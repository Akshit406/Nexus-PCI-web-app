import fs from "node:fs/promises";
import path from "node:path";
import { Router } from "express";
import { AnswerValue, CertificationStatus, PaymentState, UserRoleCode } from "@prisma/client";
import { z } from "zod";
import { config } from "../config";
import { writeAuditLog } from "../lib/audit";
import { prisma } from "../lib/prisma";
import { CaptureFieldDefinition, CaptureSectionDefinition, getSaqCaptureSections } from "../lib/saq-sections";
import { calculateSaqValidationStatus, getSaqValidationStatusLabel, getSaqValidationStatusText } from "../lib/saq-status";
import { generateAocStubPdf, generateDiplomaPdf, generateSaqPdf } from "../lib/pdf-generators";
import { getReminderSchedulerStatus, runReminderSchedulerNow } from "../lib/reminder-scheduler";
import { AuthenticatedRequest, requireAuth, requireRole } from "../middleware/auth";

const router = Router();
const allowedDocumentExtensions = new Set([".doc", ".docx", ".pdf", ".xls", ".xlsx", ".png", ".jpg", ".jpeg", ".webp", ".txt"]);
const maxDocumentSizeBytes = 25 * 1024 * 1024;

function getUserAgentHeader(value: string | string[] | undefined) {
  return Array.isArray(value) ? value.join(", ") : value;
}

function parseJsonRecord(payloadJson: string) {
  try {
    const parsed = JSON.parse(payloadJson);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? Object.fromEntries(Object.entries(parsed).map(([key, value]) => [key, typeof value === "string" ? value : String(value ?? "")]))
      : {};
  } catch {
    return {};
  }
}

