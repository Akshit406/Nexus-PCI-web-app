import { Router } from "express";
import fs from "node:fs/promises";
import path from "node:path";
import { CertificationStatus, Prisma, UserRoleCode } from "@prisma/client";
import { z } from "zod";
import { config } from "../config";
import { writeAuditLog } from "../lib/audit";
import { prisma } from "../lib/prisma";
import {
  OfficialDocumentKind,
  ParsedOfficialRequirement,
  applyOfficialSaqQuestionSnapshot,
  compareRequirementSets,
  parseOfficialAocDocument,
  parseOfficialSaqDocument,
  resolveOfficialDocument,
} from "../lib/official-document-registry";
import { getOfficialAocTemplateConfig } from "../lib/official-aoc-field-map";
import { getOfficialSaqTemplateConfig } from "../lib/official-saq-field-map";
import { AuthenticatedRequest, requireAuth, requireRole } from "../middleware/auth";

const router = Router();

function getUserAgentHeader(value: string | string[] | undefined) {
  return Array.isArray(value) ? value.join(", ") : value;
}

function sanitizeFileName(value: string) {
  return path.basename(value).replace(/[^a-zA-Z0-9._-]/g, "-");
}

function stripDataUrl(value: string) {
  return value.includes(",") ? value.split(",").pop() ?? "" : value;
}

function officialExpectedShape(kind: OfficialDocumentKind, saqTypeCode: string) {
  return kind === "SAQ" ? getOfficialSaqTemplateConfig(saqTypeCode) : getOfficialAocTemplateConfig(saqTypeCode);
}

function parseJsonArray<T>(value: string | null | undefined): T[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed as T[] : [];
  } catch {
    return [];
  }
}

async function currentRequirementRows(saqTypeId: string) {
  const rows = await prisma.saqRequirementMap.findMany({
    where: { saqTypeId, isActive: true },
    include: { requirement: true },
    orderBy: { displayOrder: "asc" },
  });
  return rows.map((row) => ({
    requirementCode: row.requirement.requirementCode,
    description: row.requirement.description,
  }));
}

