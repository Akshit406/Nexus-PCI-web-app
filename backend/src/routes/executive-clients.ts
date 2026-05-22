import { Router } from "express";
import { CertificationStatus, ClientStatus, PaymentState, UserRoleCode } from "@prisma/client";
import { z } from "zod";
import { hashPassword } from "../lib/auth";
import { writeAuditLog } from "../lib/audit";
import { sendWelcomeEmail } from "../lib/email-templates";
import { prisma } from "../lib/prisma";
import { AuthenticatedRequest, requireAuth, requireRole } from "../middleware/auth";

const router = Router();

function getUserAgentHeader(value: string | string[] | undefined) {
  return Array.isArray(value) ? value.join(", ") : value;
}

function splitName(value: string) {
  const parts = value.trim().split(/\s+/).filter(Boolean);
  return {
    firstName: parts[0] ?? value.trim(),
    lastName: parts.slice(1).join(" ") || "Cliente",
  };
}

async function assertExecutiveOwnsClient(executiveUserId: string, clientId: string) {
  const assignment = await prisma.executiveClientAssignment.findFirst({
    where: { executiveUserId, clientId, isActive: true },
  });
  return Boolean(assignment);
}

router.post(
  "/clients",
  requireAuth,
  requireRole([UserRoleCode.EXECUTIVE]),
  async (req: AuthenticatedRequest, res) => {
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
      adminContactName: z.string().trim().optional(),
      adminContactEmail: z.string().trim().email().optional().or(z.literal("")),
      adminContactPhone: z.string().trim().optional(),
      username: z.string().trim().min(3),
      temporaryPassword: z.string().min(8),
      saqTypeId: z.string().min(1),
      cycleYear: z.number().int().min(2020).max(2100),
      paymentState: z.nativeEnum(PaymentState).default(PaymentState.UNPAID),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success || !req.auth) {
      return res.status(400).json({ message: "Datos de cliente invalidos." });
    }

    const data = parsed.data;
    const [existingUser, saqType, clientRole] = await Promise.all([
      prisma.user.findFirst({
        where: { OR: [{ username: data.username }, { email: data.primaryContactEmail }] },
      }),
      prisma.saqType.findUnique({ where: { id: data.saqTypeId } }),
      prisma.role.findUnique({ where: { code: UserRoleCode.CLIENT } }),
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

    const contactName = splitName(data.primaryContactName);
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
          adminContactName: data.adminContactName || null,
          adminContactEmail: data.adminContactEmail || null,
          adminContactPhone: data.adminContactPhone || null,
          status: ClientStatus.IN_PROGRESS,
        },
      });

      const user = await tx.user.create({
        data: {
          roleId: clientRole.id,
          email: data.primaryContactEmail,
          username: data.username,
          passwordHash,
          firstName: contactName.firstName,
          lastName: contactName.lastName,
          phone: data.primaryContactPhone || null,
          mustChangePassword: true,
        },
      });

      await tx.clientUser.create({
        data: { clientId: client.id, userId: user.id, isPrimary: true },
      });

      await tx.executiveClientAssignment.create({
        data: { clientId: client.id, executiveUserId: req.auth!.userId, isActive: true },
      });

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
          notes: "Cliente creado desde portal ejecutivo.",
        },
      });

      return { client, user, certification };
    });

    await writeAuditLog({
      userId: req.auth.userId,
      roleCode: req.auth.role,
      actionType: "EXECUTIVE_CLIENT_CREATED",
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

    let welcomeEmailSent = false;
    try {
      const emailResult = await sendWelcomeEmail({
        to: result.user.email,
        fullName: `${result.user.firstName} ${result.user.lastName}`.trim(),
        companyName: result.client.companyName,
        username: result.user.username,
        temporaryPassword: data.temporaryPassword,
        saqTypeName: saqType.name,
        cycleYear: data.cycleYear,
      });
      welcomeEmailSent = Boolean(emailResult?.sent);
    } catch (error) {
      console.error("Failed to send welcome email", error);
    }

    res.status(201).json({
      id: result.client.id,
      companyName: result.client.companyName,
      username: result.user.username,
      temporaryPassword: data.temporaryPassword,
      certificationId: result.certification.id,
      saqTypeCode: saqType.code,
      cycleYear: result.certification.cycleYear,
      welcomeEmailSent,
    });
  },
);