function parseJsonArray(value?: string) {
  if (!value) {
    return [];
  }

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function firstNonEmpty(...values: Array<string | null | undefined>) {
  return values.find((value) => value?.trim())?.trim();
}

function requiredValue(...values: Array<string | null | undefined>) {
  return firstNonEmpty(...values) ?? "Pendiente";
}

function optionalValue(...values: Array<string | null | undefined>) {
  return firstNonEmpty(...values) ?? "No aplica";
}

function legalExceptionRows(values: Record<string, string>, maxRows = 12) {
  return Array.from({ length: maxRows }, (_, index) => {
    const row = index + 1;
    return {
      requirement: values[`legal_exception_${row}_requirement`]?.trim() ?? "",
      restriction: values[`legal_exception_${row}_restriction`]?.trim() ?? "",
    };
  }).filter((row) => row.requirement || row.restriction);
}

function formatDate(value?: Date | null) {
  if (!value) {
    return "Pendiente";
  }

  return new Intl.DateTimeFormat("es-MX", { year: "numeric", month: "short", day: "numeric" }).format(value);
}

function sanitizeFileName(value: string) {
  return path.basename(value).replace(/[^a-zA-Z0-9._-]/g, "-");
}

function escapePdfText(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

async function getLatestCertificationForClient(clientId: string) {
  return prisma.certification.findFirst({
    where: {
      clientId,
      status: { not: CertificationStatus.ARCHIVED },
    },
    include: {
      client: true,
      saqType: true,
      answers: { include: { justification: true, requirement: { include: { topic: true } } } },
      sectionInputs: true,
      signature: true,
      paymentStatus: true,
      dashboardMessages: { where: { isActive: true }, orderBy: { createdAt: "desc" } },
      documents: true,
    },
    orderBy: [{ cycleYear: "desc" }, { createdAt: "desc" }],
  });
}

async function getMappedRequirements(certification: NonNullable<Awaited<ReturnType<typeof getLatestCertificationForClient>>>) {
  return prisma.saqRequirementMap.findMany({
    where: { saqTypeId: certification.saqTypeId, isActive: true },
    include: { requirement: { include: { topic: true } } },
    orderBy: { displayOrder: "asc" },
  });
}

export async function canAccessClient(req: AuthenticatedRequest, clientId: string) {
  if (!req.auth) {
    return false;
  }

  if (req.auth.role === UserRoleCode.ADMIN) {
    return true;
  }

  if (req.auth.role === UserRoleCode.CLIENT) {
    return req.auth.clientId === clientId;
  }

  const assignment = await prisma.executiveClientAssignment.findFirst({
    where: {
      clientId,
      executiveUserId: req.auth.userId,
      isActive: true,
    },
  });
  return Boolean(assignment);
}

export async function canAccessCertification(req: AuthenticatedRequest, certificationId: string) {
  const certification = await prisma.certification.findUnique({ where: { id: certificationId } });
  if (!certification) {
    return null;
  }

  return (await canAccessClient(req, certification.clientId)) ? certification : null;
}

function validateCcwExplanation(explanation?: string | null) {
  if (!explanation) {
    return false;
  }

  const parsed = parseJsonRecord(explanation);
  return ["restrictions", "definition", "objective", "risk", "validation", "maintenance"].every((key) => parsed[key]?.trim());
}

function isRequiredFieldComplete(value: string, inputType: CaptureFieldDefinition["inputType"]) {
  if (inputType === "checkbox-group") {
    return parseJsonArray(value).length > 0;
  }

  return value.trim().length > 0;
}

function areSaqCaptureSectionsComplete(input: {
  sections: CaptureSectionDefinition[];
  sectionInputsById: Map<string, Record<string, string>>;
  answers: NonNullable<Awaited<ReturnType<typeof getLatestCertificationForClient>>>["answers"];
}) {
  for (const section of input.sections) {
    const savedValues = input.sectionInputsById.get(section.id) ?? {};
    const values = Object.fromEntries(
      section.fields.map((field) => [field.key, savedValues[field.key] ?? field.defaultValue ?? ""]),
    );

    for (const field of section.fields) {
      if (field.required === false) {
        continue;
      }
      if (!isRequiredFieldComplete(String(values[field.key] ?? ""), field.inputType)) {
        return false;
      }
    }

    if (section.id === "part-2a-payment-channels" && values.has_excluded_payment_channels === "YES" && !values.excluded_payment_channels_explanation?.trim()) {
      return false;
    }

    if (section.id === "part-2b-cardholder-function") {
      const paymentSection = input.sections.find((item) => item.id === "part-2a-payment-channels");
      const paymentValues = input.sectionInputsById.get("part-2a-payment-channels") ?? {};
      const selectedChannels = parseJsonArray(paymentValues.included_payment_channels);
      const channelLabels =
        paymentSection?.fields
          .find((field) => field.key === "included_payment_channels")
          ?.options?.filter((option) => selectedChannels.includes(option.value))
          .map((option) => option.label) ?? [];
      for (let row = 1; row <= channelLabels.length; row += 1) {
        if (!values[`card_function_${row}_description`]?.trim()) {
          return false;
        }
      }
    }

    if (section.id === "part-2e-validated-products" && values.uses_pci_validated_products === "YES") {
      const hasCompleteProductRow = Array.from({ length: 4 }, (_, index) => index + 1).some((row) =>
        ["name", "version", "standard", "reference", "expiration"].every((column) => values[`validated_product_${row}_${column}`]?.trim()),
      );
      if (!hasCompleteProductRow) {
        return false;
      }
    }

    if (section.id === "part-2f-service-providers") {
      const hasServiceProvider = [
        values.providers_store_process_transmit,
        values.providers_manage_system_components,
        values.providers_affect_cde_security,
      ].includes("YES");
      if (hasServiceProvider && (!values.service_provider_1_name?.trim() || !values.service_provider_1_description?.trim())) {
        return false;
      }
    }

    if (section.id === "part-2h-saq-eligibility") {
      const selected = parseJsonArray(values.eligibility_confirmations);
      const expectedCount = section.fields.find((field) => field.key === "eligibility_confirmations")?.options?.length ?? 0;
      if (selected.length < expectedCount && !values.eligibility_change_notes?.trim()) {
        return false;
      }
    }

    if (section.id === "section-3-validation-certification") {
      const notImplementedAnswers = input.answers.filter((answer) => answer.answerValue === AnswerValue.NOT_IMPLEMENTED);
      if (values.legal_exception_claimed === "YES" && notImplementedAnswers.length === 0) {
        return false;
      }
      if (values.legal_exception_claimed === "YES") {
        const rows = legalExceptionRows(values);
        for (const answer of notImplementedAnswers) {
          const code = answer.requirement.requirementCode;
          const matchingRow = rows.find((row) => row.requirement.includes(code));
          if (!matchingRow?.restriction) {
            return false;
          }
        }
      }
    }

    if (section.id === "section-3a-merchant-recognition" && parseJsonArray(values.merchant_acknowledgements).length < 3) {
      return false;
    }
  }

  return true;
}

function formatCaptureValue(field: CaptureFieldDefinition, value: string) {
  if (!value.trim()) {
    return field.required === false ? "No aplica" : "Pendiente";
  }

  if (field.inputType === "checkbox-group") {
    const labels = parseJsonArray(value)
      .map((item) => field.options?.find((option) => option.value === item)?.label)
      .filter(Boolean);
    return labels.length > 0 ? labels.join(", ") : field.required === false ? "No aplica" : "Pendiente";
  }

  if (field.inputType === "radio-group" || field.inputType === "select") {
    return field.options?.find((option) => option.value === value)?.label ?? value;
  }

  return value;
}

export async function validateGenerationReadiness(certification: NonNullable<Awaited<ReturnType<typeof getLatestCertificationForClient>>>) {
  const mappedRequirements = await getMappedRequirements(certification);
  const answersByRequirement = new Map(certification.answers.map((answer) => [answer.requirementId, answer]));
  const evidenceRequirementIds = new Set(
    certification.documents
      .filter((document) => document.category === "EVIDENCE" && !document.isArchived && document.requirementId)
      .map((document) => document.requirementId!),
  );
  const sectionInputsById = new Map(certification.sectionInputs.map((input) => [input.sectionId, parseJsonRecord(input.payloadJson)]));
  const blockers: string[] = [];

  for (const mapping of mappedRequirements) {
    const answer = answersByRequirement.get(mapping.requirementId);
    const code = mapping.requirement.requirementCode;
    if (!answer) {
      blockers.push(`Falta responder el requisito ${code}.`);
      continue;
    }

    if (answer.answerValue === AnswerValue.NOT_IMPLEMENTED) {
      if (!answer.explanation?.trim()) {
        blockers.push(`Falta explicar las acciones, no conformidad o restriccion legal del requisito ${code}.`);
      }
      if (!answer.resolutionDate) {
        blockers.push(`Falta fecha limite para el requisito No Implementado ${code}.`);
      }
    }

    if (answer.answerValue === AnswerValue.CCW && mapping.requiresCcwJustification && !validateCcwExplanation(answer.explanation)) {
      blockers.push(`Falta completar la ficha CCW del requisito ${code}.`);
    }

    if (answer.answerValue === AnswerValue.NOT_APPLICABLE && mapping.requiresNaJustification && !answer.explanation?.trim()) {
      blockers.push(`Falta justificacion de No Aplicable para el requisito ${code}.`);
    }

    if (answer.answerValue === AnswerValue.NOT_TESTED) {
      if (!mapping.allowNotTested && !certification.saqType.supportsNotTested) {
        blockers.push(`El requisito ${code} no permite No Probado para este SAQ.`);
      }
      if (!answer.explanation?.trim() || !answer.resolutionDate) {
        blockers.push(`Falta explicacion y fecha de resolucion para No Probado en ${code}.`);
      }
    }

    if (mapping.requiresEvidence && !evidenceRequirementIds.has(mapping.requirementId)) {
      blockers.push(`Falta evidencia obligatoria para el requisito ${code}.`);
    }
  }

  for (const section of getSaqCaptureSections(certification.saqType.code)) {
    const savedValues = sectionInputsById.get(section.id) ?? {};
    const values = Object.fromEntries(
      section.fields.map((field) => [field.key, savedValues[field.key] ?? field.defaultValue ?? ""]),
    );
    for (const field of section.fields) {
      if (field.required === false) {
        continue;
      }
      const value = values[field.key] ?? "";
      if (!String(value).trim() || value === "[]") {
        blockers.push(`Falta completar ${section.title}: ${field.label}.`);
      }
    }

    if (section.id === "part-2a-payment-channels" && values.has_excluded_payment_channels === "YES" && !values.excluded_payment_channels_explanation?.trim()) {
      blockers.push("Falta completar Parte 2a: canal(es) no incluidos y motivo de exclusion.");
    }

    if (section.id === "part-2b-cardholder-function") {
      const paymentSection = getSaqCaptureSections(certification.saqType.code).find((item) => item.id === "part-2a-payment-channels");
      const paymentValues = sectionInputsById.get("part-2a-payment-channels") ?? {};
      const selectedChannels = parseJsonArray(paymentValues.included_payment_channels);
      const channelLabels =
        paymentSection?.fields
          .find((field) => field.key === "included_payment_channels")
          ?.options?.filter((option) => selectedChannels.includes(option.value))
          .map((option) => option.label) ?? [];
      for (let row = 1; row <= channelLabels.length; row += 1) {
        if (!values[`card_function_${row}_description`]?.trim()) {
          blockers.push(`Falta completar Parte 2b: descripcion para ${channelLabels[row - 1]}.`);
        }
      }
    }

    if (section.id === "part-2e-validated-products" && values.uses_pci_validated_products === "YES") {
      const hasAtLeastOneProduct = Array.from({ length: 4 }, (_, index) => index + 1).some((row) =>
        ["name", "version", "standard", "reference", "expiration"].some((column) => values[`validated_product_${row}_${column}`]?.trim()),
      );
      if (!hasAtLeastOneProduct) {
        blockers.push("Falta completar Parte 2e: al menos un producto o solucion validado por PCI SSC.");
      }

      for (let row = 1; row <= 4; row += 1) {
        const columns = ["name", "version", "standard", "reference", "expiration"];
        const rowValues = columns.map((column) => values[`validated_product_${row}_${column}`]?.trim() ?? "");
        if (rowValues.some(Boolean) && rowValues.some((value) => !value)) {
          blockers.push(`Falta completar Parte 2e: todos los campos de la fila ${row}.`);
        }
      }
    }

    if (section.id === "part-2f-service-providers") {
      const hasServiceProvider = [
        values.providers_store_process_transmit,
        values.providers_manage_system_components,
        values.providers_affect_cde_security,
      ].includes("YES");
      if (hasServiceProvider && (!values.service_provider_1_name?.trim() || !values.service_provider_1_description?.trim())) {
        blockers.push("Falta completar Parte 2f: nombre del proveedor de servicio y descripcion del servicio prestado.");
      }

      for (let row = 1; row <= 10; row += 1) {
        const name = values[`service_provider_${row}_name`]?.trim() ?? "";
        const description = values[`service_provider_${row}_description`]?.trim() ?? "";
        if ((name || description) && (!name || !description)) {
          blockers.push(`Falta completar Parte 2f: nombre y descripcion de la fila ${row}.`);
        }
      }
    }

    if (section.id === "part-2h-saq-eligibility") {
      const selected = parseJsonArray(values.eligibility_confirmations);
      const expectedCount = section.fields.find((field) => field.key === "eligibility_confirmations")?.options?.length ?? 0;
      if (selected.length < expectedCount && !values.eligibility_change_notes?.trim()) {
        blockers.push("Falta explicar por que no se cumplen todos los criterios de elegibilidad del SAQ asignado.");
      }
    }

    if (section.id === "section-3-validation-certification") {
      const hasNotImplemented = certification.answers.some((answer) => answer.answerValue === AnswerValue.NOT_IMPLEMENTED);
      if (values.legal_exception_claimed === "YES" && !hasNotImplemented) {
        blockers.push("La excepcion legal solo puede marcarse cuando existe al menos un requisito No Implementado.");
      }
      if (values.legal_exception_claimed === "YES") {
        const rows = legalExceptionRows(values);
        const notImplementedAnswers = certification.answers.filter((answer) => answer.answerValue === AnswerValue.NOT_IMPLEMENTED);
        for (const answer of notImplementedAnswers) {
          const code = answer.requirement.requirementCode;
          const matchingRow = rows.find((row) => row.requirement.includes(code));
          if (!matchingRow?.restriction) {
            blockers.push(`Falta completar la restriccion legal para el requisito ${code} en la Seccion 3.`);
          }
        }
      }
    }

    if (section.id === "section-3a-merchant-recognition") {
      const selected = parseJsonArray(values.merchant_acknowledgements);
      if (selected.length < 3) {
        blockers.push("Falta marcar las tres casillas de Reconocimiento del comerciante.");
      }
    }
  }

  if (!certification.signature) {
    blockers.push("Falta registrar la firma del cliente.");
  }

  if (certification.paymentStatus?.state !== PaymentState.PAID) {
    blockers.push("El pago debe estar marcado como Pagado para generar documentos finales.");
  }

  return {
    ready: blockers.length === 0,
    blockers,
    blockerCounts: {
      unanswered: blockers.filter((blocker) => blocker.includes("Falta responder")).length,
      annex: blockers.filter((blocker) => blocker.includes("CCW") || blocker.includes("No Aplicable") || blocker.includes("No Probado")).length,
      evidence: blockers.filter((blocker) => blocker.includes("evidencia")).length,
      signature: blockers.filter((blocker) => blocker.includes("firma")).length,
      payment: blockers.filter((blocker) => blocker.includes("pago")).length,
    },
    totalRequirements: mappedRequirements.length,
    answeredCount: mappedRequirements.filter((mapping) => answersByRequirement.has(mapping.requirementId)).length,
    requiredEvidenceCount: mappedRequirements.filter((mapping) => mapping.requiresEvidence).length,
    uploadedRequiredEvidenceCount: mappedRequirements.filter((mapping) => mapping.requiresEvidence && evidenceRequirementIds.has(mapping.requirementId)).length,
  };
}

async function syncReadinessStatus(certification: NonNullable<Awaited<ReturnType<typeof getLatestCertificationForClient>>>, ready: boolean) {
  if (certification.isLocked || certification.status === CertificationStatus.GENERATED || certification.status === CertificationStatus.FINALIZED) {
    return certification.status;
  }

  const nextStatus = ready ? CertificationStatus.READY_TO_GENERATE : CertificationStatus.IN_PROGRESS;
  if (certification.status !== nextStatus) {
    await prisma.certification.update({
      where: { id: certification.id },
      data: { status: nextStatus },
    });
  }
  return nextStatus;
}

function mapDocument(document: {
  id: string;
  title: string;
  fileName: string;
  category: string;
  sourceTemplateKey: string | null;
  mimeType: string;
  fileSizeBytes: number;
  notes: string | null;
  createdAt: Date;
  requirementId?: string | null;
  topicCode?: string | null;
  generatedType?: string | null;
  generatedAt?: Date | null;
  version?: number;
  isArchived?: boolean;
  parentDocumentId?: string | null;
}) {
  return {
    id: document.id,
    title: document.title,
    fileName: document.fileName,
    category: document.category,
    sourceTemplateKey: document.sourceTemplateKey,
    mimeType: document.mimeType,
    fileSizeBytes: document.fileSizeBytes,
    notes: document.notes ?? "",
    createdAt: document.createdAt,
    requirementId: document.requirementId ?? null,
    topicCode: document.topicCode ?? null,
    generatedType: document.generatedType ?? null,
    generatedAt: document.generatedAt ?? null,
    version: document.version ?? 1,
    isArchived: document.isArchived ?? false,
    parentDocumentId: document.parentDocumentId ?? null,
  };
}

async function storeDocumentFile(input: {
  clientId: string;
  certificationId: string;
  sourceFileName: string;
  base64: string;
  category: string;
  topicCode?: string | null;
  requirementCode?: string | null;
}) {
  const sourceFileName = sanitizeFileName(input.sourceFileName);
  const extension = path.extname(sourceFileName).toLowerCase();
  if (!allowedDocumentExtensions.has(extension)) {
    throw new Error("Unsupported file type.");
  }

  const base64Payload = input.base64.includes(",") ? input.base64.split(",").pop() ?? "" : input.base64;
  const buffer = Buffer.from(base64Payload, "base64");
  if (!buffer.byteLength) {
    throw new Error("File content is empty.");
  }

  if (buffer.byteLength > maxDocumentSizeBytes) {
    throw new Error("The file exceeds the 25 MB limit.");
  }

  const relativeDirectory =
    input.category === "EVIDENCE" && input.topicCode && input.requirementCode
      ? path.join(
          "client-documents",
          input.clientId,
          input.certificationId,
          "evidence",
          `topic-${input.topicCode}`,
          `requirement-${input.requirementCode}`,
        )
      : input.category === "SCAN"
        ? path.join("client-documents", input.clientId, input.certificationId, "scans")
        : path.join("client-documents", input.clientId, input.certificationId, input.category.toLowerCase());
  const absoluteDirectory = path.join(config.uploadsDir, relativeDirectory);
  await fs.mkdir(absoluteDirectory, { recursive: true });

  const storageFileName = `${Date.now()}-${sourceFileName}`;
  await fs.writeFile(path.join(absoluteDirectory, storageFileName), buffer);

  return {
    fileName: sourceFileName,
    storagePath: path.join(relativeDirectory, storageFileName),
    fileSizeBytes: buffer.byteLength,
  };
}

async function storeGeneratedPdf(input: {
  clientId: string;
  certificationId: string;
  title: string;
  fileName: string;
  generatedType: string;
  buffer: Buffer;
  userId: string;
}) {
  const buffer = input.buffer;
  const relativeDirectory = path.join("client-documents", input.clientId, input.certificationId, "generated");
  const absoluteDirectory = path.join(config.uploadsDir, relativeDirectory);
  await fs.mkdir(absoluteDirectory, { recursive: true });

  const safeFileName = sanitizeFileName(input.fileName);
  const storageFileName = `${Date.now()}-${safeFileName}`;
  await fs.writeFile(path.join(absoluteDirectory, storageFileName), buffer);

  return prisma.clientDocument.create({
    data: {
      clientId: input.clientId,
      certificationId: input.certificationId,
      uploadedByUserId: input.userId,
      category: "GENERATED_OUTPUT",
      generatedType: input.generatedType,
      generatedAt: new Date(),
      title: input.title,
      fileName: safeFileName,
      mimeType: "application/pdf",
      storagePath: path.join(relativeDirectory, storageFileName),
      fileSizeBytes: buffer.byteLength,
    },
  });
}

router.get("/dashboard", requireAuth, requireRole([UserRoleCode.CLIENT]), async (req: AuthenticatedRequest, res) => {
  const clientId = req.auth?.clientId;
  if (!clientId) {
    return res.status(400).json({ message: "Client context missing." });
  }

  const certification = await getLatestCertificationForClient(clientId);
  if (!certification) {
    return res.status(404).json({ message: "Active certification not found." });
  }

  const mappedRequirements = await getMappedRequirements(certification);
  const validation = await validateGenerationReadiness(certification);
  const effectiveStatus = await syncReadinessStatus(certification, validation.ready);
  const totalRequirements = mappedRequirements.length;
  const answeredCount = validation.answeredCount;
  const unansweredCount = totalRequirements - answeredCount;
  const evidenceDocs = certification.documents.filter((document) => document.category === "EVIDENCE" && !document.isArchived);
  const generatedDocs = certification.documents.filter((document) => document.category === "GENERATED_OUTPUT" && !document.isArchived);

  const topicProgress = mappedRequirements.reduce<Record<string, { topicCode: string; topicName: string; total: number; answered: number }>>((acc, item) => {
    const topicCode = item.requirement.topic.code;
    if (!acc[topicCode]) {
      acc[topicCode] = { topicCode, topicName: item.requirement.topic.name, total: 0, answered: 0 };
    }
    acc[topicCode].total += 1;
    if (certification.answers.some((answer) => answer.requirementId === item.requirementId)) {
      acc[topicCode].answered += 1;
    }
    return acc;
  }, {});

  res.json({
    client: {
      id: certification.client.id,
      companyName: certification.client.companyName,
      businessType: certification.client.businessType,
    },
    certification: {
      id: certification.id,
      cycleYear: certification.cycleYear,
      status: effectiveStatus,
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
      pendingEvidenceCount: Math.max(validation.requiredEvidenceCount - validation.uploadedRequiredEvidenceCount, 0),
      requiredEvidenceCount: validation.requiredEvidenceCount,
      uploadedEvidenceCount: evidenceDocs.length,
      generatedDocumentCount: generatedDocs.length,
    },
    generation: {
      ready: validation.ready,
      blockers: validation.blockers,
      blockerCounts: validation.blockerCounts,
    },
    topics: Object.values(topicProgress).map((topic) => ({
      ...topic,
      percentage: topic.total > 0 ? Math.round((topic.answered / topic.total) * 100) : 0,
    })),
    messages: certification.dashboardMessages,
  });
});

router.get("/documents", requireAuth, requireRole([UserRoleCode.CLIENT, UserRoleCode.EXECUTIVE, UserRoleCode.ADMIN]), async (req: AuthenticatedRequest, res) => {
  const requestedClientId = typeof req.query.clientId === "string" ? req.query.clientId : undefined;
  const requestedCertificationId = typeof req.query.certificationId === "string" ? req.query.certificationId : undefined;
  const clientId = req.auth?.role === UserRoleCode.CLIENT ? req.auth.clientId : requestedClientId;
  if (!clientId && req.auth?.role === UserRoleCode.CLIENT) {
    return res.status(400).json({ message: "Client context missing." });
  }

  if (clientId && !(await canAccessClient(req, clientId))) {
    return res.status(403).json({ message: "Forbidden." });
  }

  if (requestedCertificationId) {
    const certification = await canAccessCertification(req, requestedCertificationId);
    if (!certification) {
      return res.status(403).json({ message: "Forbidden." });
    }
  }

  const certification = clientId ? await getLatestCertificationForClient(clientId) : null;
  const documents = await prisma.clientDocument.findMany({
    where: {
      isArchived: false,
      ...(clientId ? { clientId } : {}),
      ...(requestedCertificationId ? { certificationId: requestedCertificationId } : clientId ? { certificationId: certification?.id } : {}),
      ...(req.auth?.role === UserRoleCode.EXECUTIVE && !clientId
        ? {
            client: {
              executiveAssignments: {
                some: {
                  executiveUserId: req.auth.userId,
                  isActive: true,
                },
              },
            },
          }
        : {}),
    },
    orderBy: { createdAt: "desc" },
  });

  res.json({
    certificationId: certification?.id ?? null,
    items: documents.map(mapDocument),
  });
});

router.post("/documents", requireAuth, requireRole([UserRoleCode.CLIENT]), async (req: AuthenticatedRequest, res) => {
  const schema = z.object({
    title: z.string().min(1),
    fileName: z.string().min(1),
    mimeType: z.string().min(1),
    fileBase64: z.string().min(1),
    category: z.enum(["EDITED_TEMPLATE", "EVIDENCE"]).optional(),
    requirementId: z.string().optional(),
    topicCode: z.string().optional(),
    sourceTemplateKey: z.string().optional(),
    notes: z.string().optional(),
  });
  const parsed = schema.safeParse(req.body);
  const clientId = req.auth?.clientId;

  if (!parsed.success || !clientId) {
    return res.status(400).json({ message: "Invalid document payload." });
  }

  const certification = await getLatestCertificationForClient(clientId);
  if (!certification || certification.isLocked) {
    return res.status(400).json({ message: "Certification is not editable." });
  }

  const category = parsed.data.category ?? "EDITED_TEMPLATE";
  const mappedRequirements = await getMappedRequirements(certification);
  const requirementMap = parsed.data.requirementId
    ? mappedRequirements.find((mapping) => mapping.requirementId === parsed.data.requirementId)
    : null;

  if (category === "EVIDENCE" && !requirementMap) {
    return res.status(400).json({ message: "Evidence must be linked to a requirement in the assigned SAQ." });
  }

  let storedFile;
  try {
    storedFile = await storeDocumentFile({
      clientId,
      certificationId: certification.id,
      sourceFileName: parsed.data.fileName,
      base64: parsed.data.fileBase64,
      category,
      topicCode: requirementMap?.requirement.topic.code,
      requirementCode: requirementMap?.requirement.requirementCode,
    });
  } catch (error) {
    return res.status(400).json({ message: error instanceof Error ? error.message : "Invalid file." });
  }

  const previousEvidence =
    category === "EVIDENCE" && requirementMap
      ? await prisma.clientDocument.findFirst({
          where: {
            clientId,
            certificationId: certification.id,
            requirementId: requirementMap.requirementId,
            category: "EVIDENCE",
            isArchived: false,
          },
          orderBy: { version: "desc" },
        })
      : null;

  if (previousEvidence) {
    await prisma.clientDocument.update({
      where: { id: previousEvidence.id },
      data: {
        isArchived: true,
        archivedAt: new Date(),
        archivedByUserId: req.auth!.userId,
      },
    });
  }

  const document = await prisma.clientDocument.create({
    data: {
      clientId,
      certificationId: certification.id,
      requirementId: requirementMap?.requirementId,
      topicCode: requirementMap?.requirement.topic.code ?? parsed.data.topicCode,
      uploadedByUserId: req.auth!.userId,
      parentDocumentId: previousEvidence?.parentDocumentId ?? previousEvidence?.id,
      version: previousEvidence ? previousEvidence.version + 1 : 1,
      category,
      sourceTemplateKey: category === "EDITED_TEMPLATE" ? parsed.data.sourceTemplateKey : undefined,
      title: parsed.data.title.trim(),
      fileName: storedFile.fileName,
      mimeType: parsed.data.mimeType,
      storagePath: storedFile.storagePath,
      fileSizeBytes: storedFile.fileSizeBytes,
      notes: parsed.data.notes?.trim() || undefined,
    },
  });

  await writeAuditLog({
    userId: req.auth?.userId,
    roleCode: req.auth?.role,
    actionType: category === "EVIDENCE" ? "EVIDENCE_UPLOADED" : "CLIENT_DOCUMENT_UPLOADED",
    targetTable: "ClientDocument",
    targetId: document.id,
    clientId,
    certificationId: certification.id,
    ipAddress: req.ip,
    userAgent: getUserAgentHeader(req.headers["user-agent"]),
    metadata: {
      category,
      requirementId: document.requirementId,
      topicCode: document.topicCode,
      fileName: storedFile.fileName,
      sizeBytes: storedFile.fileSizeBytes,
    },
  });

  res.status(201).json(mapDocument(document));
});

router.get("/documents/:documentId/download", requireAuth, requireRole([UserRoleCode.CLIENT, UserRoleCode.EXECUTIVE, UserRoleCode.ADMIN]), async (req: AuthenticatedRequest, res) => {
  const documentId = Array.isArray(req.params.documentId) ? req.params.documentId[0] : req.params.documentId;
  if (!documentId) {
    return res.status(400).json({ message: "Invalid document request." });
  }

  const document = await prisma.clientDocument.findFirst({
    where: {
      id: documentId,
      isArchived: false,
    },
  });

  if (!document) {
    return res.status(404).json({ message: "Document not found." });
  }

  if (!(await canAccessClient(req, document.clientId))) {
    return res.status(403).json({ message: "Forbidden." });
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
    actionType: document.category === "EVIDENCE" ? "EVIDENCE_DOWNLOADED" : "CLIENT_DOCUMENT_DOWNLOADED",
    targetTable: "ClientDocument",
    targetId: document.id,
    clientId: document.clientId,
    certificationId: document.certificationId ?? undefined,
    ipAddress: req.ip,
    userAgent: getUserAgentHeader(req.headers["user-agent"]),
  });

  res.download(absoluteFilePath, document.fileName);
});

router.get("/generation/status", requireAuth, requireRole([UserRoleCode.CLIENT]), async (req: AuthenticatedRequest, res) => {
  const clientId = req.auth?.clientId;
  if (!clientId) {
    return res.status(400).json({ message: "Client context missing." });
  }

  const certification = await getLatestCertificationForClient(clientId);
  if (!certification) {
    return res.status(404).json({ message: "Certification not found." });
  }

  const validation = await validateGenerationReadiness(certification);
  await syncReadinessStatus(certification, validation.ready);
  res.json(validation);
});

router.post("/generation/generate", requireAuth, requireRole([UserRoleCode.CLIENT]), async (req: AuthenticatedRequest, res) => {
  const clientId = req.auth?.clientId;
  if (!clientId) {
    return res.status(400).json({ message: "Client context missing." });
  }

  const certification = await getLatestCertificationForClient(clientId);
  if (!certification) {
    return res.status(404).json({ message: "Certification not found." });
  }

  if (certification.isLocked) {
    return res.status(400).json({ message: "Certification is already locked." });
  }

  const validation = await validateGenerationReadiness(certification);
  if (!validation.ready) {
    return res.status(400).json({ message: "Generation is blocked.", blockers: validation.blockers });
  }

  const issuedAt = new Date();
  const validUntil = new Date(issuedAt);
  validUntil.setFullYear(validUntil.getFullYear() + 1);

  const mappedRequirements = await getMappedRequirements(certification);
  const answersByRequirement = new Map(certification.answers.map((answer) => [answer.requirementId, answer]));
  const sectionInputsById = new Map(certification.sectionInputs.map((input) => [input.sectionId, parseJsonRecord(input.payloadJson)]));
  const section3Values = sectionInputsById.get("section-3-validation-certification") ?? {};
  const legalRows = legalExceptionRows(section3Values);
  const notImplementedAnswers = certification.answers.filter((answer) => answer.answerValue === AnswerValue.NOT_IMPLEMENTED);
  const hasLegalException = notImplementedAnswers.length > 0 && section3Values.legal_exception_claimed === "YES";
  const captureDefinitions = getSaqCaptureSections(certification.saqType.code);
  const allSaqSectionsComplete = areSaqCaptureSectionsComplete({
    sections: captureDefinitions,
    sectionInputsById,
    answers: certification.answers,
  });
  const validationStatus = calculateSaqValidationStatus({
    mappedRequirementIds: mappedRequirements.map((mapping) => mapping.requirementId),
    answers: certification.answers,
    hasLegalException,
    allSaqSectionsComplete,
  });
  const validationStatusLabel = getSaqValidationStatusLabel(validationStatus);
  const validationStatusText = getSaqValidationStatusText(validationStatus);
  const latestNotImplementedDate = notImplementedAnswers
    .filter((answer) => answer.resolutionDate)
    .map((answer) => answer.resolutionDate!.getTime())
    .sort((a, b) => b - a)[0];
  const topicSummary = mappedRequirements.reduce<Record<string, { implemented: number; ccw: number; na: number; notTested: number; notImplemented: number }>>(
    (acc, mapping) => {
      const topicCode = mapping.requirement.topic.code;
      acc[topicCode] ??= { implemented: 0, ccw: 0, na: 0, notTested: 0, notImplemented: 0 };
      const answer = answersByRequirement.get(mapping.requirementId)?.answerValue;
      if (answer === AnswerValue.IMPLEMENTED) acc[topicCode].implemented += 1;
      if (answer === AnswerValue.CCW) acc[topicCode].ccw += 1;
      if (answer === AnswerValue.NOT_APPLICABLE) acc[topicCode].na += 1;
      if (answer === AnswerValue.NOT_TESTED) acc[topicCode].notTested += 1;
      if (answer === AnswerValue.NOT_IMPLEMENTED) acc[topicCode].notImplemented += 1;
      return acc;
    },
    {},
  );
  const systemSections = [
    {
      title: "Seccion 1 / Parte 1a. Informacion de la evaluacion y comerciante evaluado",
      values: {
        "Nombre legal del comerciante": certification.client.companyName,
        "Nombre comercial de la compania (DBA)": certification.client.dbaName ?? certification.client.companyName,
        "Tipo de negocio": certification.client.businessType,
        "Nombre del contacto de la compania": requiredValue(certification.client.primaryContactName, certification.client.adminContactName),
        "Titulo del contacto de la compania": optionalValue(certification.client.primaryContactTitle),
        "Numero de telefono del contacto": requiredValue(certification.client.primaryContactPhone, certification.client.adminContactPhone),
        "Direccion de correo electronico del contacto": requiredValue(certification.client.primaryContactEmail, certification.client.adminContactEmail),
        "Direccion postal": optionalValue(certification.client.postalAddress),
        "SAQ asignado": certification.saqType.name,
        Ciclo: String(certification.cycleYear),
      },
    },
    {
      title: "Parte 2g. Resumen automatico de la evaluacion",
      values: Object.fromEntries(
        Object.entries(topicSummary).map(([topicCode, counts]) => [
          `Requisito ${topicCode}`,
          `Implementado: ${counts.implemented}; CCW: ${counts.ccw}; No Aplicable: ${counts.na}; No Probado: ${counts.notTested}; No Implementado: ${counts.notImplemented}`,
        ]),
      ),
    },
    {
      title: "Seccion 3. Validacion PCI DSS",
      values: {
        "Nombre del comerciante": certification.client.companyName,
        "Estado calculado": validationStatusLabel,
        "Texto explicativo": validationStatusText,
        "Fecha limite para estar en conformidad": latestNotImplementedDate ? formatDate(new Date(latestNotImplementedDate)) : "No aplica",
      },
    },
    ...(hasLegalException
      ? [
          {
            title: "Seccion 3. Tabla de excepcion legal",
            values: Object.fromEntries(
              legalRows.map((row) => [row.requirement || "Requisito No Implementado", row.restriction || "Pendiente"]),
            ),
          },
        ]
      : []),
    {
      title: "Parte 4. Plan de accion para estado de No Conformidad",
      values: {
        "Aplica Parte 4": validationStatus === "NON_CONFORMING" ? "Si" : "No",
        "Requisitos No Implementado": String(notImplementedAnswers.length),
        "Detalle": notImplementedAnswers.length
          ? notImplementedAnswers
              .map((answer) => `${answer.requirement.requirementCode}: ${answer.explanation || "Pendiente"}; fecha compromiso ${formatDate(answer.resolutionDate)}`)
              .join(" | ")
          : validationStatus === "NON_CONFORMING"
            ? "No hay requisitos No Implementado capturados; revise las secciones pendientes del SAQ."
            : "No aplica",
      },
    },
    {
      title: "Seccion 3a. Reconocimiento del comerciante",
      values: {
        "Nombre tomado del sistema": certification.client.primaryContactName ?? certification.client.companyName,
        Firma: certification.signature ? "Registrada" : "Pendiente",
        Fecha: formatDate(issuedAt),
        Confirmaciones: sectionInputsById.get("section-3a-merchant-recognition")?.merchant_acknowledgements ?? "Pendiente",
      },
    },
  ];
  const paymentChannelField = captureDefinitions
    .find((section) => section.id === "part-2a-payment-channels")
    ?.fields.find((field) => field.key === "included_payment_channels");
  const selectedPaymentChannels = parseJsonArray(sectionInputsById.get("part-2a-payment-channels")?.included_payment_channels);
  const selectedPaymentChannelLabels =
    paymentChannelField?.options?.filter((option) => selectedPaymentChannels.includes(option.value)).map((option) => option.label) ?? [];
  const captureSections = captureDefinitions.map((section) => ({
    title: section.title,
    values: section.fields.reduce<Record<string, string>>((acc, field) => {
      const channelMatch = section.id === "part-2b-cardholder-function" ? field.key.match(/^card_function_(\d+)_channel$/) : null;
      const channelLabel = channelMatch ? selectedPaymentChannelLabels[Number(channelMatch[1]) - 1] : undefined;
      const value = sectionInputsById.get(section.id)?.[field.key] || channelLabel || "";
      if ((field.required ?? true) || value.trim()) {
        acc[field.label] = formatCaptureValue(field, value);
      }
      return acc;
    }, {}),
  }));
  const requirementOutputs = mappedRequirements.map((mapping) => {
    const answer = answersByRequirement.get(mapping.requirementId);
    return {
      code: mapping.requirement.requirementCode,
      description: mapping.requirement.description,
      testingProcedures: mapping.requirement.testingProcedures,
      answerValue: answer?.answerValue ?? null,
      explanation: answer?.explanation ?? null,
      resolutionDate: answer?.resolutionDate ?? null,
    };
  });
  const ccwAnswers = certification.answers.filter((answer) => answer.answerValue === AnswerValue.CCW);
  const naAnswers = certification.answers.filter((answer) => answer.answerValue === AnswerValue.NOT_APPLICABLE);
  const notTestedAnswers = certification.answers.filter((answer) => answer.answerValue === AnswerValue.NOT_TESTED);
  const annexes = [
    {
      title: "Anexo B. Fichas de control compensatorio",
      entries: ccwAnswers.map((answer) => {
        const data = parseJsonRecord(answer.explanation ?? "");
        return {
          title: `${answer.requirement.requirementCode} - ${answer.requirement.title}`,
          lines: [
            `Restricciones: ${data.restrictions || "Pendiente"}`,
            `Definicion: ${data.definition || "Pendiente"}`,
            `Objetivo: ${data.objective || "Pendiente"}`,
            `Riesgo: ${data.risk || "Pendiente"}`,
            `Validacion: ${data.validation || "Pendiente"}`,
            `Mantenimiento: ${data.maintenance || "Pendiente"}`,
          ],
        };
      }),
    },
    {
      title: "Anexo C. Requisitos no aplicables",
      entries: naAnswers.map((answer) => ({
        title: `${answer.requirement.requirementCode} - ${answer.requirement.title}`,
        lines: [`Justificacion: ${answer.explanation || "Pendiente"}`],
      })),
    },
    {
      title: "Anexo D. Requisitos no probados",
      entries: notTestedAnswers.map((answer) => ({
        title: `${answer.requirement.requirementCode} - ${answer.requirement.title}`,
        lines: [`Explicacion: ${answer.explanation || "Pendiente"}`, `Fecha de resolucion: ${formatDate(answer.resolutionDate)}`],
      })),
    },
  ];

  const [saqBuffer, diplomaBuffer, aocBuffer] = await Promise.all([
    generateSaqPdf({
      companyName: certification.client.companyName,
      businessType: certification.client.businessType,
      saqTypeName: certification.saqType.name,
      cycleYear: certification.cycleYear,
      generatedAt: issuedAt,
      issueDate: issuedAt,
      validUntil,
      paymentState: certification.paymentStatus?.state,
      signaturePresent: Boolean(certification.signature),
      systemSections,
      captureSections,
      requirements: requirementOutputs,
      annexes,
    }),
    generateDiplomaPdf({
      companyName: certification.client.companyName,
      saqTypeName: certification.saqType.name,
      cycleYear: certification.cycleYear,
      issueDate: issuedAt,
      validUntil,
      status: CertificationStatus.FINALIZED,
    }),
    generateAocStubPdf({
      companyName: certification.client.companyName,
      saqTypeName: certification.saqType.name,
      cycleYear: certification.cycleYear,
      issueDate: issuedAt,
      validUntil,
    }),
  ]);

  const [saqDocument, diplomaDocument, aocDocument] = await Promise.all([
    storeGeneratedPdf({
      clientId,
      certificationId: certification.id,
      userId: req.auth!.userId,
      generatedType: "SAQ",
      title: "SAQ generado",
      fileName: `SAQ-${certification.client.companyName}-${certification.cycleYear}.pdf`,
      buffer: saqBuffer,
    }),
    storeGeneratedPdf({
      clientId,
      certificationId: certification.id,
      userId: req.auth!.userId,
      generatedType: "DIPLOMA",
      title: "Diploma de certificacion",
      fileName: `Diploma-${certification.client.companyName}-${certification.cycleYear}.pdf`,
      buffer: diplomaBuffer,
    }),
    storeGeneratedPdf({
      clientId,
      certificationId: certification.id,
      userId: req.auth!.userId,
      generatedType: "AOC",
      title: "AOC generado",
      fileName: `AOC-${certification.client.companyName}-${certification.cycleYear}.pdf`,
      buffer: aocBuffer,
    }),
  ]);

  await prisma.certification.update({
    where: { id: certification.id },
    data: {
      status: CertificationStatus.FINALIZED,
      isLocked: true,
      finalizedAt: issuedAt,
      issuedAt,
      validUntil,
    },
  });

  await prisma.client.update({
    where: { id: clientId },
    data: { status: "FINALIZED" },
  });

  await writeAuditLog({
    userId: req.auth!.userId,
    roleCode: req.auth!.role,
    actionType: "CERTIFICATION_DOCUMENTS_GENERATED",
    targetTable: "Certification",
    targetId: certification.id,
    clientId,
    certificationId: certification.id,
    ipAddress: req.ip,
    userAgent: getUserAgentHeader(req.headers["user-agent"]),
    metadata: {
      documents: [saqDocument.id, diplomaDocument.id, aocDocument.id],
    },
  });

  res.status(201).json({
    success: true,
    documents: [saqDocument, diplomaDocument, aocDocument].map(mapDocument),
  });
});

router.post("/renewals", requireAuth, requireRole([UserRoleCode.CLIENT]), async (req: AuthenticatedRequest, res) => {
  const schema = z.object({
    scopeChanged: z.boolean(),
    cardHandlingChanged: z.boolean(),
    notes: z.string().optional(),
  });
  const parsed = schema.safeParse(req.body);
  const clientId = req.auth?.clientId;
  if (!parsed.success || !clientId) {
    return res.status(400).json({ message: "Invalid renewal request." });
  }

  const previous = await getLatestCertificationForClient(clientId);
  if (!previous || (previous.status !== CertificationStatus.GENERATED && previous.status !== CertificationStatus.FINALIZED)) {
    return res.status(400).json({ message: "Renewal requires a generated or finalized certification." });
  }

  const shouldPreload = !parsed.data.scopeChanged && !parsed.data.cardHandlingChanged;
  const nextCertification = await prisma.certification.create({
    data: {
      clientId,
      saqTypeId: previous.saqTypeId,
      cycleYear: previous.cycleYear + 1,
      status: CertificationStatus.IN_PROGRESS,
      startedAt: new Date(),
      preloadedFromCertificationId: shouldPreload ? previous.id : undefined,
      templateVersionSnapshot: previous.templateVersionSnapshot,
      mappingVersionSnapshot: previous.mappingVersionSnapshot,
      lastViewedTopicCode: previous.lastViewedTopicCode,
    },
  });

  if (shouldPreload) {
    await prisma.certificationAnswer.createMany({
      data: previous.answers.map((answer) => ({
        certificationId: nextCertification.id,
        requirementId: answer.requirementId,
        answerValue: answer.answerValue,
        explanation: answer.explanation,
        resolutionDate: answer.resolutionDate,
        isPreloaded: true,
        preloadedFromAnswerId: answer.id,
      })),
    });
  }

  await prisma.paymentStatus.create({
    data: {
      clientId,
      certificationId: nextCertification.id,
      state: PaymentState.UNPAID,
      notes: parsed.data.notes?.trim() || (shouldPreload ? "Renovacion con respuestas precargadas." : "Renovacion con cambio de alcance o manejo de tarjetas."),
    },
  });

  await prisma.dashboardMessage.create({
    data: {
      clientId,
      certificationId: nextCertification.id,
      title: shouldPreload ? "Renovacion iniciada con precarga" : "Renovacion iniciada sin precarga",
      message: shouldPreload
        ? "Tus respuestas anteriores fueron precargadas porque indicaste que no cambio el alcance ni el manejo de tarjetas."
        : "Se inicio un ciclo limpio porque indicaste cambios en alcance o manejo de tarjetas.",
      messageType: shouldPreload ? "INFO" : "WARNING",
    },
  });

  await writeAuditLog({
    userId: req.auth!.userId,
    roleCode: req.auth!.role,
    actionType: "CERTIFICATION_RENEWAL_STARTED",
    targetTable: "Certification",
    targetId: nextCertification.id,
    clientId,
    certificationId: nextCertification.id,
    ipAddress: req.ip,
    userAgent: getUserAgentHeader(req.headers["user-agent"]),
    metadata: parsed.data,
  });

  res.status(201).json({ success: true, certificationId: nextCertification.id, preloaded: shouldPreload });
});

router.patch("/payment-state", requireAuth, requireRole([UserRoleCode.EXECUTIVE, UserRoleCode.ADMIN]), async (req: AuthenticatedRequest, res) => {
  const schema = z.object({
    certificationId: z.string().min(1),
    state: z.nativeEnum(PaymentState),
    notes: z.string().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "Invalid payment payload." });
  }

  const certification = await prisma.certification.findUnique({ where: { id: parsed.data.certificationId } });
  if (!certification) {
    return res.status(404).json({ message: "Certification not found." });
  }
  if (!(await canAccessClient(req, certification.clientId))) {
    return res.status(403).json({ message: "Forbidden." });
  }

  const payment = await prisma.paymentStatus.upsert({
    where: { certificationId: certification.id },
    update: {
      state: parsed.data.state,
      notes: parsed.data.notes?.trim(),
      updatedByUserId: req.auth!.userId,
      updatedAt: new Date(),
    },
    create: {
      clientId: certification.clientId,
      certificationId: certification.id,
      state: parsed.data.state,
      notes: parsed.data.notes?.trim(),
      updatedByUserId: req.auth!.userId,
    },
  });

  await writeAuditLog({
    userId: req.auth?.userId,
    roleCode: req.auth?.role,
    actionType: "PAYMENT_STATE_UPDATED",
    targetTable: "PaymentStatus",
    targetId: payment.id,
    clientId: certification.clientId,
    certificationId: certification.id,
    ipAddress: req.ip,
    userAgent: getUserAgentHeader(req.headers["user-agent"]),
    metadata: { state: parsed.data.state },
  });

  res.json({ success: true, payment });
});

