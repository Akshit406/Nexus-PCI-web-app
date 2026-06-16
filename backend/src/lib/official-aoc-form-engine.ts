import { createHash } from "node:crypto";
import { AnswerValue } from "@prisma/client";
import PizZip from "pizzip";
import { convertOfficeBufferToPdf, readTemplate } from "./doc-template-engine";
import {
  getOfficialAocFieldManifest,
  getOfficialAocTemplateConfig,
  OfficialAocFieldManifest,
  RowRange,
} from "./official-aoc-field-map";
import {
  assertWellFormedDocumentXml,
  checkboxFieldsIn,
  extractLegacyFields,
  LegacyField,
  replaceFieldRanges,
  setCheckboxField,
  setTextField,
  visibleText,
} from "./official-saq-form-engine";
import { AocPdfInput } from "./pdf-generators";

const TABLE_ROW_PATTERN = /<w:tr\b[\s\S]*?<\/w:tr>/g;

function normalizeText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function getCaptureSection(input: AocPdfInput, id: string) {
  return input.captureSections.find((section) => section.id === id)?.values ?? {};
}

function findValue(values: Record<string, string>, labelIncludes: string) {
  const needle = labelIncludes.toLowerCase();
  return Object.entries(values).find(([label]) => label.toLowerCase().includes(needle))?.[1] ?? "";
}

function yesNo(value: string) {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return null;
  if (normalized === "si" || normalized === "sí" || normalized === "yes") return true;
  if (normalized === "no") return false;
  return null;
}

function optionalValue(value: string | null | undefined, fallback = "") {
  const text = normalizeText(value ?? "");
  return text || fallback;
}

function formatDate(value?: Date | string | null) {
  if (!value) {
    return "";
  }
  return new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value));
}

function blankValues(count: number) {
  return Array.from({ length: count }, () => "");
}

function manifestFor(input: AocPdfInput) {
  const manifest = getOfficialAocFieldManifest(input.saqTypeCode);
  if (!manifest) {
    throw new Error(`No official AOC field manifest is configured for ${input.saqTypeCode ?? "unknown SAQ"}.`);
  }
  return manifest;
}

function setIndex(values: Map<number, string>, index: number | undefined, value: string | null | undefined) {
  if (index === undefined) {
    return;
  }
  values.set(index, value ?? "");
}

function setRowValues(values: Map<number, string>, range: RowRange | undefined, row: number, rowValues: Array<string | null | undefined>) {
  if (!range || row > range.rows) {
    return;
  }
  for (let column = 0; column < Math.min(range.columns, rowValues.length); column += 1) {
    setIndex(values, range.start + (row - 1) * range.columns + column, rowValues[column]);
  }
}

function setContactFields(values: Map<number, string>, input: AocPdfInput) {
  setIndex(values, 0, input.companyName);
  setIndex(values, 1, input.dbaName ?? input.companyName);
  setIndex(values, 2, input.postalAddress);
  setIndex(values, 3, input.website);
  setIndex(values, 4, input.contactName ?? input.companyName);
  setIndex(values, 5, input.contactTitle);
  setIndex(values, 6, input.contactPhone);
  setIndex(values, 7, input.contactEmail);
  setIndex(values, 8, input.assessor?.isaName);
  setIndex(values, 9, input.assessor?.qsaCompany);
  setIndex(values, 10, "");
  setIndex(values, 11, "");
  setIndex(values, 12, input.assessor?.qsaLeadName);
  setIndex(values, 13, "");
  setIndex(values, 14, "");
  setIndex(values, 15, "");
}