router.patch(
  "/clients/:clientId",
  requireAuth,
  requireRole([UserRoleCode.EXECUTIVE]),
  async (req: AuthenticatedRequest, res) => {
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
      adminContactName: z.string().trim().optional(),
      adminContactEmail: z.string().trim().email().optional().or(z.literal("")),
      adminContactPhone: z.string().trim().optional(),
    });
    const parsed = schema.safeParse(req.body);
    const clientId = Array.isArray(req.params.clientId) ? req.params.clientId[0] : req.params.clientId;
    if (!parsed.success || !clientId || !req.auth) {
      return res.status(400).json({ message: "Datos de cliente invalidos." });
    }

    const ownsClient = await assertExecutiveOwnsClient(req.auth.userId, clientId);
    if (!ownsClient) {
      return res.status(403).json({ message: "No tienes acceso a este cliente." });
    }

    const client = await prisma.client.findUnique({
      where: { id: clientId },
      include: { users: { include: { user: true }, orderBy: { createdAt: "asc" } } },
    });
    if (!client || !client.isActive) {
      return res.status(404).json({ message: "Cliente no encontrado." });
    }

    const data = parsed.data;
    const updated = await prisma.client.update({
      where: { id: clientId },
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
        adminContactName: data.adminContactName || null,
        adminContactEmail: data.adminContactEmail || null,
        adminContactPhone: data.adminContactPhone || null,
      },
    });

    await writeAuditLog({
      userId: req.auth.userId,
      roleCode: req.auth.role,
      actionType: "EXECUTIVE_CLIENT_UPDATED",
      targetTable: "Client",
      targetId: updated.id,
      clientId: updated.id,
      ipAddress: req.ip,
      userAgent: getUserAgentHeader(req.headers["user-agent"]),
    });

    res.json({ id: updated.id, companyName: updated.companyName });
  },
);

router.post(
  "/clients/:clientId/deactivate",
  requireAuth,
  requireRole([UserRoleCode.EXECUTIVE]),
  async (req: AuthenticatedRequest, res) => {
    const schema = z.object({
      reason: z.string().trim().min(8, "Captura un motivo de al menos 8 caracteres."),
    });
    const parsed = schema.safeParse(req.body);
    const clientId = Array.isArray(req.params.clientId) ? req.params.clientId[0] : req.params.clientId;
    if (!parsed.success || !clientId || !req.auth) {
      return res
        .status(400)
        .json({ message: parsed.success ? "Datos invalidos." : parsed.error.issues[0]?.message ?? "Datos invalidos." });
    }

    const ownsClient = await assertExecutiveOwnsClient(req.auth.userId, clientId);
    if (!ownsClient) {
      return res.status(403).json({ message: "No tienes acceso a este cliente." });
    }

    const client = await prisma.client.findUnique({ where: { id: clientId } });
    if (!client) {
      return res.status(404).json({ message: "Cliente no encontrado." });
    }
    if (!client.isActive) {
      return res.status(400).json({ message: "El cliente ya esta desactivado." });
    }

    const updated = await prisma.$transaction(async (tx) => {
      const next = await tx.client.update({
        where: { id: clientId },
        data: {
          isActive: false,
          status: ClientStatus.SUSPENDED,
          deactivationReason: parsed.data.reason,
          deactivatedAt: new Date(),
          deactivatedByUserId: req.auth!.userId,
        },
      });

      await tx.user.updateMany({
        where: { clientLinks: { some: { clientId } }, isActive: true },
        data: { isActive: false },
      });

      return next;
    });

    await writeAuditLog({
      userId: req.auth.userId,
      roleCode: req.auth.role,
      actionType: "EXECUTIVE_CLIENT_DEACTIVATED",
      targetTable: "Client",
      targetId: updated.id,
      clientId: updated.id,
      ipAddress: req.ip,
      userAgent: getUserAgentHeader(req.headers["user-agent"]),
      metadata: { reason: parsed.data.reason },
    });

    res.json({
      id: updated.id,
      isActive: updated.isActive,
      status: updated.status,
      deactivationReason: updated.deactivationReason,
    });
  },
);

