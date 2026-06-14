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

type RowRange = {
  start: number;
  rows: number;
  columns: number;
};

type Section3FieldMap = {
  assessmentDate: number;
  conformingMerchant: number;
  nonConformingMerchant: number;
  complianceDeadline: number;
  legalExceptionMerchant: number;
  legalExceptionRowsStart: number;
  merchantDate: number;
  merchantName: number;
  merchantTitle: number;
  qsaRoleDescription: number;
  qsaLeadDate: number;
  qsaLeadName: number;
  qsaOfficerDate: number;
  qsaOfficerName: number;
  qsaCompany: number;
  isaRoleDescription: number;
  part4Start: number;
  part4Requirements: string[];
};

type OfficialSaqFieldManifest = {
  contactFields?: Partial<Record<"company" | "dba" | "postal" | "website" | "contactName" | "contactTitle" | "contactPhone" | "contactEmail" | "isaName" | "qsaCompany" | "qsaAddress" | "qsaWebsite" | "qsaLeadName" | "qsaPhone" | "qsaEmail" | "qsaCertificate", number>>;
  excludedChannelReason?: number;
  cardFunctionRows?: RowRange;
  environmentDescription?: number;
  facilitiesRows?: RowRange;
  productsRows?: RowRange;
  p2peSolutionFields?: Partial<Record<"name" | "provider" | "version" | "reference" | "expiration" | "description", number>>;
  providersRows?: RowRange;
  serviceProviderFields?: Partial<Record<"services" | "service1" | "service2" | "service3" | "serviceOther" | "serviceExcludedReason" | "storesProcessesTransmits" | "securityInfluence" | "components", number>>;
  checkboxFields?: {
    channels?: Partial<Record<"moto" | "ecommerce" | "present", number>>;
    excludedChannel?: [number, number];
    segmentation?: [number, number];
    products?: [number, number];
    providers?: {
      storesProcessesTransmits?: [number, number];
      managesComponents?: [number, number];
      affectsSecurity?: [number, number];
    };
  };
  section3: Section3FieldMap;
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

function optionalValue(value: string | null | undefined, fallback = "") {
  const text = normalizeText(value ?? "");
  return text || fallback;
}

function blankValues(count: number) {
  return Array.from({ length: count }, () => "");
}

const DEFAULT_CONTACT_FIELDS: OfficialSaqFieldManifest["contactFields"] = {
  company: 0,
  dba: 1,
  postal: 2,
  website: 3,
  contactName: 4,
  contactTitle: 5,
  contactPhone: 6,
  contactEmail: 7,
  isaName: 8,
  qsaCompany: 9,
  qsaAddress: 10,
  qsaWebsite: 11,
  qsaLeadName: 12,
  qsaPhone: 13,
  qsaEmail: 14,
  qsaCertificate: 15,
};

const STANDARD_CHECKBOX_FIELDS: OfficialSaqFieldManifest["checkboxFields"] = {
  channels: { moto: 0, ecommerce: 1, present: 2 },
  excludedChannel: [3, 4],
  segmentation: [5, 6],
  products: [7, 8],
  providers: {
    storesProcessesTransmits: [9, 10],
    managesComponents: [11, 12],
    affectsSecurity: [13, 14],
  },
};

const TWO_CHANNEL_CHECKBOX_FIELDS: OfficialSaqFieldManifest["checkboxFields"] = {
  channels: { moto: 0, ecommerce: 1 },
  excludedChannel: [2, 3],
  segmentation: [4, 5],
  providers: {
    storesProcessesTransmits: [6, 7],
    managesComponents: [8, 9],
    affectsSecurity: [10, 11],
  },
};

const SPOC_CHECKBOX_FIELDS: OfficialSaqFieldManifest["checkboxFields"] = {
  channels: { present: 0 },
  excludedChannel: [1, 2],
  segmentation: [3, 4],
  providers: {
    storesProcessesTransmits: [5, 6],
    managesComponents: [7, 8],
    affectsSecurity: [9, 10],
  },
};

const SECTION3_A: Section3FieldMap = {
  assessmentDate: 157,
  conformingMerchant: 158,
  nonConformingMerchant: 159,
  complianceDeadline: 160,
  legalExceptionMerchant: 161,
  legalExceptionRowsStart: 162,
  merchantDate: 168,
  merchantName: 169,
  merchantTitle: 170,
  qsaRoleDescription: 171,
  qsaLeadDate: 172,
  qsaLeadName: 173,
  qsaOfficerDate: 174,
  qsaOfficerName: 175,
  qsaCompany: 176,
  isaRoleDescription: 177,
  part4Start: 178,
  part4Requirements: ["2", "3", "6", "8", "9", "11", "12"],
};

const SECTION3_LONG_STANDARD: Section3FieldMap = {
  assessmentDate: 162,
  conformingMerchant: 163,
  nonConformingMerchant: 164,
  complianceDeadline: 165,
  legalExceptionMerchant: 166,
  legalExceptionRowsStart: 167,
  merchantDate: 173,
  merchantName: 174,
  merchantTitle: 175,
  qsaRoleDescription: 176,
  qsaLeadDate: 177,
  qsaLeadName: 178,
  qsaOfficerDate: 179,
  qsaOfficerName: 180,
  qsaCompany: 181,
  isaRoleDescription: 182,
  part4Start: 183,
  part4Requirements: ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12"],
};

const SAQ_MANIFESTS: Record<string, OfficialSaqFieldManifest> = {
  A: {
    contactFields: DEFAULT_CONTACT_FIELDS,
    excludedChannelReason: 16,
    cardFunctionRows: { start: 17, rows: 3, columns: 2 },
    environmentDescription: 23,
    facilitiesRows: { start: 24, rows: 8, columns: 3 },
    productsRows: { start: 48, rows: 10, columns: 5 },
    providersRows: { start: 98, rows: 10, columns: 2 },
    checkboxFields: STANDARD_CHECKBOX_FIELDS,
    section3: SECTION3_A,
  },
  A_EP: {
    contactFields: DEFAULT_CONTACT_FIELDS,
    excludedChannelReason: 16,
    cardFunctionRows: { start: 17, rows: 3, columns: 2 },
    environmentDescription: 23,
    facilitiesRows: { start: 24, rows: 8, columns: 3 },
    productsRows: { start: 48, rows: 11, columns: 5 },
    providersRows: { start: 103, rows: 10, columns: 2 },
    checkboxFields: STANDARD_CHECKBOX_FIELDS,
    section3: SECTION3_LONG_STANDARD,
  },
  B: {
    contactFields: DEFAULT_CONTACT_FIELDS,
    excludedChannelReason: 16,
    cardFunctionRows: { start: 17, rows: 3, columns: 2 },
    environmentDescription: 23,
    facilitiesRows: { start: 24, rows: 26, columns: 3 },
    providersRows: { start: 103, rows: 10, columns: 2 },
    checkboxFields: STANDARD_CHECKBOX_FIELDS,
    section3: { ...SECTION3_LONG_STANDARD, part4Requirements: ["3", "7", "9", "12"] },
  },
  B_IP: {
    contactFields: DEFAULT_CONTACT_FIELDS,
    excludedChannelReason: 16,
    cardFunctionRows: { start: 17, rows: 3, columns: 2 },
    environmentDescription: 23,
    facilitiesRows: { start: 24, rows: 8, columns: 3 },
    productsRows: { start: 48, rows: 11, columns: 5 },
    providersRows: { start: 103, rows: 10, columns: 2 },
    checkboxFields: STANDARD_CHECKBOX_FIELDS,
    section3: { ...SECTION3_LONG_STANDARD, part4Requirements: ["1", "2", "3", "4", "6", "7", "8", "9", "11", "12"] },
  },
  C: {
    contactFields: DEFAULT_CONTACT_FIELDS,
    excludedChannelReason: 16,
    cardFunctionRows: { start: 17, rows: 3, columns: 2 },
    environmentDescription: 23,
    facilitiesRows: { start: 24, rows: 8, columns: 3 },
    productsRows: { start: 48, rows: 10, columns: 5 },
    providersRows: { start: 98, rows: 10, columns: 2 },
    checkboxFields: STANDARD_CHECKBOX_FIELDS,
    section3: {
      assessmentDate: 159,
      conformingMerchant: 160,
      nonConformingMerchant: 161,
      complianceDeadline: 162,
      legalExceptionMerchant: 163,
      legalExceptionRowsStart: 164,
      merchantDate: 170,
      merchantName: 171,
      merchantTitle: 172,
      qsaRoleDescription: 173,
      qsaLeadDate: 174,
      qsaLeadName: 175,
      qsaOfficerDate: 176,
      qsaOfficerName: 177,
      qsaCompany: 178,
      isaRoleDescription: 179,
      part4Start: 180,
      part4Requirements: ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12"],
    },
  },
  C_VT: {
    contactFields: DEFAULT_CONTACT_FIELDS,
    excludedChannelReason: 16,
    cardFunctionRows: { start: 17, rows: 3, columns: 2 },
    environmentDescription: 23,
    facilitiesRows: { start: 24, rows: 8, columns: 3 },
    productsRows: { start: 48, rows: 11, columns: 5 },
    providersRows: { start: 103, rows: 10, columns: 2 },
    checkboxFields: STANDARD_CHECKBOX_FIELDS,
    section3: { ...SECTION3_LONG_STANDARD, part4Requirements: ["1", "2", "3", "4", "5", "6", "7", "8", "9", "12"] },
  },
  D_MERCHANT: {
    contactFields: DEFAULT_CONTACT_FIELDS,
    excludedChannelReason: 16,
    cardFunctionRows: { start: 17, rows: 3, columns: 2 },
    environmentDescription: 23,
    facilitiesRows: { start: 24, rows: 9, columns: 3 },
    productsRows: { start: 51, rows: 9, columns: 5 },
    providersRows: { start: 96, rows: 10, columns: 2 },
    checkboxFields: STANDARD_CHECKBOX_FIELDS,
    section3: {
      assessmentDate: 200,
      conformingMerchant: 201,
      nonConformingMerchant: 202,
      complianceDeadline: 203,
      legalExceptionMerchant: 204,
      legalExceptionRowsStart: 205,
      merchantDate: 211,
      merchantName: 212,
      merchantTitle: 213,
      qsaRoleDescription: 214,
      qsaLeadDate: 215,
      qsaLeadName: 216,
      qsaOfficerDate: 217,
      qsaOfficerName: 218,
      qsaCompany: 219,
      isaRoleDescription: 220,
      part4Start: 221,
      part4Requirements: ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12"],
    },
  },
  D_SERVICE_PROVIDER: {
    contactFields: DEFAULT_CONTACT_FIELDS,
    serviceProviderFields: {
      services: 16,
      service1: 17,
      service2: 18,
      service3: 19,
      serviceOther: 20,
      serviceExcludedReason: 26,
      storesProcessesTransmits: 27,
      securityInfluence: 28,
      components: 29,
    },
    environmentDescription: 30,
    facilitiesRows: { start: 31, rows: 24, columns: 3 },
    providersRows: { start: 103, rows: 10, columns: 2 },
    section3: {
      assessmentDate: 611,
      conformingMerchant: 612,
      nonConformingMerchant: 613,
      complianceDeadline: 614,
      legalExceptionMerchant: 615,
      legalExceptionRowsStart: 616,
      merchantDate: 622,
      merchantName: 623,
      merchantTitle: 624,
      qsaRoleDescription: 625,
      qsaLeadDate: 626,
      qsaLeadName: 627,
      qsaOfficerDate: 628,
      qsaOfficerName: 629,
      qsaCompany: 630,
      isaRoleDescription: 631,
      part4Start: 632,
      part4Requirements: ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "A1", "A2"],
    },
  },
  D_P2PE: {
    contactFields: DEFAULT_CONTACT_FIELDS,
    excludedChannelReason: 16,
    cardFunctionRows: { start: 17, rows: 2, columns: 2 },
    environmentDescription: 21,
    facilitiesRows: { start: 22, rows: 8, columns: 3 },
    p2peSolutionFields: { name: 46, provider: 47, reference: 48, version: 49, expiration: 50 },
    providersRows: { start: 51, rows: 10, columns: 2 },
    checkboxFields: TWO_CHANNEL_CHECKBOX_FIELDS,
    section3: {
      assessmentDate: 110,
      conformingMerchant: 111,
      nonConformingMerchant: 112,
      complianceDeadline: 113,
      legalExceptionMerchant: 114,
      legalExceptionRowsStart: 115,
      merchantDate: 121,
      merchantName: 122,
      merchantTitle: 123,
      qsaRoleDescription: 124,
      qsaLeadDate: 125,
      qsaLeadName: 126,
      qsaOfficerDate: 127,
      qsaOfficerName: 128,
      qsaCompany: 129,
      isaRoleDescription: 130,
      part4Start: 131,
      part4Requirements: ["3", "9", "12"],
    },
  },
  P2PE: {} as OfficialSaqFieldManifest,
  SPOC: {
    contactFields: DEFAULT_CONTACT_FIELDS,
    excludedChannelReason: 16,
    cardFunctionRows: { start: 17, rows: 2, columns: 2 },
    environmentDescription: 21,
    facilitiesRows: { start: 22, rows: 8, columns: 3 },
    p2peSolutionFields: { name: 46, provider: 47, reference: 48, version: 49, expiration: 50, description: 51 },
    providersRows: { start: 52, rows: 10, columns: 2 },
    checkboxFields: SPOC_CHECKBOX_FIELDS,
    section3: {
      assessmentDate: 111,
      conformingMerchant: 112,
      nonConformingMerchant: 113,
      complianceDeadline: 114,
      legalExceptionMerchant: 115,
      legalExceptionRowsStart: 116,
      merchantDate: 122,
      merchantName: 123,
      merchantTitle: 124,
      qsaRoleDescription: 125,
      qsaLeadDate: 126,
      qsaLeadName: 127,
      qsaOfficerDate: 128,
      qsaOfficerName: 129,
      qsaCompany: 130,
      isaRoleDescription: 131,
      part4Start: 132,
      part4Requirements: ["3", "8", "9", "12"],
    },
  },
  SPoC: {} as OfficialSaqFieldManifest,
};

