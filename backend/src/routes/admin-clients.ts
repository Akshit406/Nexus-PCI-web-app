import { Router } from "express";
import { CertificationStatus, ClientStatus, PaymentState, UserRoleCode } from "@prisma/client";
import { z } from "zod";
import { hashPassword } from "../lib/auth";
import { writeAuditLog } from "../lib/audit";
import {
  sendAdditionalUserEmail,
  sendCertificationReopenedEmail,
  sendWelcomeEmail,
} from "../lib/email-templates";
import { prisma } from "../lib/prisma";
import { selectableSaqTypeWhere } from "../lib/saq-type-catalog";
import { strongPasswordSchema } from "../lib/password-policy";
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

async function assertUniqueUserIdentity(input: {
  username: string;
  email: string;
  excludeUserId?: string;
}) {
  const existingUser = await prisma.user.findFirst({
    where: {
      OR: [{ username: input.username }, { email: input.email }],
      ...(input.excludeUserId ? { id: { not: input.excludeUserId } } : {}),
    },
  });

  return existingUser;
}

router.get("/", requireAuth, requireRole([UserRoleCode.ADMIN]), async (_req, res) => {
  const [clients, saqTypes, executives] = await Promise.all([
    prisma.client.findMany({
      where: { isActive: true },
      orderBy: { createdAt: "desc" },
      include: {
        users: { include: { user: true }, orderBy: { createdAt: "asc" } },
        executiveAssignments: { where: { isActive: true } },
        certifications: {
          where: { status: { not: CertificationStatus.ARCHIVED } },
          orderBy: [{ cycleYear: "desc" }, { createdAt: "desc" }],
          include: { saqType: true, paymentStatus: true },
        },
      },
    }),
    prisma.saqType.findMany({
      where: selectableSaqTypeWhere,
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
        adminContactName: client.adminContactName,
        adminContactEmail: client.adminContactEmail,
        adminContactPhone: client.adminContactPhone,
        username: primaryUser?.username ?? null,
        users: client.users.map((link) => ({
          id: link.user.id,
          username: link.user.username,
          email: link.user.email,
          firstName: link.user.firstName,
          lastName: link.user.lastName,
          isPrimary: link.isPrimary,
          isActive: link.user.isActive,
          mustChangePassword: link.user.mustChangePassword,
        })),
        dbaName: client.dbaName,
        website: client.website,
        taxId: client.taxId,
        postalAddress: client.postalAddress,
        fiscalAddress: client.fiscalAddress,
        primaryContactTitle: client.primaryContactTitle,
        primaryContactPhone: client.primaryContactPhone,
        executiveUserId: client.executiveAssignments.find((assignment) => assignment.isActive)?.executiveUserId ?? null,
        currentCertification: currentCertification
          ? {
              id: currentCertification.id,
              cycleYear: currentCertification.cycleYear,
              saqTypeId: currentCertification.saqTypeId,
              status: currentCertification.status,
              saqTypeCode: currentCertification.saqType.code,
              saqTypeName: currentCertification.saqType.name,
              paymentState: currentCertification.paymentStatus?.state ?? PaymentState.UNPAID,
              isLocked: currentCertification.isLocked,
              finalizedAt: currentCertification.finalizedAt?.toISOString() ?? null,
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
    adminContactName: z.string().trim().optional(),
    adminContactEmail: z.string().trim().email().optional().or(z.literal("")),
    adminContactPhone: z.string().trim().optional(),
    username: z.string().trim().min(3),
    temporaryPassword: strongPasswordSchema,
    saqTypeId: z.string().min(1),
    cycleYear: z.number().int().min(2020).max(2100),
    paymentState: z.nativeEnum(PaymentState).default(PaymentState.UNPAID),
    executiveUserId: z.string().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: parsed.error?.issues[0]?.message ?? "Datos de cliente invalidos." });
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
        notes: "Cliente creado desde administracion.",
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
});

router.patch("/:clientId", requireAuth, requireRole([UserRoleCode.ADMIN]), async (req: AuthenticatedRequest, res) => {
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
    temporaryPassword: strongPasswordSchema.optional().or(z.literal("")),
    saqTypeId: z.string().min(1),
    cycleYear: z.number().int().min(2020).max(2100),
    paymentState: z.nativeEnum(PaymentState).default(PaymentState.UNPAID),
    executiveUserId: z.string().optional(),
  });
  const parsed = schema.safeParse(req.body);
  const clientId = Array.isArray(req.params.clientId) ? req.params.clientId[0] : req.params.clientId;
  if (!parsed.success || !clientId) {
    return res.status(400).json({ message: parsed.error?.issues[0]?.message ?? "Datos de cliente invalidos." });
  }

  const data = parsed.data;
  const client = await prisma.client.findUnique({
    where: { id: clientId },
    include: {
      users: { include: { user: true }, orderBy: { createdAt: "asc" } },
      certifications: {
        where: { status: { not: CertificationStatus.ARCHIVED } },
        orderBy: [{ cycleYear: "desc" }, { createdAt: "desc" }],
      },
    },
  });
  if (!client || !client.isActive) {
    return res.status(404).json({ message: "Cliente no encontrado." });
  }

  const primaryLink = client.users.find((link) => link.isPrimary) ?? client.users[0] ?? null;
  if (!primaryLink) {
    return res.status(400).json({ message: "El cliente no tiene usuario principal para editar." });
  }

  const [existingUser, saqType, executive] = await Promise.all([
    assertUniqueUserIdentity({
      username: data.username,
      email: data.primaryContactEmail,
      excludeUserId: primaryLink.userId,
    }),
    prisma.saqType.findUnique({ where: { id: data.saqTypeId } }),
    data.executiveUserId
      ? prisma.user.findFirst({
          where: { id: data.executiveUserId, isActive: true, role: { code: UserRoleCode.EXECUTIVE } },
        })
      : Promise.resolve(null),
  ]);

  if (existingUser) {
    return res.status(409).json({ message: "Ya existe otro usuario con ese username o correo." });
  }
  if (!saqType || !saqType.isActive) {
    return res.status(404).json({ message: "SAQ no encontrado o inactivo." });
  }
  if (data.executiveUserId && !executive) {
    return res.status(404).json({ message: "Ejecutivo no encontrado." });
  }

  const currentCertification = client.certifications[0] ?? null;

  // A locked certification can still receive contact / identification updates,
  // but the SAQ type and cycle year are immutable until an admin reopens it.
  // (Reopening is exposed via POST /:clientId/certifications/:certificationId/reopen.)
  const wantsCertificationMutation =
    !currentCertification ||
    currentCertification.saqTypeId !== saqType.id ||
    currentCertification.cycleYear !== data.cycleYear;

  if (currentCertification?.isLocked && wantsCertificationMutation) {
    return res.status(400).json({
      message:
        "La certificacion actual esta bloqueada. Reabrela primero para cambiar el SAQ o el ciclo; los datos de contacto pueden actualizarse sin reabrir.",
    });
  }

  const contactName = splitName(data.primaryContactName);
  const passwordHash = data.temporaryPassword ? await hashPassword(data.temporaryPassword) : null;

  const result = await prisma.$transaction(async (tx) => {
    const updatedClient = await tx.client.update({
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
        // Keep IN_PROGRESS for editable certs; do not stomp the client status
        // when the active certification is locked/finalized.
        ...(currentCertification?.isLocked ? {} : { status: ClientStatus.IN_PROGRESS }),
      },
    });

    const updatedUser = await tx.user.update({
      where: { id: primaryLink.userId },
      data: {
        email: data.primaryContactEmail,
        username: data.username,
        firstName: contactName.firstName,
        lastName: contactName.lastName,
        phone: data.primaryContactPhone || null,
        ...(passwordHash ? { passwordHash, mustChangePassword: true } : {}),
      },
    });

    await tx.executiveClientAssignment.deleteMany({ where: { clientId, isActive: true } });
    if (data.executiveUserId) {
      await tx.executiveClientAssignment.create({
        data: { clientId, executiveUserId: data.executiveUserId, isActive: true },
      });
    }

    let certification = currentCertification;
    if (wantsCertificationMutation) {
      certification = currentCertification
        ? await tx.certification.update({
            where: { id: currentCertification.id },
            data: {
              saqTypeId: saqType.id,
              cycleYear: data.cycleYear,
              templateVersionSnapshot: saqType.templateVersion,
              status: CertificationStatus.IN_PROGRESS,
            },
          })
        : await tx.certification.create({
            data: {
              clientId,
              saqTypeId: saqType.id,
              cycleYear: data.cycleYear,
              status: CertificationStatus.IN_PROGRESS,
              startedAt: new Date(),
              templateVersionSnapshot: saqType.templateVersion,
            },
          });

      // If the SAQ type changed, remove answers for requirements that are NOT
      // part of the new SAQ's mapping. Otherwise stale answers (including
      // possible NOT_IMPLEMENTED ones) from the previous SAQ assignment would
      // keep influencing Section 3 / Part 4 / readiness calculations.
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
          const staleAnswerIds = staleAnswers.map((answer) => answer.id);
          await tx.answerJustification.deleteMany({
            where: { certificationAnswerId: { in: staleAnswerIds } },
          });
          await tx.certificationAnswer.deleteMany({
            where: { id: { in: staleAnswerIds } },
          });
        }
      }
    }

    if (!certification) {
      // Should not happen — guard for the type checker.
      throw new Error("Certification context missing after client update.");
    }

    await tx.paymentStatus.upsert({
      where: { certificationId: certification.id },
      update: {
        state: data.paymentState,
        updatedByUserId: req.auth!.userId,
        notes: "Cliente actualizado desde administracion.",
      },
      create: {
        clientId,
        certificationId: certification.id,
        state: data.paymentState,
        updatedByUserId: req.auth!.userId,
        notes: "Cliente actualizado desde administracion.",
      },
    });

    return { client: updatedClient, user: updatedUser, certification };
  });

  await writeAuditLog({
    userId: req.auth?.userId,
    roleCode: req.auth?.role,
    actionType: "ADMIN_CLIENT_UPDATED",
    targetTable: "Client",
    targetId: result.client.id,
    clientId: result.client.id,
    certificationId: result.certification.id,
    ipAddress: req.ip,
    userAgent: getUserAgentHeader(req.headers["user-agent"]),
    metadata: {
      username: result.user.username,
      passwordReset: Boolean(passwordHash),
      saqType: saqType.code,
      cycleYear: data.cycleYear,
    },
  });

  res.json({
    id: result.client.id,
    companyName: result.client.companyName,
    username: result.user.username,
    passwordReset: Boolean(passwordHash),
    certificationId: result.certification.id,
    saqTypeCode: saqType.code,
    cycleYear: result.certification.cycleYear,
  });
});

