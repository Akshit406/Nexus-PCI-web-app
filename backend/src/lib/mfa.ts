import crypto from "node:crypto";
import { generate, generateSecret, generateURI, verify } from "otplib";
import QRCode from "qrcode";
import jwt from "jsonwebtoken";
import { UserRoleCode } from "@prisma/client";
import { config } from "../config";

const MFA_ISSUER = "PCI Nexus";
const MFA_PERIOD_SECONDS = 30;
const MFA_DIGITS = 6;
// 30 seconds tolerance gives a +/- 1 step verification window which matches
// what Google Authenticator / Authy / 1Password use.
const MFA_EPOCH_TOLERANCE_SECONDS = 30;

export function generateMfaSecret() {
  return generateSecret();
}

export function buildOtpAuthUrl(input: { username: string; secret: string }) {
  return generateURI({
    issuer: MFA_ISSUER,
    label: input.username,
    secret: input.secret,
    digits: MFA_DIGITS,
    period: MFA_PERIOD_SECONDS,
  });
}

export async function buildOtpAuthQrCodeDataUrl(otpAuthUrl: string) {
  return QRCode.toDataURL(otpAuthUrl, { width: 240, errorCorrectionLevel: "M" });
}

export async function verifyTotpCode(input: { token: string; secret: string }) {
  try {
    const result = await verify({
      secret: input.secret,
      token: input.token.trim(),
      period: MFA_PERIOD_SECONDS,
      digits: MFA_DIGITS,
      epochTolerance: MFA_EPOCH_TOLERANCE_SECONDS,
    });
    return Boolean(result?.valid);
  } catch {
    return false;
  }
}

// Async helper used in tests / scripts to generate the current TOTP code.
export async function generateCurrentTotpCode(secret: string) {
  return generate({ secret, period: MFA_PERIOD_SECONDS, digits: MFA_DIGITS });
}

export function generateRecoveryCodes(count = 8) {
  const codes: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const code = crypto.randomBytes(5).toString("hex").toUpperCase();
    codes.push(`${code.slice(0, 5)}-${code.slice(5)}`);
  }
  return codes;
}

export function hashRecoveryCode(code: string) {
  return crypto.createHash("sha256").update(code.trim().toUpperCase()).digest("hex");
}

export function serializeRecoveryCodes(codes: string[]): string {
  return JSON.stringify(codes.map(hashRecoveryCode));
}

export function deserializeRecoveryCodes(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === "string") : [];
  } catch {
    return [];
  }
}

export function popRecoveryCode(serialized: string | null | undefined, providedCode: string) {
  const hashedTarget = hashRecoveryCode(providedCode);
  const hashes = deserializeRecoveryCodes(serialized);
  const matchIndex = hashes.indexOf(hashedTarget);
  if (matchIndex === -1) {
    return null;
  }
  const next = [...hashes];
  next.splice(matchIndex, 1);
  return { remainingHashes: next, remainingSerialized: JSON.stringify(next) };
}

export type MfaChallengePayload = {
  challenge: true;
  userId: string;
  role: UserRoleCode;
};

export function signMfaChallengeToken(payload: Omit<MfaChallengePayload, "challenge">) {
  const body: MfaChallengePayload = { challenge: true, ...payload };
  return jwt.sign(body, config.jwtSecret, { expiresIn: "10m" });
}

export function verifyMfaChallengeToken(token: string): MfaChallengePayload {
  const decoded = jwt.verify(token, config.jwtSecret) as MfaChallengePayload;
  if (!decoded.challenge) {
    throw new Error("Invalid challenge token.");
  }
  return decoded;
}