function setSection3Fields(values: Map<number, string>, input: AocPdfInput, manifest: OfficialAocFieldManifest) {
  const start = manifest.section3.start;
  const assessmentDate = formatDate(input.assessmentCompletionDate ?? input.issueDate);
  setIndex(values, start, assessmentDate);
  setIndex(values, start + 1, assessmentDate);
  setIndex(values, start + 2, input.companyName);
  setIndex(values, start + 3, input.companyName);
  setIndex(values, start + 4, input.complianceDeadline ? formatDate(input.complianceDeadline) : "");
  setIndex(values, start + 5, input.companyName);

  for (let row = 0; row < 3; row += 1) {
    const legalRow = input.legalExceptionRows?.[row];
    setIndex(values, start + 6 + row * 2, legalRow?.requirement ?? "");
    setIndex(values, start + 7 + row * 2, legalRow?.restriction ?? "");
  }

  setIndex(values, start + 12, formatDate(input.merchantSignatory?.date ?? input.issueDate));
  setIndex(values, start + 13, optionalValue(input.merchantSignatory?.name ?? input.contactName, input.companyName));
  setIndex(values, start + 14, optionalValue(input.merchantSignatory?.title ?? input.contactTitle, ""));
  setIndex(values, start + 15, "");
  setIndex(values, start + 16, "");
  setIndex(values, start + 17, optionalValue(input.assessor?.qsaLeadName, ""));
  setIndex(values, start + 18, "");
  setIndex(values, start + 19, "");
  setIndex(values, start + 20, optionalValue(input.assessor?.qsaCompany, ""));
  setIndex(values, start + 21, "");

  for (const [index, requirement] of manifest.section3.part4Requirements.entries()) {
    const item = input.notImplementedRequirements?.find((row) => row.code === requirement || row.code.startsWith(`${requirement}.`));
    setIndex(values, start + 22 + index, item ? `${item.resolutionDate ? formatDate(item.resolutionDate) : ""} ${item.explanation ?? ""}`.trim() : "");
  }
}

function textFieldValues(input: AocPdfInput) {
  const manifest = manifestFor(input);
  const part2a = getCaptureSection(input, "part-2a-payment-channels");
  const part2b = getCaptureSection(input, "part-2b-cardholder-function");
  const part2c = getCaptureSection(input, "part-2c-cardholder-environment");
  const part2d = getCaptureSection(input, "part-2d-scope-facilities");
  const products = getCaptureSection(input, "part-2e-validated-products");
  const p2pe = getCaptureSection(input, "part-2e-p2pe-solution");
  const providers = getCaptureSection(input, "part-2f-service-providers");
  const values = new Map<number, string>();

  setContactFields(values, input);
  setIndex(values, manifest.excludedChannelReason, findValue(part2a, "reason"));
  setIndex(values, manifest.excludedChannelReason, findValue(part2a, "motivo de exclusion") || values.get(manifest.excludedChannelReason ?? -1) || "");

  const serviceFields = manifest.serviceProviderFields;
  if (serviceFields) {
    setIndex(values, serviceFields.services, findValue(part2a, "Servicios evaluados"));
    setIndex(values, serviceFields.service1, findValue(part2a, "Servicio 1"));
    setIndex(values, serviceFields.service2, findValue(part2a, "Servicio 2"));
    setIndex(values, serviceFields.service3, findValue(part2a, "Servicio 3"));
    setIndex(values, serviceFields.serviceOther, findValue(part2a, "Otros"));
    setIndex(values, serviceFields.serviceExcludedReason, findValue(part2a, "motivo"));
    setIndex(values, serviceFields.storesProcessesTransmits, findValue(part2b, "almacena"));
    setIndex(values, serviceFields.securityInfluence, findValue(part2b, "influir"));
    setIndex(values, serviceFields.components, findValue(part2b, "componentes"));
  }

  for (let row = 1; row <= 3; row += 1) {
    setRowValues(values, manifest.cardFunctionRows, row, [
      findValue(part2b, `Fila ${row} - Canal`),
      findValue(part2b, `Fila ${row} - Como`),
    ]);
  }

  setIndex(values, manifest.environmentDescription, findValue(part2c, "Descripcion de alto nivel"));

  for (let row = 1; row <= 26; row += 1) {
    setRowValues(values, manifest.facilitiesRows, row, [
      findValue(part2d, `Fila ${row} - Tipo`),
      findValue(part2d, `Fila ${row} - Numero`),
      findValue(part2d, `Fila ${row} - Ubicacion`),
    ]);
  }

  for (let row = 1; row <= 11; row += 1) {
    setRowValues(values, manifest.productsRows, row, [
      findValue(products, `Fila ${row} - Nombre`),
      findValue(products, `Fila ${row} - Version`),
      findValue(products, `Fila ${row} - Estandar`),
      findValue(products, `Fila ${row} - Numero`),
      findValue(products, `Fila ${row} - Fecha`),
    ]);
  }

  const solutionFields = manifest.p2peSolutionFields;
  setIndex(values, solutionFields?.name, findValue(p2pe, "Nombre"));
  setIndex(values, solutionFields?.provider, findValue(p2pe, "Proveedor"));
  setIndex(values, solutionFields?.version, findValue(p2pe, "Version"));
  setIndex(values, solutionFields?.reference, findValue(p2pe, "referencia"));
  setIndex(values, solutionFields?.expiration, findValue(p2pe, "expiracion"));
  setIndex(values, solutionFields?.description, findValue(p2pe, "Descripcion"));

  for (let row = 1; row <= 10; row += 1) {
    setRowValues(values, manifest.providersRows, row, [
      findValue(providers, `Fila ${row} - Nombre`),
      findValue(providers, `Fila ${row} - Descripcion`),
    ]);
  }

  setSection3Fields(values, input, manifest);
  return values;
}

