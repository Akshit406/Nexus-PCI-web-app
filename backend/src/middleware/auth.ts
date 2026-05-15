import { NextFunction, Request, Response } from "express";
import { UserRoleCode } from "@prisma/client";
import { verifyAuthToken } from "../lib/auth";
import { prisma } from "../lib/prisma";

export type AuthenticatedRequest = Request & {
  auth?: {
    userId: string;
    role: UserRoleCode;
    clientId?: string;
  };
};

export async function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return res.status(401).json({ message: "Se requiere iniciar sesion." });
  }

  try {
    const token = header.slice("Bearer ".length);
    const payload = verifyAuthToken(token);
    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      include: { role: true, clientLinks: true },
    });

    if (!user || !user.isActive) {
      return res.status(401).json({ message: "El usuario no esta activo." });
    }

    req.auth = {
      userId: user.id,
      role: user.role.code,
      clientId: user.clientLinks[0]?.clientId,
    };
    next();
  } catch {
    return res.status(401).json({ message: "La sesion no es valida o expiro." });
  }
}

export function requireRole(roles: UserRoleCode[]) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.auth || !roles.includes(req.auth.role)) {
      return res.status(403).json({ message: "No tienes permisos para acceder a esta seccion." });
    }
    next();
  };
}
