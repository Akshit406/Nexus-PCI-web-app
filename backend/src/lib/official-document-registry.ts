import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { CertificationStatus, Prisma, PrismaClient } from "@prisma/client";
import PizZip from "pizzip";
import { config } from "../config";
import { prisma } from "./prisma";
import { readTemplate } from "./doc-template-engine";
import { getOfficialAocTemplateConfig, listOfficialAocTemplateConfigs } from "./official-aoc-field-map";
import { getOfficialSaqTemplateConfig, listOfficialSaqTemplateConfigs } from "./official-saq-field-map";

export type OfficialDocumentKind = "SAQ" | "AOC";

export type ParsedOfficialSection = {
  id: string;
  title: string;
  displayOrder: number;
};

export type ParsedOfficialRequirement = {
  code: string;
  title: string;
  description: string;
  testingProcedures: string | null;
  topicCode: string;
  displayOrder: number;
};

export type ParsedOfficialDocument = {
  sections: ParsedOfficialSection[];
  requirements: ParsedOfficialRequirement[];
  sha256: string;
  textFieldCount: number;
  checkboxCount: number;
  validationErrors: string[];
  validationWarnings: string[];
};

export type ResolvedOfficialDocument = {
  kind: OfficialDocumentKind;
  saqTypeCode: string;
  fileName: string;
  templatePath: string;
  storagePath: string | null;
  sha256: string;
  expectedTextFields: number;
  expectedCheckboxes: number;
  supportsNotTested: boolean;
  parsed: ParsedOfficialDocument;
  buffer: Buffer;
  source: "ACTIVE_UPLOAD" | "BUNDLED";
};

type LegacyFieldKind = "text" | "checkbox";

type LegacyField = {
  index: number;
  kind: LegacyFieldKind;
};

const TEXT_PATTERN = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g;
const RUN_PATTERN = /<w:r\b[\s\S]*?<\/w:r>/g;
const TABLE_ROW_PATTERN = /<w:tr\b[\s\S]*?<\/w:tr>/g;
const SECTION_TITLE_PATTERNS: Array<{ id: string; pattern: RegExp; title: string }> = [
  { id: "part-1a-merchant-evaluated", pattern: /Parte\s+1a\./i, title: "Parte 1a. Comerciante evaluado" },
  { id: "part-1b-assessor", pattern: /Parte\s+1b\./i, title: "Parte 1b. Asesor" },
  { id: "part-2a-payment-channels", pattern: /Parte\s+2a\./i, title: "Parte 2a. Canales de pago" },
  { id: "part-2b-cardholder-function", pattern: /Parte\s+2b\./i, title: "Parte 2b. Funcion con tarjetas de pago" },
  { id: "part-2c-cardholder-environment", pattern: /Parte\s+2c\./i, title: "Parte 2c. Entorno de tarjetas de pago" },
  { id: "part-2d-scope-facilities", pattern: /Parte\s+2d\./i, title: "Parte 2d. Localidades e instalaciones" },
  { id: "part-2e-generic", pattern: /Parte\s+2e\./i, title: "Parte 2e. Productos o soluciones validados" },
  { id: "part-2f-service-providers", pattern: /Parte\s+2f\./i, title: "Parte 2f. Proveedores de servicios externos" },
  { id: "part-2g-assessment-summary", pattern: /Parte\s+2g\./i, title: "Parte 2g. Resumen de la evaluacion" },
  { id: "part-2h-saq-eligibility", pattern: /Parte\s+2h\./i, title: "Parte 2h. Elegibilidad para llenar el SAQ" },
  { id: "part-2-questionnaire", pattern: /Cuestionario(?:\s+[A-Z0-9-]+)?\s+de\s+Auto/i, title: "Seccion 2. Cuestionario de Autoevaluacion" },
  { id: "annex-b-ccw", pattern: /Anexo\s+B\s*:/i, title: "Anexo B. Ficha de control compensatorio" },
  { id: "annex-c-not-applicable", pattern: /Anexo\s+C\s*:/i, title: "Anexo C. Explicacion de requisitos no aplicables" },
  { id: "annex-d-not-tested", pattern: /Anexo\s+D\s*:/i, title: "Anexo D. Explicacion de requisitos no probados" },
  { id: "section-3-validation-certification", pattern: /Parte\s+3\.\s+Validaci/i, title: "Seccion 3. Validacion y certificacion" },
  { id: "section-3a-merchant-recognition", pattern: /Parte\s+3a\./i, title: "Parte 3a. Reconocimiento del comerciante" },
  { id: "section-3b-merchant-declaration", pattern: /Parte\s+3b\./i, title: "Parte 3b. Declaracion del comerciante" },
  { id: "section-3c-qsa-declaration", pattern: /Parte\s+3c\./i, title: "Parte 3c. Declaracion del QSA" },
  { id: "section-3d-isa-participation", pattern: /Parte\s+3d\./i, title: "Parte 3d. Participacion del ISA" },
  { id: "section-4-action-plan", pattern: /Parte\s+4\./i, title: "Parte 4. Plan de accion" },
];

