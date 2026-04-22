type SaqSectionScope = "FIXED_ALL_SAQS" | "VARIABLE_ALL_SAQS" | "VARIABLE_BY_SAQ" | "VARIABLE_P2PE_ONLY";
type SaqSectionFilledBy =
  | "EXECUTIVE_SETUP"
  | "CLIENT_DURING_SAQ"
  | "CLIENT_AT_COMPLETION"
  | "SYSTEM_FROM_ANSWERS"
  | "SYSTEM_FROM_SAQ_SELECTION";

type SaqSectionDefinition = {
  id: string;
  title: string;
  scope: SaqSectionScope;
  filledBy: SaqSectionFilledBy;
  details: string;
  condition?: string;
  onlyForSaqCodes?: string[];
};

const SAQ_P2PE_CODE = "P2PE";

const sectionDefinitions: SaqSectionDefinition[] = [
  {
    id: "part-1-evaluation-information",
    title: "Parte 1: Informacion de la evaluacion",
    scope: "FIXED_ALL_SAQS",
    filledBy: "EXECUTIVE_SETUP",
    details: "Se alimenta con la informacion del registro del cliente y la asignacion administrada por el ejecutivo.",
  },
  {
    id: "part-2-executive-summary-core",
    title: "Parte 2: Resumen ejecutivo",
    scope: "FIXED_ALL_SAQS",
    filledBy: "CLIENT_DURING_SAQ",
    details: "Incluye los bloques base del resumen ejecutivo que el cliente completa dentro del SAQ.",
  },
  {
    id: "part-2-executive-summary-p2pe",
    title: "Parte 2: Resumen ejecutivo con bloque adicional P2PE",
    scope: "VARIABLE_P2PE_ONLY",
    filledBy: "CLIENT_DURING_SAQ",
    details: "El deck indica una seccion adicional del resumen ejecutivo solo para SAQ P2PE.",
    onlyForSaqCodes: [SAQ_P2PE_CODE],
  },
  {
    id: "part-2-questionnaire",
    title: "Parte 2: Cuestionario",
    scope: "VARIABLE_BY_SAQ",
    filledBy: "CLIENT_DURING_SAQ",
    details: "Es la seccion variable por tipo de SAQ. Aqui cambia la estructura de preguntas, requisitos y metadatos especificos.",
  },
  {
    id: "part-2-system-summary",
    title: "Parte 2: Resumen calculado por el sistema",
    scope: "VARIABLE_ALL_SAQS",
    filledBy: "SYSTEM_FROM_ANSWERS",
    details: "Se completa a partir de las respuestas a los requisitos y del estado de cumplimiento por seccion o capitulo.",
  },
  {
    id: "part-2-saq-selection-summary",
    title: "Parte 2: Bloque generado por eleccion del SAQ",
    scope: "VARIABLE_ALL_SAQS",
    filledBy: "SYSTEM_FROM_SAQ_SELECTION",
    details: "El deck muestra un bloque variable que depende del SAQ asignado y del estado global de respuestas conformes.",
  },
  {
    id: "annex-b-ccw",
    title: "Anexo B: Ficha de control compensatorio",
    scope: "FIXED_ALL_SAQS",
    filledBy: "CLIENT_DURING_SAQ",
    details: "Se alimenta con los requisitos marcados como CCW y sus campos complementarios.",
    condition: "Visible cuando el cliente selecciona respuestas CCW.",
  },
  {
    id: "annex-c-not-applicable",
    title: "Anexo C: Explicacion de requisitos no aplicables",
    scope: "FIXED_ALL_SAQS",
    filledBy: "CLIENT_DURING_SAQ",
    details: "Se alimenta con los requisitos marcados como No Aplicable y su justificacion.",
    condition: "Visible cuando existen respuestas No Aplicable.",
  },
  {
    id: "annex-d-not-tested",
    title: "Anexo D: Explicacion de requisitos no probados",
    scope: "FIXED_ALL_SAQS",
    filledBy: "CLIENT_DURING_SAQ",
    details: "Se alimenta con los requisitos marcados como No Probado y debe conservar la explicacion y fecha de resolucion.",
    condition: "Visible cuando existen respuestas No Probado.",
  },
  {
    id: "section-3-validation-certification",
    title: "Seccion 3: Detalles de validacion y certificacion",
    scope: "FIXED_ALL_SAQS",
    filledBy: "CLIENT_DURING_SAQ",
    details: "Es una seccion fija posterior al cuestionario que el cliente completa como parte del cierre del SAQ.",
  },
  {
    id: "section-3a-merchant-recognition",
    title: "Seccion 3a: Reconocimiento del comerciante",
    scope: "FIXED_ALL_SAQS",
    filledBy: "CLIENT_AT_COMPLETION",
    details: "Se completa al concluir el SAQ y funciona como bloque final de reconocimiento o conformidad.",
  },
  {
    id: "final-variable-saq-block",
    title: "Bloque adicional variable del SAQ",
    scope: "VARIABLE_ALL_SAQS",
    filledBy: "SYSTEM_FROM_SAQ_SELECTION",
    details: "La ultima diapositiva del deck marca un bloque adicional variable por SAQ. Se reserva como metadata estructural para la futura generacion documental.",
  },
];

export function getSaqStructuralNotes() {
  return [
    "La Parte 2 no puede modelarse como una sola lista generica para todos los SAQ.",
    "El SAQ mezcla bloques fijos, bloques variables por tipo de SAQ y bloques calculados por el sistema.",
    "Los anexos B, C y D son secciones reales del documento final y dependen de las respuestas CCW, No Aplicable y No Probado.",
    "Despues del cuestionario aun existen bloques de validacion, certificacion y reconocimiento final que deben contemplarse en la salida documental.",
  ];
}

export function getSaqSectionPlan(saqTypeCode: string) {
  return sectionDefinitions
    .filter((section) => !section.onlyForSaqCodes || section.onlyForSaqCodes.includes(saqTypeCode))
    .map((section, index) => ({
      id: section.id,
      title: section.title,
      scope: section.scope,
      filledBy: section.filledBy,
      details: section.details,
      condition: section.condition ?? null,
      displayOrder: index + 1,
    }));
}