router.post("/:clientId/users", requireAuth, requireRole([UserRoleCode.ADMIN]), async (req: AuthenticatedRequest, res) => {
  const schema = z.object({
    fullName: z.string().trim().min(2),
    email: z.string().trim().email(),
    username: z.string().trim().min(3),
    temporaryPassword: strongPasswordSchema,
    isPrimary: z.boolean().optional().default(false),
  });
  const parsed = schema.safeParse(req.body);
  const clientId = Array.isArray(req.params.clientId) ? req.params.clientId[0] : req.params.clientId;
  if (!parsed.success || !clientId) {
    return res.status(400).json({ message: parsed.error?.issues[0]?.message ?? "Datos de usuario invalidos." });
  }

  const data = parsed.data;
  const [client, existingUser, clientRole] = await Promise.all([
    prisma.client.findUnique({ where: { id: clientId } }),
    assertUniqueUserIdentity({ username: data.username, email: data.email }),
    prisma.role.findUnique({ where: { code: UserRoleCode.CLIENT } }),
  ]);

  if (!client || !client.isActive) {
    return res.status(404).json({ message: "Cliente no encontrado." });
  }
  if (existingUser) {
    return res.status(409).json({ message: "Ya existe un usuario con ese username o correo." });
  }
  if (!clientRole) {
    return res.status(500).json({ message: "Rol de cliente no configurado." });
  }

  const name = splitName(data.fullName);
  const passwordHash = await hashPassword(data.temporaryPassword);

  const result = await prisma.$transaction(async (tx) => {
    if (data.isPrimary) {
      await tx.clientUser.updateMany({ where: { clientId }, data: { isPrimary: false } });
    }

    const user = await tx.user.create({
      data: {
        roleId: clientRole.id,
        email: data.email,
        username: data.username,
        passwordHash,
        firstName: name.firstName,
        lastName: name.lastName,
        mustChangePassword: true,
      },
    });

    await tx.clientUser.create({
      data: { clientId, userId: user.id, isPrimary: data.isPrimary },
    });

    return user;
  });

  await writeAuditLog({
    userId: req.auth?.userId,
    roleCode: req.auth?.role,
    actionType: "ADMIN_CLIENT_USER_CREATED",
    targetTable: "User",
    targetId: result.id,
    clientId,
    ipAddress: req.ip,
    userAgent: getUserAgentHeader(req.headers["user-agent"]),
    metadata: {
      username: result.username,
      isPrimary: data.isPrimary,
    },
  });

  let welcomeEmailSent = false;
  try {
    const emailResult = await sendAdditionalUserEmail({
      to: result.email,
      fullName: `${result.firstName} ${result.lastName}`.trim(),
      companyName: client.companyName,
      username: result.username,
      temporaryPassword: data.temporaryPassword,
    });
    welcomeEmailSent = Boolean(emailResult?.sent);
  } catch (error) {
    console.error("Failed to send additional-user email", error);
  }

  res.status(201).json({
    id: result.id,
    username: result.username,
    temporaryPassword: data.temporaryPassword,
    clientId,
    isPrimary: data.isPrimary,
    welcomeEmailSent,
  });
});

