import fs from "node:fs/promises";
import path from "node:path";
import { Router } from "express";
import { UserRoleCode } from "@prisma/client";
import { z } from "zod";
import { config } from "../config";
import { writeAuditLog } from "../lib/audit";
import { prisma } from "../lib/prisma";
import { AuthenticatedRequest, requireAuth, requireRole } from "../middleware/auth";

const router = Router();
const allowedTemplateExtensions = new Set([".doc", ".docx", ".pdf", ".xls", ".xlsx", ".txt"]);
const maxTemplateSizeBytes = 25 * 1024 * 1024;

function getUserAgentHeader(value: string | string[] | undefined) {
  return Array.isArray(value) ? value.join(", ") : value;
}

function sanitizeFileName(value: string) {
  return path.basename(value).replace(/[^a-zA-Z0-9._-]/g, "-");
}

function slugify(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function extensionToFileType(extension: string) {
  const normalized = extension.replace(".", "").toUpperCase();
  return normalized ? `${normalized} editable` : "Archivo editable";
}

function mapTemplate(template: {
  id: string;
  key: string;
  title: string;
  description: string;
  fileName: string;
  fileType: string;
  mimeType: string | null;
  fileSizeBytes: number | null;
  isActive: boolean;
  isArchived: boolean;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: template.id,
    key: template.key,
    title: template.title,
    description: template.description,
    fileName: template.fileName,
    fileType: template.fileType,
    mimeType: template.mimeType ?? "application/octet-stream",
    fileSizeBytes: template.fileSizeBytes ?? 0,
    isActive: template.isActive,
    isArchived: template.isArchived,
    createdAt: template.createdAt,
    updatedAt: template.updatedAt,
    downloadUrl: `/templates/${template.id}/download`,
  };
}

async function storeTemplateFile(input: { key: string; fileName: string; fileBase64: string }) {
  const sourceFileName = sanitizeFileName(input.fileName);
  const extension = path.extname(sourceFileName).toLowerCase();
  if (!allowedTemplateExtensions.has(extension)) {
    throw new Error("Tipo de archivo no permitido para plantillas.");
  }

  const base64Payload = input.fileBase64.includes(",") ? input.fileBase64.split(",").pop() ?? "" : input.fileBase64;
  const buffer = Buffer.from(base64Payload, "base64");
  if (!buffer.byteLength) {
    throw new Error("El archivo esta vacio.");
  }
  if (buffer.byteLength > maxTemplateSizeBytes) {
    throw new Error("El archivo excede el limite de 25 MB.");
  }

  const relativeDirectory = path.join("document-templates", input.key);
  const absoluteDirectory = path.join(config.uploadsDir, relativeDirectory);
  await fs.mkdir(absoluteDirectory, { recursive: true });
  const storageFileName = `${Date.now()}-${sourceFileName}`;
  await fs.writeFile(path.join(absoluteDirectory, storageFileName), buffer);

  return {
    fileName: sourceFileName,
    fileType: extensionToFileType(extension),
    mimeType: extension === ".docx" ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document" : "application/octet-stream",
    storagePath: path.join(relativeDirectory, storageFileName),
    fileSizeBytes: buffer.byteLength,
  };
}

router.get("/", requireAuth, requireRole([UserRoleCode.CLIENT, UserRoleCode.EXECUTIVE, UserRoleCode.ADMIN]), async (_req, res) => {
  const templates = await prisma.documentTemplate.findMany({
    where: { isActive: true, isArchived: false },
    orderBy: [{ title: "asc" }],
  });
  res.json({ items: templates.map(mapTemplate) });
});

router.get("/admin", requireAuth, requireRole([UserRoleCode.ADMIN]), async (_req, res) => {
  const templates = await prisma.documentTemplate.findMany({
    where: { isArchived: false },
    orderBy: [{ isActive: "desc" }, { title: "asc" }],
  });
  res.json({ items: templates.map(mapTemplate) });
});

router.post("/", requireAuth, requireRole([UserRoleCode.ADMIN]), async (req: AuthenticatedRequest, res) => {
  const schema = z.object({
    title: z.string().min(3),
    description: z.string().min(3),
    key: z.string().optional(),
    fileType: z.string().optional(),
    fileName: z.string().min(1),
    fileBase64: z.string().min(1),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "Datos de plantilla invalidos." });
  }

  const key = slugify(parsed.data.key || parsed.data.title);
  if (!key) {
    return res.status(400).json({ message: "No fue posible generar la clave de la plantilla." });
  }

  try {
    const storedFile = await storeTemplateFile({ key, fileName: parsed.data.fileName, fileBase64: parsed.data.fileBase64 });
    const template = await prisma.documentTemplate.create({
      data: {
        key,
        title: parsed.data.title.trim(),
        description: parsed.data.description.trim(),
        fileName: storedFile.fileName,
        fileType: parsed.data.fileType?.trim() || storedFile.fileType,
        mimeType: storedFile.mimeType,
        storagePath: storedFile.storagePath,
        fileSizeBytes: storedFile.fileSizeBytes,
        createdByUserId: req.auth!.userId,
        updatedByUserId: req.auth!.userId,
      },
    });
    await writeAuditLog({
      userId: req.auth!.userId,
      actionType: "TEMPLATE_CREATED",
      targetTable: "DocumentTemplate",
      targetId: template.id,
      metadata: { key },
      ipAddress: req.ip,
      userAgent: getUserAgentHeader(req.headers["user-agent"]),
    });
    res.status(201).json(mapTemplate(template));
  } catch (error) {
    res.status(400).json({ message: error instanceof Error ? error.message : "No fue posible crear la plantilla." });
  }
});

