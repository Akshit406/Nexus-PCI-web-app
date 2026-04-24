import fs from "node:fs/promises";
import path from "node:path";
import { Router } from "express";
import { CertificationStatus, UserRoleCode } from "@prisma/client";
import { z } from "zod";
import { config } from "../config";
import { writeAuditLog } from "../lib/audit";
import { prisma } from "../lib/prisma";
import { AuthenticatedRequest, requireAuth, requireRole } from "../middleware/auth";

const router = Router();
const allowedDocumentExtensions = new Set([".doc", ".docx", ".pdf", ".xls", ".xlsx"]);
const maxDocumentSizeBytes = 10 * 1024 * 1024;

function getUserAgentHeader(value: string | string[] | undefined) {
  return Array.isArray(value) ? value.join(", ") : value;
}

async function getActiveCertificationForClient(clientId: string) {
  return prisma.certification.findFirst({
    where: {
      clientId,
      status: {
        in: [
          CertificationStatus.DRAFT,
          CertificationStatus.IN_PROGRESS,
          CertificationStatus.READY_TO_GENERATE,
        ],
      },
    },
    include: {
      saqType: true,
      paymentStatus: true,
      answers: { include: { requirement: { include: { topic: true } } } },
      dashboardMessages: { where: { isActive: true }, orderBy: { createdAt: "desc" } },
      signature: true,
    },
    orderBy: { cycleYear: "desc" },
  });
}

router.get("/dashboard", requireAuth, requireRole([UserRoleCode.CLIENT]), async (req: AuthenticatedRequest, res) => {
  const clientId = req.auth?.clientId;
  if (!clientId) {
    return res.status(400).json({ message: "Client context missing." });
  }

  const client = await prisma.client.findUnique({ where: { id: clientId } });
  const certification = await getActiveCertificationForClient(clientId);

  if (!client || !certification) {
    return res.status(404).json({ message: "Active certification not found." });
  }

  const mappedRequirements = await prisma.saqRequirementMap.findMany({
    where: { saqTypeId: certification.saqTypeId, isActive: true },
    include: { requirement: { include: { topic: true } } },
    orderBy: { displayOrder: "asc" },
  });

  const totalRequirements = mappedRequirements.length;
  const answeredCount = certification.answers.length;
  const unansweredCount = totalRequirements - answeredCount;

  const topicProgress = mappedRequirements.reduce<Record<string, { topicCode: string; topicName: string; total: number; answered: number }>>(
    (acc, item) => {
      const topicCode = item.requirement.topic.code;
      if (!acc[topicCode]) {
        acc[topicCode] = { topicCode, topicName: item.requirement.topic.name, total: 0, answered: 0 };
      }
      acc[topicCode].total += 1;
      if (certification.answers.some((answer) => answer.requirementId === item.requirementId)) {
        acc[topicCode].answered += 1;
      }
      return acc;
    },
    {},
  );

  res.json({
    client: {
      id: client.id,
      companyName: client.companyName,
      businessType: client.businessType,
    },
    certification: {
      id: certification.id,
      cycleYear: certification.cycleYear,
      status: certification.status,
      saqType: certification.saqType.name,
      paymentState: certification.paymentStatus?.state ?? "UNPAID",
      lastViewedTopicCode: certification.lastViewedTopicCode,
      preloadedFromCertificationId: certification.preloadedFromCertificationId,
      issueDate: certification.issuedAt,
      validUntil: certification.validUntil,
      isLocked: certification.isLocked,
      hasSignature: Boolean(certification.signature),
      signaturePreviewUrl: certification.signature?.imageDataUrl ?? null,
    },
    stats: {
      totalRequirements,
      answeredCount,
      unansweredCount,
      progressPercentage: totalRequirements > 0 ? Math.round((answeredCount / totalRequirements) * 100) : 0,
      pendingEvidenceCount: 0,
    },
    topics: Object.values(topicProgress).map((topic) => ({
      ...topic,
      percentage: topic.total > 0 ? Math.round((topic.answered / topic.total) * 100) : 0,
    })),
    messages: certification.dashboardMessages,
  });
});

router.get("/documents", requireAuth, requireRole([UserRoleCode.CLIENT]), async (req: AuthenticatedRequest, res) => {
  const clientId = req.auth?.clientId;
  if (!clientId) {
    return res.status(400).json({ message: "Client context missing." });
  }

  const certification = await getActiveCertificationForClient(clientId);
  const documents = await prisma.clientDocument.findMany({
    where: {
      clientId,
      certificationId: certification?.id,
    },
    orderBy: { createdAt: "desc" },
  });

  res.json({
    certificationId: certification?.id ?? null,
    items: documents.map((document) => ({
      id: document.id,
      title: document.title,
      fileName: document.fileName,
      category: document.category,
      sourceTemplateKey: document.sourceTemplateKey,
      mimeType: document.mimeType,
      fileSizeBytes: document.fileSizeBytes,
      notes: document.notes ?? "",
      createdAt: document.createdAt,
    })),
  });
});

