import { randomUUID } from "crypto";
import { Router } from "express";
import { z } from "zod";
import { comparePassword, hashPassword, signAuthToken } from "../lib/auth";
import { clearLoginThrottle, getLoginThrottle, registerLoginFailure } from "../lib/login-throttle";
import { prisma } from "../lib/prisma";
import { writeAuditLog } from "../lib/audit";
import { sendEmail } from "../lib/email";
import { AuthenticatedRequest, requireAuth } from "../middleware/auth";

const router = Router();

router.post("/login", async (req, res) => {
  const schema = z.object({
    username: z.string().min(1),
    password: z.string().min(1),
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "Invalid login payload." });
  }

  const { username, password } = parsed.data;
  const throttleKey = `${req.ip ?? "unknown"}:${username.toLowerCase()}`;
  const throttleState = getLoginThrottle(throttleKey);
  if (throttleState) {
    await writeAuditLog({
      actionType: "AUTH_LOGIN_BLOCKED",
      targetTable: "User",
      ipAddress: req.ip,
      userAgent: Array.isArray(req.headers["user-agent"]) ? req.headers["user-agent"].join(", ") : req.headers["user-agent"],
      metadata: { usernameAttempt: username, blockedUntil: new Date(throttleState.blockedUntil).toISOString() },
    });

    return res.status(429).json({
      message: `Too many failed login attempts. Try again in ${throttleState.retryAfterSeconds} seconds.`,
    });
  }

  const user = await prisma.user.findFirst({
    where: { OR: [{ username }, { email: username }] },
    include: { role: true, clientLinks: true },
  });

  if (!user || !(await comparePassword(password, user.passwordHash))) {
    registerLoginFailure(throttleKey);
    await writeAuditLog({
      actionType: "AUTH_LOGIN_FAILED",
      targetTable: "User",
      targetId: user?.id,
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
      metadata: { usernameAttempt: username },
    });

    return res.status(401).json({ message: "Invalid credentials." });
  }

  clearLoginThrottle(throttleKey);

  await prisma.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date() },
  });

  const token = signAuthToken({ userId: user.id, role: user.role.code });

  await writeAuditLog({
    userId: user.id,
    roleCode: user.role.code,
    actionType: "AUTH_LOGIN_SUCCESS",
    targetTable: "User",
    targetId: user.id,
    clientId: user.clientLinks[0]?.clientId,
    ipAddress: req.ip,
    userAgent: req.headers["user-agent"],
  });

  res.json({
    token,
    user: {
      id: user.id,
      username: user.username,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role.code,
      mustChangePassword: user.mustChangePassword,
      clientId: user.clientLinks[0]?.clientId,
    },
  });
});

router.post("/change-password", requireAuth, async (req: AuthenticatedRequest, res) => {
  const schema = z.object({ newPassword: z.string().min(8) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success || !req.auth) {
    return res.status(400).json({ message: "Invalid password change request." });
  }

  const passwordHash = await hashPassword(parsed.data.newPassword);
  await prisma.user.update({
    where: { id: req.auth.userId },
    data: { passwordHash, mustChangePassword: false },
  });

  await writeAuditLog({
    userId: req.auth.userId,
    roleCode: req.auth.role,
    actionType: "AUTH_PASSWORD_CHANGED",
    targetTable: "User",
    targetId: req.auth.userId,
    clientId: req.auth.clientId,
    ipAddress: req.ip,
    userAgent: req.headers["user-agent"],
  });

  res.json({ success: true });
});

router.post("/request-password-reset", async (req, res) => {
  const schema = z.object({ usernameOrEmail: z.string().min(1) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "Invalid reset request." });
  }

  const user = await prisma.user.findFirst({
    where: { OR: [{ username: parsed.data.usernameOrEmail }, { email: parsed.data.usernameOrEmail }] },
  });

  if (user) {
    const resetToken = await prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        token: randomUUID(),
        expiresAt: new Date(Date.now() + 1000 * 60 * 30),
      },
    });

    const resetUrl = `${process.env.FRONTEND_ORIGIN ?? "http://localhost:5173"}/login?resetToken=${resetToken.token}`;
    const emailResult = await sendEmail({
      to: user.email,
      subject: "Restablecimiento de contrasena PCI Nexus",
      text: [
        `Hola ${user.firstName},`,
        "",
        "Recibimos una solicitud para restablecer tu contrasena.",
        `Liga de restablecimiento: ${resetUrl}`,
        "Esta liga expira en 30 minutos.",
      ].join("\n"),
    });

    await writeAuditLog({
      userId: user.id,
      roleCode: undefined,
      actionType: emailResult.sent ? "AUTH_PASSWORD_RESET_EMAIL_SENT" : "AUTH_PASSWORD_RESET_EMAIL_DEV_MODE",
      targetTable: "PasswordResetToken",
      targetId: resetToken.id,
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
    });
  }

  res.json({
    success: true,
    message: "Si la cuenta existe, se enviaron instrucciones para restablecer la contrasena.",
  });
});

router.post("/reset-password", async (req, res) => {
  const schema = z.object({
    token: z.string().min(1),
    newPassword: z.string().min(8),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "Solicitud de restablecimiento invalida." });
  }

  const resetToken = await prisma.passwordResetToken.findUnique({
    where: { token: parsed.data.token },
    include: { user: true },
  });

  if (!resetToken || resetToken.usedAt || resetToken.expiresAt < new Date()) {
    return res.status(400).json({ message: "El enlace de restablecimiento no es valido o expiro." });
  }

  const passwordHash = await hashPassword(parsed.data.newPassword);
  await prisma.$transaction([
    prisma.user.update({
      where: { id: resetToken.userId },
      data: { passwordHash, mustChangePassword: false },
    }),
    prisma.passwordResetToken.update({
      where: { id: resetToken.id },
      data: { usedAt: new Date() },
    }),
  ]);

  await writeAuditLog({
    userId: resetToken.userId,
    roleCode: undefined,
    actionType: "AUTH_PASSWORD_RESET_COMPLETED",
    targetTable: "User",
    targetId: resetToken.userId,
    ipAddress: req.ip,
    userAgent: req.headers["user-agent"],
  });

  res.json({ success: true });
});

router.get("/me", requireAuth, async (req: AuthenticatedRequest, res) => {
  if (!req.auth) {
    return res.status(401).json({ message: "Se requiere iniciar sesion." });
  }

  const user = await prisma.user.findUnique({
    where: { id: req.auth.userId },
    include: { role: true, clientLinks: true },
  });

  if (!user) {
    return res.status(404).json({ message: "Usuario no encontrado." });
  }

  res.json({
    id: user.id,
    username: user.username,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    role: user.role.code,
    mustChangePassword: user.mustChangePassword,
    clientId: user.clientLinks[0]?.clientId,
  });
});

export default router;