router.patch("/:templateId", requireAuth, requireRole([UserRoleCode.ADMIN]), async (req: AuthenticatedRequest, res) => {
  const schema = z.object({
    title: z.string().min(3).optional(),
    description: z.string().min(3).optional(),
    fileType: z.string().min(1).optional(),
  });
  const parsed = schema.safeParse(req.body);
  const templateId = Array.isArray(req.params.templateId) ? req.params.templateId[0] : req.params.templateId;
  if (!parsed.success || !templateId) {
    return res.status(400).json({ message: "Datos de plantilla invalidos." });
  }

  const template = await prisma.documentTemplate.update({
    where: { id: templateId },
    data: {
      ...parsed.data,
      updatedByUserId: req.auth!.userId,
    },
  });
  await writeAuditLog({
    userId: req.auth!.userId,
    actionType: "TEMPLATE_UPDATED",
    targetTable: "DocumentTemplate",
    targetId: template.id,
    metadata: parsed.data,
    ipAddress: req.ip,
    userAgent: getUserAgentHeader(req.headers["user-agent"]),
  });
  res.json(mapTemplate(template));
});

router.post("/:templateId/file", requireAuth, requireRole([UserRoleCode.ADMIN]), async (req: AuthenticatedRequest, res) => {
  const schema = z.object({
    fileName: z.string().min(1),
    fileBase64: z.string().min(1),
    fileType: z.string().optional(),
  });
  const parsed = schema.safeParse(req.body);
  const templateId = Array.isArray(req.params.templateId) ? req.params.templateId[0] : req.params.templateId;
  if (!parsed.success || !templateId) {
    return res.status(400).json({ message: "Archivo de plantilla invalido." });
  }

  const existing = await prisma.documentTemplate.findUnique({ where: { id: templateId } });
  if (!existing || existing.isArchived) {
    return res.status(404).json({ message: "Plantilla no encontrada." });
  }

  try {
    const storedFile = await storeTemplateFile({ key: existing.key, fileName: parsed.data.fileName, fileBase64: parsed.data.fileBase64 });
    const template = await prisma.documentTemplate.update({
      where: { id: templateId },
      data: {
        fileName: storedFile.fileName,
        fileType: parsed.data.fileType?.trim() || storedFile.fileType,
        mimeType: storedFile.mimeType,
        storagePath: storedFile.storagePath,
        publicUrl: null,
        fileSizeBytes: storedFile.fileSizeBytes,
        updatedByUserId: req.auth!.userId,
      },
    });
    await writeAuditLog({
      userId: req.auth!.userId,
      actionType: "TEMPLATE_FILE_REPLACED",
      targetTable: "DocumentTemplate",
      targetId: template.id,
      metadata: { fileName: storedFile.fileName },
      ipAddress: req.ip,
      userAgent: getUserAgentHeader(req.headers["user-agent"]),
    });
    res.json(mapTemplate(template));
  } catch (error) {
    res.status(400).json({ message: error instanceof Error ? error.message : "No fue posible reemplazar el archivo." });
  }
});