router.post("/documents", requireAuth, requireRole([UserRoleCode.CLIENT]), async (req: AuthenticatedRequest, res) => {
  const schema = z.object({
    title: z.string().min(1),
    fileName: z.string().min(1),
    mimeType: z.string().min(1),
    fileBase64: z.string().min(1),
    sourceTemplateKey: z.string().optional(),
    notes: z.string().optional(),
  });
  const parsed = schema.safeParse(req.body);
  const clientId = req.auth?.clientId;

  if (!parsed.success || !clientId) {
    return res.status(400).json({ message: "Invalid document payload." });
  }

  const certification = await getActiveCertificationForClient(clientId);
  if (!certification || certification.isLocked) {
    return res.status(400).json({ message: "Certification is not editable." });
  }

  const sourceFileName = path.basename(parsed.data.fileName);
  const extension = path.extname(sourceFileName).toLowerCase();
  if (!allowedDocumentExtensions.has(extension)) {
    return res.status(400).json({ message: "Unsupported file type." });
  }

  const base64Payload = parsed.data.fileBase64.includes(",")
    ? parsed.data.fileBase64.split(",").pop() ?? ""
    : parsed.data.fileBase64;
  const buffer = Buffer.from(base64Payload, "base64");
  if (!buffer.byteLength) {
    return res.status(400).json({ message: "File content is empty." });
  }

  if (buffer.byteLength > maxDocumentSizeBytes) {
    return res.status(400).json({ message: "The file exceeds the 10 MB limit." });
  }

  const safeFileName = sourceFileName.replace(/[^a-zA-Z0-9._-]/g, "-");
  const relativeDirectory = path.join("client-documents", clientId, certification.id);
  const absoluteDirectory = path.join(config.uploadsDir, relativeDirectory);
  await fs.mkdir(absoluteDirectory, { recursive: true });

  const storageFileName = `${Date.now()}-${safeFileName}`;
  const absoluteFilePath = path.join(absoluteDirectory, storageFileName);
  await fs.writeFile(absoluteFilePath, buffer);

  const document = await prisma.clientDocument.create({
    data: {
      clientId,
      certificationId: certification.id,
      uploadedByUserId: req.auth!.userId,
      category: "EDITED_TEMPLATE",
      sourceTemplateKey: parsed.data.sourceTemplateKey,
      title: parsed.data.title.trim(),
      fileName: safeFileName,
      mimeType: parsed.data.mimeType,
      storagePath: path.join(relativeDirectory, storageFileName),
      fileSizeBytes: buffer.byteLength,
      notes: parsed.data.notes?.trim() || undefined,
    },
  });

  await writeAuditLog({
    userId: req.auth?.userId,
    roleCode: req.auth?.role,
    actionType: "CLIENT_DOCUMENT_UPLOADED",
    targetTable: "ClientDocument",
    targetId: document.id,
    clientId,
    certificationId: certification.id,
    ipAddress: req.ip,
    userAgent: getUserAgentHeader(req.headers["user-agent"]),
    metadata: {
      sourceTemplateKey: parsed.data.sourceTemplateKey ?? null,
      fileName: safeFileName,
      sizeBytes: buffer.byteLength,
    },
  });

  res.status(201).json({
    id: document.id,
    title: document.title,
    fileName: document.fileName,
    category: document.category,
    sourceTemplateKey: document.sourceTemplateKey,
    mimeType: document.mimeType,
    fileSizeBytes: document.fileSizeBytes,
    notes: document.notes ?? "",
    createdAt: document.createdAt,
  });
});

router.get("/documents/:documentId/download", requireAuth, requireRole([UserRoleCode.CLIENT]), async (req: AuthenticatedRequest, res) => {
  const clientId = req.auth?.clientId;
  const documentId = Array.isArray(req.params.documentId) ? req.params.documentId[0] : req.params.documentId;
  if (!clientId || !documentId) {
    return res.status(400).json({ message: "Invalid document request." });
  }

  const document = await prisma.clientDocument.findFirst({
    where: {
      id: documentId,
      clientId,
    },
  });

  if (!document) {
    return res.status(404).json({ message: "Document not found." });
  }

  const absoluteFilePath = path.join(config.uploadsDir, document.storagePath);
  try {
    await fs.access(absoluteFilePath);
  } catch {
    return res.status(404).json({ message: "Stored file not found." });
  }

  await writeAuditLog({
    userId: req.auth?.userId,
    roleCode: req.auth?.role,
    actionType: "CLIENT_DOCUMENT_DOWNLOADED",
    targetTable: "ClientDocument",
    targetId: document.id,
    clientId,
    certificationId: document.certificationId ?? undefined,
    ipAddress: req.ip,
    userAgent: getUserAgentHeader(req.headers["user-agent"]),
  });

  res.download(absoluteFilePath, document.fileName);
});

export default router;