const P2PE_SECTION_CODES = new Set(["P2PE", "D_P2PE", "SPOC", "SPoC"]);
const parserCache = new Map<string, ParsedOfficialDocument>();

function normalizeText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function decodeXmlText(value: string) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'");
}

export function visibleTextFromXml(xml: string) {
  return normalizeText(Array.from(xml.matchAll(TEXT_PATTERN), (match) => decodeXmlText(match[1] ?? "")).join(" "));
}

function instructionText(runXml: string) {
  return Array.from(runXml.matchAll(/<w:instrText[^>]*>([\s\S]*?)<\/w:instrText>/g), (item) => item[1] ?? "").join("");
}

function isFieldRun(runXml: string, type: "begin" | "end") {
  return new RegExp(`<w:fldChar\\b[^>]*w:fldCharType="${type}"`).test(runXml);
}

function extractLegacyFields(documentXml: string): LegacyField[] {
  const fields: LegacyField[] = [];
  let textIndex = 0;
  let checkboxIndex = 0;
  let active: { instrText: string; depth: number } | null = null;

  for (const match of documentXml.matchAll(RUN_PATTERN)) {
    const runXml = match[0];
    const isBegin = isFieldRun(runXml, "begin");
    const isEnd = isFieldRun(runXml, "end");
    if (!active && !isBegin) continue;
    if (!active) active = { instrText: "", depth: 0 };
    active.instrText += instructionText(runXml);
    if (isBegin) active.depth += 1;
    if (isEnd) active.depth -= 1;
    if (active.depth <= 0) {
      const instruction = normalizeText(active.instrText).replace(/\s+/g, "").toUpperCase();
      if (instruction === "FORMTEXT") {
        fields.push({ index: textIndex, kind: "text" });
        textIndex += 1;
      } else if (instruction === "FORMCHECKBOX") {
        fields.push({ index: checkboxIndex, kind: "checkbox" });
        checkboxIndex += 1;
      }
      active = null;
    }
  }

  return fields;
}

function documentXmlFromBuffer(buffer: Buffer) {
  const zip = new PizZip(buffer);
  const document = zip.file("word/document.xml");
  if (!document) {
    throw new Error("El DOCX no contiene word/document.xml.");
  }
  return document.asText();
}

function rowTextItems(documentXml: string) {
  return Array.from(documentXml.matchAll(TABLE_ROW_PATTERN), (match) => ({
    xml: match[0],
    text: visibleTextFromXml(match[0]),
    index: match.index ?? 0,
  })).filter((row) => row.text);
}

function sectionIdForGenericPart2e(saqTypeCode: string) {
  return P2PE_SECTION_CODES.has(saqTypeCode) ? "part-2e-p2pe-solution" : "part-2e-validated-products";
}

function parseSections(documentXml: string, saqTypeCode: string): ParsedOfficialSection[] {
  const text = visibleTextFromXml(documentXml);
  const sections = SECTION_TITLE_PATTERNS.flatMap((section) => {
    if (!section.pattern.test(text)) {
      return [];
    }
    return [{
      id: section.id === "part-2e-generic" ? sectionIdForGenericPart2e(saqTypeCode) : section.id,
      title: section.title,
    }];
  })
    .filter((section, index, all) => all.findIndex((item) => item.id === section.id) === index);

  return sections.map((section, index) => ({
    id: section.id,
    title: section.title,
    displayOrder: index + 1,
  }));
}

function checkboxCount(rowXml: string) {
  return extractLegacyFields(rowXml).filter((field) => field.kind === "checkbox").length;
}

function normalizeRequirementDescription(value: string) {
  return normalizeText(
    value
      .replace(/\bImplementado\b[\s\S]*$/i, "")
      .replace(/\bNo\s+Aplicable\b[\s\S]*$/i, "")
      .replace(/\bNo\s+Probado\b[\s\S]*$/i, "")
      .replace(/\bNo\s+Implementado\b[\s\S]*$/i, "")
      .replace(/\bImplementado\s+con\s+CCW\b[\s\S]*$/i, ""),
  );
}