router.post(
  "/clients/:clientId/saq-assignment",
  requireAuth,
  requireRole([UserRoleCode.EXECUTIVE]),
  async (req: AuthenticatedRequest, res) => {
    const schema = z.object({
      saqTypeId: z.string().min(1),
      cycleYear: z.number().int().min(2020).max(2100),
    });
    const parsed = schema.safeParse(req.body);
    const clientId = Array.isArray(req.params.clientId) ? req.params.clientId[0] : req.params.clientId;
    if (!parsed.success || !clientId || !req.auth) {
      return res.status(400).json({ message: "Datos de SAQ invalidos." });
    }

    const ownsClient = await assertExecutiveOwnsClient(req.auth.userId, clientId);
    if (!ownsClient) {
      return res.status(403).json({ message: "No tienes acceso a este cliente." });
    }

    const [client, saqType] = await Promise.all([
      prisma.client.findUnique({
        where: { id: clientId },
        include: {
          certifications: {
            where: { status: { not: CertificationStatus.ARCHIVED } },
            orderBy: [{ cycleYear: "desc" }, { createdAt: "desc" }],
          },
        },
      }),
      prisma.saqType.findUnique({ where: { id: parsed.data.saqTypeId } }),
    ]);

    if (!client || !client.isActive) {
      return res.status(404).json({ message: "Cliente no encontrado." });
    }
    if (!saqType || !saqType.isActive) {
      return res.status(404).json({ message: "SAQ no encontrado o inactivo." });
    }

    const currentCertification = client.certifications[0] ?? null;
    if (currentCertification?.isLocked) {
      return res.status(400).json({
        message:
          "La certificacion actual esta bloqueada. Solicita a un administrador reabrirla antes de cambiar el SAQ.",
      });
    }

    const result = await prisma.$transaction(async (tx) => {
      const certification = currentCertification
        ? await tx.certification.update({
            where: { id: currentCertification.id },
            data: {
              saqTypeId: saqType.id,
              cycleYear: parsed.data.cycleYear,
              templateVersionSnapshot: saqType.templateVersion,
              status: CertificationStatus.IN_PROGRESS,
            },
          })
        : await tx.certification.create({
            data: {
              clientId,
              saqTypeId: saqType.id,
              cycleYear: parsed.data.cycleYear,
              status: CertificationStatus.IN_PROGRESS,
              startedAt: new Date(),
              templateVersionSnapshot: saqType.templateVersion,
            },
          });

      if (currentCertification && currentCertification.saqTypeId !== saqType.id) {
        const newMappings = await tx.saqRequirementMap.findMany({
          where: { saqTypeId: saqType.id, isActive: true },
          select: { requirementId: true },
        });
        const validRequirementIds = newMappings.map((mapping) => mapping.requirementId);
        const staleAnswers = await tx.certificationAnswer.findMany({
          where: {
            certificationId: certification.id,
            requirementId: { notIn: validRequirementIds.length > 0 ? validRequirementIds : ["__none__"] },
          },
          select: { id: true },
        });
        if (staleAnswers.length > 0) {
          const staleIds = staleAnswers.map((row) => row.id);
          await tx.answerJustification.deleteMany({ where: { certificationAnswerId: { in: staleIds } } });
          await tx.certificationAnswer.deleteMany({ where: { id: { in: staleIds } } });
        }
      }

      return certification;
    });

    await writeAuditLog({
      userId: req.auth.userId,
      roleCode: req.auth.role,
      actionType: "EXECUTIVE_CLIENT_SAQ_ASSIGNED",
      targetTable: "Certification",
      targetId: result.id,
      clientId,
      certificationId: result.id,
      ipAddress: req.ip,
      userAgent: getUserAgentHeader(req.headers["user-agent"]),
      metadata: { saqTypeCode: saqType.code, cycleYear: parsed.data.cycleYear },
    });

    res.json({
      id: result.id,
      saqTypeId: result.saqTypeId,
      cycleYear: result.cycleYear,
      status: result.status,
    });
  },
);

export default router;