function mapOfficialDocumentVersion(version: {
  id: string;
  kind: string;
  fileName: string;
  storagePath: string | null;
  bundledTemplatePath: string | null;
  sha256: string;
  textFieldCount: number;
  checkboxCount: number;
  parsedSectionsJson: string;
  parsedRequirementsJson: string;
  validationJson: string | null;
  isActive: boolean;
  appliedAt: Date | null;
  createdAt: Date;
}) {
  return {
    id: version.id,
    kind: version.kind,
    fileName: version.fileName,
    storagePath: version.storagePath,
    bundledTemplatePath: version.bundledTemplatePath,
    sha256: version.sha256,
    textFieldCount: version.textFieldCount,
    checkboxCount: version.checkboxCount,
    parsedSections: parseJsonArray(version.parsedSectionsJson),
    parsedRequirements: parseJsonArray(version.parsedRequirementsJson),
    validation: version.validationJson ? JSON.parse(version.validationJson) : null,
    isActive: version.isActive,
    appliedAt: version.appliedAt?.toISOString() ?? null,
    createdAt: version.createdAt.toISOString(),
  };
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

// --- Official SAQ/AOC document versions -----------------------------------

router.get("/official-documents", requireAuth, requireRole([UserRoleCode.ADMIN]), async (_req, res) => {
  const saqTypes = await prisma.saqType.findMany({
    where: { isActive: true },
    orderBy: { name: "asc" },
    include: {
      officialDocuments: {
        orderBy: { createdAt: "desc" },
        take: 20,
      },
    },
  });

  const items = await Promise.all(
    saqTypes.map(async (saqType) => {
      const [saq, aoc] = await Promise.all([
        resolveOfficialDocument("SAQ", saqType.code),
        resolveOfficialDocument("AOC", saqType.code),
      ]);
      return {
        id: saqType.id,
        code: saqType.code,
        name: saqType.name,
        documents: {
          SAQ: saq ? {
            fileName: saq.fileName,
            sha256: saq.sha256,
            textFieldCount: saq.parsed.textFieldCount,
            checkboxCount: saq.parsed.checkboxCount,
            parsedSections: saq.parsed.sections,
            parsedRequirements: saq.parsed.requirements,
            source: saq.source,
            validationErrors: saq.parsed.validationErrors,
            validationWarnings: saq.parsed.validationWarnings,
          } : null,
          AOC: aoc ? {
            fileName: aoc.fileName,
            sha256: aoc.sha256,
            textFieldCount: aoc.parsed.textFieldCount,
            checkboxCount: aoc.parsed.checkboxCount,
            parsedSections: [],
            parsedRequirements: [],
            source: aoc.source,
            validationErrors: aoc.parsed.validationErrors,
            validationWarnings: aoc.parsed.validationWarnings,
          } : null,
        },
        versions: saqType.officialDocuments.map(mapOfficialDocumentVersion),
      };
    }),
  );

  res.json({ items });
});

router.post("/types/:saqTypeId/official-documents/:kind/preview", requireAuth, requireRole([UserRoleCode.ADMIN]), async (req: AuthenticatedRequest, res) => {
  const saqTypeId = Array.isArray(req.params.saqTypeId) ? req.params.saqTypeId[0] : req.params.saqTypeId;
  const kind = (Array.isArray(req.params.kind) ? req.params.kind[0] : req.params.kind)?.toUpperCase() as OfficialDocumentKind | undefined;
  const schema = z.object({
    fileName: z.string().trim().min(1),
    fileBase64: z.string().min(1),
  });
  const parsedBody = schema.safeParse(req.body);
  if (!parsedBody.success || !saqTypeId || (kind !== "SAQ" && kind !== "AOC")) {
    return res.status(400).json({ message: parsedBody.success ? "Documento oficial invalido." : parsedBody.error.issues[0]?.message ?? "Datos invalidos." });
  }

  const saqType = await prisma.saqType.findUnique({ where: { id: saqTypeId } });
  if (!saqType) {
    return res.status(404).json({ message: "SAQ no encontrado." });
  }

  const fileName = sanitizeFileName(parsedBody.data.fileName);
  if (path.extname(fileName).toLowerCase() !== ".docx") {
    return res.status(400).json({ message: "Solo se aceptan documentos oficiales DOCX." });
  }

  const buffer = Buffer.from(stripDataUrl(parsedBody.data.fileBase64), "base64");
  if (!buffer.byteLength) {
    return res.status(400).json({ message: "El archivo esta vacio." });
  }
  if (buffer.byteLength > 30 * 1024 * 1024) {
    return res.status(400).json({ message: "El documento supera el limite de 30 MB." });
  }

  const parsedDocument = kind === "SAQ" ? parseOfficialSaqDocument(buffer, saqType.code) : parseOfficialAocDocument(buffer, saqType.code);
  const validationErrors = [...parsedDocument.validationErrors];
  const validationWarnings = [...parsedDocument.validationWarnings];
  const expectedShape = officialExpectedShape(kind, saqType.code);
  if (!expectedShape) {
    validationErrors.push(`No existe configuracion de formulario oficial para SAQ ${saqType.code}.`);
  } else if (parsedDocument.textFieldCount !== expectedShape.expectedTextFields || parsedDocument.checkboxCount !== expectedShape.expectedCheckboxes) {
    validationErrors.push(
      `La forma no coincide con el motor de llenado actual: se esperaban ${expectedShape.expectedTextFields} campos de texto y ${expectedShape.expectedCheckboxes} casillas; el documento tiene ${parsedDocument.textFieldCount} y ${parsedDocument.checkboxCount}.`,
    );
  }

  const currentRows = kind === "SAQ" ? await currentRequirementRows(saqTypeId) : [];
  const diff = kind === "SAQ" ? compareRequirementSets(currentRows, parsedDocument.requirements) : { added: [], removed: [], changed: [] };
  const relativeDirectory = path.join("official-documents", saqType.code, kind.toLowerCase());
  const absoluteDirectory = path.join(config.uploadsDir, relativeDirectory);
  await fs.mkdir(absoluteDirectory, { recursive: true });
  const storageFileName = `${Date.now()}-${fileName}`;
  const storagePath = path.join(relativeDirectory, storageFileName);
  await fs.writeFile(path.join(absoluteDirectory, storageFileName), buffer);

  const validation = {
    canApply: validationErrors.length === 0,
    errors: validationErrors,
    warnings: validationWarnings,
    addedRequirements: diff.added,
    removedRequirements: diff.removed,
    changedRequirements: diff.changed,
  };
  const version = await prisma.officialDocumentVersion.create({
    data: {
      saqTypeId,
      kind,
      fileName,
      storagePath,
      bundledTemplatePath: null,
      sha256: parsedDocument.sha256,
      textFieldCount: parsedDocument.textFieldCount,
      checkboxCount: parsedDocument.checkboxCount,
      parsedSectionsJson: JSON.stringify(parsedDocument.sections),
      parsedRequirementsJson: JSON.stringify(parsedDocument.requirements),
      validationJson: JSON.stringify(validation),
      uploadedByUserId: req.auth?.userId,
      isActive: false,
    },
  });

  await writeAuditLog({
    userId: req.auth?.userId,
    roleCode: req.auth?.role,
    actionType: "ADMIN_OFFICIAL_DOCUMENT_PREVIEWED",
    targetTable: "OfficialDocumentVersion",
    targetId: version.id,
    ipAddress: req.ip,
    userAgent: getUserAgentHeader(req.headers["user-agent"]),
    metadata: { saqType: saqType.code, kind, fileName, canApply: validation.canApply },
  });

  res.status(201).json({
    ...mapOfficialDocumentVersion(version),
    validation,
  });
});

router.post("/official-documents/:documentId/apply", requireAuth, requireRole([UserRoleCode.ADMIN]), async (req: AuthenticatedRequest, res) => {
  const schema = z.object({
    overwriteMode: z.literal("FULL_RESET").optional(),
    confirmFullReset: z.boolean().optional(),
  });
  const parsedBody = schema.safeParse(req.body ?? {});
  if (!parsedBody.success) {
    return res.status(400).json({ message: "Confirmacion de aplicacion invalida." });
  }
  const documentId = Array.isArray(req.params.documentId) ? req.params.documentId[0] : req.params.documentId;
  if (!documentId) {
    return res.status(400).json({ message: "Documento invalido." });
  }

  const version = await prisma.officialDocumentVersion.findUnique({
    where: { id: documentId },
    include: { saqType: true },
  });
  if (!version) {
    return res.status(404).json({ message: "Version de documento no encontrada." });
  }
  const validation = version.validationJson ? JSON.parse(version.validationJson) as { canApply?: boolean; errors?: string[] } : null;
  if (validation && validation.canApply === false) {
    return res.status(400).json({ message: "No se puede aplicar un documento con errores de validacion.", errors: validation.errors ?? [] });
  }
  if (version.kind === "SAQ" && (parsedBody.data.overwriteMode !== "FULL_RESET" || parsedBody.data.confirmFullReset !== true)) {
    return res.status(400).json({
      message: "Aplicar un SAQ oficial requiere confirmar FULL_RESET. Esta accion borra respuestas y secciones capturadas de certificaciones desbloqueadas/no finalizadas para este SAQ.",
    });
  }

  const parsedRequirements = parseJsonArray<ParsedOfficialRequirement>(version.parsedRequirementsJson);
  await prisma.$transaction(async (tx) => {
    await tx.officialDocumentVersion.updateMany({
      where: { saqTypeId: version.saqTypeId, kind: version.kind, isActive: true },
      data: { isActive: false },
    });
    await tx.officialDocumentVersion.update({
      where: { id: version.id },
      data: {
        isActive: true,
        appliedAt: new Date(),
        appliedByUserId: req.auth?.userId,
      },
    });

    if (version.kind === "SAQ") {
      await applyOfficialSaqQuestionSnapshot({
        tx,
        saqType: version.saqType,
        fileName: version.fileName,
        sha256: version.sha256,
        requirements: parsedRequirements,
        resetUnlockedCertifications: true,
      });
    }
  });

  await writeAuditLog({
    userId: req.auth?.userId,
    roleCode: req.auth?.role,
    actionType: "ADMIN_OFFICIAL_DOCUMENT_APPLIED",
    targetTable: "OfficialDocumentVersion",
    targetId: version.id,
    ipAddress: req.ip,
    userAgent: getUserAgentHeader(req.headers["user-agent"]),
    metadata: {
      saqType: version.saqType.code,
      kind: version.kind,
      fileName: version.fileName,
      parsedRequirementCount: parsedRequirements.length,
      overwriteMode: version.kind === "SAQ" ? "FULL_RESET" : null,
    },
  });

  res.json({ success: true });
});

router.get("/official-documents/:documentId/download", requireAuth, requireRole([UserRoleCode.ADMIN]), async (req, res) => {
  const documentId = Array.isArray(req.params.documentId) ? req.params.documentId[0] : req.params.documentId;
  if (!documentId) {
    return res.status(400).json({ message: "Documento invalido." });
  }
  const version = await prisma.officialDocumentVersion.findUnique({ where: { id: documentId } });
  if (!version) {
    return res.status(404).json({ message: "Documento no encontrado." });
  }
  const absolutePath = version.storagePath
    ? path.join(config.uploadsDir, version.storagePath)
    : version.bundledTemplatePath
      ? path.join(process.cwd(), "templates", version.bundledTemplatePath)
      : null;
  if (!absolutePath) {
    return res.status(404).json({ message: "El documento no tiene archivo asociado." });
  }
  res.download(absolutePath, version.fileName);
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