SAQ_MANIFESTS.P2PE = SAQ_MANIFESTS.D_P2PE;
SAQ_MANIFESTS.SPoC = SAQ_MANIFESTS.SPOC;

function manifestFor(input: SaqPdfInput) {
  const manifest = input.saqTypeCode ? SAQ_MANIFESTS[input.saqTypeCode] : undefined;
  if (!manifest) {
    throw new Error(`No official SAQ field manifest is configured for ${input.saqTypeCode ?? "unknown SAQ"}.`);
  }
  return manifest;
}

export function getOfficialSaqFieldManifest(saqTypeCode: string | null | undefined) {
  return saqTypeCode ? SAQ_MANIFESTS[saqTypeCode] : undefined;
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

function textFieldValues(input: SaqPdfInput) {
  const manifest = manifestFor(input);
  const part2a = getCaptureSection(input, "part-2a-payment-channels");
  const part2b = getCaptureSection(input, "part-2b-cardholder-function");
  const part2c = getCaptureSection(input, "part-2c-cardholder-environment");
  const part2d = getCaptureSection(input, "part-2d-scope-facilities");
  const products = getCaptureSection(input, "part-2e-validated-products");
  const p2pe = getCaptureSection(input, "part-2e-p2pe-solution");
  const providers = getCaptureSection(input, "part-2f-service-providers");
  const values = new Map<number, string>();
  const contact = manifest.contactFields ?? {};
  setIndex(values, contact.company, input.companyName);
  setIndex(values, contact.dba, input.dbaName ?? input.companyName);
  setIndex(values, contact.postal, optionalValue(input.postalAddress, "No aplicable"));
  setIndex(values, contact.website, optionalValue(input.website, ""));
  setIndex(values, contact.contactName, optionalValue(input.contactName, ""));
  setIndex(values, contact.contactTitle, optionalValue(input.contactTitle, "No aplicable"));
  setIndex(values, contact.contactPhone, optionalValue(input.contactPhone, "Pendiente"));
  setIndex(values, contact.contactEmail, optionalValue(input.contactEmail, ""));
  setIndex(values, contact.isaName, optionalValue(input.assessor?.isaName, ""));
  setIndex(values, contact.qsaCompany, optionalValue(input.assessor?.qsaCompany, ""));
  setIndex(values, contact.qsaAddress, "");
  setIndex(values, contact.qsaWebsite, "");
  setIndex(values, contact.qsaLeadName, optionalValue(input.assessor?.qsaLeadName, ""));
  setIndex(values, contact.qsaPhone, "");
  setIndex(values, contact.qsaEmail, "");
  setIndex(values, contact.qsaCertificate, "");
  setIndex(values, manifest.excludedChannelReason, findValue(part2a, "motivo de exclusion"));

  const serviceFields = manifest.serviceProviderFields;
  setIndex(values, serviceFields?.services, findValue(part2a, "Servicios evaluados"));
  setIndex(values, serviceFields?.service1, findValue(part2a, "Servicio 1"));
  setIndex(values, serviceFields?.service2, findValue(part2a, "Servicio 2"));
  setIndex(values, serviceFields?.service3, findValue(part2a, "Servicio 3"));
  setIndex(values, serviceFields?.serviceOther, findValue(part2a, "Otros"));
  setIndex(values, serviceFields?.serviceExcludedReason, findValue(part2a, "motivo de exclusion"));
  setIndex(values, serviceFields?.storesProcessesTransmits, findValue(part2b, "almacena"));
  setIndex(values, serviceFields?.securityInfluence, findValue(part2b, "seguridad"));
  setIndex(values, serviceFields?.components, findValue(part2c, "Descripcion de alto nivel"));

  for (let row = 1; row <= 3; row += 1) {
    setRowValues(values, manifest.cardFunctionRows, row, [
      findValue(part2b, `Fila ${row} - Canal`),
      findValue(part2b, `Fila ${row} - Como`),
    ]);
  }
  setIndex(values, manifest.environmentDescription, findValue(part2c, "Descripcion de alto nivel"));

  for (let row = 1; row <= 8; row += 1) {
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
  setIndex(values, solutionFields?.name, findValue(p2pe, "Nombre de la solucion") || findValue(products, "Fila 1 - Nombre"));
  setIndex(values, solutionFields?.provider, findValue(p2pe, "Proveedor") || findValue(products, "Fila 1 - Estandar"));
  setIndex(values, solutionFields?.version, findValue(p2pe, "Version") || findValue(products, "Fila 1 - Version"));
  setIndex(values, solutionFields?.reference, findValue(p2pe, "Numero de referencia") || findValue(products, "Fila 1 - Numero"));
  setIndex(values, solutionFields?.expiration, findValue(p2pe, "Fecha de expiracion") || findValue(products, "Fila 1 - Fecha"));
  setIndex(values, solutionFields?.description, findValue(p2pe, "Descripcion de uso"));

  for (let row = 1; row <= 10; row += 1) {
    setRowValues(values, manifest.providersRows, row, [
      findValue(providers, `Fila ${row} - Nombre`),
      findValue(providers, `Fila ${row} - Descripcion`),
    ]);
  }

  const section3 = manifest.section3;
  setIndex(values, section3.assessmentDate, formatDate(input.assessmentCompletionDate ?? input.issueDate));
  setIndex(values, section3.conformingMerchant, input.companyName);
  setIndex(values, section3.nonConformingMerchant, input.companyName);
  setIndex(values, section3.complianceDeadline, input.complianceDeadline ? formatDate(input.complianceDeadline) : "");
  setIndex(values, section3.legalExceptionMerchant, input.companyName);

  for (let row = 0; row < 3; row += 1) {
    const legalRow = input.legalExceptionRows?.[row];
    setIndex(values, section3.legalExceptionRowsStart + row * 2, legalRow?.requirement ?? "");
    setIndex(values, section3.legalExceptionRowsStart + row * 2 + 1, legalRow?.restriction ?? "");
  }

  setIndex(values, section3.merchantDate, input.merchantSignatory?.date ? formatDate(input.merchantSignatory.date) : formatDate(input.issueDate));
  setIndex(values, section3.merchantName, optionalValue(input.merchantSignatory?.name ?? input.contactName, input.companyName));
  setIndex(values, section3.merchantTitle, optionalValue(input.merchantSignatory?.title ?? input.contactTitle, "No aplicable"));
  setIndex(values, section3.qsaRoleDescription, "");
  setIndex(values, section3.qsaLeadDate, "");
  setIndex(values, section3.qsaLeadName, optionalValue(input.assessor?.qsaLeadName, ""));
  setIndex(values, section3.qsaOfficerDate, "");
  setIndex(values, section3.qsaOfficerName, "");
  setIndex(values, section3.qsaCompany, optionalValue(input.assessor?.qsaCompany, ""));
  setIndex(values, section3.isaRoleDescription, "");

  for (const [index, requirement] of section3.part4Requirements.entries()) {
    const item = input.notImplementedRequirements?.find((row) => row.code === requirement || row.code.startsWith(`${requirement}.`));
    setIndex(values, section3.part4Start + index, item ? `${item.resolutionDate ? formatDate(item.resolutionDate) : ""} ${item.explanation ?? ""}`.trim() : "");
  }

  return values;
}

function formatDate(value?: Date | string | null) {
  if (!value) {
    return "";
  }
  return new Intl.DateTimeFormat("es-MX", { year: "numeric", month: "long", day: "numeric" }).format(new Date(value));
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

function summaryChecksForRequirement(input: SaqPdfInput, majorRequirement: string, checkboxCount: number, supportsNotTested: boolean) {
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

function fillRequirementSummaryRows(documentXml: string, input: SaqPdfInput, supportsNotTested: boolean) {
  return documentXml.replace(TABLE_ROW_PATTERN, (rowXml) => {
    const text = visibleText(rowXml);
    const match = text.match(/^Requisito\s+([A0-9]+):?$/i);
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

function fillPart4Rows(documentXml: string, input: SaqPdfInput) {
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

function fillKnownCheckboxes(documentXml: string, input: SaqPdfInput) {
  const manifest = manifestFor(input);
  const checkboxFields = manifest.checkboxFields;
  const part2a = getCaptureSection(input, "part-2a-payment-channels");
  const part2c = getCaptureSection(input, "part-2c-cardholder-environment");
  const products = getCaptureSection(input, "part-2e-validated-products");
  const providers = getCaptureSection(input, "part-2f-service-providers");
  const section3 = getCaptureSection(input, "section-3-validation-certification");
  const recognition = getCaptureSection(input, "section-3a-merchant-recognition");
  const eligibility = getCaptureSection(input, "part-2h-eligibility");

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
      (context.includes("certifica la elegibilidad") ||
        context.includes("sólo acepta transacciones") ||
        context.includes("solo acepta transacciones") ||
        context.includes("subcontrata") ||
        context.includes("no almacena") ||
        context.includes("ha confirmado") ||
        context.includes("está impreso") ||
        context.includes("formularios de las páginas de pago") ||
        context.includes("ataques de scripts"))
    ) {
      checked = true;
    }

    if (context.includes("En Conformidad:")) checked = conformity === "CONFORMING";
    if (context.includes("No Conform")) checked = conformity === "NON_CONFORMING";
    if (context.includes("excepción legal") || context.includes("excepcion legal")) checked = conformity === "LEGAL_EXCEPTION";
    if (context.includes("El SAQ fue completado")) {
      checked = acknowledgements.includes("completado de acuerdo");
    }
    if (context.includes("ha sido completado de acuerdo")) {
      checked = acknowledgements.includes("completado");
    }
    if (context.includes("representa") && context.includes("fielmente")) {
      checked = acknowledgements.includes("representa");
    }
    if (context.includes("mantendran") || context.includes("mantendr")) {
      checked = acknowledgements.includes("mantendran") || acknowledgements.includes("mantendr");
    }
    if (
      (context.startsWith("Conforme pero") || context.startsWith("Conforme, pero")) &&
      (context.includes("excepcion legal") || context.includes("excepci")) &&
      conformity !== "LEGAL_EXCEPTION"
    ) {
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
  documentXml = fillRequirementSummaryRows(documentXml, input, config.supportsNotTested || Boolean(input.supportsNotTested));
  documentXml = fillRequirementRows(documentXml, input, config.supportsNotTested || Boolean(input.supportsNotTested));
  documentXml = fillPart4Rows(documentXml, input);
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
