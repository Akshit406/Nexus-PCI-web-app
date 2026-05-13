import { Router } from "express";
import { CertificationStatus, ClientStatus, PaymentState, UserRoleCode } from "@prisma/client";
import { z } from "zod";
import { hashPassword } from "../lib/auth";
import { writeAuditLog } from "../lib/audit";
import { prisma } from "../lib/prisma";
import { AuthenticatedRequest, requireAuth, requireRole } from "../middleware/auth";

const router = Router();

function getUserAgentHeader(value: string | string[] | undefined) {
  return Array.isArray(value) ? value.join(", ") : value;
}

router.get("/", requireAuth, requireRole([UserRoleCode.ADMIN]), async (_req, res) => {
  const [clients, saqTypes, executives] = await Promise.all([
    prisma.client.findMany({
      where: { isActive: true },
      orderBy: { createdAt: "desc" },
      include: {
        users: { include: { user: true }, orderBy: { createdAt: "asc" } },
        certifications: {
          where: { status: { not: CertificationStatus.ARCHIVED } },
          orderBy: [{ cycleYear: "desc" }, { createdAt: "desc" }],
          include: { saqType: true, paymentStatus: true },
        },
      },
    }),
    prisma.saqType.findMany({
      where: { isActive: true },
      orderBy: [{ code: "asc" }, { name: "asc" }],
      select: { id: true, code: true, name: true, templateVersion: true },
    }),
    prisma.user.findMany({
      where: { isActive: true, role: { code: UserRoleCode.EXECUTIVE } },
      orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
      select: { id: true, firstName: true, lastName: true, username: true, email: true },
    }),
  ]);

  res.json({
    saqTypes,
    executives,
    items: clients.map((client) => {
      const currentCertification = client.certifications[0] ?? null;
      const primaryUser = client.users.find((link) => link.isPrimary)?.user ?? client.users[0]?.user ?? null;
      return {
        id: client.id,
        companyName: client.companyName,
        businessType: client.businessType,
        status: client.status,
        primaryContactName: client.primaryContactName,
        primaryContactEmail: client.primaryContactEmail,
        username: primaryUser?.username ?? null,
        currentCertification: currentCertification
          ? {
              id: currentCertification.id,
              cycleYear: currentCertification.cycleYear,
              status: currentCertification.status,
              saqTypeCode: currentCertification.saqType.code,
              saqTypeName: currentCertification.saqType.name,
              paymentState: currentCertification.paymentStatus?.state ?? PaymentState.UNPAID,
            }
          : null,
      };
    }),
  });
});

router.post("/", requireAuth, requireRole([UserRoleCode.ADMIN]), async (req: AuthenticatedRequest, res) => {
  const schema = z.object({
    companyName: z.string().trim().min(2),
    businessType: z.string().trim().min(2),
    dbaName: z.string().trim().optional(),
    website: z.string().trim().optional(),
    taxId: z.string().trim().optional(),
    postalAddress: z.string().trim().optional(),
    fiscalAddress: z.string().trim().optional(),
    primaryContactName: z.string().trim().min(2),
    primaryContactTitle: z.string().trim().optional(),
    primaryContactEmail: z.string().trim().email(),
    primaryContactPhone: z.string().trim().optional(),
    username: z.string().trim().min(3),
    temporaryPassword: z.string().min(8),
    saqTypeId: z.string().min(1),
    cycleYear: z.number().int().min(2020).max(2100),
    paymentState: z.nativeEnum(PaymentState).default(PaymentState.UNPAID),
    executiveUserId: z.string().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "Datos de cliente invalidos." });
  }

  const data = parsed.data;
  const [existingUser, saqType, clientRole, executive] = await Promise.all([
    prisma.user.findFirst({
      where: { OR: [{ username: data.username }, { email: data.primaryContactEmail }] },
    }),
    prisma.saqType.findUnique({ where: { id: data.saqTypeId } }),
    prisma.role.findUnique({ where: { code: UserRoleCode.CLIENT } }),
    data.executiveUserId
      ? prisma.user.findFirst({
          where: { id: data.executiveUserId, isActive: true, role: { code: UserRoleCode.EXECUTIVE } },
        })
      : Promise.resolve(null),
  ]);

  if (existingUser) {
    return res.status(409).json({ message: "Ya existe un usuario con ese username o correo." });
  }
  if (!saqType || !saqType.isActive) {
    return res.status(404).json({ message: "SAQ no encontrado o inactivo." });
  }
  if (!clientRole) {
    return res.status(500).json({ message: "Rol de cliente no configurado." });
  }
  if (data.executiveUserId && !executive) {
    return res.status(404).json({ message: "Ejecutivo no encontrado." });
  }

  const passwordHash = await hashPassword(data.temporaryPassword);
  const result = await prisma.$transaction(async (tx) => {
    const client = await tx.client.create({
      data: {
        companyName: data.companyName,
        dbaName: data.dbaName || null,
        businessType: data.businessType,
        website: data.website || null,
        taxId: data.taxId || null,
        postalAddress: data.postalAddress || null,
        fiscalAddress: data.fiscalAddress || null,
        primaryContactName: data.primaryContactName,
        primaryContactTitle: data.primaryContactTitle || null,
        primaryContactEmail: data.primaryContactEmail,
        primaryContactPhone: data.primaryContactPhone || null,
        status: ClientStatus.IN_PROGRESS,
      },
    });

    const user = await tx.user.create({
      data: {
        roleId: clientRole.id,
        email: data.primaryContactEmail,
        username: data.username,
        passwordHash,
        firstName: data.primaryContactName.split(/\s+/)[0] ?? data.primaryContactName,
        lastName: data.primaryContactName.split(/\s+/).slice(1).join(" ") || "Cliente",
        phone: data.primaryContactPhone || null,
        mustChangePassword: true,
      },
    });

    await tx.clientUser.create({
      data: { clientId: client.id, userId: user.id, isPrimary: true },
    });

    if (data.executiveUserId) {
      await tx.executiveClientAssignment.create({
        data: { clientId: client.id, executiveUserId: data.executiveUserId, isActive: true },
      });
    }

    const certification = await tx.certification.create({
      data: {
        clientId: client.id,
        saqTypeId: saqType.id,
        cycleYear: data.cycleYear,
        status: CertificationStatus.IN_PROGRESS,
        startedAt: new Date(),
        templateVersionSnapshot: saqType.templateVersion,
      },
    });

    await tx.paymentStatus.create({
      data: {
        clientId: client.id,
        certificationId: certification.id,
        state: data.paymentState,
        updatedByUserId: req.auth!.userId,
        notes: "Cliente de prueba creado desde administracion.",
      },
    });

    return { client, user, certification };
  });

  await writeAuditLog({
    userId: req.auth?.userId,
    roleCode: req.auth?.role,
    actionType: "ADMIN_CLIENT_CREATED",
    targetTable: "Client",
    targetId: result.client.id,
    clientId: result.client.id,
    certificationId: result.certification.id,
    ipAddress: req.ip,
    userAgent: getUserAgentHeader(req.headers["user-agent"]),
    metadata: {
      username: result.user.username,
      saqType: saqType.code,
      cycleYear: data.cycleYear,
    },
  });

  res.status(201).json({
    id: result.client.id,
    companyName: result.client.companyName,
    username: result.user.username,
    temporaryPassword: data.temporaryPassword,
    certificationId: result.certification.id,
    saqTypeCode: saqType.code,
    cycleYear: result.certification.cycleYear,
  });
});

export default router;
