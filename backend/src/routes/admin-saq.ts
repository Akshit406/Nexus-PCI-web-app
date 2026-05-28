import { Router } from "express";
import { CertificationStatus, Prisma, UserRoleCode } from "@prisma/client";
import { z } from "zod";
import { writeAuditLog } from "../lib/audit";
import { prisma } from "../lib/prisma";
import { AuthenticatedRequest, requireAuth, requireRole } from "../middleware/auth";

const router = Router();

function getUserAgentHeader(value: string | string[] | undefined) {
  return Array.isArray(value) ? value.join(", ") : value;
}

// --- SAQ types + their active requirement mappings ---------------------------

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
        testingProcedures: mapping.requirement.testingProcedures,
        topicCode: mapping.requirement.topic.code,
        topicName: mapping.requirement.topic.name,
        displayOrder: mapping.displayOrder,
        requiresEvidence: mapping.requiresEvidence,
        requiresCcwJustification: mapping.requiresCcwJustification,
        requiresNaJustification: mapping.requiresNaJustification,
        allowNotTested: mapping.allowNotTested,
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
    userAgent: getUserAgentHeader(req.headers["user-agent"]),
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

// --- PCI topics + requirements catalog -------------------------------------

router.get("/topics", requireAuth, requireRole([UserRoleCode.ADMIN]), async (_req, res) => {
  const topics = await prisma.pciTopic.findMany({
    orderBy: { displayOrder: "asc" },
    select: { id: true, code: true, name: true },
  });
  res.json({ items: topics });
});

router.get("/requirements", requireAuth, requireRole([UserRoleCode.ADMIN]), async (req, res) => {
  const search = String(req.query.search ?? "").trim();
  const topicCode = String(req.query.topicCode ?? "").trim();

  const where: Prisma.PciRequirementWhereInput = {
    isActive: true,
    ...(topicCode ? { topic: { code: topicCode } } : {}),
    ...(search
      ? {
          OR: [
            { requirementCode: { contains: search } },
            { title: { contains: search } },
            { description: { contains: search } },
          ],
        }
      : {}),
  };

  const requirements = await prisma.pciRequirement.findMany({
    where,
    orderBy: [{ requirementCode: "asc" }],
    take: 500,
    include: { topic: true },
  });

  res.json({
    items: requirements.map((requirement) => ({
      id: requirement.id,
      requirementCode: requirement.requirementCode,
      title: requirement.title,
      description: requirement.description,
      testingProcedures: requirement.testingProcedures,
      requirementVersion: requirement.requirementVersion,
      topicCode: requirement.topic.code,
      topicName: requirement.topic.name,
      updatedAt: requirement.updatedAt.toISOString(),
    })),
  });
});

router.post("/requirements", requireAuth, requireRole([UserRoleCode.ADMIN]), async (req: AuthenticatedRequest, res) => {
  const schema = z.object({
    requirementCode: z.string().trim().regex(/^\d+(?:\.\d+){1,4}$/u, "El codigo debe seguir el formato 1.2.3."),
    topicCode: z.string().trim().min(1),
    title: z.string().trim().min(3),
    description: z.string().trim().min(3),
    testingProcedures: z.string().optional().nullable(),
    requirementVersion: z.string().trim().optional().nullable(),
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: parsed.error.issues[0]?.message ?? "Datos invalidos." });
  }

  const topic = await prisma.pciTopic.findUnique({ where: { code: parsed.data.topicCode } });
  if (!topic) {
    return res.status(400).json({ message: "Topico PCI no encontrado." });
  }

  const existing = await prisma.pciRequirement.findUnique({
    where: { requirementCode: parsed.data.requirementCode },
  });
  if (existing) {
    return res.status(409).json({ message: `El requisito ${parsed.data.requirementCode} ya existe.` });
  }

  const requirement = await prisma.pciRequirement.create({
    data: {
      requirementCode: parsed.data.requirementCode,
      title: parsed.data.title,
      description: parsed.data.description,
      testingProcedures: parsed.data.testingProcedures?.trim() || null,
      requirementVersion: parsed.data.requirementVersion?.trim() || null,
      topicId: topic.id,
    },
    include: { topic: true },
  });

  await writeAuditLog({
    userId: req.auth?.userId,
    roleCode: req.auth?.role,
    actionType: "ADMIN_SAQ_REQUIREMENT_CREATED",
    targetTable: "PciRequirement",
    targetId: requirement.id,
    ipAddress: req.ip,
    userAgent: getUserAgentHeader(req.headers["user-agent"]),
    metadata: {
      requirementCode: requirement.requirementCode,
      topicCode: requirement.topic.code,
    },
  });

  res.status(201).json({
    id: requirement.id,
    requirementCode: requirement.requirementCode,
    title: requirement.title,
    description: requirement.description,
    testingProcedures: requirement.testingProcedures,
    requirementVersion: requirement.requirementVersion,
    topicCode: requirement.topic.code,
    topicName: requirement.topic.name,
  });
});

