import { Router } from "express";
import { CertificationStatus, PaymentState, UserRoleCode } from "@prisma/client";
import { z } from "zod";
import { config } from "../config";
import { writeAuditLog } from "../lib/audit";
import { prisma } from "../lib/prisma";
import { getReminderSchedulerStatus, runReminderSchedulerNow } from "../lib/reminder-scheduler";
import { getRetentionSchedulerStatus, runRetentionNow } from "../lib/retention-job";
import { AuthenticatedRequest, requireAuth, requireRole } from "../middleware/auth";

const router = Router();

const ACTIVE_CERTIFICATION_STATUSES = [
  CertificationStatus.DRAFT,
  CertificationStatus.IN_PROGRESS,
  CertificationStatus.READY_TO_GENERATE,
  CertificationStatus.GENERATED,
];

function addDays(days: number) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date;
}

function parseMetadata(value: string | null) {
  if (!value) {
    return null;
  }

  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    return { raw: value };
  }
}

function countBy<T extends string>(values: T[]) {
  return values.reduce<Record<string, number>>((accumulator, value) => {
    accumulator[value] = (accumulator[value] ?? 0) + 1;
    return accumulator;
  }, {});
}

function getStatusWarningLevel(actionType: string) {
  if (actionType.includes("FAILED") || actionType.includes("DENIED") || actionType.includes("ERROR")) {
    return "HIGH";
  }
  if (actionType.includes("PASSWORD") || actionType.includes("PAYMENT") || actionType.includes("ADMIN")) {
    return "MEDIUM";
  }
  return "LOW";
}

