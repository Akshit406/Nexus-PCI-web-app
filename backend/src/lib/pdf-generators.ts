import PDFDocument from "pdfkit";
import { AnswerValue } from "@prisma/client";
import {
  ConformityStatus,
  getSaqDocumentTitle,
  groupRequirementsByTopic,
  isPart2CaptureSection,
  renderConformityOptions,
  renderResponseRow,
  SAQ_DOCUMENT_SUBTITLE,
} from "./saq-document-layout";

type PdfLine = string | null | undefined;

type RequirementOutput = {
  code: string;
  description: string;
  testingProcedures?: string | null;
  answerValue?: string | null;
  explanation?: string | null;
  resolutionDate?: Date | string | null;
  topicCode?: string | null;
  topicName?: string | null;
};

type SectionOutput = {
  id?: string;
  title: string;
  values: Record<string, string>;
};

type AnnexOutput = {
  title: string;
  entries: Array<{
    title: string;
    lines: PdfLine[];
  }>;
};

type SignatoryInput = {
  name?: string | null;
  title?: string | null;
  date?: Date | string | null;
};

export type SaqPdfInput = {
  companyName: string;
  businessType?: string | null;
  dbaName?: string | null;
  website?: string | null;
  contactName?: string | null;
  contactTitle?: string | null;
  contactPhone?: string | null;
  contactEmail?: string | null;
  postalAddress?: string | null;
  saqTypeName: string;
  saqTypeCode?: string | null;
  cycleYear: number;
  generatedAt: Date;
  issueDate?: Date | null;
  validUntil?: Date | null;
  assessmentCompletionDate?: Date | string | null;
  paymentState?: string | null;
  signaturePresent: boolean;
  signatureImageDataUrl?: string | null;
  supportsNotTested?: boolean;
  systemSections?: SectionOutput[];
  captureSections: SectionOutput[];
  requirements: RequirementOutput[];
  annexes: AnnexOutput[];
  validationStatus?: ConformityStatus | null;
  validationStatusText?: string | null;
  complianceDeadline?: Date | string | null;
  legalExceptionRows?: Array<{ requirement: string; restriction: string }>;
  appliesPart4?: boolean;
  notImplementedRequirements?: Array<{
    code: string;
    title?: string | null;
    explanation?: string | null;
    resolutionDate?: Date | string | null;
  }>;
  merchantSignatory?: SignatoryInput;
  assessor?: {
    isaName?: string | null;
    qsaCompany?: string | null;
    qsaLeadName?: string | null;
  };
};

export type DiplomaPdfInput = {
  companyName: string;
  saqTypeName: string;
  cycleYear: number;
  issueDate: Date;
  validUntil: Date;
  status: string;
};

// The official SAQ already embeds the AOC; the standalone AOC document reuses
// the same Seccion 1 / Seccion 3 renderer, so it accepts the same rich input.
export type AocPdfInput = SaqPdfInput;

function formatDate(value?: Date | string | null) {
  if (!value) {
    return "Pendiente";
  }
  return new Intl.DateTimeFormat("es-MX", {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(new Date(value));
}

// pdfkit ships only the standard WinAnsi Type1 fonts (Helvetica/Times/Courier),
// so text that contains characters outside that encoding (TAB, smart quotes,
// non-breaking spaces, etc.) gets silently mangled in both the rendered glyphs
// and in the PDF text-extraction stream. The PCI DSS requirement descriptions
// imported from the Excel workbook are full of bullet+TAB sequences, so we
// normalize them to WinAnsi-safe equivalents before handing the text to pdfkit.
function sanitizeForPdf(input: string | null | undefined): string {
  if (input === null || input === undefined) {
    return "";
  }
  return String(input)
    .normalize("NFC")
    .replace(/\r\n?/g, "\n")
    .replace(/\t/g, "    ")
    .replace(/[\u2010\u2011\u2012\u2013\u2014\u2212]/g, "-")
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F]/g, '"')
    .replace(/\u2026/g, "...")
    .replace(/[\u00A0\u2007\u202F]/g, " ")
    .replace(/[\u200B\u200C\u200D\uFEFF]/g, "")
    .replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, "");
}

