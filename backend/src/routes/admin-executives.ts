import { Router } from "express";
import { UserRoleCode } from "@prisma/client";
import { z } from "zod";
import { hashPassword } from "../lib/auth";
import { writeAuditLog } from "../lib/audit";
import { prisma } from "../lib/prisma";
import { AuthenticatedRequest, requireAuth, requireRole } from "../middleware/auth";

const router = Router();

function getUserAgentHeader(value: string | string[] | undefined) {
  return Array.isArray(value) ? value.join(", ") : value;
}

async function assertUniqueUserIdentity(input: {
  username: string;
  email: string;
  excludeUserId?: string;
}) {
  return prisma.user.findFirst({
    where: {
      OR: [{ username: input.username }, { email: input.email }],
      ...(input.excludeUserId ? { id: { not: input.excludeUserId } } : {}),
    },
  });
}

router.get("/", requireAuth, requireRole([UserRoleCode.ADMIN]), async (_req, res) => {
  const executives = await prisma.user.findMany({
    where: { role: { code: UserRoleCode.EXECUTIVE } },
    orderBy: [{ isActive: "desc" }, { firstName: "asc" }, { lastName: "asc" }],
    include: {
      executiveAssignments: {
        where: { isActive: true },
        include: {
          client: {
            include: {
              certifications: {
                where: { status: { not: "ARCHIVED" } },
                orderBy: [{ cycleYear: "desc" }, { updatedAt: "desc" }],
                include: { paymentStatus: true, saqType: true },
              },
            },
          },
        },
      },
    },
  });

  res.json({
    items: executives.map((executive) => ({
      id: executive.id,
      username: executive.username,
      email: executive.email,
      firstName: executive.firstName,
      lastName: executive.lastName,
      phone: executive.phone,
      isActive: executive.isActive,
      mustChangePassword: executive.mustChangePassword,
      assignedClientCount: executive.executiveAssignments.length,
      clients: executive.executiveAssignments.map((assignment) => {
        const certification = assignment.client.certifications[0] ?? null;
        return {
          id: assignment.client.id,
          companyName: assignment.client.companyName,
          status: assignment.client.status,
          certificationStatus: certification?.status ?? null,
          paymentState: certification?.paymentStatus?.state ?? "UNPAID",
          saqTypeCode: certification?.saqType.code ?? null,
        };
      }),
    })),
  });
});

router.post("/", requireAuth, requireRole([UserRoleCode.ADMIN]), async (req: AuthenticatedRequest, res) => {
  const schema = z.object({
    firstName: z.string().trim().min(2),
    lastName: z.string().trim().min(2),
    email: z.string().trim().email(),
    username: z.string().trim().min(3),
    phone: z.string().trim().optional(),
    temporaryPassword: z.string().min(8),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "Datos de ejecutivo invalidos." });
  }

  const data = parsed.data;
  const [existingUser, executiveRole] = await Promise.all([
    assertUniqueUserIdentity({ username: data.username, email: data.email }),
    prisma.role.findUnique({ where: { code: UserRoleCode.EXECUTIVE } }),
  ]);

  if (existingUser) {
    return res.status(409).json({ message: "Ya existe un usuario con ese username o correo." });
  }
  if (!executiveRole) {
    return res.status(500).json({ message: "Rol de ejecutivo no configurado." });
  }

  const user = await prisma.user.create({
    data: {
      roleId: executiveRole.id,
      email: data.email,
      username: data.username,
      passwordHash: await hashPassword(data.temporaryPassword),
      firstName: data.firstName,
      lastName: data.lastName,
      phone: data.phone || null,
      mustChangePassword: true,
    },
  });

  await writeAuditLog({
    userId: req.auth?.userId,
    roleCode: req.auth?.role,
    actionType: "ADMIN_EXECUTIVE_CREATED",
    targetTable: "User",
    targetId: user.id,
    ipAddress: req.ip,
    userAgent: getUserAgentHeader(req.headers["user-agent"]),
    metadata: { username: user.username, email: user.email },
  });

  res.status(201).json({
    id: user.id,
    username: user.username,
    temporaryPassword: data.temporaryPassword,
  });
});

router.patch("/:userId", requireAuth, requireRole([UserRoleCode.ADMIN]), async (req: AuthenticatedRequest, res) => {
  const schema = z.object({
    firstName: z.string().trim().min(2),
    lastName: z.string().trim().min(2),
    email: z.string().trim().email(),
    username: z.string().trim().min(3),
    phone: z.string().trim().optional(),
    temporaryPassword: z.string().min(8).optional().or(z.literal("")),
    isActive: z.boolean(),
  });
  const parsed = schema.safeParse(req.body);
  const userId = Array.isArray(req.params.userId) ? req.params.userId[0] : req.params.userId;
  if (!parsed.success || !userId) {
    return res.status(400).json({ message: "Datos de ejecutivo invalidos." });
  }

  const data = parsed.data;
  const [executive, existingUser, activeAssignments] = await Promise.all([
    prisma.user.findFirst({ where: { id: userId, role: { code: UserRoleCode.EXECUTIVE } } }),
    assertUniqueUserIdentity({ username: data.username, email: data.email, excludeUserId: userId }),
    prisma.executiveClientAssignment.count({ where: { executiveUserId: userId, isActive: true } }),
  ]);

  if (!executive) {
    return res.status(404).json({ message: "Ejecutivo no encontrado." });
  }
  if (existingUser) {
    return res.status(409).json({ message: "Ya existe otro usuario con ese username o correo." });
  }
  if (!data.isActive && activeAssignments > 0) {
    return res.status(400).json({
      message: "No puedes desactivar un ejecutivo con clientes activos. Reasigna su portafolio primero.",
    });
  }

  const passwordHash = data.temporaryPassword ? await hashPassword(data.temporaryPassword) : null;
  const updated = await prisma.user.update({
    where: { id: userId },
    data: {
      email: data.email,
      username: data.username,
      firstName: data.firstName,
      lastName: data.lastName,
      phone: data.phone || null,
      isActive: data.isActive,
      ...(passwordHash ? { passwordHash, mustChangePassword: true } : {}),
    },
  });

  await writeAuditLog({
    userId: req.auth?.userId,
    roleCode: req.auth?.role,
    actionType: "ADMIN_EXECUTIVE_UPDATED",
    targetTable: "User",
    targetId: updated.id,
    ipAddress: req.ip,
    userAgent: getUserAgentHeader(req.headers["user-agent"]),
    metadata: {
      username: updated.username,
      email: updated.email,
      isActive: updated.isActive,
      passwordReset: Boolean(passwordHash),
    },
  });

  res.json({
    id: updated.id,
    username: updated.username,
    isActive: updated.isActive,
    passwordReset: Boolean(passwordHash),
  });
});

export default router;