router.get("/summary", requireAuth, requireRole([UserRoleCode.ADMIN]), async (_req, res) => {
  const now = new Date();
  const expirationLimit = addDays(60);
  const abandonedLimit = addDays(-15);

  const [
    roles,
    activeClients,
    users,
    activeCertifications,
    activeTemplates,
    activeSaqTypes,
    activeMappings,
    requirements,
    activeAssignments,
    generatedDocuments,
    notificationCount,
    recentAuditLogs,
  ] = await Promise.all([
    prisma.role.findMany({ select: { code: true } }),
    prisma.client.findMany({
      where: { isActive: true },
      include: {
        executiveAssignments: { where: { isActive: true }, include: { executive: true } },
        certifications: {
          where: { status: { in: ACTIVE_CERTIFICATION_STATUSES } },
          orderBy: [{ cycleYear: "desc" }, { updatedAt: "desc" }],
          include: { saqType: true, paymentStatus: true },
        },
      },
    }),
    prisma.user.findMany({ where: { isActive: true }, include: { role: true } }),
    prisma.certification.findMany({
      where: { status: { in: ACTIVE_CERTIFICATION_STATUSES } },
      include: { client: true, saqType: true, paymentStatus: true },
      orderBy: { updatedAt: "desc" },
    }),
    prisma.documentTemplate.count({ where: { isActive: true, isArchived: false } }),
    prisma.saqType.findMany({
      where: { isActive: true },
      include: { requirementMap: { where: { isActive: true }, select: { displayOrder: true, requirementId: true } } },
      orderBy: { code: "asc" },
    }),
    prisma.saqRequirementMap.count({ where: { isActive: true } }),
    prisma.pciRequirement.count({ where: { isActive: true } }),
    prisma.executiveClientAssignment.count({ where: { isActive: true } }),
    prisma.clientDocument.count({ where: { generatedType: { not: null }, isArchived: false } }),
    prisma.notificationLog.count(),
    prisma.auditLog.findMany({
      orderBy: { createdAt: "desc" },
      take: 50,
      include: { user: { select: { username: true, email: true, firstName: true, lastName: true } } },
    }),
  ]);

  const certificationStatus = countBy(activeCertifications.map((certification) => certification.status));
  const paymentStatus = countBy(
    activeCertifications.map((certification) => certification.paymentStatus?.state ?? PaymentState.UNPAID),
  );
  const activeUsersByRole = countBy(users.map((user) => user.role.code));
  const activeAdmins = activeUsersByRole[UserRoleCode.ADMIN] ?? 0;
  const activeExecutives = activeUsersByRole[UserRoleCode.EXECUTIVE] ?? 0;

  const expirations = activeCertifications
    .filter((certification) => certification.validUntil && certification.validUntil >= now && certification.validUntil <= expirationLimit)
    .map((certification) => ({
      certificationId: certification.id,
      clientId: certification.clientId,
      companyName: certification.client.companyName,
      saqTypeCode: certification.saqType.code,
      status: certification.status,
      paymentState: certification.paymentStatus?.state ?? PaymentState.UNPAID,
      validUntil: certification.validUntil?.toISOString() ?? null,
    }));

  const abandoned = activeCertifications
    .filter((certification) => certification.status !== CertificationStatus.GENERATED && certification.updatedAt < abandonedLimit)
    .slice(0, 30)
    .map((certification) => ({
      certificationId: certification.id,
      clientId: certification.clientId,
      companyName: certification.client.companyName,
      saqTypeCode: certification.saqType.code,
      status: certification.status,
      paymentState: certification.paymentStatus?.state ?? PaymentState.UNPAID,
      lastActivityAt: certification.updatedAt.toISOString(),
    }));

  const executivePortfolio = users
    .filter((user) => user.role.code === UserRoleCode.EXECUTIVE)
    .map((executive) => {
      const assignedClients = activeClients.filter((client) =>
        client.executiveAssignments.some((assignment) => assignment.executiveUserId === executive.id),
      );
      return {
        executiveUserId: executive.id,
        name: `${executive.firstName} ${executive.lastName}`.trim(),
        username: executive.username,
        email: executive.email,
        activeClientCount: assignedClients.length,
        clients: assignedClients.slice(0, 10).map((client) => client.companyName),
      };
    })
    .sort((left, right) => right.activeClientCount - left.activeClientCount);

  const mappingIssues = activeSaqTypes.flatMap((saqType) => {
    const displayOrderCounts = countBy(saqType.requirementMap.map((mapping) => String(mapping.displayOrder)));
    const duplicateOrders = Object.entries(displayOrderCounts)
      .filter(([, total]) => total > 1)
      .map(([displayOrder]) => displayOrder);

    return [
      ...(saqType.requirementMap.length === 0
        ? [{ saqTypeCode: saqType.code, severity: "HIGH", message: "SAQ activo sin requisitos mapeados." }]
        : []),
      ...duplicateOrders.map((displayOrder) => ({
        saqTypeCode: saqType.code,
        severity: "MEDIUM",
        message: `Orden duplicado ${displayOrder} en el mapeo activo.`,
      })),
    ];
  });

  const dataHealthWarnings = [
    ...(roles.length < 3 ? ["Faltan roles base de administracion, ejecutivo o cliente."] : []),
    ...(activeAdmins === 0 ? ["No hay administradores activos."] : []),
    ...(activeSaqTypes.length === 0 ? ["No hay tipos de SAQ activos."] : []),
    ...(activeMappings === 0 ? ["No hay mapeos SAQ-requisito activos."] : []),
    ...(requirements === 0 ? ["No hay catalogo de requisitos PCI activo."] : []),
    ...(activeTemplates === 0 ? ["No hay plantillas activas."] : []),
    ...(activeClients.some((client) => client.executiveAssignments.length === 0)
      ? ["Hay clientes activos sin ejecutivo asignado."]
      : []),
    ...(activeCertifications.some((certification) => !certification.paymentStatus)
      ? ["Hay certificaciones activas sin estado de pago."]
      : []),
    ...mappingIssues.map((issue) => `${issue.saqTypeCode}: ${issue.message}`),
  ];

  res.json({
    generatedAt: now.toISOString(),
    maintenance: {
      enabled: config.maintenanceModeEnabled,
      message: config.maintenanceMessage,
    },
    counts: {
      activeClients: activeClients.length,
      activeUsers: users.length,
      activeAdmins,
      activeExecutives,
      activeCertifications: activeCertifications.length,
      readyToGenerate: certificationStatus[CertificationStatus.READY_TO_GENERATE] ?? 0,
      generated: certificationStatus[CertificationStatus.GENERATED] ?? 0,
      generatedDocuments,
      activeTemplates,
      activeSaqTypes: activeSaqTypes.length,
      activeMappings,
      activeAssignments,
      notificationCount,
      auditLogCount: await prisma.auditLog.count(),
    },
    certificationStatus,
    paymentStatus,
    expirations,
    abandoned,
    executivePortfolio,
    mappingIssues,
    dataHealth: {
      ok: dataHealthWarnings.length === 0,
      warnings: dataHealthWarnings,
      roles: roles.map((role) => role.code),
    },
    reminderScheduler: getReminderSchedulerStatus(),
    retentionScheduler: getRetentionSchedulerStatus(),
    recentAuditLogs: recentAuditLogs.map((log) => ({
      id: log.id,
      actionType: log.actionType,
      warningLevel: getStatusWarningLevel(log.actionType),
      targetTable: log.targetTable,
      targetId: log.targetId,
      clientId: log.clientId,
      certificationId: log.certificationId,
      roleCode: log.roleCode,
      user: log.user
        ? {
            username: log.user.username,
            email: log.user.email,
            name: `${log.user.firstName} ${log.user.lastName}`.trim(),
          }
        : null,
      ipAddress: log.ipAddress,
      userAgent: log.userAgent,
      metadata: parseMetadata(log.metadataJson),
      createdAt: log.createdAt.toISOString(),
    })),
    backupGuidance: {
      database: [
        "Crear carpeta local de respaldo en el VPS: mkdir -p backups",
        "Copiar SQLite desde el contenedor: docker cp $(docker compose ps -q backend):/data/prod.db ./backups/prod-$(date +%F-%H%M).db",
        "Restaurar solo en ventana de mantenimiento: detener backend, reemplazar /data/prod.db con el respaldo validado y levantar nuevamente.",
      ],
      uploads: [
        "Respaldar archivos: docker run --rm --volumes-from $(docker compose ps -q backend) -v \"$PWD/backups\":/backup alpine sh -lc 'tar czf /backup/uploads-$(date +%F-%H%M).tgz /uploads'",
        "Restaurar archivos solo con mantenimiento activo y despues de validar permisos del volumen uploads_data.",
      ],
      productionSeed: [
        "Despues de una instalacion fresca ejecutar: docker compose exec backend npm run saq:import",
        "Luego ejecutar: docker compose exec backend npm run templates:seed",
      ],
    },
  });
});