router.patch("/:templateId/status", requireAuth, requireRole([UserRoleCode.ADMIN]), async (req: AuthenticatedRequest, res) => {
  const schema = z.object({ isActive: z.boolean() });
  const parsed = schema.safeParse(req.body);
  const templateId = Array.isArray(req.params.templateId) ? req.params.templateId[0] : req.params.templateId;
  if (!parsed.success || !templateId) {
    return res.status(400).json({ message: "Estado de plantilla invalido." });
  }

  const template = await prisma.documentTemplate.update({
    where: { id: templateId },
    data: {
      isActive: parsed.data.isActive,
      updatedByUserId: req.auth!.userId,
    },
  });
  await writeAuditLog({
    userId: req.auth!.userId,
    actionType: parsed.data.isActive ? "TEMPLATE_ENABLED" : "TEMPLATE_DISABLED",
    targetTable: "DocumentTemplate",
    targetId: template.id,
    ipAddress: req.ip,
    userAgent: getUserAgentHeader(req.headers["user-agent"]),
  });
  res.json(mapTemplate(template));
});

router.delete("/:templateId", requireAuth, requireRole([UserRoleCode.ADMIN]), async (req: AuthenticatedRequest, res) => {
  const templateId = Array.isArray(req.params.templateId) ? req.params.templateId[0] : req.params.templateId;
  if (!templateId) {
    return res.status(400).json({ message: "Plantilla invalida." });
  }

  const template = await prisma.documentTemplate.update({
    where: { id: templateId },
    data: {
      isActive: false,
      isArchived: true,
      archivedAt: new Date(),
      updatedByUserId: req.auth!.userId,
    },
  });
  await writeAuditLog({
    userId: req.auth!.userId,
    actionType: "TEMPLATE_ARCHIVED",
    targetTable: "DocumentTemplate",
    targetId: template.id,
    ipAddress: req.ip,
    userAgent: getUserAgentHeader(req.headers["user-agent"]),
  });
  res.json({ success: true });
});

router.get("/:templateId/download", requireAuth, requireRole([UserRoleCode.CLIENT, UserRoleCode.EXECUTIVE, UserRoleCode.ADMIN]), async (req: AuthenticatedRequest, res) => {
  const templateId = Array.isArray(req.params.templateId) ? req.params.templateId[0] : req.params.templateId;
  if (!templateId) {
    return res.status(400).json({ message: "Plantilla invalida." });
  }

  const template = await prisma.documentTemplate.findUnique({ where: { id: templateId } });
  if (!template || template.isArchived || (!template.isActive && req.auth!.role !== UserRoleCode.ADMIN)) {
    return res.status(404).json({ message: "Plantilla no encontrada." });
  }

  if (template.storagePath) {
    const absoluteFilePath = path.join(config.uploadsDir, template.storagePath);
    return res.download(absoluteFilePath, template.fileName);
  }
  if (template.publicUrl) {
    return res.redirect(template.publicUrl);
  }
  return res.status(404).json({ message: "Archivo de plantilla no encontrado." });
});

export default router;
