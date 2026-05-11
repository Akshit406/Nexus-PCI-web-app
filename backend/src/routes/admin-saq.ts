import { Router } from "express";
import { UserRoleCode } from "@prisma/client";
import { z } from "zod";
import { writeAuditLog } from "../lib/audit";
import { prisma } from "../lib/prisma";
import { AuthenticatedRequest, requireAuth, requireRole } from "../middleware/auth";

const router = Router();

router.get("/evidence-requirements", requireAuth, requireRole([UserRoleCode.ADMIN]), async (_req, res) => {
  const saqTypes = await prisma.saqType.findMany({
    where: { isActive: true },
    orderBy: { name: "asc" },
    include: {
      requirementMap: {
        where: { isActive: true },
        orderBy: { displayOrder: "asc" },
        include: {
          requirement: {
            include: { topic: true },
          },
        },
      },
    },
  });

  res.json({
    items: saqTypes.map((saqType) => ({
      id: saqType.id,
      code: saqType.code,
      name: saqType.name,
      templateVersion: saqType.templateVersion,
      mappings: saqType.requirementMap.map((mapping) => ({
        id: mapping.id,
        requirementId: mapping.requirementId,
        requirementCode: mapping.requirement.requirementCode,
        title: mapping.requirement.title,
        description: mapping.requirement.description,
        topicCode: mapping.requirement.topic.code,
        topicName: mapping.requirement.topic.name,
        displayOrder: mapping.displayOrder,
        requiresEvidence: mapping.requiresEvidence,
      })),
    })),
  });
});

router.patch("/evidence-requirements/:mappingId", requireAuth, requireRole([UserRoleCode.ADMIN]), async (req: AuthenticatedRequest, res) => {
  const schema = z.object({ requiresEvidence: z.boolean() });
  const parsed = schema.safeParse(req.body);
  const mappingId = Array.isArray(req.params.mappingId) ? req.params.mappingId[0] : req.params.mappingId;

  if (!parsed.success || !mappingId) {
    return res.status(400).json({ message: "Datos de requisito invalidos." });
  }

  const mapping = await prisma.saqRequirementMap.update({
    where: { id: mappingId },
    data: { requiresEvidence: parsed.data.requiresEvidence },
    include: {
      saqType: true,
      requirement: true,
    },
  });

  await writeAuditLog({
    userId: req.auth?.userId,
    roleCode: req.auth?.role,
    actionType: "ADMIN_SAQ_EVIDENCE_REQUIREMENT_UPDATED",
    targetTable: "SaqRequirementMap",
    targetId: mapping.id,
    ipAddress: req.ip,
    userAgent: req.headers["user-agent"],
    metadata: {
      saqType: mapping.saqType.code,
      requirementCode: mapping.requirement.requirementCode,
      requiresEvidence: mapping.requiresEvidence,
    },
  });

  res.json({
    id: mapping.id,
    requiresEvidence: mapping.requiresEvidence,
  });
});

export default router;
