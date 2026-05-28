import { randomUUID } from "crypto";
import { Router } from "express";
import { UserRoleCode } from "@prisma/client";
import { z } from "zod";
import { comparePassword, hashPassword, signAuthToken } from "../lib/auth";
import { clearLoginThrottle, getLoginThrottle, registerLoginFailure } from "../lib/login-throttle";
import { prisma } from "../lib/prisma";
import { writeAuditLog } from "../lib/audit";
import { sendPasswordResetEmail } from "../lib/email-templates";
import {
  buildOtpAuthQrCodeDataUrl,
  buildOtpAuthUrl,
  generateMfaSecret,
  generateRecoveryCodes,
  popRecoveryCode,
  serializeRecoveryCodes,
  signMfaChallengeToken,
  verifyMfaChallengeToken,
  verifyTotpCode,
} from "../lib/mfa";
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

  if (user.mfaEnabled && user.mfaSecret) {
    const mfaChallengeToken = signMfaChallengeToken({ userId: user.id, role: user.role.code });
    await writeAuditLog({
      userId: user.id,
      roleCode: user.role.code,
      actionType: "AUTH_MFA_CHALLENGE_ISSUED",
      targetTable: "User",
      targetId: user.id,
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
    });
    return res.json({ mfaRequired: true, mfaChallengeToken });
  }

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
      mfaEnabled: user.mfaEnabled,
      clientId: user.clientLinks[0]?.clientId,
    },
  });
});

router.post("/mfa/verify", async (req, res) => {
  const schema = z.object({
    mfaChallengeToken: z.string().min(10),
    code: z.string().trim().min(6).max(20),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "Solicitud de verificacion MFA invalida." });
  }

  let challenge;
  try {
    challenge = verifyMfaChallengeToken(parsed.data.mfaChallengeToken);
  } catch {
    return res.status(400).json({ message: "El reto MFA expiro. Vuelve a iniciar sesion." });
  }

  const user = await prisma.user.findUnique({
    where: { id: challenge.userId },
    include: { role: true, clientLinks: true },
  });
  if (!user || !user.isActive || !user.mfaEnabled || !user.mfaSecret) {
    return res.status(400).json({ message: "El usuario no tiene MFA habilitado." });
  }

  const code = parsed.data.code.trim();
  const isTotpValid = await verifyTotpCode({ token: code, secret: user.mfaSecret });
  let consumedRecoveryCode = false;
  let nextSerializedRecoveryCodes: string | null | undefined = undefined;
  if (!isTotpValid) {
    const recoveryResult = popRecoveryCode(user.mfaRecoveryCodesJson, code);
    if (!recoveryResult) {
      await writeAuditLog({
        userId: user.id,
        roleCode: user.role.code,
        actionType: "AUTH_MFA_FAILED",
        targetTable: "User",
        targetId: user.id,
        ipAddress: req.ip,
        userAgent: req.headers["user-agent"],
      });
      return res.status(401).json({ message: "Codigo MFA invalido." });
    }
    consumedRecoveryCode = true;
    nextSerializedRecoveryCodes = recoveryResult.remainingSerialized;
  }

  await prisma.user.update({
    where: { id: user.id },
    data: {
      lastLoginAt: new Date(),
      ...(consumedRecoveryCode ? { mfaRecoveryCodesJson: nextSerializedRecoveryCodes ?? null } : {}),
    },
  });

  const token = signAuthToken({ userId: user.id, role: user.role.code });
  await writeAuditLog({
    userId: user.id,
    roleCode: user.role.code,
    actionType: consumedRecoveryCode ? "AUTH_MFA_RECOVERY_CODE_USED" : "AUTH_MFA_SUCCESS",
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
      mfaEnabled: user.mfaEnabled,
      clientId: user.clientLinks[0]?.clientId,
    },
  });
});

router.post("/mfa/enroll/start", requireAuth, async (req: AuthenticatedRequest, res) => {
  if (!req.auth) {
    return res.status(401).json({ message: "Se requiere iniciar sesion." });
  }
  if (req.auth.role !== UserRoleCode.ADMIN && req.auth.role !== UserRoleCode.EXECUTIVE) {
    return res.status(403).json({ message: "MFA esta disponible solo para roles administrativos." });
  }

  const user = await prisma.user.findUnique({ where: { id: req.auth.userId } });
  if (!user) {
    return res.status(404).json({ message: "Usuario no encontrado." });
  }

  const secret = generateMfaSecret();
  const otpAuthUrl = buildOtpAuthUrl({ username: user.username, secret });
  const qrCodeDataUrl = await buildOtpAuthQrCodeDataUrl(otpAuthUrl);

  await prisma.user.update({
    where: { id: user.id },
    data: { mfaSecret: secret, mfaEnabled: false, mfaRecoveryCodesJson: null, mfaEnrolledAt: null },
  });

  res.json({
    secret,
    otpAuthUrl,
    qrCodeDataUrl,
  });
});