function titleFromDescription(description: string) {
  const sentence = description.split(/(?<=[.!?])\s+/u).find(Boolean) ?? description;
  return sentence.length > 180 ? `${sentence.slice(0, 177).trim()}...` : sentence;
}

function topicCodeForRequirement(requirementCode: string) {
  const annex = requirementCode.match(/^(A\d+)\./i);
  if (annex) return annex[1].toUpperCase();
  return requirementCode.split(".")[0] ?? requirementCode;
}

function parseRequirements(documentXml: string): ParsedOfficialRequirement[] {
  const rows = rowTextItems(documentXml);
  const startIndex = rows.findIndex((row) => /Cuestionario(?:\s+[A-Z0-9-]+)?\s+de\s+Auto/i.test(row.text));
  const endIndex = rows.findIndex((row, index) => index > startIndex && (/Anexo\s+B\s*:/i.test(row.text) || /Parte\s+3\.\s+Validaci/i.test(row.text)));
  const scopedRows = rows.slice(startIndex >= 0 ? startIndex : 0, endIndex > 0 ? endIndex : rows.length);
  const requirementByCode = new Map<string, ParsedOfficialRequirement>();

  for (const row of scopedRows) {
    if (checkboxCount(row.xml) < 4) {
      continue;
    }
    const match = row.text.match(/\b(A\d+\.)?\d+\.\d+(?:\.\d+){0,4}\b/i);
    if (!match) {
      continue;
    }
    const code = match[0].toUpperCase();
    if (requirementByCode.has(code)) {
      continue;
    }
    const description = normalizeRequirementDescription(row.text.slice((match.index ?? 0) + match[0].length));
    if (description.length < 8) {
      continue;
    }
    requirementByCode.set(code, {
      code,
      title: titleFromDescription(description),
      description,
      testingProcedures: null,
      topicCode: topicCodeForRequirement(code),
      displayOrder: requirementByCode.size + 1,
    });
  }

  return Array.from(requirementByCode.values());
}

function parseDocument(buffer: Buffer, kind: OfficialDocumentKind, saqTypeCode: string): ParsedOfficialDocument {
  const sha256 = createHash("sha256").update(buffer).digest("hex");
  const cacheKey = `${kind}:${saqTypeCode}:${sha256}`;
  const cached = parserCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const validationErrors: string[] = [];
  const validationWarnings: string[] = [];
  let documentXml = "";
  try {
    documentXml = documentXmlFromBuffer(buffer);
  } catch (error) {
    return {
      sections: [],
      requirements: [],
      sha256,
      textFieldCount: 0,
      checkboxCount: 0,
      validationErrors: [error instanceof Error ? error.message : String(error)],
      validationWarnings,
    };
  }

  const fields = extractLegacyFields(documentXml);
  const textFieldCount = fields.filter((field) => field.kind === "text").length;
  const checkboxFieldCount = fields.filter((field) => field.kind === "checkbox").length;
  const sections = kind === "SAQ" ? parseSections(documentXml, saqTypeCode) : [];
  const requirements = kind === "SAQ" ? parseRequirements(documentXml) : [];

  if (kind === "SAQ" && sections.length === 0) {
    validationErrors.push("No se pudieron detectar secciones oficiales del SAQ.");
  }
  if (kind === "SAQ" && !sections.some((section) => section.id === "part-2-questionnaire")) {
    validationErrors.push("No se detecto la Seccion 2 / Cuestionario de Autoevaluacion.");
  }
  if (kind === "SAQ" && requirements.length === 0) {
    validationErrors.push("No se detectaron requisitos PCI con filas de respuesta en la Seccion 2.");
  }
  if (textFieldCount === 0 && checkboxFieldCount === 0) {
    validationErrors.push("El documento no parece ser un formulario oficial con campos heredados de Word.");
  }

  const parsed = {
    sections,
    requirements,
    sha256,
    textFieldCount,
    checkboxCount: checkboxFieldCount,
    validationErrors,
    validationWarnings,
  };
  parserCache.set(cacheKey, parsed);
  return parsed;
}

export function parseOfficialSaqDocument(buffer: Buffer, saqTypeCode: string) {
  return parseDocument(buffer, "SAQ", saqTypeCode);
}

export function parseOfficialAocDocument(buffer: Buffer, saqTypeCode: string) {
  return parseDocument(buffer, "AOC", saqTypeCode);
}

function bundledConfigFor(kind: OfficialDocumentKind, saqTypeCode: string) {
  return kind === "SAQ" ? getOfficialSaqTemplateConfig(saqTypeCode) : getOfficialAocTemplateConfig(saqTypeCode);
}

async function readStoragePath(storagePath: string) {
  return fs.readFile(path.join(config.uploadsDir, storagePath));
}

