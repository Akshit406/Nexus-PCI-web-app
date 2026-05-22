import { Router } from "express";
import {
  AsvScanFinding,
  AsvScanSeverity,
  AsvScanStatus,
  Prisma,
  UserRoleCode,
} from "@prisma/client";
import { z } from "zod";
import { writeAuditLog } from "../lib/audit";
import { prisma } from "../lib/prisma";
import { AuthenticatedRequest, requireAuth, requireRole } from "../middleware/auth";

const router = Router();

function getUserAgentHeader(value: string | string[] | undefined) {
  return Array.isArray(value) ? value.join(", ") : value;
}

function generateScanReference() {
  const stamp = new Date()
    .toISOString()
    .replace(/[-:.TZ]/g, "")
    .slice(0, 14);
  const random = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `ASV-${stamp}-${random}`;
}

const SAMPLE_FINDINGS: Array<{
  title: string;
  description: string;
  remediation: string;
  severity: AsvScanSeverity;
  cve?: string;
}> = [
  {
    title: "TLS 1.0 / 1.1 still negotiable",
    description: "El endpoint acepta protocolos TLS heredados que ya no se consideran seguros.",
    remediation: "Deshabilitar TLS 1.0 y 1.1 en el balanceador o servidor web. Mantener solo TLS 1.2+.",
    severity: AsvScanSeverity.HIGH,
  },
  {
    title: "Encabezados HTTP Strict-Transport-Security ausentes",
    description: "El servidor no envia el encabezado HSTS para forzar el uso de HTTPS.",
    remediation: "Configurar HSTS (max-age >= 31536000; includeSubDomains).",
    severity: AsvScanSeverity.MEDIUM,
  },
  {
    title: "Certificado expira en menos de 30 dias",
    description: "El certificado del dominio principal expira pronto.",
    remediation: "Renovar el certificado y verificar el pipeline de auto-renovacion en Let's Encrypt.",
    severity: AsvScanSeverity.LOW,
  },
  {
    title: "Puerto SSH abierto a Internet",
    description: "El puerto 22 esta accesible publicamente sin restriccion por IP.",
    remediation: "Restringir el acceso SSH mediante bastion, VPN o reglas de firewall por IP.",
    severity: AsvScanSeverity.MEDIUM,
  },
  {
    title: "Servicio expone version (banner)",
    description: "El servidor responde con banners que revelan la version exacta del software.",
    remediation: "Ocultar versiones en cabeceras y banners de servicios HTTP/SMTP/SSH.",
    severity: AsvScanSeverity.LOW,
  },
  {
    title: "Login admin sin MFA",
    description: "Se detecto un panel administrativo accesible sin segundo factor.",
    remediation: "Habilitar MFA obligatorio para cuentas administrativas.",
    severity: AsvScanSeverity.HIGH,
  },
];

function sampleFindings(targetScope: string) {
  const seed = targetScope.length || 4;
  const count = 1 + (seed % 4); // 1..4 findings
  const findings: Array<Omit<AsvScanFinding, "id" | "scanId" | "createdAt">> = [];
  for (let index = 0; index < count; index += 1) {
    const template = SAMPLE_FINDINGS[(seed + index) % SAMPLE_FINDINGS.length];
    findings.push({
      cve: template.cve ?? null,
      hostTarget: targetScope.split(/[ ,;]+/).filter(Boolean)[0] ?? "primary-host",
      severity: template.severity,
      title: template.title,
      description: template.description,
      remediation: template.remediation,
      isResolved: false,
      resolvedAt: null,
    });
  }
  return findings;
}

function decideFinalStatus(findings: ReturnType<typeof sampleFindings>) {
  if (findings.some((finding) => finding.severity === AsvScanSeverity.CRITICAL || finding.severity === AsvScanSeverity.HIGH)) {
    return AsvScanStatus.NEEDS_REMEDIATION;
  }
  if (findings.length === 0) {
    return AsvScanStatus.PASSED;
  }
  return AsvScanStatus.PASSED;
}

async function assertExecutiveOwnsClient(executiveUserId: string, clientId: string) {
  const assignment = await prisma.executiveClientAssignment.findFirst({
    where: { executiveUserId, clientId, isActive: true },
  });
  return Boolean(assignment);
}

