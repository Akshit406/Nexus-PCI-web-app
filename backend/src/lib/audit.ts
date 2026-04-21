import { prisma } from "./prisma";

type AuditInput = {
  userId?: string | null;
  roleCode?: string | null;
  actionType: string;
  targetTable?: string;
  targetId?: string;
  clientId?: string;
  certificationId?: string;
  ipAddress?: string | null;
  userAgent?: string | null;
  metadata?: Record<string, unknown>;
};

export async function writeAuditLog(input: AuditInput) {
  await prisma.auditLog.create({
    data: {
      userId: input.userId ?? undefined,
      roleCode: input.roleCode ?? undefined,
      actionType: input.actionType,
      targetTable: input.targetTable,
      targetId: input.targetId,
      clientId: input.clientId,
      certificationId: input.certificationId,
      ipAddress: input.ipAddress ?? undefined,
      userAgent: input.userAgent ?? undefined,
      metadataJson: input.metadata ? JSON.stringify(input.metadata) : undefined,
    },
  });
}
