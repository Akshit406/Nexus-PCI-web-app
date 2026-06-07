import {
  AocPdfInput,
  DiplomaPdfInput,
  generateAocSummaryPdf,
  generateDiplomaPdf,
  generateSaqPdf,
  SaqPdfInput,
} from "./pdf-generators";
import {
  isPdfConversionAvailable,
  renderDiplomaPdf,
  renderTemplateToPdf,
} from "./doc-template-engine";
import { getTaggedAocTemplate, getTaggedSaqTemplate } from "./saq-template-map";
import { groupRequirementsByTopic, getResponseColumns } from "./saq-document-layout";

const MARK = "X";

function formatDate(value?: Date | string | null) {
  if (!value) {
    return "";
  }
  return new Intl.DateTimeFormat("es-MX", { year: "numeric", month: "long", day: "numeric" }).format(new Date(value));
}

// Flat data model consumed by the official .docx templates (docxtemplater).
// Tag names intentionally avoid spaces so template authoring stays simple.
export function buildSaqTemplateModel(input: SaqPdfInput) {
  const supportsNotTested = Boolean(input.supportsNotTested);
  const columns = getResponseColumns(supportsNotTested).map((column) => column.value);

  const requirements = input.requirements.map((requirement) => {
    const value = requirement.answerValue ?? null;
    return {
      code: requirement.code,
      description: requirement.description,
      testingProcedures: requirement.testingProcedures ?? "",
      topicCode: requirement.topicCode ?? "",
      topicName: requirement.topicName ?? "",
      respImplemented: value === "IMPLEMENTED" ? MARK : "",
      respCcw: value === "CCW" ? MARK : "",
      respNa: value === "NOT_APPLICABLE" ? MARK : "",
      respNotTested: value === "NOT_TESTED" ? MARK : "",
      respNotImplemented: value === "NOT_IMPLEMENTED" ? MARK : "",
    };
  });

  const topicGroups = groupRequirementsByTopic(
    input.requirements.map((requirement) => ({
      code: requirement.code,
      topicCode: requirement.topicCode,
      topicName: requirement.topicName,
    })),
  ).map((group) => ({ heading: group.heading, topicCode: group.topicCode, topicName: group.topicName }));

  return {
    companyName: input.companyName,
    dbaName: input.dbaName ?? input.companyName,
    businessType: input.businessType ?? "No aplicable",
    contactName: input.contactName ?? input.companyName,
    contactTitle: input.contactTitle ?? "No aplicable",
    contactPhone: input.contactPhone ?? "No aplicable",
    contactEmail: input.contactEmail ?? "No aplicable",
    postalAddress: input.postalAddress ?? "No aplicable",
    isaName: input.assessor?.isaName ?? "No aplicable",
    qsaCompany: input.assessor?.qsaCompany ?? "No aplicable",
    qsaLeadName: input.assessor?.qsaLeadName ?? "No aplicable",
    saqTypeName: input.saqTypeName,
    saqTypeCode: input.saqTypeCode ?? "",
    cycleYear: String(input.cycleYear),
    generatedAt: formatDate(input.generatedAt),
    issueDate: formatDate(input.issueDate),
    validUntil: formatDate(input.validUntil),
    assessmentDate: formatDate(input.assessmentCompletionDate ?? input.issueDate),
    paymentState: input.paymentState ?? "",
    signaturePresent: input.signaturePresent ? "Registrada" : "Pendiente",
    columns,
    requirements,
    topicGroups,
    conformityImplemented: input.validationStatus === "CONFORMING" ? MARK : "",
    conformityNonConforming: input.validationStatus === "NON_CONFORMING" ? MARK : "",
    conformityLegalException: input.validationStatus === "LEGAL_EXCEPTION" ? MARK : "",
    conformityText: input.validationStatusText ?? "",
    complianceDeadline: formatDate(input.complianceDeadline),
    legalExceptionRows: (input.legalExceptionRows ?? []).map((row) => ({
      requirement: row.requirement || "Requisito No Implementado",
      restriction: row.restriction || "Pendiente",
    })),
    appliesPart4: Boolean(input.appliesPart4),
    part4Rows: (input.notImplementedRequirements ?? []).map((row) => ({
      code: row.code,
      title: row.title ?? "",
      explanation: row.explanation || "Pendiente",
      resolutionDate: formatDate(row.resolutionDate),
    })),
    merchantSignatoryName: input.merchantSignatory?.name ?? input.contactName ?? input.companyName,
    merchantSignatoryTitle: input.merchantSignatory?.title ?? input.contactTitle ?? "No aplicable",
    merchantSignatoryDate: formatDate(input.merchantSignatory?.date ?? input.issueDate),
  };
}

// Renders the SAQ. Uses the official .docx template when both a mapped template
// and LibreOffice are available; otherwise falls back to the pdfkit generator
// so generation never breaks in environments without LibreOffice.
export async function renderSaqDocument(input: SaqPdfInput): Promise<Buffer> {
  const template = getTaggedSaqTemplate(input.saqTypeCode);
  if (template && isPdfConversionAvailable()) {
    try {
      return await renderTemplateToPdf(template, buildSaqTemplateModel(input));
    } catch (error) {
      console.error("[saq-document-render] SAQ template render failed, falling back to pdfkit:", error);
    }
  }
  return generateSaqPdf(input);
}

export async function renderAocDocument(input: AocPdfInput): Promise<Buffer> {
  const template = getTaggedAocTemplate(input.saqTypeCode);
  if (template && isPdfConversionAvailable()) {
    try {
      return await renderTemplateToPdf(template, buildSaqTemplateModel(input));
    } catch (error) {
      console.error("[saq-document-render] AOC template render failed, falling back to pdfkit:", error);
    }
  }
  return generateAocSummaryPdf(input);
}

export async function renderDiplomaDocument(
  diploma: { companyName: string; startDate?: Date | string | null; endDate?: Date | string | null },
  fallback: DiplomaPdfInput,
): Promise<Buffer> {
  if (isPdfConversionAvailable()) {
    try {
      return await renderDiplomaPdf({
        companyName: diploma.companyName,
        startDate: formatDate(diploma.startDate),
        endDate: formatDate(diploma.endDate),
      });
    } catch (error) {
      console.error("[saq-document-render] Diploma template render failed, falling back to pdfkit:", error);
    }
  }
  return generateDiplomaPdf(fallback);
}