router.patch("/:clientId/users/:userId", requireAuth, requireRole([UserRoleCode.ADMIN]), async (req: AuthenticatedRequest, res) => {
  const schema = z.object({
    fullName: z.string().trim().min(2),
    email: z.string().trim().email(),
    username: z.string().trim().min(3),
    temporaryPassword: strongPasswordSchema.optional().or(z.literal("")),
    isPrimary: z.boolean().optional().default(false),
    isActive: z.boolean().optional().default(true),
  });
  const parsed = schema.safeParse(req.body);
  const clientId = Array.isArray(req.params.clientId) ? req.params.clientId[0] : req.params.clientId;
  const userId = Array.isArray(req.params.userId) ? req.params.userId[0] : req.params.userId;
  if (!parsed.success || !clientId || !userId) {
    return res.status(400).json({ message: parsed.error?.issues[0]?.message ?? "Datos de usuario invalidos." });
  }

  const data = parsed.data;
  const [clientUser, existingUser] = await Promise.all([
    prisma.clientUser.findFirst({
      where: { clientId, userId },
      include: { client: true, user: true },
    }),
    assertUniqueUserIdentity({ username: data.username, email: data.email, excludeUserId: userId }),
  ]);

  if (!clientUser || !clientUser.client.isActive) {
    return res.status(404).json({ message: "Usuario del cliente no encontrado." });
  }
  if (existingUser) {
    return res.status(409).json({ message: "Ya existe otro usuario con ese username o correo." });
  }
  if (data.isPrimary && !data.isActive) {
    return res.status(400).json({ message: "Un usuario principal debe estar activo." });
  }

  const activeUserCount = await prisma.clientUser.count({
    where: { clientId, user: { isActive: true } },
  });
  if (!data.isActive && activeUserCount <= 1 && clientUser.user.isActive) {
    return res.status(400).json({ message: "El cliente debe conservar al menos un usuario activo." });
  }
  if (!data.isActive && clientUser.isPrimary) {
    return res.status(400).json({ message: "No puedes desactivar el usuario principal. Marca otro usuario como principal antes de desactivarlo." });
  }

  const name = splitName(data.fullName);
  const passwordHash = data.temporaryPassword ? await hashPassword(data.temporaryPassword) : null;

  const result = await prisma.$transaction(async (tx) => {
    if (data.isPrimary) {
      await tx.clientUser.updateMany({ where: { clientId }, data: { isPrimary: false } });
    }

    const updatedLink = await tx.clientUser.update({
      where: { id: clientUser.id },
      data: { isPrimary: data.isPrimary || clientUser.isPrimary },
    });

    const updatedUser = await tx.user.update({
      where: { id: userId },
      data: {
        email: data.email,
        username: data.username,
        firstName: name.firstName,
        lastName: name.lastName,
        isActive: data.isActive,
        ...(passwordHash ? { passwordHash, mustChangePassword: true } : {}),
      },
    });

    return { link: updatedLink, user: updatedUser };
  });

  await writeAuditLog({
    userId: req.auth?.userId,
    roleCode: req.auth?.role,
    actionType: "ADMIN_CLIENT_USER_UPDATED",
    targetTable: "User",
    targetId: result.user.id,
    clientId,
    ipAddress: req.ip,
    userAgent: getUserAgentHeader(req.headers["user-agent"]),
    metadata: {
      username: result.user.username,
      isPrimary: result.link.isPrimary,
      isActive: result.user.isActive,
      passwordReset: Boolean(passwordHash),
    },
  });

  res.json({
    id: result.user.id,
    username: result.user.username,
    clientId,
    isPrimary: result.link.isPrimary,
    isActive: result.user.isActive,
    passwordReset: Boolean(passwordHash),
  });
});