router.post("/mfa/enroll/confirm", requireAuth, async (req: AuthenticatedRequest, res) => {
  const schema = z.object({ code: z.string().trim().min(6).max(10) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success || !req.auth) {
    return res.status(400).json({ message: "Codigo MFA invalido." });
  }
  if (req.auth.role !== UserRoleCode.ADMIN && req.auth.role !== UserRoleCode.EXECUTIVE) {
    return res.status(403).json({ message: "MFA esta disponible solo para roles administrativos." });
  }

  const user = await prisma.user.findUnique({ where: { id: req.auth.userId } });
  if (!user || !user.mfaSecret) {
    return res.status(400).json({ message: "Inicia el flujo de enrolamiento antes de confirmar." });
  }

  const isValid = await verifyTotpCode({ token: parsed.data.code, secret: user.mfaSecret });
  if (!isValid) {
    return res.status(400).json({ message: "El codigo MFA no es valido. Verifica la hora del dispositivo y vuelve a intentarlo." });
  }

  const recoveryCodes = generateRecoveryCodes();
  const serialized = serializeRecoveryCodes(recoveryCodes);
  await prisma.user.update({
    where: { id: user.id },
    data: {
      mfaEnabled: true,
      mfaEnrolledAt: new Date(),
      mfaRecoveryCodesJson: serialized,
    },
  });

  await writeAuditLog({
    userId: user.id,
    roleCode: req.auth.role,
    actionType: "AUTH_MFA_ENROLLED",
    targetTable: "User",
    targetId: user.id,
    ipAddress: req.ip,
    userAgent: req.headers["user-agent"],
  });

  res.json({ enabled: true, recoveryCodes });
});

router.post("/mfa/disable", requireAuth, async (req: AuthenticatedRequest, res) => {
  const schema = z.object({ password: z.string().min(1) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success || !req.auth) {
    return res.status(400).json({ message: "Solicitud invalida." });
  }

  const user = await prisma.user.findUnique({ where: { id: req.auth.userId } });
  if (!user) {
    return res.status(404).json({ message: "Usuario no encontrado." });
  }

  const passwordMatches = await comparePassword(parsed.data.password, user.passwordHash);
  if (!passwordMatches) {
    return res.status(401).json({ message: "Contrasena incorrecta." });
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { mfaEnabled: false, mfaSecret: null, mfaRecoveryCodesJson: null, mfaEnrolledAt: null },
  });

  await writeAuditLog({
    userId: user.id,
    roleCode: req.auth.role,
    actionType: "AUTH_MFA_DISABLED",
    targetTable: "User",
    targetId: user.id,
    ipAddress: req.ip,
    userAgent: req.headers["user-agent"],
  });

  res.json({ enabled: false });
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
        expiresAt: new Date(Date.now() + 1000 * 60 * 60),
      },
    });

    let emailSent = false;
    let emailDevMode = false;
    let emailError: string | null = null;
    try {
      const emailResult = await sendPasswordResetEmail({
        to: user.email,
        fullName: `${user.firstName} ${user.lastName}`.trim() || user.username,
        resetToken: resetToken.token,
      });
      emailSent = emailResult.sent;
      emailDevMode = emailResult.devMode;
    } catch (error) {
      emailError = error instanceof Error ? error.message : "unknown email error";
      console.error("[auth] Failed to send password reset email", error);
    }

    // The action type makes the failure mode obvious from Admin Operaciones
    // -> audit logs (filter by AUTH_PASSWORD_RESET) so the admin can tell
    // why the recipient never got the message.
    await writeAuditLog({
      userId: user.id,
      roleCode: undefined,
      actionType: emailError
        ? "AUTH_PASSWORD_RESET_EMAIL_FAILED"
        : emailSent
          ? "AUTH_PASSWORD_RESET_EMAIL_SENT"
          : "AUTH_PASSWORD_RESET_EMAIL_DEV_MODE",
      targetTable: "PasswordResetToken",
      targetId: resetToken.id,
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
      metadata: { to: user.email, emailSent, emailDevMode, emailError },
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
    mfaEnabled: user.mfaEnabled,
    clientId: user.clientLinks[0]?.clientId,
  });
});

export default router;