router.post("/reminders/run-now", requireAuth, requireRole([UserRoleCode.ADMIN]), async (req: AuthenticatedRequest, res) => {
  const result = await runReminderSchedulerNow("admin-operations");

  await writeAuditLog({
    userId: req.auth?.userId,
    roleCode: req.auth?.role,
    actionType: "ADMIN_REMINDER_SCAN_RUN",
    targetTable: "NotificationLog",
    ipAddress: req.ip,
    userAgent: req.headers["user-agent"],
    metadata: result,
  });

  res.json(result);
});

router.post(
  "/retention/run-now",
  requireAuth,
  requireRole([UserRoleCode.ADMIN]),
  async (req: AuthenticatedRequest, res) => {
    const result = await runRetentionNow("admin-operations");

    await writeAuditLog({
      userId: req.auth?.userId,
      roleCode: req.auth?.role,
      actionType: "ADMIN_RETENTION_RUN",
      targetTable: "Certification",
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
      metadata: result,
    });

    res.json(result);
  },
);

const auditLogFiltersSchema = z.object({
  limit: z.coerce.number().int().min(1).max(2000).default(100),
  actionType: z.string().trim().optional(),
  userId: z.string().trim().optional(),
  clientId: z.string().trim().optional(),
  // Inclusive date range in YYYY-MM-DD format or ISO timestamp.
  from: z.string().trim().optional(),
  to: z.string().trim().optional(),
});