router.patch("/requirements/:requirementId", requireAuth, requireRole([UserRoleCode.ADMIN]), async (req: AuthenticatedRequest, res) => {
  const schema = z.object({
    title: z.string().trim().min(3).optional(),
    description: z.string().trim().min(3).optional(),
    testingProcedures: z.string().optional().nullable(),
    requirementVersion: z.string().trim().optional().nullable(),
    topicCode: z.string().trim().optional(),
  });
  const requirementId = Array.isArray(req.params.requirementId) ? req.params.requirementId[0] : req.params.requirementId;

  const parsed = schema.safeParse(req.body);
  if (!parsed.success || !requirementId) {
    return res.status(400).json({ message: "Datos de requisito invalidos." });
  }

  const requirement = await prisma.pciRequirement.findUnique({
    where: { id: requirementId },
    include: { topic: true },
  });
  if (!requirement) {
    return res.status(404).json({ message: "Requisito no encontrado." });
  }

  let topicId: string | undefined;
  if (parsed.data.topicCode && parsed.data.topicCode !== requirement.topic.code) {
    const topic = await prisma.pciTopic.findUnique({ where: { code: parsed.data.topicCode } });
    if (!topic) {
      return res.status(400).json({ message: "Topico PCI no encontrado." });
    }
    topicId = topic.id;
  }

  const updated = await prisma.pciRequirement.update({
    where: { id: requirement.id },
    data: {
      ...(parsed.data.title !== undefined ? { title: parsed.data.title } : {}),
      ...(parsed.data.description !== undefined ? { description: parsed.data.description } : {}),
      ...(parsed.data.testingProcedures !== undefined
        ? { testingProcedures: parsed.data.testingProcedures?.trim() || null }
        : {}),
      ...(parsed.data.requirementVersion !== undefined
        ? { requirementVersion: parsed.data.requirementVersion?.trim() || null }
        : {}),
      ...(topicId ? { topicId } : {}),
    },
    include: { topic: true },
  });

  await writeAuditLog({
    userId: req.auth?.userId,
    roleCode: req.auth?.role,
    actionType: "ADMIN_SAQ_REQUIREMENT_UPDATED",
    targetTable: "PciRequirement",
    targetId: updated.id,
    ipAddress: req.ip,
    userAgent: getUserAgentHeader(req.headers["user-agent"]),
    metadata: {
      requirementCode: updated.requirementCode,
      fields: Object.keys(parsed.data),
      topicCode: updated.topic.code,
    },
  });

  res.json({
    id: updated.id,
    requirementCode: updated.requirementCode,
    title: updated.title,
    description: updated.description,
    testingProcedures: updated.testingProcedures,
    requirementVersion: updated.requirementVersion,
    topicCode: updated.topic.code,
    topicName: updated.topic.name,
  });
});

// --- SAQ -> requirement attach / detach / flag editing ---------------------

router.get("/types/:saqTypeId/available-requirements", requireAuth, requireRole([UserRoleCode.ADMIN]), async (req, res) => {
  const saqTypeId = Array.isArray(req.params.saqTypeId) ? req.params.saqTypeId[0] : req.params.saqTypeId;
  if (!saqTypeId) {
    return res.status(400).json({ message: "SAQ invalido." });
  }
  const saqType = await prisma.saqType.findUnique({ where: { id: saqTypeId } });
  if (!saqType) {
    return res.status(404).json({ message: "SAQ no encontrado." });
  }

  const existingMappings = await prisma.saqRequirementMap.findMany({
    where: { saqTypeId, isActive: true },
    select: { requirementId: true },
  });
  const mappedIds = new Set(existingMappings.map((mapping) => mapping.requirementId));

  const search = String(req.query.search ?? "").trim();
  const requirements = await prisma.pciRequirement.findMany({
    where: {
      isActive: true,
      id: { notIn: Array.from(mappedIds) },
      ...(search
        ? {
            OR: [
              { requirementCode: { contains: search } },
              { title: { contains: search } },
              { description: { contains: search } },
            ],
          }
        : {}),
    },
    orderBy: [{ requirementCode: "asc" }],
    take: 200,
    include: { topic: true },
  });

  res.json({
    items: requirements.map((requirement) => ({
      id: requirement.id,
      requirementCode: requirement.requirementCode,
      title: requirement.title,
      topicCode: requirement.topic.code,
      topicName: requirement.topic.name,
    })),
  });
});