function addTitle(doc: PDFKit.PDFDocument, title: string, subtitle?: string) {
  doc.fontSize(18).fillColor("#06245a").text(sanitizeForPdf(title), { continued: false });
  if (subtitle) {
    doc.moveDown(0.25).fontSize(10).fillColor("#52627a").text(sanitizeForPdf(subtitle));
  }
  doc.moveDown();
}

function addSection(doc: PDFKit.PDFDocument, title: string, lines: PdfLine[]) {
  doc.moveDown(0.5).fontSize(13).fillColor("#06245a").text(sanitizeForPdf(title));
  doc.moveDown(0.25);
  doc.fontSize(9).fillColor("#1f2a3d");
  for (const line of lines) {
    if (line === null || line === undefined) {
      continue;
    }
    doc.text(sanitizeForPdf(String(line)), { width: 500 });
  }
}

function createPdfBuffer(render: (doc: PDFKit.PDFDocument) => void) {
  return new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({ size: "LETTER", margin: 48, bufferPages: true });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    doc.on("error", reject);
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    render(doc);
    doc.end();
  });
}

const BODY_WIDTH = 500;

// Banner heading for a major section ("Seccion 1: ...").
function addMajorSection(doc: PDFKit.PDFDocument, label: string) {
  doc.moveDown(0.8);
  doc.fontSize(14).fillColor("#06245a").text(sanitizeForPdf(label), { width: BODY_WIDTH });
  const y = doc.y + 2;
  doc
    .moveTo(doc.page.margins.left, y)
    .lineTo(doc.page.width - doc.page.margins.right, y)
    .strokeColor("#06245a")
    .lineWidth(1)
    .stroke();
  doc.moveDown(0.5);
}

// Sub-heading for a Part ("Parte 2a. ...").
function addPartHeading(doc: PDFKit.PDFDocument, label: string) {
  doc.moveDown(0.4).fontSize(11).fillColor("#0b3a8a").text(sanitizeForPdf(label), { width: BODY_WIDTH });
  doc.moveDown(0.15);
}

function addKeyValues(doc: PDFKit.PDFDocument, values: Record<string, string>, emptyLabel = "No aplicable") {
  doc.fontSize(9).fillColor("#1f2a3d");
  const entries = Object.entries(values);
  if (entries.length === 0) {
    doc.fillColor("#52627a").text(emptyLabel, { width: BODY_WIDTH });
    return;
  }
  for (const [key, value] of entries) {
    doc
      .font("Helvetica-Bold")
      .fillColor("#1f2a3d")
      .text(sanitizeForPdf(`${key}: `), { width: BODY_WIDTH, continued: true })
      .font("Helvetica")
      .fillColor("#1f2a3d")
      .text(sanitizeForPdf(value && value.trim() ? value : emptyLabel));
  }
}

function addParagraph(doc: PDFKit.PDFDocument, text: string, color = "#1f2a3d", size = 9) {
  doc.fontSize(size).fillColor(color).text(sanitizeForPdf(text), { width: BODY_WIDTH });
}

function findSystemSection(input: SaqPdfInput, predicate: (section: SectionOutput) => boolean) {
  return (input.systemSections ?? []).find(predicate);
}

