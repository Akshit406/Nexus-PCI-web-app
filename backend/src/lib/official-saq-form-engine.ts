import { AnswerValue } from "@prisma/client";
import { DOMParser } from "@xmldom/xmldom";
import PizZip from "pizzip";
import { convertOfficeBufferToPdf, readTemplate } from "./doc-template-engine";
import { getOfficialSaqTemplateConfig } from "./official-saq-field-map";
import { SaqPdfInput } from "./pdf-generators";

type LegacyFieldKind = "text" | "checkbox";

type LegacyField = {
  index: number;
  kind: LegacyFieldKind;
  xml: string;
  start: number;
  end: number;
};

const TEXT_PATTERN = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g;
const RUN_PATTERN = /<w:r\b[\s\S]*?<\/w:r>/g;
const TABLE_ROW_PATTERN = /<w:tr\b[\s\S]*?<\/w:tr>/g;

function xmlEscape(value: string) {
  return value
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function normalizeText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function visibleText(xml: string) {
  return normalizeText(
    Array.from(xml.matchAll(TEXT_PATTERN), (match) => match[1] ?? "")
      .join(" ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">"),
  );
}

function instructionText(runXml: string) {
  return Array.from(runXml.matchAll(/<w:instrText[^>]*>([\s\S]*?)<\/w:instrText>/g), (item) => item[1] ?? "").join("");
}

function isFieldRun(runXml: string, type: "begin" | "separate" | "end") {
  return new RegExp(`<w:fldChar\\b[^>]*w:fldCharType="${type}"`).test(runXml);
}

export function extractLegacyFields(documentXml: string): LegacyField[] {
  const fields: LegacyField[] = [];
  let textIndex = 0;
  let checkboxIndex = 0;
  let active: { start: number; end: number; xml: string; instrText: string; depth: number } | null = null;

  for (const match of documentXml.matchAll(RUN_PATTERN)) {
    const runXml = match[0];
    const start = match.index ?? 0;
    const end = start + runXml.length;
    const isBegin = isFieldRun(runXml, "begin");
    const isEnd = isFieldRun(runXml, "end");

    if (!active && !isBegin) {
      continue;
    }

    if (!active) {
      active = { start, end, xml: "", instrText: "", depth: 0 };
    }

    active.end = end;
    active.xml += runXml;
    active.instrText += instructionText(runXml);
    if (isBegin) {
      active.depth += 1;
    }
    if (isEnd) {
      active.depth -= 1;
    }

    if (active.depth <= 0) {
      const instruction = normalizeText(active.instrText).replace(/\s+/g, "").toUpperCase();
      if (instruction === "FORMTEXT") {
        fields.push({ index: textIndex, kind: "text", xml: active.xml, start: active.start, end: active.end });
        textIndex += 1;
      } else if (instruction === "FORMCHECKBOX") {
        fields.push({ index: checkboxIndex, kind: "checkbox", xml: active.xml, start: active.start, end: active.end });
        checkboxIndex += 1;
      }
      active = null;
    }
  }

  return fields;
}

function replaceFieldRanges(documentXml: string, replacements: Array<{ field: LegacyField; xml: string }>) {
  return replacements
    .sort((left, right) => right.field.start - left.field.start)
    .reduce((xml, replacement) => {
      return `${xml.slice(0, replacement.field.start)}${replacement.xml}${xml.slice(replacement.field.end)}`;
    }, documentXml);
}

export function assertWellFormedDocumentXml(documentXml: string, label = "word/document.xml") {
  const errors: string[] = [];
  const parser = new DOMParser({
    onError(level, message) {
      if (level !== "warning") {
        errors.push(message);
      }
    },
  });
  const parsed = parser.parseFromString(documentXml, "application/xml");
  const parserErrors = Array.from(parsed.getElementsByTagName("parsererror")).map((node) => node.textContent ?? "");
  if (errors.length > 0 || parserErrors.length > 0) {
    throw new Error(`${label} is not well-formed XML: ${[...errors, ...parserErrors].filter(Boolean).join(" | ")}`);
  }
}

function assertFilledDocxIsValid(buffer: Buffer, templateName: string) {
  const zip = new PizZip(buffer);
  const document = zip.file("word/document.xml");
  if (!document) {
    throw new Error(`Filled official SAQ ${templateName} is missing word/document.xml.`);
  }
  assertWellFormedDocumentXml(document.asText(), `filled ${templateName} word/document.xml`);
}

function setCheckboxField(fieldXml: string, checked: boolean) {
  let xml = fieldXml.replace(
    /<w:default w:val="[01]"\/>/,
    `<w:default w:val="${checked ? "1" : "0"}"/>`,
  );

  xml = xml.replace(/<w:checked(?:\s+w:val="[01]")?\/>/g, "");
  if (checked) {
    xml = xml.replace("</w:checkBox>", '<w:checked w:val="1"/></w:checkBox>');
  }
  return xml;
}

function runPropertiesFor(fieldXml: string) {
  return fieldXml.match(/<w:rPr>[\s\S]*?<\/w:rPr>/)?.[0] ?? "";
}

function setTextField(fieldXml: string, value: string) {
  const text = normalizeText(value);
  if (!text) {
    return fieldXml;
  }

  const separate = fieldXml.match(/<w:r\b[\s\S]*?<w:fldChar\b[^>]*w:fldCharType="separate"[\s\S]*?<\/w:r>/);
  const runs = Array.from(fieldXml.matchAll(RUN_PATTERN));
  const endRun = runs[runs.length - 1];
  const endIndex = endRun?.index ?? -1;
  if (!separate || endIndex < 0 || separate.index === undefined || separate.index >= endIndex) {
    return fieldXml;
  }

  const beforeResult = fieldXml.slice(0, separate.index + separate[0].length);
  const endRunXml = fieldXml.slice(endIndex);
  const textRun = `<w:r>${runPropertiesFor(fieldXml)}<w:t xml:space="preserve">${xmlEscape(text)}</w:t></w:r>`;
  return `${beforeResult}${textRun}${endRunXml}`;
}

function getCaptureSection(input: SaqPdfInput, id: string) {
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

function textFieldValues(input: SaqPdfInput) {
  const part2a = getCaptureSection(input, "part-2a-payment-channels");
  const part2b = getCaptureSection(input, "part-2b-cardholder-function");
  const part2c = getCaptureSection(input, "part-2c-cardholder-environment");
  const part2d = getCaptureSection(input, "part-2d-scope-facilities");
  const products = getCaptureSection(input, "part-2e-validated-products");
  const p2pe = getCaptureSection(input, "part-2e-p2pe-solution");
  const providers = getCaptureSection(input, "part-2f-service-providers");
  const section3 = getCaptureSection(input, "section-3-validation-certification");

  const values: string[] = [
    input.companyName,
    input.dbaName ?? input.companyName,
    input.businessType ?? "",
    input.contactName ?? "",
    input.contactTitle ?? "",
    input.contactPhone ?? "",
    input.contactEmail ?? "",
    input.postalAddress ?? "",
    input.assessor?.isaName ?? "",
    input.assessor?.qsaCompany ?? "",
    input.assessor?.qsaLeadName ?? "",
    "",
    "",
    "",
    "",
    "",
    findValue(part2a, "motivo de exclusion"),
  ];

  for (let row = 1; row <= 3; row += 1) {
    values.push(
      findValue(part2b, `Fila ${row} - Canal`),
      findValue(part2b, `Fila ${row} - Como`),
    );
  }

  values.push(
    findValue(part2c, "Descripcion de alto nivel"),
    findValue(part2c, "Descripcion de la segmentacion"),
  );

  for (let row = 1; row <= 4; row += 1) {
    values.push(
      findValue(part2d, `Fila ${row} - Tipo`),
      findValue(part2d, `Fila ${row} - Numero`),
      findValue(part2d, `Fila ${row} - Ubicacion`),
    );
  }

  for (let row = 1; row <= 4; row += 1) {
    values.push(
      findValue(products, `Fila ${row} - Nombre`),
      findValue(products, `Fila ${row} - Version`),
      findValue(products, `Fila ${row} - Estandar`),
      findValue(products, `Fila ${row} - Numero`),
      findValue(products, `Fila ${row} - Fecha`),
    );
  }

  values.push(
    findValue(p2pe, "Nombre de la solucion"),
    findValue(p2pe, "Proveedor"),
    findValue(p2pe, "Version"),
    findValue(p2pe, "Numero de referencia"),
    findValue(p2pe, "Fecha de expiracion"),
    findValue(p2pe, "Descripcion de uso"),
  );

  for (let row = 1; row <= 10; row += 1) {
    values.push(
      findValue(providers, `Fila ${row} - Nombre`),
      findValue(providers, `Fila ${row} - Descripcion`),
    );
  }

  for (const row of input.legalExceptionRows ?? []) {
    values.push(row.requirement, row.restriction);
  }

  values.push(
    input.merchantSignatory?.name ?? input.contactName ?? input.companyName,
    input.merchantSignatory?.title ?? input.contactTitle ?? "",
    input.merchantSignatory?.date ? formatDate(input.merchantSignatory.date) : formatDate(input.issueDate),
    input.assessor?.qsaCompany ?? "",
    input.assessor?.qsaLeadName ?? "",
    input.assessor?.isaName ?? "",
    input.complianceDeadline ? formatDate(input.complianceDeadline) : "",
  );

  for (const row of input.notImplementedRequirements ?? []) {
    values.push(row.code, row.explanation ?? "", row.resolutionDate ? formatDate(row.resolutionDate) : "");
  }

  // Section 3 legal-exception table appears late in each official form. Add it
  // again near the end so forms with more blank fields can still receive it.
  for (const [label, value] of Object.entries(section3)) {
    if (label.toLowerCase().includes("fila")) {
      values.push(value);
    }
  }

  return values;
}

function formatDate(value?: Date | string | null) {
  if (!value) {
    return "";
  }
  return new Intl.DateTimeFormat("es-MX", { year: "numeric", month: "long", day: "numeric" }).format(new Date(value));
}

function fillTextFields(documentXml: string, values: string[]) {
  let textIndex = 0;
  const replacements = extractLegacyFields(documentXml)
    .filter((field) => field.kind === "text")
    .map((field) => {
      const value = values[textIndex] ?? "";
      textIndex += 1;
      return { field, xml: setTextField(field.xml, value) };
    });
  return replaceFieldRanges(documentXml, replacements);
}

function checkboxFieldsIn(xml: string) {
  return extractLegacyFields(xml).filter((field) => field.kind === "checkbox");
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

function requirementCodePattern(code: string) {
  return new RegExp(`(^|[^0-9])${code.replace(/\./g, "\\.")}([^0-9.]|$)`);
}

function fillRequirementRows(documentXml: string, input: SaqPdfInput, supportsNotTested: boolean) {
  const requirements = input.requirements
    .filter((requirement) => requirement.answerValue)
    .sort((left, right) => right.code.length - left.code.length);

  return documentXml.replace(TABLE_ROW_PATTERN, (rowXml) => {
    const text = visibleText(rowXml);
    const requirement = requirements.find((item) => requirementCodePattern(item.code).test(text));
    if (!requirement) {
      return rowXml;
    }

    const checkboxCount = checkboxFieldsIn(rowXml).length;
    const expectedColumns = supportsNotTested ? 5 : 4;
    if (checkboxCount < expectedColumns) {
      return rowXml;
    }

    const selectedColumn = answerColumn(requirement.answerValue, supportsNotTested);
    if (selectedColumn < 0) {
      return rowXml;
    }

    return setCheckboxesByOrder(
      rowXml,
      Array.from({ length: checkboxCount }, (_, index) => index === selectedColumn),
    );
  });
}

function fillKnownCheckboxes(documentXml: string, input: SaqPdfInput) {
  const part2a = getCaptureSection(input, "part-2a-payment-channels");
  const products = getCaptureSection(input, "part-2e-validated-products");
  const providers = getCaptureSection(input, "part-2f-service-providers");
  const section3 = getCaptureSection(input, "section-3-validation-certification");
  const recognition = getCaptureSection(input, "section-3a-merchant-recognition");

  const includedChannels = findValue(part2a, "Canales de pago").toLowerCase();
  const excluded = yesNo(findValue(part2a, "Hay algun canal"));
  const usesProducts = yesNo(findValue(products, "Utiliza el comerciante"));
  const storesProcesses = yesNo(findValue(providers, "Almacenan"));
  const managesComponents = yesNo(findValue(providers, "Gestionan"));
  const affectsSecurity = yesNo(findValue(providers, "Podrian"));
  const legalException = yesNo(findValue(section3, "Conforme"));
  const acknowledgements = findValue(recognition, "Confirmaciones").toLowerCase();

  return fillCheckboxFields(documentXml, (field, checkboxIndex) => {
    let checked: boolean | null = null;
    if (checkboxIndex === 0) checked = includedChannels.includes("moto") || includedChannels.includes("correo");
    if (checkboxIndex === 1) checked = includedChannels.includes("electronico") || includedChannels.includes("electr");
    if (checkboxIndex === 2) checked = includedChannels.includes("presencial");
    if (checkboxIndex === 3 && excluded !== null) checked = excluded;
    if (checkboxIndex === 4 && excluded !== null) checked = !excluded;

    // These yes/no pairs are stable across the official merchant SAQs before
    // the requirement-answer grid begins. If a template shifts, the audit count
    // still catches the file change and requirement rows are filled separately.
    if (checkboxIndex === 9 && usesProducts !== null) checked = usesProducts;
    if (checkboxIndex === 10 && usesProducts !== null) checked = !usesProducts;
    if (checkboxIndex === 11 && storesProcesses !== null) checked = storesProcesses;
    if (checkboxIndex === 12 && storesProcesses !== null) checked = !storesProcesses;
    if (checkboxIndex === 13 && managesComponents !== null) checked = managesComponents;
    if (checkboxIndex === 14 && managesComponents !== null) checked = !managesComponents;
    if (checkboxIndex === 15 && affectsSecurity !== null) checked = affectsSecurity;
    if (checkboxIndex === 16 && affectsSecurity !== null) checked = !affectsSecurity;

    const context = visibleText(field.xml);
    if (context.includes("El SAQ fue completado")) {
      checked = acknowledgements.includes("completado de acuerdo");
    }
    if (context.includes("representa fielmente")) {
      checked = acknowledgements.includes("representa fielmente");
    }
    if (context.includes("mantendran") || context.includes("mantendr")) {
      checked = acknowledgements.includes("mantendran") || acknowledgements.includes("mantendr");
    }
    if (context.includes("excepcion legal") || context.includes("excepci")) {
      checked = legalException === true;
    }

    return checked;
  });
}

function assertTemplateShape(documentXml: string, input: SaqPdfInput) {
  const config = getOfficialSaqTemplateConfig(input.saqTypeCode);
  if (!config) {
    throw new Error(`No official SAQ template is configured for ${input.saqTypeCode ?? "unknown SAQ"}.`);
  }

  const fields = extractLegacyFields(documentXml);
  const textFields = fields.filter((field) => field.kind === "text").length;
  const checkboxes = fields.filter((field) => field.kind === "checkbox").length;
  if (textFields !== config.expectedTextFields || checkboxes !== config.expectedCheckboxes) {
    throw new Error(
      `Official SAQ template shape changed for ${input.saqTypeCode}. Expected ${config.expectedTextFields} text fields and ${config.expectedCheckboxes} checkboxes; found ${textFields} text fields and ${checkboxes} checkboxes.`,
    );
  }
}

export async function fillOfficialSaqDocx(input: SaqPdfInput): Promise<Buffer> {
  const config = getOfficialSaqTemplateConfig(input.saqTypeCode);
  if (!config) {
    throw new Error(`No official SAQ template is configured for ${input.saqTypeCode ?? "unknown SAQ"}.`);
  }

  const template = await readTemplate(config.template);
  const zip = new PizZip(template);
  const document = zip.file("word/document.xml");
  if (!document) {
    throw new Error(`Official SAQ template ${config.template} is missing word/document.xml.`);
  }

  let documentXml = document.asText();
  assertWellFormedDocumentXml(documentXml, `${config.template} word/document.xml`);
  assertTemplateShape(documentXml, input);
  documentXml = fillTextFields(documentXml, textFieldValues(input));
  documentXml = fillKnownCheckboxes(documentXml, input);
  documentXml = fillRequirementRows(documentXml, input, config.supportsNotTested || Boolean(input.supportsNotTested));
  assertWellFormedDocumentXml(documentXml, `filled ${config.template} word/document.xml`);
  zip.file("word/document.xml", documentXml);
  const filled = zip.generate({ type: "nodebuffer", compression: "DEFLATE" }) as Buffer;
  assertFilledDocxIsValid(filled, config.template);
  return filled;
}

export async function renderOfficialSaqPdf(input: SaqPdfInput): Promise<Buffer> {
  const filledDocx = await fillOfficialSaqDocx(input);
  return convertOfficeBufferToPdf(filledDocx, "docx");
}