router.get("/certifications", requireAuth, requireRole([UserRoleCode.EXECUTIVE, UserRoleCode.ADMIN]), async (req: AuthenticatedRequest, res) => {
  const certifications = await prisma.certification.findMany({
    where: {
      status: { not: CertificationStatus.ARCHIVED },
      ...(req.auth?.role === UserRoleCode.EXECUTIVE
        ? {
            client: {
              executiveAssignments: {
                some: {
                  executiveUserId: req.auth.userId,
                  isActive: true,
                },
              },
            },
          }
        : {}),
    },
    include: {
      client: true,
      saqType: true,
      paymentStatus: true,
      documents: true,
      answers: true,
    },
    orderBy: [{ cycleYear: "desc" }, { createdAt: "desc" }],
  });

  res.json({
    items: certifications.map((certification) => ({
      id: certification.id,
      clientId: certification.clientId,
      companyName: certification.client.companyName,
      saqType: certification.saqType.name,
      cycleYear: certification.cycleYear,
      status: certification.status,
      paymentState: certification.paymentStatus?.state ?? PaymentState.UNPAID,
      generatedDocumentCount: certification.documents.filter((document) => document.category === "GENERATED_OUTPUT").length,
      evidenceCount: certification.documents.filter((document) => document.category === "EVIDENCE").length,
      answeredCount: certification.answers.length,
      issuedAt: certification.issuedAt,
      validUntil: certification.validUntil,
    })),
  });
});