function buildAuditLogWhere(filters: z.infer<typeof auditLogFiltersSchema>) {
  const where: Record<string, unknown> = {};
  if (filters.actionType) where.actionType = { contains: filters.actionType };
  if (filters.userId) where.userId = filters.userId;
  if (filters.clientId) where.clientId = filters.clientId;

  const fromDate = filters.from ? new Date(filters.from) : null;
  const toDate = filters.to ? new Date(filters.to) : null;
  if ((fromDate && !Number.isNaN(fromDate.getTime())) || (toDate && !Number.isNaN(toDate.getTime()))) {
    where.createdAt = {
      ...(fromDate && !Number.isNaN(fromDate.getTime()) ? { gte: fromDate } : {}),
      ...(toDate && !Number.isNaN(toDate.getTime()) ? { lte: toDate } : {}),
    };
  }

  return where;
}

router.get("/audit-logs", requireAuth, requireRole([UserRoleCode.ADMIN]), async (req, res) => {
  const parsed = auditLogFiltersSchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ message: "Filtros de auditoria invalidos." });
  }

  const filters = parsed.data;
  const logs = await prisma.auditLog.findMany({
    where: buildAuditLogWhere(filters),
    orderBy: { createdAt: "desc" },
    take: filters.limit,
    include: { user: { select: { username: true, email: true, firstName: true, lastName: true } } },
  });

  res.json({
    items: logs.map((log) => ({
      id: log.id,
      actionType: log.actionType,
      warningLevel: getStatusWarningLevel(log.actionType),
      targetTable: log.targetTable,
      targetId: log.targetId,
      clientId: log.clientId,
      certificationId: log.certificationId,
      roleCode: log.roleCode,
      user: log.user
        ? {
            username: log.user.username,
            email: log.user.email,
            name: `${log.user.firstName} ${log.user.lastName}`.trim(),
          }
        : null,
      ipAddress: log.ipAddress,
      metadata: parseMetadata(log.metadataJson),
      createdAt: log.createdAt.toISOString(),
    })),
  });
});

function escapeCsvField(value: unknown) {
  if (value === null || value === undefined) {
    return "";
  }
  const stringValue = typeof value === "string" ? value : JSON.stringify(value);
  if (/[",\n\r]/.test(stringValue)) {
    return `"${stringValue.replace(/"/g, '""')}"`;
  }
  return stringValue;
}

router.get(
  "/audit-logs.csv",
  requireAuth,
  requireRole([UserRoleCode.ADMIN]),
  async (req: AuthenticatedRequest, res) => {
    const parsed = auditLogFiltersSchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ message: "Filtros de auditoria invalidos." });
    }

    const filters = { ...parsed.data, limit: Math.min(parsed.data.limit ?? 2000, 2000) };
    const logs = await prisma.auditLog.findMany({
      where: buildAuditLogWhere(filters),
      orderBy: { createdAt: "desc" },
      take: filters.limit,
      include: { user: { select: { username: true, email: true, firstName: true, lastName: true } } },
    });

    const header = [
      "createdAt",
      "actionType",
      "roleCode",
      "username",
      "userEmail",
      "userName",
      "clientId",
      "certificationId",
      "targetTable",
      "targetId",
      "ipAddress",
      "metadata",
    ];
    const rows = logs.map((log) => [
      log.createdAt.toISOString(),
      log.actionType,
      log.roleCode ?? "",
      log.user?.username ?? "",
      log.user?.email ?? "",
      log.user ? `${log.user.firstName} ${log.user.lastName}`.trim() : "",
      log.clientId ?? "",
      log.certificationId ?? "",
      log.targetTable ?? "",
      log.targetId ?? "",
      log.ipAddress ?? "",
      log.metadataJson ?? "",
    ]);

    const csv = [header, ...rows]
      .map((columns) => columns.map((value) => escapeCsvField(value)).join(","))
      .join("\r\n");

    await writeAuditLog({
      userId: req.auth?.userId,
      roleCode: req.auth?.role,
      actionType: "ADMIN_AUDIT_LOGS_EXPORTED",
      targetTable: "AuditLog",
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
      metadata: { exportedRowCount: logs.length, filters },
    });

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="pcinexus-audit-logs-${new Date().toISOString().slice(0, 10)}.csv"`,
    );
    res.send(csv);
  },
);

export default router;
