import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { UserRoleCode } from "@prisma/client";
import { config } from "../config";

export type AuthTokenPayload = {
  userId: string;
  role: UserRoleCode;
};

export async function hashPassword(password: string) {
  return bcrypt.hash(password, 10);
}

export async function comparePassword(password: string, hash: string) {
  return bcrypt.compare(password, hash);
}

export function signAuthToken(payload: AuthTokenPayload) {
  return jwt.sign(payload, config.jwtSecret, { expiresIn: "8h" });
}

export function verifyAuthToken(token: string) {
  return jwt.verify(token, config.jwtSecret) as AuthTokenPayload;
}