async function authorizeScopedAccess(
  req: AuthenticatedRequest,
  clientId: string,
): Promise<{ ok: true } | { ok: false; status: number; message: string }> {
  if (!req.auth) {
    return { ok: false, status: 401, message: "Se requiere iniciar sesion." };
  }
  if (req.auth.role === UserRoleCode.ADMIN) {
    return { ok: true };
  }
  if (req.auth.role === UserRoleCode.EXECUTIVE) {
    const owns = await assertExecutiveOwnsClient(req.auth.userId, clientId);
    return owns
      ? { ok: true }
      : { ok: false, status: 403, message: "No tienes asignado este cliente." };
  }
  if (req.auth.role === UserRoleCode.CLIENT) {
    const link = await prisma.clientUser.findFirst({
      where: { clientId, userId: req.auth.userId },
    });
    return link
      ? { ok: true }
      : { ok: false, status: 403, message: "No tienes acceso a este cliente." };
  }
  return { ok: false, status: 403, message: "Rol no autorizado." };
}

function serializeScan(scan: Prisma.AsvScanGetPayload<{ include: { findings: true } }>) {
  return {
    id: scan.id,
    clientId: scan.clientId,
    certificationId: scan.certificationId,
    scanReference: scan.scanReference,
    targetScope: scan.targetScope,
    status: scan.status,
    requestedAt: scan.requestedAt.toISOString(),
    startedAt: scan.startedAt?.toISOString() ?? null,
    completedAt: scan.completedAt?.toISOString() ?? null,
    summary: scan.summary,
    externalVendorRef: scan.externalVendorRef,
    findings: scan.findings.map((finding) => ({
      id: finding.id,
      cve: finding.cve,
      hostTarget: finding.hostTarget,
      severity: finding.severity,
      title: finding.title,
      description: finding.description,
      remediation: finding.remediation,
      isResolved: finding.isResolved,
      resolvedAt: finding.resolvedAt?.toISOString() ?? null,
    })),
  };
}

router.get(
  "/clients/:clientId/scans",
  requireAuth,
  requireRole([UserRoleCode.CLIENT, UserRoleCode.EXECUTIVE, UserRoleCode.ADMIN]),
  async (req: AuthenticatedRequest, res) => {
    const clientId = Array.isArray(req.params.clientId) ? req.params.clientId[0] : req.params.clientId;
    if (!clientId) {
      return res.status(400).json({ message: "clientId requerido." });
    }
    const auth = await authorizeScopedAccess(req, clientId);
    if (!auth.ok) {
      return res.status(auth.status).json({ message: auth.message });
    }
    const scans = await prisma.asvScan.findMany({
      where: { clientId },
      orderBy: { requestedAt: "desc" },
      include: { findings: true },
    });
    res.json({ items: scans.map(serializeScan) });
  },
);

router.post(
  "/clients/:clientId/scans",
  requireAuth,
  requireRole([UserRoleCode.EXECUTIVE, UserRoleCode.ADMIN]),
  async (req: AuthenticatedRequest, res) => {
    const schema = z.object({
      targetScope: z.string().trim().min(3),
      certificationId: z.string().optional(),
      externalVendorRef: z.string().trim().optional(),
    });
    const parsed = schema.safeParse(req.body);
    const clientId = Array.isArray(req.params.clientId) ? req.params.clientId[0] : req.params.clientId;
    if (!parsed.success || !clientId || !req.auth) {
      return res.status(400).json({ message: "Datos de scan ASV invalidos." });
    }
    const auth = await authorizeScopedAccess(req, clientId);
    if (!auth.ok) {
      return res.status(auth.status).json({ message: auth.message });
    }

    const scan = await prisma.asvScan.create({
      data: {
        clientId,
        certificationId: parsed.data.certificationId || null,
        scanReference: generateScanReference(),
        targetScope: parsed.data.targetScope,
        requestedByUserId: req.auth.userId,
        externalVendorRef: parsed.data.externalVendorRef || null,
        status: AsvScanStatus.REQUESTED,
      },
      include: { findings: true },
    });

    await writeAuditLog({
      userId: req.auth.userId,
      roleCode: req.auth.role,
      actionType: "ASV_SCAN_REQUESTED",
      targetTable: "AsvScan",
      targetId: scan.id,
      clientId,
      certificationId: parsed.data.certificationId,
      ipAddress: req.ip,
      userAgent: getUserAgentHeader(req.headers["user-agent"]),
      metadata: { scanReference: scan.scanReference, targetScope: parsed.data.targetScope },
    });

    res.status(201).json(serializeScan(scan));
  },
);