// ---- Seccion 1: Informacion de la Evaluacion (= AOC Parte 1 + Parte 2) -----
function renderSeccion1(doc: PDFKit.PDFDocument, input: SaqPdfInput) {
  addMajorSection(doc, "Seccion 1: Informacion de la Evaluacion");

  addPartHeading(doc, "Parte 1. Informacion de Contacto");
  addParagraph(doc, "Parte 1a. Comerciante evaluado", "#06245a", 9.5);
  addKeyValues(doc, {
    "Nombre legal del comerciante": input.companyName,
    "Nombre comercial (DBA)": input.dbaName ?? input.companyName,
    "Tipo de negocio": input.businessType ?? "No aplicable",
    "Nombre del contacto": input.contactName ?? input.companyName,
    "Titulo del contacto": input.contactTitle ?? "No aplicable",
    "Telefono": input.contactPhone ?? "No aplicable",
    "Correo electronico": input.contactEmail ?? "No aplicable",
    "Direccion postal": input.postalAddress ?? "No aplicable",
    "SAQ asignado": input.saqTypeName,
    Ciclo: String(input.cycleYear),
  });

  doc.moveDown(0.3);
  addParagraph(doc, "Parte 1b. Asesor (PCI SSC) / QSA / ISA", "#06245a", 9.5);
  addKeyValues(doc, {
    "Nombre del ISA": input.assessor?.isaName ?? "No aplicable",
    "Empresa QSA": input.assessor?.qsaCompany ?? "No aplicable",
    "Asesor lider QSA": input.assessor?.qsaLeadName ?? "No aplicable",
  });

  addPartHeading(doc, "Parte 2. Resumen Ejecutivo");
  const part2Sections = input.captureSections.filter((section) => isPart2CaptureSection(section.id));
  for (const section of part2Sections) {
    doc.moveDown(0.25);
    addParagraph(doc, section.title, "#0b3a8a", 9.5);
    
    if (section.id === "part-2h-eligibility") {
      doc.moveDown(0.15);
      for (const [key, value] of Object.entries(section.values)) {
        const isChecked = String(value).toLowerCase() === "true" || value === "Sí" || value === "Yes";
        const mark = isChecked ? "[X]" : "[ ]";
        doc.fontSize(8.5).fillColor("#1f2a3d").text(`${mark} ${sanitizeForPdf(key)}`, { width: BODY_WIDTH });
        doc.moveDown(0.15);
      }
    } else {
      addKeyValues(doc, section.values, "Pendiente");
    }
  }
}

// ---- Seccion 2: Cuestionario de Autoevaluacion -----------------------------
function renderSeccion2(doc: PDFKit.PDFDocument, input: SaqPdfInput) {
  addMajorSection(doc, "Seccion 2: Cuestionario de Autoevaluacion");
  const supportsNotTested = Boolean(input.supportsNotTested);
  const groups = groupRequirementsByTopic(input.requirements);

  if (groups.length === 0) {
    addParagraph(doc, "No hay requisitos asignados para este SAQ.", "#52627a");
    return;
  }

  for (const group of groups) {
    doc.moveDown(0.4).fontSize(10.5).fillColor("#06245a").text(sanitizeForPdf(group.heading), { width: BODY_WIDTH });
    doc.moveDown(0.1);
    for (const requirement of group.requirements) {
      doc.moveDown(0.3);
      doc
        .font("Helvetica-Bold")
        .fontSize(9)
        .fillColor("#1f2a3d")
        .text(sanitizeForPdf(`${requirement.code}. Requisito de PCI DSS:`))
        .font("Helvetica")
        .text(sanitizeForPdf(requirement.description), { width: BODY_WIDTH });
      if (requirement.testingProcedures) {
        doc.moveDown(0.2);
        doc
          .font("Helvetica-Bold")
          .fontSize(8.5)
          .fillColor("#52627a")
          .text("Pruebas previstas:")
          .font("Helvetica")
          .text(sanitizeForPdf(requirement.testingProcedures), { width: BODY_WIDTH });
      }
      doc
        .fontSize(8.5)
        .fillColor("#0b3a8a")
        .text(sanitizeForPdf(`Respuesta: ${renderResponseRow(requirement.answerValue as AnswerValue | null, supportsNotTested)}`), {
          width: BODY_WIDTH,
        });
    }
  }
}

