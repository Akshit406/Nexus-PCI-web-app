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

function addTitle(doc: PDFKit.PDFDocument, title: string, subtitle?: string) {
  doc.fontSize(18).fillColor("#06245a").text(title, { continued: false });
  if (subtitle) {
    doc.moveDown(0.25).fontSize(10).fillColor("#52627a").text(subtitle);
  }
  doc.moveDown();
}

function addSection(doc: PDFKit.PDFDocument, title: string, lines: PdfLine[]) {
  doc.moveDown(0.5).fontSize(13).fillColor("#06245a").text(title);
  doc.moveDown(0.25);
  doc.fontSize(9).fillColor("#1f2a3d");
  for (const line of lines) {
    if (line === null || line === undefined) {
      continue;
    }
    doc.text(String(line), { width: 500 });
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
      doc.moveDown(0.35).fontSize(10).fillColor("#06245a").text(section.title);
      doc.fontSize(8.5).fillColor("#1f2a3d");
      for (const [key, value] of Object.entries(section.values)) {
        doc.text(`${key}: ${value || "Pendiente"}`, { width: 500 });
      }
    }

    addSection(doc, "Partes capturadas del SAQ", []);
    for (const section of input.captureSections) {
      doc.moveDown(0.35).fontSize(10).fillColor("#06245a").text(section.title);
      doc.fontSize(8.5).fillColor("#1f2a3d");
      for (const [key, value] of Object.entries(section.values)) {
        doc.text(`${key}: ${value || "Pendiente"}`, { width: 500 });
      }
    }

    addSection(doc, "Requisitos y respuestas", []);
    for (const requirement of input.requirements) {
      doc.moveDown(0.35).fontSize(9.5).fillColor("#06245a").text(`${requirement.code} - ${requirement.answerValue ?? "Sin respuesta"}`);
      doc.fontSize(8).fillColor("#1f2a3d").text(requirement.description, { width: 500 });
      if (requirement.testingProcedures) {
        doc.fontSize(8).fillColor("#52627a").text(`Procedimientos de prueba: ${requirement.testingProcedures}`, { width: 500 });
      }
      if (requirement.explanation) {
        doc.fontSize(8).fillColor("#52627a").text(`Explicacion/Anexo: ${requirement.explanation}`, { width: 500 });
      }
      if (requirement.resolutionDate) {
        doc.fontSize(8).fillColor("#52627a").text(`Fecha de resolucion: ${formatDate(requirement.resolutionDate)}`);
      }
    }

    for (const annex of input.annexes) {
      addSection(doc, annex.title, []);
      if (annex.entries.length === 0) {
        doc.fontSize(8.5).fillColor("#52627a").text("Sin entradas para este anexo.");
        continue;
      }
      for (const entry of annex.entries) {
        doc.moveDown(0.35).fontSize(9).fillColor("#06245a").text(entry.title);
        doc.fontSize(8).fillColor("#1f2a3d");
        for (const line of entry.lines) {
          if (line) {
            doc.text(String(line), { width: 500 });
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
    doc.fontSize(14).fillColor("#1f2a3d").text("Se reconoce la finalizacion del proceso de certificacion en la plataforma PCI Nexus.", {
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

export function generateAocStubPdf(input: AocPdfInput) {
  return createPdfBuffer((doc) => {
    addTitle(doc, "AOC - resumen generado", `${input.saqTypeName} | Ciclo ${input.cycleYear}`);
    addSection(doc, "Atestacion de cumplimiento", [
      "Resumen de atestacion generado por PCI Nexus con base en la informacion capturada durante el proceso de certificacion.",
      "El documento consolida los datos principales del comerciante, SAQ asignado, fecha de emision y vigencia.",
    ]);
    addSection(doc, "Datos del AOC", [
      `Empresa: ${input.companyName}`,
      `SAQ: ${input.saqTypeName}`,
      `Ciclo: ${input.cycleYear}`,
      `Fecha de emision: ${formatDate(input.issueDate)}`,
      `Vigencia: ${formatDate(input.validUntil)}`,
    ]);
  });
}