router.post("/types/:saqTypeId/mappings", requireAuth, requireRole([UserRoleCode.ADMIN]), async (req: AuthenticatedRequest, res) => {
  const schema = z.object({
    requirementId: z.string().trim().min(1),
    requiresEvidence: z.boolean().optional().default(false),
    requiresCcwJustification: z.boolean().optional().default(true),
    requiresNaJustification: z.boolean().optional().default(true),
    allowNotTested: z.boolean().optional().default(false),
    displayOrder: z.number().int().optional(),
  });
  const saqTypeId = Array.isArray(req.params.saqTypeId) ? req.params.saqTypeId[0] : req.params.saqTypeId;
  const parsed = schema.safeParse(req.body);
  if (!parsed.success || !saqTypeId) {
    return res.status(400).json({ message: parsed.success ? "SAQ invalido." : parsed.error.issues[0]?.message ?? "Datos invalidos." });
  }

  const [saqType, requirement] = await Promise.all([
    prisma.saqType.findUnique({ where: { id: saqTypeId } }),
    prisma.pciRequirement.findUnique({ where: { id: parsed.data.requirementId } }),
  ]);
  if (!saqType) {
    return res.status(404).json({ message: "SAQ no encontrado." });
  }
  if (!requirement) {
    return res.status(404).json({ message: "Requisito no encontrado." });
  }

  // Reactivate a soft-deleted mapping instead of failing on the unique key.
  const existing = await prisma.saqRequirementMap.findUnique({
    where: { saqTypeId_requirementId: { saqTypeId, requirementId: parsed.data.requirementId } },
  });

  const lastOrder = await prisma.saqRequirementMap.aggregate({
    where: { saqTypeId, isActive: true },
    _max: { displayOrder: true },
  });
  const nextOrder = parsed.data.displayOrder ?? (lastOrder._max.displayOrder ?? 0) + 10;

  const mapping = existing
    ? await prisma.saqRequirementMap.update({
        where: { id: existing.id },
        data: {
          isActive: true,
          displayOrder: nextOrder,
          requiresEvidence: parsed.data.requiresEvidence,
          requiresCcwJustification: parsed.data.requiresCcwJustification,
          requiresNaJustification: parsed.data.requiresNaJustification,
          allowNotTested: parsed.data.allowNotTested,
        },
        include: { saqType: true, requirement: { include: { topic: true } } },
      })
    : await prisma.saqRequirementMap.create({
        data: {
          saqTypeId,
          requirementId: parsed.data.requirementId,
          displayOrder: nextOrder,
          requiresEvidence: parsed.data.requiresEvidence,
          requiresCcwJustification: parsed.data.requiresCcwJustification,
          requiresNaJustification: parsed.data.requiresNaJustification,
          allowNotTested: parsed.data.allowNotTested,
        },
        include: { saqType: true, requirement: { include: { topic: true } } },
      });

  await writeAuditLog({
    userId: req.auth?.userId,
    roleCode: req.auth?.role,
    actionType: "ADMIN_SAQ_MAPPING_ATTACHED",
    targetTable: "SaqRequirementMap",
    targetId: mapping.id,
    ipAddress: req.ip,
    userAgent: getUserAgentHeader(req.headers["user-agent"]),
    metadata: {
      saqType: mapping.saqType.code,
      requirementCode: mapping.requirement.requirementCode,
      reactivated: Boolean(existing),
    },
  });

  res.status(201).json({
    id: mapping.id,
    saqTypeId: mapping.saqTypeId,
    requirementId: mapping.requirementId,
    requirementCode: mapping.requirement.requirementCode,
    title: mapping.requirement.title,
    description: mapping.requirement.description,
    topicCode: mapping.requirement.topic.code,
    topicName: mapping.requirement.topic.name,
    displayOrder: mapping.displayOrder,
    requiresEvidence: mapping.requiresEvidence,
    requiresCcwJustification: mapping.requiresCcwJustification,
    requiresNaJustification: mapping.requiresNaJustification,
    allowNotTested: mapping.allowNotTested,
  });
});