function fillTextFields(documentXml: string, values: Map<number, string>) {
  const replacements = extractLegacyFields(documentXml)
    .filter((field) => field.kind === "text")
    .map((field) => {
      const value = values.get(field.index) ?? "";
      return { field, xml: setTextField(field.xml, value) };
    });
  return replaceFieldRanges(documentXml, replacements);
}

function setCheckboxesByOrder(xml: string, checks: boolean[]) {
  const replacements = checkboxFieldsIn(xml).map((field, index) => ({
    field,
    xml: setCheckboxField(field.xml, checks[index] ?? false),
  }));
  return replaceFieldRanges(xml, replacements);
}

function fillCheckboxFields(documentXml: string, getChecked: (field: LegacyField, checkboxIndex: number) => boolean | null) {
  let checkboxIndex = 0;
  const replacements = extractLegacyFields(documentXml)
    .filter((field) => field.kind === "checkbox")
    .flatMap((field) => {
      const checked = getChecked(field, checkboxIndex);
      checkboxIndex += 1;
      return checked === null ? [] : [{ field, xml: setCheckboxField(field.xml, checked) }];
    });
  return replaceFieldRanges(documentXml, replacements);
}

function fieldContext(documentXml: string, field: LegacyField) {
  const rowStart = documentXml.lastIndexOf("<w:tr", field.start);
  const rowEnd = documentXml.indexOf("</w:tr>", field.end);
  if (rowStart >= 0 && rowEnd >= 0) {
    return visibleText(documentXml.slice(rowStart, rowEnd + "</w:tr>".length));
  }
  return visibleText(documentXml.slice(Math.max(0, field.start - 700), Math.min(documentXml.length, field.end + 700)));
}

function answerColumn(answer: string | null | undefined, supportsNotTested: boolean) {
  switch (answer) {
    case AnswerValue.IMPLEMENTED:
      return 0;
    case AnswerValue.CCW:
      return 1;
    case AnswerValue.NOT_APPLICABLE:
      return 2;
    case AnswerValue.NOT_TESTED:
      return supportsNotTested ? 3 : -1;
    case AnswerValue.NOT_IMPLEMENTED:
      return supportsNotTested ? 4 : 3;
    default:
      return -1;
  }
}

function summaryChecksForRequirement(input: AocPdfInput, majorRequirement: string, checkboxCount: number, supportsNotTested: boolean) {
  const answers = input.requirements.filter(
    (requirement) => requirement.code === majorRequirement || requirement.code.startsWith(`${majorRequirement}.`),
  );
  const checks = Array.from({ length: checkboxCount }, () => false);
  for (const answer of answers) {
    const column = answerColumn(answer.answerValue, supportsNotTested);
    if (column >= 0 && column < checks.length) {
      checks[column] = true;
    }
  }
  return checks;
}

function fillRequirementSummaryRows(documentXml: string, input: AocPdfInput, supportsNotTested: boolean) {
  return documentXml.replace(TABLE_ROW_PATTERN, (rowXml) => {
    const text = visibleText(rowXml);
    const match = text.match(/^Requirement\s+([A0-9]+)\s*:?/i);
    if (!match) {
      return rowXml;
    }
    const checkboxCount = checkboxFieldsIn(rowXml).length;
    if (checkboxCount < 4) {
      return rowXml;
    }
    const checks = summaryChecksForRequirement(input, match[1], checkboxCount, supportsNotTested);
    return checks.some(Boolean) ? setCheckboxesByOrder(rowXml, checks) : rowXml;
  });
}

function fillPart4Rows(documentXml: string, input: AocPdfInput) {
  const manifest = manifestFor(input);
  return documentXml.replace(TABLE_ROW_PATTERN, (rowXml) => {
    const checkboxCount = checkboxFieldsIn(rowXml).length;
    if (checkboxCount !== 2) {
      return rowXml;
    }
    const text = visibleText(rowXml);
    const requirement = manifest.section3.part4Requirements.find((item) => new RegExp(`^${item}(\\s|$)`).test(text));
    if (!requirement) {
      return rowXml;
    }
    const hasNotImplemented = input.notImplementedRequirements?.some(
      (item) => item.code === requirement || item.code.startsWith(`${requirement}.`),
    );
    return setCheckboxesByOrder(rowXml, [!hasNotImplemented, Boolean(hasNotImplemented)]);
  });
}

