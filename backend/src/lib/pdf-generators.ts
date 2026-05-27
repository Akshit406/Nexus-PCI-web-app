import PDFDocument from "pdfkit";

type PdfLine = string | null | undefined;

type RequirementOutput = {
  code: string;
  description: string;
  testingProcedures?: string | null;
  answerValue?: string | null;
  explanation?: string | null;
  resolutionDate?: Date | string | null;
};

type SectionOutput = {
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

export type SaqPdfInput = {
  companyName: string;
  businessType?: string | null;
  saqTypeName: string;
  cycleYear: number;
  generatedAt: Date;
  issueDate?: Date | null;
  validUntil?: Date | null;
  paymentState?: string | null;
  signaturePresent: boolean;
  systemSections?: SectionOutput[];
  captureSections: SectionOutput[];
  requirements: RequirementOutput[];
  annexes: AnnexOutput[];
};

export type DiplomaPdfInput = {
  companyName: string;
  saqTypeName: string;
  cycleYear: number;
  issueDate: Date;
  validUntil: Date;
  status: string;
};

export type AocPdfInput = {
  companyName: string;
  saqTypeName: string;
  cycleYear: number;
  issueDate: Date;
  validUntil: Date;
};

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

export function generateSaqPdf(input: SaqPdfInput) {
  return createPdfBuffer((doc) => {
    addTitle(doc, "PCI Nexus - SAQ generado", `${input.saqTypeName} | Ciclo ${input.cycleYear}`);
    addSection(doc, "Datos del cliente", [
      `Empresa: ${input.companyName}`,
      `Giro: ${input.businessType ?? "Pendiente"}`,
      `Fecha de generacion: ${formatDate(input.generatedAt)}`,
      `Fecha de emision: ${formatDate(input.issueDate)}`,
      `Vigencia: ${formatDate(input.validUntil)}`,
      `Estado de pago: ${input.paymentState ?? "Pendiente"}`,
      `Firma: ${input.signaturePresent ? "Registrada" : "Pendiente"}`,
    ]);

    addSection(doc, "Secciones automaticas del SAQ", []);
    for (const section of input.systemSections ?? []) {
      doc.moveDown(0.35).fontSize(10).fillColor("#06245a").text(sanitizeForPdf(section.title));
      doc.fontSize(8.5).fillColor("#1f2a3d");
      for (const [key, value] of Object.entries(section.values)) {
        doc.text(sanitizeForPdf(`${key}: ${value || "Pendiente"}`), { width: 500 });
      }
    }

    addSection(doc, "Partes capturadas del SAQ", []);
    for (const section of input.captureSections) {
      doc.moveDown(0.35).fontSize(10).fillColor("#06245a").text(sanitizeForPdf(section.title));
      doc.fontSize(8.5).fillColor("#1f2a3d");
      for (const [key, value] of Object.entries(section.values)) {
        doc.text(sanitizeForPdf(`${key}: ${value || "Pendiente"}`), { width: 500 });
      }
    }

    addSection(doc, "Requisitos y respuestas", []);
    for (const requirement of input.requirements) {
      doc.moveDown(0.35).fontSize(9.5).fillColor("#06245a").text(sanitizeForPdf(`${requirement.code} - ${requirement.answerValue ?? "Sin respuesta"}`));
      doc.fontSize(8).fillColor("#1f2a3d").text(sanitizeForPdf(requirement.description), { width: 500 });
      if (requirement.testingProcedures) {
        doc.fontSize(8).fillColor("#52627a").text(sanitizeForPdf(`Procedimientos de prueba: ${requirement.testingProcedures}`), { width: 500 });
      }
      if (requirement.explanation) {
        doc.fontSize(8).fillColor("#52627a").text(sanitizeForPdf(`Explicacion/Anexo: ${requirement.explanation}`), { width: 500 });
      }
      if (requirement.resolutionDate) {
        doc.fontSize(8).fillColor("#52627a").text(sanitizeForPdf(`Fecha de resolucion: ${formatDate(requirement.resolutionDate)}`));
      }
    }

    for (const annex of input.annexes) {
      addSection(doc, annex.title, []);
      if (annex.entries.length === 0) {
        doc.fontSize(8.5).fillColor("#52627a").text("Sin entradas para este anexo.");
        continue;
      }
      for (const entry of annex.entries) {
        doc.moveDown(0.35).fontSize(9).fillColor("#06245a").text(sanitizeForPdf(entry.title));
        doc.fontSize(8).fillColor("#1f2a3d");
        for (const line of entry.lines) {
          if (line) {
            doc.text(sanitizeForPdf(String(line)), { width: 500 });
          }
        }
      }
    }
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
  return createPdfBuffer((doc) => {
    addTitle(doc, "Resumen AOC preliminar", `${input.saqTypeName} | Ciclo ${input.cycleYear}`);
    addSection(doc, "Resumen de atestacion", [
      "Resumen de atestacion generado por PCI Nexus con base en la informacion capturada durante el proceso de certificacion.",
      "El documento consolida los datos principales del comerciante, SAQ asignado, fecha de emision y vigencia.",
      "Este archivo es un resumen preliminar de apoyo y no sustituye el formato AOC oficial cuando sea requerido por el proceso.",
    ]);
    addSection(doc, "Datos del resumen", [
      `Empresa: ${input.companyName}`,
      `SAQ: ${input.saqTypeName}`,
      `Ciclo: ${input.cycleYear}`,
      `Fecha de emision: ${formatDate(input.issueDate)}`,
      `Vigencia: ${formatDate(input.validUntil)}`,
    ]);
  });
}