router.patch("/mappings/:mappingId", requireAuth, requireRole([UserRoleCode.ADMIN]), async (req: AuthenticatedRequest, res) => {
  const schema = z.object({
    requiresEvidence: z.boolean().optional(),
    requiresCcwJustification: z.boolean().optional(),
    requiresNaJustification: z.boolean().optional(),
    allowNotTested: z.boolean().optional(),
    displayOrder: z.number().int().optional(),
  });
  const mappingId = Array.isArray(req.params.mappingId) ? req.params.mappingId[0] : req.params.mappingId;
  const parsed = schema.safeParse(req.body);
  if (!parsed.success || !mappingId) {
    return res.status(400).json({ message: "Datos invalidos." });
  }

  const mapping = await prisma.saqRequirementMap.update({
    where: { id: mappingId },
    data: {
      ...(parsed.data.requiresEvidence !== undefined ? { requiresEvidence: parsed.data.requiresEvidence } : {}),
      ...(parsed.data.requiresCcwJustification !== undefined
        ? { requiresCcwJustification: parsed.data.requiresCcwJustification }
        : {}),
      ...(parsed.data.requiresNaJustification !== undefined
        ? { requiresNaJustification: parsed.data.requiresNaJustification }
        : {}),
      ...(parsed.data.allowNotTested !== undefined ? { allowNotTested: parsed.data.allowNotTested } : {}),
      ...(parsed.data.displayOrder !== undefined ? { displayOrder: parsed.data.displayOrder } : {}),
    },
    include: { saqType: true, requirement: true },
  });

  await writeAuditLog({
    userId: req.auth?.userId,
    roleCode: req.auth?.role,
    actionType: "ADMIN_SAQ_MAPPING_FLAGS_UPDATED",
    targetTable: "SaqRequirementMap",
    targetId: mapping.id,
    ipAddress: req.ip,
    userAgent: getUserAgentHeader(req.headers["user-agent"]),
    metadata: {
      saqType: mapping.saqType.code,
      requirementCode: mapping.requirement.requirementCode,
      changed: Object.keys(parsed.data),
    },
  });

  res.json({
    id: mapping.id,
    requiresEvidence: mapping.requiresEvidence,
    requiresCcwJustification: mapping.requiresCcwJustification,
    requiresNaJustification: mapping.requiresNaJustification,
    allowNotTested: mapping.allowNotTested,
    displayOrder: mapping.displayOrder,
  });
});

router.delete("/mappings/:mappingId", requireAuth, requireRole([UserRoleCode.ADMIN]), async (req: AuthenticatedRequest, res) => {
  const mappingId = Array.isArray(req.params.mappingId) ? req.params.mappingId[0] : req.params.mappingId;
  if (!mappingId) {
    return res.status(400).json({ message: "Mapping invalido." });
  }

  const mapping = await prisma.saqRequirementMap.findUnique({
    where: { id: mappingId },
    include: { saqType: true, requirement: true },
  });
  if (!mapping) {
    return res.status(404).json({ message: "Mapping no encontrado." });
  }

  // Guardrail: removing a mapping that is currently in use by a LOCKED
  // certification would retroactively rewrite a finalized SAQ PDF, so we
  // refuse and tell the admin to reopen the certification first.
  const lockedDependency = await prisma.certificationAnswer.findFirst({
    where: {
      requirementId: mapping.requirementId,
      certification: {
        saqTypeId: mapping.saqTypeId,
        isLocked: true,
        status: { not: CertificationStatus.ARCHIVED },
      },
    },
    include: { certification: { include: { client: true } } },
  });
  if (lockedDependency) {
    return res.status(409).json({
      message: `No puedes quitar este requisito mientras siga en uso por una certificacion bloqueada (cliente: ${lockedDependency.certification.client.companyName}). Reabre primero esa certificacion.`,
    });
  }

  await prisma.saqRequirementMap.update({
    where: { id: mappingId },
    data: { isActive: false },
  });

  await writeAuditLog({
    userId: req.auth?.userId,
    roleCode: req.auth?.role,
    actionType: "ADMIN_SAQ_MAPPING_DETACHED",
    targetTable: "SaqRequirementMap",
    targetId: mapping.id,
    ipAddress: req.ip,
    userAgent: getUserAgentHeader(req.headers["user-agent"]),
    metadata: {
      saqType: mapping.saqType.code,
      requirementCode: mapping.requirement.requirementCode,
    },
  });

  res.json({ success: true });
});

export default router;
