export type SaqSectionScope =
  | "FIXED_ALL_SAQS"
  | "VARIABLE_ALL_SAQS"
  | "VARIABLE_BY_SAQ"
  | "VARIABLE_P2PE_ONLY";

export type SaqSectionFilledBy =
  | "EXECUTIVE_SETUP"
  | "CLIENT_DURING_SAQ"
  | "CLIENT_AT_COMPLETION"
  | "SYSTEM_FROM_ANSWERS"
  | "SYSTEM_FROM_SAQ_SELECTION";

export type SaqSectionDefinition = {
  id: string;
  title: string;
  scope: SaqSectionScope;
  filledBy: SaqSectionFilledBy;
  details: string;
  condition?: string;
  onlyForSaqCodes?: string[];
};

export type CaptureFieldDefinition = {
  key: string;
  label: string;
  inputType: "text" | "textarea";
  placeholder: string;
};

export type CaptureSectionDefinition = {
  id: string;
  title: string;
  details: string;
  completionStage: "DURING_SAQ" | "AT_COMPLETION";
  onlyForSaqCodes?: string[];
  fields: CaptureFieldDefinition[];
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
    id: "part-2-executive-summary-fixed-1",
    title: "Parte 2: Resumen ejecutivo - bloque fijo 1",
    scope: "FIXED_ALL_SAQS",
    filledBy: "CLIENT_DURING_SAQ",
    details: "Bloque fijo del resumen ejecutivo que el cliente debe completar dentro del SAQ.",
  },
  {
    id: "part-2-executive-summary-fixed-2",
    title: "Parte 2: Resumen ejecutivo - bloque fijo 2",
    scope: "FIXED_ALL_SAQS",
    filledBy: "CLIENT_DURING_SAQ",
    details: "Bloque fijo del resumen ejecutivo que el cliente debe completar dentro del SAQ.",
  },
  {
    id: "part-2-executive-summary-fixed-3",
    title: "Parte 2: Resumen ejecutivo - bloque fijo 3",
    scope: "FIXED_ALL_SAQS",
    filledBy: "CLIENT_DURING_SAQ",
    details: "Bloque fijo del resumen ejecutivo que el cliente debe completar dentro del SAQ.",
  },
  {
    id: "part-2-executive-summary-p2pe",
    title: "Parte 2: Resumen ejecutivo - bloque variable P2PE",
    scope: "VARIABLE_P2PE_ONLY",
    filledBy: "CLIENT_DURING_SAQ",
    details: "Bloque adicional del resumen ejecutivo que solo aplica a SAQ P2PE.",
    onlyForSaqCodes: [SAQ_P2PE_CODE],
  },
  {
    id: "part-2-executive-summary-fixed-4",
    title: "Parte 2: Resumen ejecutivo - bloque fijo 4",
    scope: "FIXED_ALL_SAQS",
    filledBy: "CLIENT_DURING_SAQ",
    details: "Bloque fijo del resumen ejecutivo que el cliente debe completar dentro del SAQ.",
  },
  {
    id: "part-2-questionnaire",
    title: "Parte 2: Cuestionario",
    scope: "VARIABLE_BY_SAQ",
    filledBy: "CLIENT_DURING_SAQ",
    details: "Seccion variable por tipo de SAQ. Aqui cambia la estructura de preguntas y requisitos aplicables.",
  },
  {
    id: "part-2-system-summary",
    title: "Parte 2: Resumen calculado por el sistema",
    scope: "VARIABLE_ALL_SAQS",
    filledBy: "SYSTEM_FROM_ANSWERS",
    details: "Se completa de forma automatica a partir de las respuestas a los requisitos.",
  },
  {
    id: "part-2-selection-summary",
    title: "Parte 2: Bloque variable a partir del SAQ",
    scope: "VARIABLE_ALL_SAQS",
    filledBy: "SYSTEM_FROM_SAQ_SELECTION",
    details: "Bloque variable que el sistema completa a partir del SAQ asignado y la validacion general de respuestas.",
  },
  {
    id: "annex-b-ccw",
    title: "Anexo B: Ficha de control compensatorio",
    scope: "FIXED_ALL_SAQS",
    filledBy: "SYSTEM_FROM_ANSWERS",
    details: "La aplicacion genera una ficha por cada requerimiento respondido como CCW con base en la informacion capturada por el cliente.",
    condition: "Visible cuando el cliente selecciona respuestas CCW.",
  },
  {
    id: "annex-c-not-applicable",
    title: "Anexo C: Explicacion de requisitos no aplicables",
    scope: "FIXED_ALL_SAQS",
    filledBy: "SYSTEM_FROM_ANSWERS",
    details: "La aplicacion genera el anexo con los requerimientos marcados como No Aplicable y sus justificaciones.",
    condition: "Visible cuando existen respuestas No Aplicable.",
  },
  {
    id: "annex-d-not-tested",
    title: "Anexo D: Explicacion de requisitos no probados",
    scope: "FIXED_ALL_SAQS",
    filledBy: "SYSTEM_FROM_ANSWERS",
    details: "La aplicacion genera el anexo con los requerimientos marcados como No Probado y su fecha de resolucion.",
    condition: "Visible cuando existen respuestas No Probado.",
  },
  {
    id: "section-3-validation-certification",
    title: "Seccion 3: Detalles de validacion y certificacion",
    scope: "FIXED_ALL_SAQS",
    filledBy: "SYSTEM_FROM_ANSWERS",
    details: "La primera validacion de conformidad se calcula automaticamente a partir del estado global del cuestionario.",
  },
  {
    id: "section-3a-merchant-recognition",
    title: "Seccion 3a: Reconocimiento del comerciante",
    scope: "FIXED_ALL_SAQS",
    filledBy: "CLIENT_AT_COMPLETION",
    details: "Bloque final que el cliente completa al concluir el SAQ.",
  },
];

