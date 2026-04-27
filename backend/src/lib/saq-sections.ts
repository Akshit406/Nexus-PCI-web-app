export type SaqSectionScope =
  | "FIXED_ALL_SAQS"
  | "VARIABLE_ALL_SAQS"
  | "VARIABLE_BY_SAQ"
  | "VARIABLE_P2PE_ONLY";

export type SaqSectionFilledBy =
  | "EXECUTIVE_SETUP"
  | "CLIENT_DURING_SAQ"
  | "CLIENT_AT_COMPLETION"
  | "SYSTEM_FROM_ANSWERS";

export type SaqSectionDefinition = {
  id: string;
  title: string;
  scope: SaqSectionScope;
  filledBy: SaqSectionFilledBy;
  details: string;
  condition?: string;
  onlyForSaqCodes?: string[];
};

export type CaptureFieldOption = {
  value: string;
  label: string;
};

export type CaptureFieldDefinition = {
  key: string;
  label: string;
  inputType: "text" | "textarea" | "select" | "checkbox-group";
  placeholder: string;
  options?: CaptureFieldOption[];
  required?: boolean;
};

export type CaptureSectionDefinition = {
  id: string;
  title: string;
  details: string;
  completionStage: "DURING_SAQ" | "AT_COMPLETION";
  onlyForSaqCodes?: string[];
  fields: CaptureFieldDefinition[];
};

const SAQ_P2PE_CODES = ["P2PE", "D_P2PE"];

const yesNoOptions: CaptureFieldOption[] = [
  { value: "NO", label: "No" },
  { value: "YES", label: "Si" },
];

const paymentChannelOptions: CaptureFieldOption[] = [
  { value: "MOTO", label: "Pedido por correo / por telefono (MOTO)" },
  { value: "ECOMMERCE", label: "Comercio electronico" },
  { value: "CARD_PRESENT", label: "Presencial" },
];

