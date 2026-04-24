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
    title: "Parte 1. Información de contacto",
    scope: "FIXED_ALL_SAQS",
    filledBy: "EXECUTIVE_SETUP",
    details: "Se alimenta con la información del registro del cliente y la asignación administrada por el ejecutivo.",
  },
  {
    id: "part-2-executive-summary-fixed-1",
    title: "Parte 1a. Comerciante evaluado",
    scope: "FIXED_ALL_SAQS",
    filledBy: "CLIENT_DURING_SAQ",
    details: "Información general del comerciante y del contexto evaluado dentro del SAQ.",
  },
  {
    id: "part-2-executive-summary-fixed-2",
    title: "Parte 2a. Resumen ejecutivo",
    scope: "FIXED_ALL_SAQS",
    filledBy: "CLIENT_DURING_SAQ",
    details: "Bloque fijo del resumen ejecutivo que el cliente debe completar dentro del SAQ.",
  },
  {
    id: "part-2-executive-summary-fixed-3",
    title: "Parte 2b. Descripción de la función con tarjetas de pago",
    scope: "FIXED_ALL_SAQS",
    filledBy: "CLIENT_DURING_SAQ",
    details: "Descripción de funciones, plataformas y responsabilidades ligadas al flujo de pago.",
  },
  {
    id: "part-2-executive-summary-p2pe",
    title: "Parte 2. Información adicional P2PE",
    scope: "VARIABLE_P2PE_ONLY",
    filledBy: "CLIENT_DURING_SAQ",
    details: "Bloque adicional que solo aplica a implementaciones SAQ P2PE.",
    onlyForSaqCodes: [SAQ_P2PE_CODE],
  },
  {
    id: "part-2-executive-summary-fixed-4",
    title: "Parte 2c. Datos complementarios del entorno",
    scope: "FIXED_ALL_SAQS",
    filledBy: "CLIENT_DURING_SAQ",
    details: "Observaciones y datos complementarios del entorno evaluado.",
  },
  {
    id: "part-2-questionnaire",
    title: "Parte 2d. Cuestionario",
    scope: "VARIABLE_BY_SAQ",
    filledBy: "CLIENT_DURING_SAQ",
    details: "Sección variable por tipo de SAQ. Aquí cambia la estructura de preguntas y requisitos aplicables.",
  },
  {
    id: "part-2-system-summary",
    title: "Parte 2e. Resumen calculado por el sistema",
    scope: "VARIABLE_ALL_SAQS",
    filledBy: "SYSTEM_FROM_ANSWERS",
    details: "Se completa de forma automática a partir de las respuestas a los requisitos.",
  },
  {
    id: "part-2-selection-summary",
    title: "Parte 2f. Validación general según el SAQ",
    scope: "VARIABLE_ALL_SAQS",
    filledBy: "SYSTEM_FROM_SAQ_SELECTION",
    details: "Bloque variable que el sistema completa a partir del SAQ asignado y la validación general de respuestas.",
  },
  {
    id: "annex-b-ccw",
    title: "Anexo B. Ficha de control compensatorio",
    scope: "FIXED_ALL_SAQS",
    filledBy: "SYSTEM_FROM_ANSWERS",
    details: "La aplicación genera una ficha por cada requerimiento respondido como CCW con base en la información capturada por el cliente.",
    condition: "Visible cuando el cliente selecciona respuestas CCW.",
  },
  {
    id: "annex-c-not-applicable",
    title: "Anexo C. Explicación de requisitos no aplicables",
    scope: "FIXED_ALL_SAQS",
    filledBy: "SYSTEM_FROM_ANSWERS",
    details: "La aplicación genera el anexo con los requerimientos marcados como No Aplicable y sus justificaciones.",
    condition: "Visible cuando existen respuestas No Aplicable.",
  },
  {
    id: "annex-d-not-tested",
    title: "Anexo D. Explicación de requisitos no probados",
    scope: "FIXED_ALL_SAQS",
    filledBy: "SYSTEM_FROM_ANSWERS",
    details: "La aplicación genera el anexo con los requerimientos marcados como No Probado y su fecha de resolución.",
    condition: "Visible cuando existen respuestas No Probado.",
  },
  {
    id: "section-3-validation-certification",
    title: "Sección 3. Detalles de validación y certificación",
    scope: "FIXED_ALL_SAQS",
    filledBy: "SYSTEM_FROM_ANSWERS",
    details: "La primera validación de conformidad se calcula automáticamente a partir del estado global del cuestionario.",
  },
  {
    id: "section-3a-merchant-recognition",
    title: "Sección 3a. Reconocimiento del comerciante",
    scope: "FIXED_ALL_SAQS",
    filledBy: "CLIENT_AT_COMPLETION",
    details: "Bloque final que el cliente completa al concluir el SAQ.",
  },
];

const captureSectionDefinitions: CaptureSectionDefinition[] = [
  {
    id: "part-2-executive-summary-fixed-1",
    title: "Comerciante evaluado",
    details: "Ficha de captura para registrar el contexto general del comerciante y el alcance descrito por el cliente.",
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
    title: "Resumen ejecutivo",
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
    title: "Descripción de la función con tarjetas de pago",
    details: "Ficha de captura para registrar terceros, proveedores o responsabilidades compartidas dentro del flujo de pago.",
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
    title: "Datos complementarios del entorno",
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
    title: "Información adicional P2PE",
    details: "Ficha específica para entornos P2PE.",
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

export function getSaqSectionPlan(saqTypeCode: string) {
  return sectionDefinitions
    .filter((section) => !section.onlyForSaqCodes || section.onlyForSaqCodes.includes(saqTypeCode))
    .map((section, index) => ({
      id: section.id,
      title: section.title,
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
