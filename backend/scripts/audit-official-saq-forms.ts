import "dotenv/config";
import { createHash } from "node:crypto";
import {
  assertWellFormedDocumentXml,
  extractLegacyFields,
  fillOfficialSaqDocx,
  getOfficialSaqFieldManifest,
} from "../src/lib/official-saq-form-engine";
import { listOfficialSaqTemplateConfigs } from "../src/lib/official-saq-field-map";
import { fillOfficialAocDocx } from "../src/lib/official-aoc-form-engine";
import { listOfficialAocTemplateConfigs } from "../src/lib/official-aoc-field-map";
import { getSaqCaptureSections, getSaqSectionPlan } from "../src/lib/saq-sections";
import { CURRENT_SAQ_CAPTURE_SCHEMA_VERSION, buildSaqQuestionnaireCompletion } from "../src/lib/saq-completion";
import { readTemplate } from "../src/lib/doc-template-engine";
import PizZip from "pizzip";
import { SaqPdfInput } from "../src/lib/pdf-generators";
import { AnswerValue } from "@prisma/client";

function sampleInput(saqTypeCode: string, supportsNotTested: boolean): SaqPdfInput {
  const now = new Date("2026-06-15T00:00:00.000Z");
  const suffix = saqTypeCode.replace(/[^A-Za-z0-9]/g, "");
  return {
    companyName: `Audit Company ${suffix}`,
    businessType: "Comercio de prueba",
    dbaName: `Audit DBA ${suffix}`,
    website: `https://audit-${suffix.toLowerCase()}.example.com`,
    contactName: `Audit Contact ${suffix}`,
    contactTitle: `Responsable PCI ${suffix}`,
    contactPhone: `+34 000 000 ${suffix.length}`,
    contactEmail: `audit-${suffix.toLowerCase()}@example.com`,
    postalAddress: `Audit address ${suffix}`,
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
          "Canales de pago utilizados por la empresa que se incluyen en esta Evaluacion": "Comercio electronico, Presencial, Pedido por correo / por telefono (MOTO)",
          "Hay algun canal de pago que no este incluido en esta evaluacion?": "No",
          "Servicios evaluados": `Audit services ${suffix}`,
          "Servicio 1": `Audit service 1 ${suffix}`,
          "Servicio 2": `Audit service 2 ${suffix}`,
          "Servicio 3": `Audit service 3 ${suffix}`,
          "Otros": `Audit other service ${suffix}`,
        },
      },
      {
        id: "part-2b-cardholder-function",
        title: "Parte 2b",
        values: {
          "Fila 1 - Canal": `Audit channel ${suffix}`,
          "Fila 1 - Como la empresa almacena, procesa y/o transmite los datos del titular de la tarjeta": `Audit card function ${suffix}`,
          "Describe cómo la empresa almacena, procesa y/o transmite los datos del titular de la tarjeta": `Audit card function ${suffix}`,
          "Describe cómo la empresa participa o tiene la capacidad de influir en la seguridad de los datos del titular de la tarjeta": `Audit influence ${suffix}`,
        },
      },
      {
        id: "part-2c-cardholder-environment",
        title: "Parte 2c",
        values: {
          "Descripcion de alto nivel del entorno": `Audit environment ${suffix}`,
          "El entorno incluye segmentacion para reducir el alcance?": "No",
        },
      },
      {
        id: "part-2d-scope-facilities",
        title: "Parte 2d",
        values: {
          "Fila 1 - Tipo de instalacion": `Audit facility ${suffix}`,
          "Fila 1 - Numero total de instalaciones": "1",
          "Fila 1 - Ubicacion(es) de las instalaciones": `Audit city ${suffix}`,
        },
      },
      {
        id: "part-2e-validated-products",
        title: "Parte 2e",
        values: {
          "Utiliza el comerciante algun elemento identificado en alguna de las listas de Productos y Soluciones Validados por PCI SSC?": "No",
          "Fila 1 - Nombre del producto o solucion validado por PCI SSC": `Audit product ${suffix}`,
          "Fila 1 - Version del producto o solucion": "1.0",
          "Fila 1 - Estandar PCI SSC segun el cual se valido": `Audit standard ${suffix}`,
          "Fila 1 - Numero de referencia de la lista PCI SSC": `AUD-${suffix}`,
          "Fila 1 - Fecha de expiracion de la lista": "2026-12-31",
        },
      },
      {
        id: "part-2e-p2pe-solution",
        title: "Parte 2e P2PE",
        values: {
          "Nombre de la solucion": `Audit solution ${suffix}`,
          Proveedor: `Audit provider ${suffix}`,
          Version: "1.0",
          "Numero de referencia": `AUD-P2PE-${suffix}`,
          "Fecha de expiracion": "2026-12-31",
          "Descripcion de uso": `Audit solution use ${suffix}`,
        },
      },
      {
        id: "part-2f-service-providers",
        title: "Parte 2f",
        values: {
          "Almacenan, procesan o transmiten datos del titular de la tarjeta en nombre del comerciante?": "No",
          "Gestionan componentes del sistema incluidos en el ambito de la evaluacion PCI DSS del comerciante?": "No",
          "Podrian afectar la seguridad del CDE del comerciante?": "No",
          "Fila 1 - Nombre": `Audit TPSP ${suffix}`,
          "Fila 1 - Descripcion": `Audit TPSP service ${suffix}`,
        },
      },
      {
        id: "part-2h-saq-eligibility",
        title: "Parte 2h",
        values: {
          "Criterios de elegibilidad confirmados": "Confirmado",
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
      name: `Audit Contact ${suffix}`,
      title: `Responsable PCI ${suffix}`,
      date: now,
    },
  };
}