// ---- Anexos B / C / D ------------------------------------------------------
function renderAnexos(doc: PDFKit.PDFDocument, input: SaqPdfInput) {
  addMajorSection(doc, "Anexos: Controles Compensatorios y Explicaciones");
  for (const annex of input.annexes) {
    doc.moveDown(0.3).fontSize(10.5).fillColor("#06245a").text(sanitizeForPdf(annex.title), { width: BODY_WIDTH });
    if (annex.entries.length === 0) {
      doc.fontSize(8.5).fillColor("#52627a").text("No aplica para esta evaluacion.", { width: BODY_WIDTH });
      continue;
    }
    for (const entry of annex.entries) {
      doc.moveDown(0.25).fontSize(9).fillColor("#0b3a8a").text(sanitizeForPdf(entry.title), { width: BODY_WIDTH });
      doc.fontSize(8).fillColor("#1f2a3d");
      for (const line of entry.lines) {
        if (line) {
          doc.text(sanitizeForPdf(String(line)), { width: BODY_WIDTH });
        }
      }
    }
  }
}

// ---- Seccion 3: Detalles de Validacion y Certificacion (AOC Parte 3 + 4) ---
function renderSeccion3(doc: PDFKit.PDFDocument, input: SaqPdfInput) {
  addMajorSection(doc, "Seccion 3: Detalles de Validacion y Certificacion");

  addPartHeading(doc, "Parte 3. Validacion PCI DSS");
  addParagraph(
    doc,
    `Esta evaluacion AOC se basa en los resultados registrados con fecha ${formatDate(input.assessmentCompletionDate ?? input.issueDate)}.`,
  );
  doc.moveDown(0.2);
  for (const option of renderConformityOptions(input.validationStatus)) {
    doc.fontSize(8.5).fillColor("#1f2a3d").text(sanitizeForPdf(option), { width: BODY_WIDTH });
    doc.moveDown(0.1);
  }
  if (input.validationStatusText) {
    doc.moveDown(0.1);
    addParagraph(doc, input.validationStatusText, "#52627a", 8.5);
  }

  // Legal exception table (Conforme con excepcion legal).
  if (input.legalExceptionRows && input.legalExceptionRows.length > 0) {
    doc.moveDown(0.3);
    addParagraph(doc, "Tabla de excepcion legal", "#0b3a8a", 9.5);
    addKeyValues(
      doc,
      Object.fromEntries(
        input.legalExceptionRows.map((row) => [row.requirement || "Requisito No Implementado", row.restriction || "Pendiente"]),
      ),
      "Pendiente",
    );
  }

  // Parte 3a. Reconocimiento del comerciante.
  doc.moveDown(0.3);
  addPartHeading(doc, "Parte 3a. Reconocimiento del comerciante");
  const acknowledgements = input.captureSections.find((section) => section.id === "section-3a-merchant-recognition");
  addKeyValues(doc, acknowledgements?.values ?? {}, "Pendiente");

  // Parte 3b. Firma del comerciante.
  doc.moveDown(0.3);
  addPartHeading(doc, "Parte 3b. Firma del comerciante");
  const showSignatureImage = input.signaturePresent && input.signatureImageDataUrl;
  
  addKeyValues(doc, {
    "Nombre del firmante": input.merchantSignatory?.name ?? input.contactName ?? input.companyName,
    "Titulo del firmante": input.merchantSignatory?.title ?? input.contactTitle ?? "No aplicable",
    Firma: showSignatureImage ? "" : (input.signaturePresent ? "Registrada" : "Pendiente"),
    Fecha: formatDate(input.merchantSignatory?.date ?? input.issueDate),
  });

  if (showSignatureImage) {
    try {
      const base64Data = input.signatureImageDataUrl!.replace(/^data:image\/\w+;base64,/, "");
      const signatureBuffer = Buffer.from(base64Data, "base64");
      doc.image(signatureBuffer, 170, doc.y - 30, { height: 35 });
    } catch (err) {
      // Ignore invalid image
    }
  }

  // Parte 3c / 3d. QSA / ISA (no aplica para autoevaluacion del comerciante).
  doc.moveDown(0.3);
  addPartHeading(doc, "Parte 3c. Reconocimiento del QSA (si corresponde)");
  addKeyValues(doc, { "Empresa QSA": input.assessor?.qsaCompany ?? "No aplicable", "Asesor lider QSA": input.assessor?.qsaLeadName ?? "No aplicable" });
  doc.moveDown(0.2);
  addPartHeading(doc, "Parte 3d. Reconocimiento del ISA (si corresponde)");
  addKeyValues(doc, { "Nombre del ISA": input.assessor?.isaName ?? "No aplicable" });

  // Parte 4. Plan de Accion - only when NON_CONFORMING.
  if (input.appliesPart4) {
    doc.moveDown(0.4);
    addPartHeading(doc, "Parte 4. Plan de Accion para estado de No Conformidad");
    const rows = input.notImplementedRequirements ?? [];
    if (rows.length === 0) {
      addParagraph(doc, "No hay requisitos No Implementado registrados.", "#52627a");
    } else {
      for (const row of rows) {
        doc
          .font("Helvetica-Bold")
          .fontSize(9)
          .fillColor("#1f2a3d")
          .text(sanitizeForPdf(`${row.code}: `), { width: BODY_WIDTH, continued: true })
          .font("Helvetica")
          .text(sanitizeForPdf(row.title ?? ""));
        addParagraph(doc, `Accion correctiva: ${row.explanation || "Pendiente"}`, "#52627a", 8.5);
        addParagraph(doc, `Fecha compromiso: ${formatDate(row.resolutionDate)}`, "#52627a", 8.5);
        doc.moveDown(0.15);
      }
    }
  }
}