router.post("/reminders", requireAuth, requireRole([UserRoleCode.EXECUTIVE, UserRoleCode.ADMIN]), async (req: AuthenticatedRequest, res) => {
  const schema = z.object({
    certificationId: z.string().min(1),
    title: z.string().min(1),
    message: z.string().min(1),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "Invalid reminder payload." });
  }

  const certification = await prisma.certification.findUnique({ where: { id: parsed.data.certificationId } });
  if (!certification) {
    return res.status(404).json({ message: "Certification not found." });
  }
  if (!(await canAccessClient(req, certification.clientId))) {
    return res.status(403).json({ message: "Forbidden." });
  }

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const duplicate = await prisma.dashboardMessage.findFirst({
    where: {
      certificationId: certification.id,
      title: parsed.data.title.trim(),
      message: parsed.data.message.trim(),
      createdAt: { gte: since },
    },
  });

  if (duplicate) {
    return res.json({ success: true, skipped: true, message: "Duplicate reminder prevented." });
  }

  const reminder = await prisma.dashboardMessage.create({
    data: {
      clientId: certification.clientId,
      certificationId: certification.id,
      title: parsed.data.title.trim(),
      message: parsed.data.message.trim(),
      messageType: "WARNING",
    },
  });

  await writeAuditLog({
    userId: req.auth?.userId,
    roleCode: req.auth?.role,
    actionType: "BUSINESS_REMINDER_SENT",
    targetTable: "DashboardMessage",
    targetId: reminder.id,
    clientId: certification.clientId,
    certificationId: certification.id,
    ipAddress: req.ip,
    userAgent: getUserAgentHeader(req.headers["user-agent"]),
  });

  res.status(201).json({ success: true, skipped: false, reminder });
});

router.get("/reminders/scheduler-status", requireAuth, requireRole([UserRoleCode.ADMIN]), async (_req: AuthenticatedRequest, res) => {
  res.json(getReminderSchedulerStatus());
});

router.post("/reminders/scheduler-run-now", requireAuth, requireRole([UserRoleCode.ADMIN]), async (_req: AuthenticatedRequest, res) => {
  const result = await runReminderSchedulerNow("admin-manual");
  res.json(result);
});

router.post("/reminders/scan", requireAuth, requireRole([UserRoleCode.ADMIN]), async (_req: AuthenticatedRequest, res) => {
  const result = await runReminderSchedulerNow("admin-scan");
  res.json(result);
});

export default router;
