import { AnswerValue } from "@prisma/client";

// ---------------------------------------------------------------------------
// Official PCI DSS v4.0.1 SAQ / AOC document layout helpers.
//
// The app already captures everything the official document needs (see
// saq-sections.ts and the generation flow in routes/client.ts). This module
// only describes how that data must be ORDERED and LABELLED so the generated
// PDF mirrors the official PCI SSC SAQ structure:
//   Seccion 1  Informacion de la Evaluacion   (= AOC Parte 1 + Parte 2)
//   Seccion 2  Cuestionario de Autoevaluacion  (requirements grouped by Requisito)
//   Anexos     B (CCW) / C (No Aplicable) / D (No Probado)
//   Seccion 3  Detalles de Validacion y Certificacion (= AOC Parte 3 + Parte 4)
// ---------------------------------------------------------------------------

export const SAQ_DOCUMENT_SUBTITLE = "Para uso con el PCI DSS Version 4.0.1";

export function getSaqDocumentTitle(saqTypeName: string) {
  return `Cuestionario de Autoevaluacion ${saqTypeName} y Certificado de Conformidad`;
}

export type ResponseColumn = { value: AnswerValue; label: string };

const COLUMN_IMPLEMENTED: ResponseColumn = { value: AnswerValue.IMPLEMENTED, label: "Implementado" };
const COLUMN_CCW: ResponseColumn = { value: AnswerValue.CCW, label: "Implementado con CCW" };
const COLUMN_NA: ResponseColumn = { value: AnswerValue.NOT_APPLICABLE, label: "No Aplicable" };
const COLUMN_NOT_TESTED: ResponseColumn = { value: AnswerValue.NOT_TESTED, label: "No Probado" };
const COLUMN_NOT_IMPLEMENTED: ResponseColumn = { value: AnswerValue.NOT_IMPLEMENTED, label: "No Implementado" };

// The official answer table is 4 columns; SAQs that support "No Probado"
// (e.g. SAQ D) insert it before "No Implementado".
export function getResponseColumns(supportsNotTested: boolean): ResponseColumn[] {
  return supportsNotTested
    ? [COLUMN_IMPLEMENTED, COLUMN_CCW, COLUMN_NA, COLUMN_NOT_TESTED, COLUMN_NOT_IMPLEMENTED]
    : [COLUMN_IMPLEMENTED, COLUMN_CCW, COLUMN_NA, COLUMN_NOT_IMPLEMENTED];
}

export function renderResponseRow(
  selected: AnswerValue | null | undefined,
  supportsNotTested: boolean,
): string {
  return getResponseColumns(supportsNotTested)
    .map((column) => `${column.value === selected ? "[X]" : "[ ]"} ${column.label}`)
    .join("   ");
}

// Leading integer of a requirement code ("3.2.1" -> 3) identifies the Requisito.
function topicNumberFromCode(code: string): number {
  const match = code.match(/^(\d+)/);
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
}

export type GroupedRequirement<T extends { code: string; topicCode?: string | null; topicName?: string | null }> = {
  topicNumber: number;
  topicCode: string;
  topicName: string;
  heading: string;
  requirements: T[];
};

// Groups requirements by their PCI Requisito number, preserving the natural
// requirement-code order inside each group and ordering the groups numerically.
export function groupRequirementsByTopic<
  T extends { code: string; topicCode?: string | null; topicName?: string | null },
>(requirements: T[]): GroupedRequirement<T>[] {
  const groups = new Map<number, GroupedRequirement<T>>();

  for (const requirement of requirements) {
    const topicNumber = topicNumberFromCode(requirement.code);
    const topicCode = requirement.topicCode ?? String(topicNumber);
    const topicName = requirement.topicName ?? "";
    if (!groups.has(topicNumber)) {
      groups.set(topicNumber, {
        topicNumber,
        topicCode,
        topicName,
        heading: topicName ? `Requisito ${topicCode}: ${topicName}` : `Requisito ${topicCode}`,
        requirements: [],
      });
    }
    groups.get(topicNumber)!.requirements.push(requirement);
  }

  return Array.from(groups.values()).sort((left, right) => left.topicNumber - right.topicNumber);
}

export type ConformityStatus = "CONFORMING" | "NON_CONFORMING" | "LEGAL_EXCEPTION";

// The three mutually-exclusive options of AOC Parte 3, with the official
// checkbox marked according to the calculated validation status.
export function renderConformityOptions(status: ConformityStatus | null | undefined): string[] {
  const mark = (option: ConformityStatus) => (option === status ? "[X]" : "[ ]");
  return [
    `${mark("CONFORMING")} En Conformidad: Todas las secciones del SAQ estan completas y todos los requisitos estan marcados como Implementado, Implementado con CCW o No Aplicable, resultando en una calificacion general de EN CONFORMIDAD.`,
    `${mark("NON_CONFORMING")} No Conformidad: No se completaron todas las secciones del SAQ, o uno o mas requisitos estan marcados como No Implementado, resultando en una calificacion general de NO CONFORMIDAD.`,
    `${mark("LEGAL_EXCEPTION")} Conforme pero con una excepcion legal: Uno o mas requisitos estan marcados como No Implementado debido a una restriccion legal y los demas estan en Conformidad, resultando en EN CONFORMIDAD PERO CON EXCEPCION LEGAL.`,
  ];
}

// Capture-section ids that belong to Seccion 1 / Parte 2 (Resumen Ejecutivo).
export function isPart2CaptureSection(sectionId: string | undefined) {
  return Boolean(sectionId && sectionId.startsWith("part-2"));
}

// Capture-section ids that belong to Seccion 3.
export function isSection3CaptureSection(sectionId: string | undefined) {
  return sectionId === "section-3-validation-certification" || sectionId === "section-3a-merchant-recognition";
}
