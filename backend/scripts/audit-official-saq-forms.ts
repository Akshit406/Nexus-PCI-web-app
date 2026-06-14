import "dotenv/config";
import { assertWellFormedDocumentXml, extractLegacyFields, fillOfficialSaqDocx } from "../src/lib/official-saq-form-engine";
import { listOfficialSaqTemplateConfigs } from "../src/lib/official-saq-field-map";
import { readTemplate } from "../src/lib/doc-template-engine";
import PizZip from "pizzip";
import { SaqPdfInput } from "../src/lib/pdf-generators";

function sampleInput(saqTypeCode: string, supportsNotTested: boolean): SaqPdfInput {
  const now = new Date("2026-06-15T00:00:00.000Z");
  return {
    companyName: "Audit Company",
    businessType: "Comercio de prueba",
    dbaName: "Audit DBA",
    contactName: "Audit Contact",
    contactTitle: "Responsable PCI",
    contactPhone: "+34 000 000 000",
    contactEmail: "audit@example.com",
    postalAddress: "Audit address",
    saqTypeName: `SAQ ${saqTypeCode}`,
    saqTypeCode,
    cycleYear: 2026,
    generatedAt: now,
    issueDate: now,
    validUntil: now,
    assessmentCompletionDate: now,
    paymentState: "PAID",
    signaturePresent: true,
    supportsNotTested,
    systemSections: [],
    captureSections: [
      {
        id: "part-2a-payment-channels",
        title: "Parte 2a",
        values: {
          "Canales de pago utilizados por la empresa que se incluyen en esta Evaluacion": "Comercio electronico",
          "Hay algun canal de pago que no este incluido en esta evaluacion?": "No",
        },
      },
      {
        id: "section-3a-merchant-recognition",
        title: "Seccion 3a",
        values: {
          "Confirmaciones del comerciante": "El SAQ fue completado de acuerdo; representa fielmente; mantendran",
        },
      },
    ],
    requirements: [
      {
        code: "11.3.2",
        description: "Sample requirement",
        answerValue: "IMPLEMENTED",
        topicCode: "11",
        topicName: "Sample topic",
      },
    ],
    annexes: [],
    validationStatus: "CONFORMING",
    validationStatusText: "Sample conforming status",
    merchantSignatory: {
      name: "Audit Contact",
      title: "Responsable PCI",
      date: now,
    },
  };
}

async function main() {
  const rows: Array<{
    code: string;
    template: string;
    textFields: number;
    expectedTextFields: number;
    checkboxes: number;
    expectedCheckboxes: number;
    ok: boolean;
  }> = [];

  for (const config of listOfficialSaqTemplateConfigs()) {
    const template = await readTemplate(config.template);
    const zip = new PizZip(template);
    const document = zip.file("word/document.xml");
    if (!document) {
      throw new Error(`${config.template} is missing word/document.xml`);
    }

    const documentXml = document.asText();
    assertWellFormedDocumentXml(documentXml, `${config.template} word/document.xml`);
    const fields = extractLegacyFields(documentXml);
    const textFields = fields.filter((field) => field.kind === "text").length;
    const checkboxes = fields.filter((field) => field.kind === "checkbox").length;
    const filled = await fillOfficialSaqDocx(sampleInput(config.code, config.supportsNotTested));
    const filledZip = new PizZip(filled);
    const filledDocument = filledZip.file("word/document.xml");
    if (!filledDocument) {
      throw new Error(`Filled ${config.template} is missing word/document.xml`);
    }
    assertWellFormedDocumentXml(filledDocument.asText(), `filled ${config.template} word/document.xml`);
    rows.push({
      code: config.code,
      template: config.template,
      textFields,
      expectedTextFields: config.expectedTextFields,
      checkboxes,
      expectedCheckboxes: config.expectedCheckboxes,
      ok: textFields === config.expectedTextFields && checkboxes === config.expectedCheckboxes,
    });
  }

  console.table(rows);
  const failed = rows.filter((row) => !row.ok);
  if (failed.length > 0) {
    throw new Error(`Official SAQ form audit failed for: ${failed.map((row) => row.code).join(", ")}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