const captureSectionDefinitions: CaptureSectionDefinition[] = [
  {
    id: "part-2-executive-summary-fixed-1",
    title: "Resumen ejecutivo - ficha 1",
    details: "Ficha de captura para registrar el contexto general del proceso y el alcance descrito por el cliente.",
    completionStage: "DURING_SAQ",
    fields: [
      {
        key: "business_overview",
        label: "Resumen del negocio",
        inputType: "textarea",
        placeholder: "Describe de forma breve la operacion y el contexto del negocio dentro del alcance PCI DSS.",
      },
      {
        key: "payment_scope",
        label: "Alcance de pago",
        inputType: "textarea",
        placeholder: "Explica como se reciben, procesan o transmiten pagos dentro del entorno evaluado.",
      },
    ],
  },
  {
    id: "part-2-executive-summary-fixed-2",
    title: "Resumen ejecutivo - ficha 2",
    details: "Ficha de captura para registrar plataformas, canales o procesos operativos relevantes para el SAQ.",
    completionStage: "DURING_SAQ",
    fields: [
      {
        key: "payment_channels",
        label: "Canales de pago",
        inputType: "textarea",
        placeholder: "Indica los canales utilizados, por ejemplo terminales, ecommerce, telefono o terminal virtual.",
      },
      {
        key: "technology_stack",
        label: "Tecnologias y componentes principales",
        inputType: "textarea",
        placeholder: "Describe las plataformas, aplicaciones o componentes principales involucrados.",
      },
    ],
  },
  {
    id: "part-2-executive-summary-fixed-3",
    title: "Resumen ejecutivo - ficha 3",
    details: "Ficha de captura para registrar terceros, proveedores o responsabilidades compartidas.",
    completionStage: "DURING_SAQ",
    fields: [
      {
        key: "service_providers",
        label: "Proveedores o terceros involucrados",
        inputType: "textarea",
        placeholder: "Enumera procesadores, adquirentes, proveedores de tecnologia o terceros con participacion relevante.",
      },
      {
        key: "responsibility_notes",
        label: "Notas de responsabilidad compartida",
        inputType: "textarea",
        placeholder: "Describe cualquier dependencia o responsabilidad compartida relevante para el cumplimiento.",
      },
    ],
  },
  {
    id: "part-2-executive-summary-fixed-4",
    title: "Resumen ejecutivo - ficha 4",
    details: "Ficha de captura para registrar observaciones del entorno y consideraciones generales del cliente.",
    completionStage: "DURING_SAQ",
    fields: [
      {
        key: "environment_notes",
        label: "Observaciones del entorno",
        inputType: "textarea",
        placeholder: "Registra observaciones generales del entorno dentro del alcance PCI DSS.",
      },
      {
        key: "supporting_notes",
        label: "Notas complementarias",
        inputType: "textarea",
        placeholder: "Agrega notas adicionales que deban considerarse en el llenado del SAQ.",
      },
    ],
  },
  {
    id: "part-2-executive-summary-p2pe",
    title: "Resumen ejecutivo - ficha P2PE",
    details: "Ficha especifica para entornos P2PE.",
    completionStage: "DURING_SAQ",
    onlyForSaqCodes: [SAQ_P2PE_CODE],
    fields: [
      {
        key: "p2pe_solution",
        label: "Solucion P2PE",
        inputType: "text",
        placeholder: "Indica el nombre de la solucion P2PE utilizada.",
      },
      {
        key: "p2pe_notes",
        label: "Notas P2PE",
        inputType: "textarea",
        placeholder: "Registra observaciones o consideraciones especificas para el flujo P2PE.",
      },
    ],
  },
  {
    id: "section-3a-merchant-recognition",
    title: "Reconocimiento del comerciante",
    details: "Ficha final que el cliente debe completar al concluir el SAQ.",
    completionStage: "AT_COMPLETION",
    fields: [
      {
        key: "merchant_representative_name",
        label: "Nombre del representante",
        inputType: "text",
        placeholder: "Indica el nombre de la persona que reconoce la informacion del SAQ.",
      },
      {
        key: "merchant_representative_title",
        label: "Cargo del representante",
        inputType: "text",
        placeholder: "Indica el cargo o puesto del representante.",
      },
      {
        key: "merchant_acknowledgement",
        label: "Declaracion del comerciante",
        inputType: "textarea",
        placeholder: "Registra la declaracion o comentario final del comerciante para el cierre del SAQ.",
      },
    ],
  },
];

export function getSaqStructuralNotes() {
  return [
    "La Parte 2 no puede modelarse como una sola lista generica para todos los SAQ.",
    "Los bloques verdes del deck indican quien captura o bajo que proceso se completa cada parte.",
    "Las fichas del cliente deben ser editables dentro del sistema y conservarse por certificacion.",
    "Los anexos, el bloque variable por seleccion del SAQ y la validacion principal se alimentan automaticamente con la informacion registrada en el cuestionario.",
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

export function getSaqCaptureSections(saqTypeCode: string) {
  return captureSectionDefinitions.filter(
    (section) => !section.onlyForSaqCodes || section.onlyForSaqCodes.includes(saqTypeCode),
  );
}