export function generateSaqPdf(input: SaqPdfInput) {
  return createPdfBuffer((doc) => {
    addTitle(doc, getSaqDocumentTitle(input.saqTypeName), SAQ_DOCUMENT_SUBTITLE);
    doc.fontSize(9).fillColor("#52627a").text(
      sanitizeForPdf(
        `Empresa: ${input.companyName}  |  Ciclo ${input.cycleYear}  |  Generado: ${formatDate(input.generatedAt)}  |  Vigencia: ${formatDate(input.validUntil)}`,
      ),
      { width: BODY_WIDTH },
    );

    renderSeccion1(doc, input);
    renderSeccion2(doc, input);
    renderAnexos(doc, input);
    renderSeccion3(doc, input);
  });
}

export function generateDiplomaPdf(input: DiplomaPdfInput) {
  return createPdfBuffer((doc) => {
    addTitle(doc, "Diploma de certificacion PCI DSS", input.companyName);
    doc.moveDown(2);
    doc.fontSize(14).fillColor("#1f2a3d").text(sanitizeForPdf("Se reconoce la finalizacion del proceso de certificacion en la plataforma PCI Nexus."), {
      align: "center",
    });
    doc.moveDown();
    addSection(doc, "Detalle", [
      `Empresa: ${input.companyName}`,
      `SAQ: ${input.saqTypeName}`,
      `Ciclo: ${input.cycleYear}`,
      `Fecha de emision: ${formatDate(input.issueDate)}`,
      `Vigencia: ${formatDate(input.validUntil)}`,
      `Estado: ${input.status}`,
    ]);
  });
}

export function generateAocSummaryPdf(input: AocPdfInput) {
  // The official AOC is the same Seccion 1 + Seccion 3 content that the SAQ
  // embeds, without the Seccion 2 questionnaire or the annexes.
  return createPdfBuffer((doc) => {
    addTitle(
      doc,
      `Atestacion de Conformidad (AOC) - ${input.saqTypeName}`,
      SAQ_DOCUMENT_SUBTITLE,
    );
    doc.fontSize(9).fillColor("#52627a").text(
      sanitizeForPdf(
        `Empresa: ${input.companyName}  |  Ciclo ${input.cycleYear}  |  Generado: ${formatDate(input.generatedAt)}  |  Vigencia: ${formatDate(input.validUntil)}`,
      ),
      { width: BODY_WIDTH },
    );

    renderSeccion1(doc, input);
    renderSeccion3(doc, input);
  });
}