router.post(
  "/scans/:scanId/simulate",
  requireAuth,
  requireRole([UserRoleCode.EXECUTIVE, UserRoleCode.ADMIN]),
  async (req: AuthenticatedRequest, res) => {
    const scanId = Array.isArray(req.params.scanId) ? req.params.scanId[0] : req.params.scanId;
    if (!scanId || !req.auth) {
      return res.status(400).json({ message: "scanId requerido." });
    }
    const scan = await prisma.asvScan.findUnique({ where: { id: scanId } });
    if (!scan) {
      return res.status(404).json({ message: "Scan no encontrado." });
    }
    const auth = await authorizeScopedAccess(req, scan.clientId);
    if (!auth.ok) {
      return res.status(auth.status).json({ message: auth.message });
    }
    if (scan.status === AsvScanStatus.PASSED || scan.status === AsvScanStatus.NEEDS_REMEDIATION) {
      return res.status(400).json({ message: "El scan ya fue completado." });
    }

    const findings = sampleFindings(scan.targetScope);
    const finalStatus = decideFinalStatus(findings);
    const summary =
      finalStatus === AsvScanStatus.PASSED
        ? "Scan completado sin hallazgos criticos."
        : `Scan completado con ${findings.length} hallazgo(s). Atiende los marcados como HIGH/CRITICAL.`;

    const completed = await prisma.$transaction(async (tx) => {
      await tx.asvScan.update({
        where: { id: scanId },
        data: {
          status: AsvScanStatus.IN_PROGRESS,
          startedAt: scan.startedAt ?? new Date(),
        },
      });

      if (findings.length > 0) {
        await tx.asvScanFinding.createMany({
          data: findings.map((finding) => ({ ...finding, scanId })),
        });
      }

      return tx.asvScan.update({
        where: { id: scanId },
        data: {
          status: finalStatus,
          completedAt: new Date(),
          completedByUserId: req.auth!.userId,
          summary,
        },
        include: { findings: true },
      });
    });

    await writeAuditLog({
      userId: req.auth.userId,
      roleCode: req.auth.role,
      actionType: "ASV_SCAN_SIMULATED",
      targetTable: "AsvScan",
      targetId: scanId,
      clientId: scan.clientId,
      certificationId: scan.certificationId ?? undefined,
      ipAddress: req.ip,
      userAgent: getUserAgentHeader(req.headers["user-agent"]),
      metadata: {
        scanReference: scan.scanReference,
        findings: findings.length,
        finalStatus,
      },
    });

    res.json(serializeScan(completed));
  },
);

router.patch(
  "/scans/:scanId/findings/:findingId",
  requireAuth,
  requireRole([UserRoleCode.EXECUTIVE, UserRoleCode.ADMIN]),
  async (req: AuthenticatedRequest, res) => {
    const schema = z.object({ isResolved: z.boolean() });
    const parsed = schema.safeParse(req.body);
    const scanId = Array.isArray(req.params.scanId) ? req.params.scanId[0] : req.params.scanId;
    const findingId = Array.isArray(req.params.findingId) ? req.params.findingId[0] : req.params.findingId;
    if (!parsed.success || !scanId || !findingId || !req.auth) {
      return res.status(400).json({ message: "Solicitud invalida." });
    }
    const scan = await prisma.asvScan.findUnique({ where: { id: scanId } });
    if (!scan) {
      return res.status(404).json({ message: "Scan no encontrado." });
    }
    const auth = await authorizeScopedAccess(req, scan.clientId);
    if (!auth.ok) {
      return res.status(auth.status).json({ message: auth.message });
    }

    const finding = await prisma.asvScanFinding.update({
      where: { id: findingId },
      data: {
        isResolved: parsed.data.isResolved,
        resolvedAt: parsed.data.isResolved ? new Date() : null,
      },
    });

    await writeAuditLog({
      userId: req.auth.userId,
      roleCode: req.auth.role,
      actionType: parsed.data.isResolved ? "ASV_FINDING_RESOLVED" : "ASV_FINDING_REOPENED",
      targetTable: "AsvScanFinding",
      targetId: findingId,
      clientId: scan.clientId,
      certificationId: scan.certificationId ?? undefined,
      ipAddress: req.ip,
      userAgent: getUserAgentHeader(req.headers["user-agent"]),
    });

    res.json({
      id: finding.id,
      isResolved: finding.isResolved,
      resolvedAt: finding.resolvedAt?.toISOString() ?? null,
    });
  },
);

router.get("/summary", requireAuth, requireRole([UserRoleCode.ADMIN]), async (_req, res) => {
  const [byStatus, recent] = await Promise.all([
    prisma.asvScan.groupBy({
      by: ["status"],
      _count: { _all: true },
    }),
    prisma.asvScan.findMany({
      orderBy: { requestedAt: "desc" },
      take: 12,
      include: { findings: true, client: { select: { companyName: true } } },
    }),
  ]);
  res.json({
    countsByStatus: Object.fromEntries(byStatus.map((row) => [row.status, row._count._all])),
    recent: recent.map((scan) => ({
      ...serializeScan(scan),
      companyName: scan.client.companyName,
      unresolvedFindings: scan.findings.filter((finding) => !finding.isResolved).length,
    })),
  });
});

export default router;