function fillKnownCheckboxes(documentXml: string, input: AocPdfInput) {
  const manifest = manifestFor(input);
  const checkboxFields = manifest.checkboxFields;
  const part2a = getCaptureSection(input, "part-2a-payment-channels");
  const part2c = getCaptureSection(input, "part-2c-cardholder-environment");
  const products = getCaptureSection(input, "part-2e-validated-products");
  const providers = getCaptureSection(input, "part-2f-service-providers");
  const section3 = getCaptureSection(input, "section-3-validation-certification");
  const recognition = getCaptureSection(input, "section-3a-merchant-recognition");
  const eligibility = getCaptureSection(input, "part-2h-saq-eligibility");

  const includedChannels = findValue(part2a, "Canales de pago").toLowerCase();
  const excluded = yesNo(findValue(part2a, "Hay algun canal"));
  const segmented = yesNo(findValue(part2c, "segmentacion"));
  const usesProducts = yesNo(findValue(products, "Utiliza el comerciante"));
  const storesProcesses = yesNo(findValue(providers, "Almacenan"));
  const managesComponents = yesNo(findValue(providers, "Gestionan"));
  const affectsSecurity = yesNo(findValue(providers, "Podrian"));
  const legalException = yesNo(findValue(section3, "Conforme"));
  const acknowledgements = findValue(recognition, "Confirmaciones").toLowerCase();
  const hasEligibilityConfirmation = Boolean(findValue(eligibility, "Criterios de elegibilidad"));
  const conformity = input.validationStatus ?? null;

  return fillCheckboxFields(documentXml, (field, checkboxIndex) => {
    let checked: boolean | null = null;

    if (checkboxIndex === checkboxFields?.channels?.moto) checked = includedChannels.includes("moto") || includedChannels.includes("correo");
    if (checkboxIndex === checkboxFields?.channels?.ecommerce) checked = includedChannels.includes("electronico") || includedChannels.includes("electr");
    if (checkboxIndex === checkboxFields?.channels?.present) checked = includedChannels.includes("presencial");
    if (checkboxIndex === checkboxFields?.excludedChannel?.[0] && excluded !== null) checked = excluded;
    if (checkboxIndex === checkboxFields?.excludedChannel?.[1] && excluded !== null) checked = !excluded;
    if (checkboxIndex === checkboxFields?.segmentation?.[0] && segmented !== null) checked = segmented;
    if (checkboxIndex === checkboxFields?.segmentation?.[1] && segmented !== null) checked = !segmented;
    if (checkboxIndex === checkboxFields?.products?.[0] && usesProducts !== null) checked = usesProducts;
    if (checkboxIndex === checkboxFields?.products?.[1] && usesProducts !== null) checked = !usesProducts;
    if (checkboxIndex === checkboxFields?.providers?.storesProcessesTransmits?.[0] && storesProcesses !== null) checked = storesProcesses;
    if (checkboxIndex === checkboxFields?.providers?.storesProcessesTransmits?.[1] && storesProcesses !== null) checked = !storesProcesses;
    if (checkboxIndex === checkboxFields?.providers?.managesComponents?.[0] && managesComponents !== null) checked = managesComponents;
    if (checkboxIndex === checkboxFields?.providers?.managesComponents?.[1] && managesComponents !== null) checked = !managesComponents;
    if (checkboxIndex === checkboxFields?.providers?.affectsSecurity?.[0] && affectsSecurity !== null) checked = affectsSecurity;
    if (checkboxIndex === checkboxFields?.providers?.affectsSecurity?.[1] && affectsSecurity !== null) checked = !affectsSecurity;

    const context = fieldContext(documentXml, field);
    if (
      hasEligibilityConfirmation &&
      (context.includes("Merchant confirms eligibility") ||
        context.includes("eligible to use") ||
        context.includes("merchant accepts") ||
        context.includes("does not store") ||
        context.includes("All payment processing") ||
        context.includes("validated PCI-listed") ||
        context.includes("SPoC solution") ||
        context.includes("P2PE Instruction Manual"))
    ) {
      checked = true;
    }

    if (context.includes("Were any requirements") && context.includes("legal constraint")) {
      checked = context.includes("Yes") ? conformity === "LEGAL_EXCEPTION" || legalException === true : conformity !== "LEGAL_EXCEPTION" && legalException !== true;
    }
    if (context.includes("Compliant: All sections")) checked = conformity === "CONFORMING";
    if (context.includes("Non-Compliant: Not all sections")) checked = conformity === "NON_CONFORMING";
    if (context.includes("Compliant but with Legal exception")) checked = conformity === "LEGAL_EXCEPTION";
    if (context.includes("has read this document") || context.includes("results of the assessment")) {
      checked = acknowledgements.includes("representa") || acknowledgements.includes("completed") || acknowledgements.includes("completado");
    }
    if (context.includes("PCI DSS controls will be maintained") || context.includes("will be maintained")) {
      checked = acknowledgements.includes("mantendran") || acknowledgements.includes("mantendr") || acknowledgements.includes("maintained");
    }

    return checked;
  });
}