router.post(
  "/:clientId/certifications/:certificationId/reopen",
  requireAuth,
  requireRole([UserRoleCode.ADMIN]),
  async (req: AuthenticatedRequest, res) => {
    const schema = z.object({
      reason: z.string().trim().min(8, "Captura un motivo de al menos 8 caracteres."),
      archiveGeneratedDocuments: z.boolean().optional().default(true),
    });
    const parsed = schema.safeParse(req.body);
    const clientId = Array.isArray(req.params.clientId) ? req.params.clientId[0] : req.params.clientId;
    const certificationId = Array.isArray(req.params.certificationId)
      ? req.params.certificationId[0]
      : req.params.certificationId;

    if (!parsed.success || !clientId || !certificationId) {
      return res.status(400).json({
        message: parsed.success ? "Identificadores invalidos." : parsed.error.issues[0]?.message ?? "Datos invalidos.",
      });
    }

    const certification = await prisma.certification.findFirst({
      where: { id: certificationId, clientId },
      include: {
        client: {
          include: { users: { include: { user: true }, orderBy: { createdAt: "asc" } } },
        },
      },
    });

    if (!certification) {
      return res.status(404).json({ message: "Certificacion no encontrada para este cliente." });
    }

    if (!certification.isLocked && certification.status !== CertificationStatus.FINALIZED) {
      return res.status(400).json({
        message: "La certificacion no esta bloqueada o finalizada; no es necesario reabrirla.",
      });
    }

    const updated = await prisma.$transaction(async (tx) => {
      const next = await tx.certification.update({
        where: { id: certificationId },
        data: {
          isLocked: false,
          status: CertificationStatus.IN_PROGRESS,
          finalizedAt: null,
        },
      });

      // The client record is flipped to FINALIZED when SAQ/diploma/AOC are
      // generated; reverting it back to IN_PROGRESS keeps the admin list and
      // status chips coherent with the unlocked certification state.
      if (certification.client.status === ClientStatus.FINALIZED) {
        await tx.client.update({
          where: { id: clientId },
          data: { status: ClientStatus.IN_PROGRESS },
        });
      }

      if (parsed.data.archiveGeneratedDocuments) {
        await tx.clientDocument.updateMany({
          where: {
            certificationId,
            category: "GENERATED_OUTPUT",
            isArchived: false,
          },
          data: { isArchived: true },
        });
      }

      return next;
    });

    await writeAuditLog({
      userId: req.auth?.userId,
      roleCode: req.auth?.role,
      actionType: "ADMIN_CERTIFICATION_REOPENED",
      targetTable: "Certification",
      targetId: certification.id,
      clientId,
      certificationId: certification.id,
      ipAddress: req.ip,
      userAgent: getUserAgentHeader(req.headers["user-agent"]),
      metadata: {
        reason: parsed.data.reason,
        archivedGeneratedDocuments: parsed.data.archiveGeneratedDocuments,
        previousStatus: certification.status,
      },
    });

    const primaryUser =
      certification.client.users.find((link) => link.isPrimary)?.user ??
      certification.client.users[0]?.user ??
      null;
    if (primaryUser?.email) {
      try {
        await sendCertificationReopenedEmail({
          to: primaryUser.email,
          fullName: `${primaryUser.firstName} ${primaryUser.lastName}`.trim() || primaryUser.username,
          companyName: certification.client.companyName,
          reason: parsed.data.reason,
        });
      } catch (error) {
        console.error("Failed to send certification-reopened email", error);
      }
    }

    res.json({
      id: updated.id,
      status: updated.status,
      isLocked: updated.isLocked,
      reason: parsed.data.reason,
    });
  },
);

export default router;