const TEXT_PATTERN = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g;

function visibleText(xml: string) {
  return Array.from(xml.matchAll(TEXT_PATTERN), (match) => match[1] ?? "")
    .join(" ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function expectFieldValue(textFields: ReturnType<typeof extractLegacyFields>, index: number | undefined, expected: string, label: string) {
  if (index === undefined) {
    return;
  }
  const field = textFields.find((item) => item.kind === "text" && item.index === index);
  const actual = field ? visibleText(field.xml) : "";
  if (actual !== expected) {
    throw new Error(`${label} expected "${expected}" at text field ${index}, found "${actual}"`);
  }
}

function expectCheckedCheckbox(documentXml: string, labelIncludes: string, label: string) {
  const checkboxes = extractLegacyFields(documentXml).filter((field) => field.kind === "checkbox");
  const field = checkboxes.find((candidate) => {
    const start = documentXml.lastIndexOf("<w:tr", candidate.start);
    const end = documentXml.indexOf("</w:tr>", candidate.end);
    const context = start >= 0 && end >= 0 ? visibleText(documentXml.slice(start, end + "</w:tr>".length)) : visibleText(candidate.xml);
    return context.includes(labelIncludes);
  });
  if (!field || !/<w:checked\b/.test(field.xml)) {
    throw new Error(`${label} checkbox containing "${labelIncludes}" was not checked`);
  }
}

function verifySemanticMapping(saqTypeCode: string, documentXml: string) {
  const suffix = saqTypeCode.replace(/[^A-Za-z0-9]/g, "");
  const manifest = getOfficialSaqFieldManifest(saqTypeCode);
  if (!manifest) {
    throw new Error(`No manifest for ${saqTypeCode}`);
  }
  const textFields = extractLegacyFields(documentXml).filter((field) => field.kind === "text");
  const contact = manifest.contactFields ?? {};
  expectFieldValue(textFields, contact.company, `Audit Company ${suffix}`, `${saqTypeCode} company`);
  expectFieldValue(textFields, contact.dba, `Audit DBA ${suffix}`, `${saqTypeCode} DBA`);
  expectFieldValue(textFields, contact.postal, `Audit address ${suffix}`, `${saqTypeCode} postal`);
  expectFieldValue(textFields, contact.website, `https://audit-${suffix.toLowerCase()}.example.com`, `${saqTypeCode} website`);
  expectFieldValue(textFields, contact.contactName, `Audit Contact ${suffix}`, `${saqTypeCode} contact name`);
  expectFieldValue(textFields, contact.contactTitle, `Responsable PCI ${suffix}`, `${saqTypeCode} contact title`);
  expectFieldValue(textFields, contact.contactEmail, `audit-${suffix.toLowerCase()}@example.com`, `${saqTypeCode} contact email`);
  expectFieldValue(textFields, manifest.cardFunctionRows?.start, `Audit channel ${suffix}`, `${saqTypeCode} card channel`);
  expectFieldValue(textFields, manifest.cardFunctionRows ? manifest.cardFunctionRows.start + 1 : undefined, `Audit card function ${suffix}`, `${saqTypeCode} card function`);
  expectFieldValue(textFields, manifest.environmentDescription, `Audit environment ${suffix}`, `${saqTypeCode} environment`);
  expectFieldValue(textFields, manifest.facilitiesRows?.start, `Audit facility ${suffix}`, `${saqTypeCode} facility`);
  expectFieldValue(textFields, manifest.providersRows?.start, `Audit TPSP ${suffix}`, `${saqTypeCode} provider`);
  expectFieldValue(textFields, manifest.providersRows ? manifest.providersRows.start + 1 : undefined, `Audit TPSP service ${suffix}`, `${saqTypeCode} provider service`);
  expectFieldValue(textFields, manifest.productsRows?.start, `Audit product ${suffix}`, `${saqTypeCode} product`);
  expectFieldValue(textFields, manifest.p2peSolutionFields?.name, `Audit solution ${suffix}`, `${saqTypeCode} solution`);
  expectFieldValue(textFields, manifest.section3.conformingMerchant, `Audit Company ${suffix}`, `${saqTypeCode} section 3 merchant`);
  expectFieldValue(textFields, manifest.section3.merchantName, `Audit Contact ${suffix}`, `${saqTypeCode} signatory name`);
  expectFieldValue(textFields, manifest.section3.merchantTitle, `Responsable PCI ${suffix}`, `${saqTypeCode} signatory title`);
  expectCheckedCheckbox(documentXml, "En Conformidad", `${saqTypeCode} conformity`);
  expectCheckedCheckbox(documentXml, "fielmente", `${saqTypeCode} acknowledgement`);
}

function requiredValueForField(field: { inputType: string; options?: Array<{ value: string }> }) {
  if (field.inputType === "checkbox-group") {
    return JSON.stringify((field.options ?? []).map((option) => option.value));
  }
  if (field.inputType === "radio-group" || field.inputType === "select") {
    return field.options?.[0]?.value ?? "NO";
  }
  if (field.inputType === "number") {
    return "1";
  }
  if (field.inputType === "date") {
    return "2026-12-31";
  }
  return "Audit completion value";
}

function verifyQuestionnaireCompletion(saqTypeCode: string) {
  const mappedRequirements = [
    {
      requirementId: "audit-requirement-1",
      requirement: {
        requirementCode: "1.1",
        description: "Audit requirement",
      },
    },
  ];
  const answers = [
    {
      requirementId: "audit-requirement-1",
      answerValue: AnswerValue.IMPLEMENTED,
      requirement: {
        requirementCode: "1.1",
        description: "Audit requirement",
      },
    },
  ];
  const staleCompletion = buildSaqQuestionnaireCompletion({
    saqTypeCode,
    mappedRequirements,
    answers,
    sectionInputs: [],
  });
  if (staleCompletion.overall.percentage >= 100) {
    throw new Error(`${saqTypeCode} completion should not be 100% without reviewed official sections`);
  }

  const reviewedSectionInputs = getSaqCaptureSections(saqTypeCode).map((section) => {
    const values = Object.fromEntries(
      section.fields.map((field) => [field.key, field.required === false ? "" : requiredValueForField(field)]),
    );
    if (section.id === "part-2b-cardholder-function") {
      values.card_function_1_channel = "Pedido por correo / por telefono (MOTO)";
      values.card_function_1_description = "Audit MOTO flow";
      values.card_function_2_channel = "Comercio electronico";
      values.card_function_2_description = "Audit ecommerce flow";
      values.card_function_3_channel = "Presencial";
      values.card_function_3_description = "Audit card-present flow";
    }
    values.__schemaVersion = CURRENT_SAQ_CAPTURE_SCHEMA_VERSION;
    values.__reviewedAt = "2026-06-15T00:00:00.000Z";
    return {
      sectionId: section.id,
      payloadJson: JSON.stringify(values),
    };
  });
  const reviewedCompletion = buildSaqQuestionnaireCompletion({
    saqTypeCode,
    mappedRequirements,
    answers,
    sectionInputs: reviewedSectionInputs,
  });
  if (reviewedCompletion.overall.percentage !== 100) {
    const blockers = reviewedCompletion.captureSections.flatMap((section) => section.blockerMessages).join(" ");
    throw new Error(`${saqTypeCode} reviewed completion should be 100%, got ${reviewedCompletion.overall.percentage}. ${blockers}`);
  }
}

const PLAN_SECTION_PATTERNS: Array<{ id: string; pattern: RegExp }> = [
  { id: "part-1a-merchant-evaluated", pattern: /Parte\s+1a\./i },
  { id: "part-1b-assessor", pattern: /Parte\s+1b\./i },
  { id: "part-2a-payment-channels", pattern: /Parte\s+2a\./i },
  { id: "part-2b-cardholder-function", pattern: /Parte\s+2b\./i },
  { id: "part-2c-cardholder-environment", pattern: /Parte\s+2c\./i },
  { id: "part-2d-scope-facilities", pattern: /Parte\s+2d\./i },
  { id: "part-2f-service-providers", pattern: /Parte\s+2f\./i },
  { id: "part-2g-assessment-summary", pattern: /Parte\s+2g\./i },
  { id: "part-2h-saq-eligibility", pattern: /Parte\s+2h\./i },
  { id: "part-2-questionnaire", pattern: /Cuestionario(?:\s+[A-Z0-9-]+)?\s+de\s+Auto/i },
  { id: "annex-b-ccw", pattern: /Anexo\s+B:/i },
  { id: "annex-c-not-applicable", pattern: /Anexo\s+C:/i },
  { id: "annex-d-not-tested", pattern: /Anexo\s+D\s*:/i },
  { id: "section-3-validation-certification", pattern: /Parte\s+3\.\s+Validaci/i },
  { id: "section-3a-merchant-recognition", pattern: /Parte\s+3a\./i },
  { id: "section-3b-merchant-declaration", pattern: /Parte\s+3b\./i },
  { id: "section-3c-qsa-declaration", pattern: /Parte\s+3c\./i },
  { id: "section-3d-isa-participation", pattern: /Parte\s+3d\./i },
  { id: "section-4-action-plan", pattern: /Parte\s+4\./i },
];

const CAPTURE_SECTION_IDS = new Set([
  "part-2a-payment-channels",
  "part-2b-cardholder-function",
  "part-2c-cardholder-environment",
  "part-2d-scope-facilities",
  "part-2f-service-providers",
  "part-2g-assessment-summary",
  "part-2h-saq-eligibility",
  "section-3-validation-certification",
  "section-3a-merchant-recognition",
]);

function expectedPart2eCaptureId(saqTypeCode: string, text: string) {
  if (!/Parte\s+2e\./i.test(text)) {
    return null;
  }
  if (["P2PE", "D_P2PE", "SPOC", "SPoC"].includes(saqTypeCode)) {
    return "part-2e-p2pe-solution";
  }
  return "part-2e-validated-products";
}

function verifyQuestionnaireManifestMatchesOfficialSections(saqTypeCode: string, documentXml: string) {
  const text = visibleText(documentXml);
  const expectedPlanIds = PLAN_SECTION_PATTERNS
    .filter((section) => section.pattern.test(text))
    .map((section) => section.id);
  const part2eCaptureId = expectedPart2eCaptureId(saqTypeCode, text);
  if (part2eCaptureId) {
    expectedPlanIds.push(part2eCaptureId);
  }

  const planIds = new Set(getSaqSectionPlan(saqTypeCode).map((section) => section.id));
  const captureIds = new Set(getSaqCaptureSections(saqTypeCode).map((section) => section.id));
  const missingPlanIds = expectedPlanIds.filter((id) => !planIds.has(id));
  const expectedCaptureIds = expectedPlanIds
    .filter((id) => CAPTURE_SECTION_IDS.has(id))
    .concat(part2eCaptureId ? [part2eCaptureId] : []);
  const missingCaptureIds = Array.from(new Set(expectedCaptureIds)).filter((id) => !captureIds.has(id));

  if (missingPlanIds.length > 0 || missingCaptureIds.length > 0) {
    throw new Error(
      `${saqTypeCode} questionnaire manifest does not match official SAQ sections. Missing plan: ${missingPlanIds.join(", ") || "none"}. Missing capture: ${missingCaptureIds.join(", ") || "none"}.`,
    );
  }
}

function assertTemplateHash(buffer: Buffer, expectedSha256: string, label: string) {
  const actual = createHash("sha256").update(buffer).digest("hex");
  if (actual !== expectedSha256) {
    throw new Error(`${label} hash changed. Expected ${expectedSha256}; found ${actual}`);
  }
}

async function main() {
  const rows: Array<{
    kind: string;
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
    assertTemplateHash(template, config.expectedSha256, config.template);
    const zip = new PizZip(template);
    const document = zip.file("word/document.xml");
    if (!document) {
      throw new Error(`${config.template} is missing word/document.xml`);
    }

    const documentXml = document.asText();
    assertWellFormedDocumentXml(documentXml, `${config.template} word/document.xml`);
    verifyQuestionnaireManifestMatchesOfficialSections(config.code, documentXml);
    const fields = extractLegacyFields(documentXml);
    const textFields = fields.filter((field) => field.kind === "text").length;
    const checkboxes = fields.filter((field) => field.kind === "checkbox").length;
    const filled = await fillOfficialSaqDocx(sampleInput(config.code, config.supportsNotTested));
    const filledZip = new PizZip(filled);
    const filledDocument = filledZip.file("word/document.xml");
    if (!filledDocument) {
      throw new Error(`Filled ${config.template} is missing word/document.xml`);
    }
    const filledDocumentXml = filledDocument.asText();
    assertWellFormedDocumentXml(filledDocumentXml, `filled ${config.template} word/document.xml`);
    verifySemanticMapping(config.code, filledDocumentXml);
    verifyQuestionnaireCompletion(config.code);
    rows.push({
      kind: "SAQ",
      code: config.code,
      template: config.template,
      textFields,
      expectedTextFields: config.expectedTextFields,
      checkboxes,
      expectedCheckboxes: config.expectedCheckboxes,
      ok: textFields === config.expectedTextFields && checkboxes === config.expectedCheckboxes,
    });
  }

  for (const config of listOfficialAocTemplateConfigs()) {
    const template = await readTemplate(config.template);
    assertTemplateHash(template, config.expectedSha256, config.template);
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
    const filled = await fillOfficialAocDocx(sampleInput(config.code, config.supportsNotTested));
    const filledZip = new PizZip(filled);
    const filledDocument = filledZip.file("word/document.xml");
    if (!filledDocument) {
      throw new Error(`Filled ${config.template} is missing word/document.xml`);
    }
    assertWellFormedDocumentXml(filledDocument.asText(), `filled ${config.template} word/document.xml`);
    rows.push({
      kind: "AOC",
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
    throw new Error(`Official form audit failed for: ${failed.map((row) => `${row.kind}:${row.code}`).join(", ")}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