export async function resolveOfficialDocument(kind: OfficialDocumentKind, saqTypeCode: string): Promise<ResolvedOfficialDocument | null> {
  const active = await prisma.officialDocumentVersion.findFirst({
    where: { kind, isActive: true, saqType: { code: saqTypeCode } },
    include: { saqType: true },
    orderBy: { appliedAt: "desc" },
  });

  if (active) {
    const buffer = active.storagePath
      ? await readStoragePath(active.storagePath)
      : active.bundledTemplatePath
        ? await readTemplate(active.bundledTemplatePath)
        : null;
    if (!buffer) {
      throw new Error(`El documento oficial activo ${active.fileName} no tiene ruta de almacenamiento.`);
    }
    const supportsNotTested = kind === "SAQ"
      ? Boolean(getOfficialSaqTemplateConfig(saqTypeCode)?.supportsNotTested)
      : Boolean(getOfficialAocTemplateConfig(saqTypeCode)?.supportsNotTested);
    return {
      kind,
      saqTypeCode,
      fileName: active.fileName,
      templatePath: active.bundledTemplatePath ?? active.storagePath ?? active.fileName,
      storagePath: active.storagePath,
      sha256: active.sha256,
      expectedTextFields: active.textFieldCount,
      expectedCheckboxes: active.checkboxCount,
      supportsNotTested,
      parsed: {
        sections: JSON.parse(active.parsedSectionsJson) as ParsedOfficialSection[],
        requirements: JSON.parse(active.parsedRequirementsJson) as ParsedOfficialRequirement[],
        sha256: active.sha256,
        textFieldCount: active.textFieldCount,
        checkboxCount: active.checkboxCount,
        validationErrors: [],
        validationWarnings: [],
      },
      buffer,
      source: active.storagePath ? "ACTIVE_UPLOAD" : "BUNDLED",
    };
  }

  return null;
}

export async function resolveBundledOfficialDocument(kind: OfficialDocumentKind, saqTypeCode: string): Promise<ResolvedOfficialDocument | null> {
  const bundled = bundledConfigFor(kind, saqTypeCode);
  if (!bundled) {
    return null;
  }
  const buffer = await readTemplate(bundled.template);
  const parsed = kind === "SAQ" ? parseOfficialSaqDocument(buffer, saqTypeCode) : parseOfficialAocDocument(buffer, saqTypeCode);
  return {
    kind,
    saqTypeCode,
    fileName: path.basename(bundled.template),
    templatePath: bundled.template,
    storagePath: null,
    sha256: parsed.sha256,
    expectedTextFields: bundled.expectedTextFields,
    expectedCheckboxes: bundled.expectedCheckboxes,
    supportsNotTested: bundled.supportsNotTested,
    parsed,
    buffer,
    source: "BUNDLED",
  };
}

export async function getActiveOfficialSaqManifest(saqTypeCode: string) {
  const document = await resolveOfficialDocument("SAQ", saqTypeCode);
  return document?.parsed ?? null;
}

export async function readActiveOfficialDocumentBuffer(kind: OfficialDocumentKind, saqTypeCode: string) {
  return resolveOfficialDocument(kind, saqTypeCode);
}

export function listConfiguredOfficialDocumentRows() {
  return [
    ...listOfficialSaqTemplateConfigs().map((item) => ({ kind: "SAQ" as const, ...item })),
    ...listOfficialAocTemplateConfigs().map((item) => ({ kind: "AOC" as const, ...item })),
  ];
}

export function compareRequirementSets(current: Array<{ requirementCode: string; description: string }>, parsed: ParsedOfficialRequirement[]) {
  const currentByCode = new Map(current.map((item) => [item.requirementCode.toUpperCase(), item]));
  const parsedByCode = new Map(parsed.map((item) => [item.code.toUpperCase(), item]));
  const added = parsed.filter((item) => !currentByCode.has(item.code.toUpperCase()));
  const removed = current.filter((item) => !parsedByCode.has(item.requirementCode.toUpperCase()));
  const changed = parsed.filter((item) => {
    const existing = currentByCode.get(item.code.toUpperCase());
    return existing && normalizeText(existing.description) !== normalizeText(item.description);
  });
  return { added, removed, changed };
}

function defaultRequiresEvidence(requirement: ParsedOfficialRequirement) {
  return ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12"].includes(requirement.topicCode);
}

function topicDisplayOrder(topicCode: string) {
  return /^A\d+$/i.test(topicCode) ? 100 + Number(topicCode.slice(1)) : Number(topicCode) || 999;
}