const sectionDefinitions: SaqSectionDefinition[] = [
  {
    id: "part-1-evaluation-information",
    title: "Parte 1. Informacion de contacto",
    scope: "FIXED_ALL_SAQS",
    filledBy: "EXECUTIVE_SETUP",
    details: "Se alimenta con la informacion del registro del cliente y la asignacion administrada por el ejecutivo.",
  },
  {
    id: "part-1a-merchant-evaluated",
    title: "Parte 1a. Comerciante evaluado",
    scope: "FIXED_ALL_SAQS",
    filledBy: "CLIENT_DURING_SAQ",
    details: "Informacion general del comerciante evaluado dentro del alcance PCI DSS.",
  },
  {
    id: "part-2a-payment-channels",
    title: "Parte 2a. Canales de pago del comerciante",
    scope: "FIXED_ALL_SAQS",
    filledBy: "CLIENT_DURING_SAQ",
    details: "Seleccione todos los canales de pago utilizados por la empresa que se incluyen en esta evaluacion.",
  },
  {
    id: "part-2b-cardholder-function",
    title: "Parte 2b. Descripcion de la funcion con tarjetas de pago",
    scope: "FIXED_ALL_SAQS",
    filledBy: "CLIENT_DURING_SAQ",
    details: "Para cada canal incluido, describa como la empresa almacena, procesa y/o transmite datos del titular de la tarjeta.",
  },
  {
    id: "part-2c-cardholder-environment",
    title: "Parte 2c. Descripcion del entorno de las tarjetas de pago",
    scope: "FIXED_ALL_SAQS",
    filledBy: "CLIENT_DURING_SAQ",
    details: "Descripcion de alto nivel del entorno cubierto por esta evaluacion, incluyendo CDE, componentes criticos y segmentacion.",
  },
  {
    id: "part-2d-scope-facilities",
    title: "Parte 2d. Localidades e instalaciones en el ambito de aplicacion",
    scope: "FIXED_ALL_SAQS",
    filledBy: "CLIENT_DURING_SAQ",
    details: "Listado de tipos de ubicaciones fisicas o instalaciones dentro del alcance de la evaluacion PCI DSS.",
  },
  {
    id: "part-2e-validated-products",
    title: "Parte 2e. Productos y soluciones validados por PCI SSC",
    scope: "FIXED_ALL_SAQS",
    filledBy: "CLIENT_DURING_SAQ",
    details: "Indique si el comerciante utiliza elementos identificados en listas de productos y soluciones validados por PCI SSC.",
  },
  {
    id: "part-2f-service-providers",
    title: "Parte 2f. Proveedores de servicios externos",
    scope: "FIXED_ALL_SAQS",
    filledBy: "CLIENT_DURING_SAQ",
    details: "Registro de proveedores externos que almacenan, procesan, transmiten o pueden afectar la seguridad del CDE.",
  },
  {
    id: "part-2-p2pe-additional",
    title: "Parte 2. Informacion adicional P2PE",
    scope: "VARIABLE_P2PE_ONLY",
    filledBy: "CLIENT_DURING_SAQ",
    details: "Bloque adicional que solo aplica a implementaciones SAQ P2PE.",
    onlyForSaqCodes: SAQ_P2PE_CODES,
  },
  {
    id: "part-2g-assessment-summary",
    title: "Parte 2g. Resumen de la evaluacion",
    scope: "VARIABLE_ALL_SAQS",
    filledBy: "SYSTEM_FROM_ANSWERS",
    details: "Resumen automatico de respuestas por requisito PCI DSS, calculado a partir del cuestionario.",
  },
  {
    id: "part-2-questionnaire",
    title: "Cuestionario de requisitos PCI DSS",
    scope: "VARIABLE_BY_SAQ",
    filledBy: "CLIENT_DURING_SAQ",
    details: "Seccion variable por tipo de SAQ. Aqui cambia la estructura de preguntas y requisitos aplicables.",
  },
  {
    id: "annex-b-ccw",
    title: "Anexo B. Ficha de control compensatorio",
    scope: "FIXED_ALL_SAQS",
    filledBy: "SYSTEM_FROM_ANSWERS",
    details: "La aplicacion genera una ficha por cada requerimiento respondido como CCW con base en la informacion capturada por el cliente.",
    condition: "Visible cuando el cliente selecciona respuestas CCW.",
  },
  {
    id: "annex-c-not-applicable",
    title: "Anexo C. Explicacion de requisitos no aplicables",
    scope: "FIXED_ALL_SAQS",
    filledBy: "SYSTEM_FROM_ANSWERS",
    details: "La aplicacion genera el anexo con los requerimientos marcados como No Aplicable y sus justificaciones.",
    condition: "Visible cuando existen respuestas No Aplicable.",
  },
  {
    id: "annex-d-not-tested",
    title: "Anexo D. Explicacion de requisitos no probados",
    scope: "FIXED_ALL_SAQS",
    filledBy: "SYSTEM_FROM_ANSWERS",
    details: "La aplicacion genera el anexo con los requerimientos marcados como No Probado y su fecha de resolucion.",
    condition: "Visible cuando existen respuestas No Probado.",
  },
  {
    id: "section-3-validation-certification",
    title: "Seccion 3. Detalles de validacion y certificacion",
    scope: "FIXED_ALL_SAQS",
    filledBy: "SYSTEM_FROM_ANSWERS",
    details: "La primera validacion de conformidad se calcula automaticamente a partir del estado global del cuestionario.",
  },
  {
    id: "section-3a-merchant-recognition",
    title: "Seccion 3a. Reconocimiento del comerciante",
    scope: "FIXED_ALL_SAQS",
    filledBy: "CLIENT_AT_COMPLETION",
    details: "Bloque final que el cliente completa al concluir el SAQ.",
  },
];