function assertTemplateShape(documentXml: string, input: AocPdfInput, templateBuffer: Buffer) {
  const config = getOfficialAocTemplateConfig(input.saqTypeCode);
  if (!config) {
    throw new Error(`No official AOC template is configured for ${input.saqTypeCode ?? "unknown SAQ"}.`);
  }

  const actualHash = createHash("sha256").update(templateBuffer).digest("hex");
  if (actualHash !== config.expectedSha256) {
    throw new Error(`Official AOC template hash changed for ${input.saqTypeCode}. Expected ${config.expectedSha256}; found ${actualHash}.`);
  }

  const fields = extractLegacyFields(documentXml);
  const textFields = fields.filter((field) => field.kind === "text").length;
  const checkboxes = fields.filter((field) => field.kind === "checkbox").length;
  if (textFields !== config.expectedTextFields || checkboxes !== config.expectedCheckboxes) {
    throw new Error(
      `Official AOC template shape changed for ${input.saqTypeCode}. Expected ${config.expectedTextFields} text fields and ${config.expectedCheckboxes} checkboxes; found ${textFields} text fields and ${checkboxes} checkboxes.`,
    );
  }
}

function assertFilledDocxIsValid(buffer: Buffer, templateName: string) {
  const zip = new PizZip(buffer);
  const document = zip.file("word/document.xml");
  if (!document) {
    throw new Error(`Filled official AOC ${templateName} is missing word/document.xml.`);
  }
  assertWellFormedDocumentXml(document.asText(), `filled ${templateName} word/document.xml`);
}

export async function fillOfficialAocDocx(input: AocPdfInput): Promise<Buffer> {
  const config = getOfficialAocTemplateConfig(input.saqTypeCode);
  if (!config) {
    throw new Error(`No official AOC template is configured for ${input.saqTypeCode ?? "unknown SAQ"}.`);
  }

  const template = await readTemplate(config.template);
  const zip = new PizZip(template);
  const document = zip.file("word/document.xml");
  if (!document) {
    throw new Error(`Official AOC template ${config.template} is missing word/document.xml.`);
  }

  let documentXml = document.asText();
  assertWellFormedDocumentXml(documentXml, `${config.template} word/document.xml`);
  assertTemplateShape(documentXml, input, template);
  documentXml = fillTextFields(documentXml, textFieldValues(input));
  documentXml = fillKnownCheckboxes(documentXml, input);
  documentXml = fillRequirementSummaryRows(documentXml, input, config.supportsNotTested || Boolean(input.supportsNotTested));
  documentXml = fillPart4Rows(documentXml, input);
  assertWellFormedDocumentXml(documentXml, `filled ${config.template} word/document.xml`);
  zip.file("word/document.xml", documentXml);
  const filled = zip.generate({ type: "nodebuffer", compression: "DEFLATE" }) as Buffer;
  assertFilledDocxIsValid(filled, config.template);
  return filled;
}

export async function renderOfficialAocPdf(input: AocPdfInput): Promise<Buffer> {
  const filledDocx = await fillOfficialAocDocx(input);
  return convertOfficeBufferToPdf(filledDocx, "docx");
}

export function buildBlankAocInput(saqTypeCode: string, supportsNotTested: boolean): AocPdfInput {
  const now = new Date("2026-06-15T00:00:00.000Z");
  return {
    companyName: "Audit Company",
    dbaName: "Audit DBA",
    website: "https://audit.example.com",
    contactName: "Audit Contact",
    contactTitle: "PCI Owner",
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
    captureSections: [],
    requirements: [{ code: "12", description: "Sample requirement", answerValue: "IMPLEMENTED" }],
    annexes: [],
    validationStatus: "CONFORMING",
    merchantSignatory: { name: "Audit Contact", title: "PCI Owner", date: now },
  };
}