function topicName(topicCode: string) {
  return /^A\d+$/i.test(topicCode) ? `Requisito adicional ${topicCode}` : `Requisito ${topicCode}`;
}

type OfficialSnapshotTx = Prisma.TransactionClient | PrismaClient;

export async function applyOfficialSaqQuestionSnapshot(input: {
  tx: OfficialSnapshotTx;
  saqType: {
    id: string;
    code: string;
    templateVersion: string | null;
    supportsNotTested: boolean;
  };
  fileName: string;
  sha256: string;
  requirements: ParsedOfficialRequirement[];
  resetUnlockedCertifications: boolean;
}) {
  if (input.requirements.length === 0) {
    throw new Error(`No parsed requirements were provided for SAQ ${input.saqType.code}.`);
  }

  const mappingVersion = `official-doc:${input.sha256.slice(0, 12)}`;
  const existingMappings = await input.tx.saqRequirementMap.findMany({
    where: { saqTypeId: input.saqType.id },
    include: { requirement: true },
  });

  if (input.resetUnlockedCertifications) {
    const affectedCertifications = await input.tx.certification.findMany({
      where: {
        saqTypeId: input.saqType.id,
        isLocked: false,
        status: { notIn: [CertificationStatus.FINALIZED, CertificationStatus.ARCHIVED] },
      },
      select: { id: true },
    });
    const certificationIds = affectedCertifications.map((certification) => certification.id);
    if (certificationIds.length > 0) {
      await input.tx.answerJustification.deleteMany({
        where: { certificationAnswer: { certificationId: { in: certificationIds } } },
      });
      await input.tx.certificationAnswer.deleteMany({
        where: { certificationId: { in: certificationIds } },
      });
      await input.tx.certificationSectionInput.deleteMany({
        where: { certificationId: { in: certificationIds } },
      });
      await input.tx.certification.updateMany({
        where: { id: { in: certificationIds } },
        data: {
          status: CertificationStatus.IN_PROGRESS,
          lastViewedTopicCode: null,
          mappingVersionSnapshot: mappingVersion,
          templateVersionSnapshot: input.saqType.templateVersion ?? "PCI DSS v4.0.1",
        },
      });
    }
  }

  await input.tx.saqRequirementMap.updateMany({
    where: { saqTypeId: input.saqType.id, isActive: true },
    data: { isActive: false },
  });

  for (const requirement of input.requirements) {
    const topic = await input.tx.pciTopic.upsert({
      where: { code: requirement.topicCode },
      update: {
        name: topicName(requirement.topicCode),
        displayOrder: topicDisplayOrder(requirement.topicCode),
      },
      create: {
        code: requirement.topicCode,
        name: topicName(requirement.topicCode),
        displayOrder: topicDisplayOrder(requirement.topicCode),
      },
    });
    const savedRequirement = await input.tx.pciRequirement.upsert({
      where: { requirementCode: requirement.code },
      update: {
        title: requirement.title,
        description: requirement.description,
        testingProcedures: requirement.testingProcedures,
        topicId: topic.id,
        requirementVersion: input.saqType.templateVersion ?? "PCI DSS v4.0.1",
        isActive: true,
      },
      create: {
        requirementCode: requirement.code,
        title: requirement.title,
        description: requirement.description,
        testingProcedures: requirement.testingProcedures,
        topicId: topic.id,
        requirementVersion: input.saqType.templateVersion ?? "PCI DSS v4.0.1",
        isActive: true,
      },
    });
    const existingMapping = existingMappings.find((mapping) => mapping.requirementId === savedRequirement.id);
    await input.tx.saqRequirementMap.upsert({
      where: {
        saqTypeId_requirementId: {
          saqTypeId: input.saqType.id,
          requirementId: savedRequirement.id,
        },
      },
      update: {
        displayOrder: requirement.displayOrder,
        isActive: true,
        mappingVersion,
      },
      create: {
        saqTypeId: input.saqType.id,
        requirementId: savedRequirement.id,
        displayOrder: requirement.displayOrder,
        requiresEvidence: existingMapping?.requiresEvidence ?? defaultRequiresEvidence(requirement),
        requiresCcwJustification: existingMapping?.requiresCcwJustification ?? true,
        requiresNaJustification: existingMapping?.requiresNaJustification ?? true,
        allowNotTested: existingMapping?.allowNotTested ?? input.saqType.supportsNotTested,
        mappingVersion,
      },
    });
  }

  await input.tx.saqType.update({
    where: { id: input.saqType.id },
    data: {
      sourceDocument: input.fileName,
      templateVersion: input.saqType.templateVersion ?? "PCI DSS v4.0.1",
    },
  });

  return { mappingVersion };
}