const captureSectionDefinitions: CaptureSectionDefinition[] = [
  {
    id: "part-1a-merchant-evaluated",
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
    id: "part-2a-payment-channels",
    title: "Canales de pago del comerciante",
    details: "Seleccione todos los canales de pago utilizados por la empresa que se incluyen en esta evaluacion.",
    completionStage: "DURING_SAQ",
    fields: [
      {
        key: "included_payment_channels",
        label: "Canales incluidos en esta evaluacion",
        inputType: "checkbox-group",
        placeholder: "",
        options: paymentChannelOptions,
      },
      {
        key: "has_excluded_payment_channels",
        label: "Hay algun canal de pago que no este incluido en esta evaluacion?",
        inputType: "select",
        placeholder: "Selecciona una respuesta",
        options: yesNoOptions,
      },
      {
        key: "excluded_payment_channels_explanation",
        label: "Canales no incluidos y motivo de exclusion",
        inputType: "textarea",
        placeholder: "Si respondiste Si, indica los canales no incluidos y explica brevemente por que se excluyeron.",
        required: false,
      },
    ],
  },
  {
    id: "part-2b-cardholder-function",
    title: "Descripcion de la funcion con tarjetas de pago",
    details: "Complete el formato oficial: canal y como la empresa almacena, procesa y/o transmite datos del titular de la tarjeta.",
    completionStage: "DURING_SAQ",
    fields: [
      {
        key: "moto_cardholder_data_flow",
        label: "MOTO - Como almacena, procesa y/o transmite datos del titular",
        inputType: "textarea",
        placeholder: "Completa solo si el canal MOTO fue incluido en la Parte 2a.",
        required: false,
      },
      {
        key: "ecommerce_cardholder_data_flow",
        label: "Comercio electronico - Como almacena, procesa y/o transmite datos del titular",
        inputType: "textarea",
        placeholder: "Completa solo si el canal de comercio electronico fue incluido en la Parte 2a.",
        required: false,
      },
      {
        key: "present_cardholder_data_flow",
        label: "Presencial - Como almacena, procesa y/o transmite datos del titular",
        inputType: "textarea",
        placeholder: "Completa solo si el canal presencial fue incluido en la Parte 2a.",
        required: false,
      },
    ],
  },
  {
    id: "part-2c-cardholder-environment",
    title: "Descripcion del entorno de las tarjetas de pago",
    details: "Capture la descripcion de alto nivel del CDE y confirme si existe segmentacion para reducir alcance.",
    completionStage: "DURING_SAQ",
    fields: [
      {
        key: "environment_description",
        label: "Descripcion de alto nivel del entorno",
        inputType: "textarea",
        placeholder: "Incluye conexiones hacia/desde el CDE, componentes criticos y otros componentes que puedan afectar la seguridad.",
      },
      {
        key: "uses_segmentation",
        label: "El entorno incluye segmentacion para reducir el alcance?",
        inputType: "select",
        placeholder: "Selecciona una respuesta",
        options: yesNoOptions,
      },
      {
        key: "segmentation_notes",
        label: "Descripcion de la segmentacion",
        inputType: "textarea",
        placeholder: "Si respondiste Si, describe la segmentacion aplicada.",
        required: false,
      },
    ],
  },
  {
    id: "part-2d-scope-facilities",
    title: "Localidades e instalaciones en el ambito de aplicacion",
    details: "Registre las instalaciones segun el formato oficial: tipo, numero total y ubicaciones.",
    completionStage: "DURING_SAQ",
    fields: [
      {
        key: "facilities_in_scope",
        label: "Instalaciones dentro del alcance",
        inputType: "textarea",
        placeholder: "Ejemplo: Centros de datos | 3 | Ciudad de Mexico, Guadalajara, Monterrey.",
      },
    ],
  },
  {
    id: "part-2e-validated-products",
    title: "Productos y soluciones validados por PCI SSC",
    details: "Capture esta parte como en el SAQ oficial, no como resumen calculado del sistema.",
    completionStage: "DURING_SAQ",
    fields: [
      {
        key: "uses_pci_validated_products",
        label: "Utiliza elementos identificados en listas de productos y soluciones validados por PCI SSC?",
        inputType: "select",
        placeholder: "Selecciona una respuesta",
        options: yesNoOptions,
      },
      {
        key: "pci_validated_products",
        label: "Productos o soluciones validados por PCI SSC",
        inputType: "textarea",
        placeholder: "Nombre | Version | Estandar PCI SSC | Numero de referencia | Fecha de expiracion.",
        required: false,
      },
    ],
  },
  {
    id: "part-2f-service-providers",
    title: "Proveedores de servicios externos",
    details: "Registre relaciones con terceros que puedan almacenar, procesar, transmitir o afectar la seguridad del CDE.",
    completionStage: "DURING_SAQ",
    fields: [
      {
        key: "providers_store_process_transmit",
        label: "Hay proveedores que almacenan, procesan o transmiten datos del titular en nombre del comerciante?",
        inputType: "select",
        placeholder: "Selecciona una respuesta",
        options: yesNoOptions,
      },
      {
        key: "providers_manage_system_components",
        label: "Hay proveedores que gestionan componentes del sistema dentro del alcance PCI DSS?",
        inputType: "select",
        placeholder: "Selecciona una respuesta",
        options: yesNoOptions,
      },
      {
        key: "providers_affect_cde_security",
        label: "Hay proveedores que podrian afectar la seguridad del CDE?",
        inputType: "select",
        placeholder: "Selecciona una respuesta",
        options: yesNoOptions,
      },
      {
        key: "service_provider_details",
        label: "Nombre del proveedor y descripcion del servicio",
        inputType: "textarea",
        placeholder: "Si alguna respuesta fue Si, agrega nombre del proveedor y descripcion del servicio prestado.",
        required: false,
      },
    ],
  },
  {
    id: "part-2-p2pe-additional",
    title: "Informacion adicional P2PE",
    details: "Ficha especifica para entornos P2PE.",
    completionStage: "DURING_SAQ",
    onlyForSaqCodes: SAQ_P2PE_CODES,
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
