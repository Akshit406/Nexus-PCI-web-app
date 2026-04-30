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
  inputType: "text" | "textarea" | "select" | "checkbox-group" | "radio-group" | "number" | "date";
  placeholder: string;
  options?: CaptureFieldOption[];
  required?: boolean;
  defaultValue?: string;
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
const SAQ_WITH_ELIGIBILITY_CODES = ["A", "A_EP", "B", "B_IP", "C", "C_VT"];
const LEGAL_EXCEPTION_ROW_COUNT = 12;

const yesNoOptions: CaptureFieldOption[] = [
  { value: "NO", label: "No" },
  { value: "YES", label: "Si" },
];

const paymentChannelOptions: CaptureFieldOption[] = [
  { value: "MOTO", label: "Pedido por correo / por telefono (MOTO)" },
  { value: "ECOMMERCE", label: "Comercio electronico" },
  { value: "CARD_PRESENT", label: "Presencial" },
];

function buildCardFunctionFields(): CaptureFieldDefinition[] {
  return Array.from({ length: 3 }, (_, index) => {
    const row = index + 1;
    return [
      {
        key: `card_function_${row}_channel`,
        label: `Fila ${row} - Canal`,
        inputType: "text" as const,
        placeholder: "Canal de pago seleccionado en la Parte 2a.",
        required: false,
      },
      {
        key: `card_function_${row}_description`,
        label: `Fila ${row} - Como la empresa almacena, procesa y/o transmite los datos del titular de la tarjeta`,
        inputType: "textarea" as const,
        placeholder: "Describa el flujo de datos del titular de la tarjeta para este canal.",
        required: false,
      },
    ];
  }).flat();
}

function buildFacilityFields(): CaptureFieldDefinition[] {
  return Array.from({ length: 4 }, (_, index) => {
    const row = index + 1;
    const required = row === 1;
    return [
      {
        key: `facility_${row}_type`,
        label: `Fila ${row} - Tipo de instalacion`,
        inputType: "text" as const,
        placeholder: row === 1 ? "Ejemplo: Centros de datos" : "Tipo de instalacion",
        required,
      },
      {
        key: `facility_${row}_count`,
        label: `Fila ${row} - Numero total de instalaciones`,
        inputType: "number" as const,
        placeholder: row === 1 ? "Ejemplo: 3" : "Numero total",
        required,
      },
      {
        key: `facility_${row}_locations`,
        label: `Fila ${row} - Ubicacion(es) de las instalaciones`,
        inputType: "text" as const,
        placeholder: row === 1 ? "Ejemplo: Boston, MA, USA" : "Ciudad, pais",
        required,
      },
    ];
  }).flat();
}

function buildValidatedProductFields(): CaptureFieldDefinition[] {
  return Array.from({ length: 4 }, (_, index) => {
    const row = index + 1;
    return [
      {
        key: `validated_product_${row}_name`,
        label: `Fila ${row} - Nombre del producto o solucion validado por PCI SSC`,
        inputType: "text" as const,
        placeholder: "Nombre del producto o solucion",
        required: false,
      },
      {
        key: `validated_product_${row}_version`,
        label: `Fila ${row} - Version del producto o solucion`,
        inputType: "text" as const,
        placeholder: "Version",
        required: false,
      },
      {
        key: `validated_product_${row}_standard`,
        label: `Fila ${row} - Estandar PCI SSC segun el cual se valido`,
        inputType: "text" as const,
        placeholder: "Estandar PCI SSC",
        required: false,
      },
      {
        key: `validated_product_${row}_reference`,
        label: `Fila ${row} - Numero de referencia de la lista PCI SSC`,
        inputType: "text" as const,
        placeholder: "Numero de referencia",
        required: false,
      },
      {
        key: `validated_product_${row}_expiration`,
        label: `Fila ${row} - Fecha de expiracion de la lista`,
        inputType: "date" as const,
        placeholder: "AAAA-MM-DD",
        required: false,
      },
    ];
  }).flat();
}

function buildP2peValidatedSolutionFields(): CaptureFieldDefinition[] {
  return [
    {
      key: "p2pe_solution_name",
      label: "Nombre de la solucion P2PE",
      inputType: "text",
      placeholder: "Nombre de la solucion P2PE validada.",
    },
    {
      key: "p2pe_provider",
      label: "Proveedor",
      inputType: "text",
      placeholder: "Proveedor de la solucion P2PE.",
    },
    {
      key: "p2pe_version",
      label: "Version",
      inputType: "text",
      placeholder: "Version de la solucion.",
    },
    {
      key: "p2pe_reference",
      label: "Numero de referencia PCI SSC",
      inputType: "text",
      placeholder: "Numero de referencia en PCI SSC.",
    },
    {
      key: "p2pe_expiration",
      label: "Fecha de expiracion",
      inputType: "date",
      placeholder: "AAAA-MM-DD",
    },
    {
      key: "p2pe_usage_description",
      label: "Descripcion de uso",
      inputType: "textarea",
      placeholder: "Describa como se utiliza la solucion P2PE dentro del entorno evaluado.",
    },
  ];
}

function buildLegalExceptionFields(): CaptureFieldDefinition[] {
  return Array.from({ length: LEGAL_EXCEPTION_ROW_COUNT }, (_, index) => {
    const row = index + 1;
    return [
      {
        key: `legal_exception_${row}_requirement`,
        label: `Fila ${row} - Requisito concerniente`,
        inputType: "text" as const,
        placeholder: "Se prellena con el requisito No Implementado.",
        required: false,
      },
      {
        key: `legal_exception_${row}_restriction`,
        label: `Fila ${row} - Detalles de como la restriccion legal impide que se cumpla con el requisito`,
        inputType: "textarea" as const,
        placeholder: "Explique la restriccion legal aplicable a este requisito.",
        required: false,
      },
    ];
  }).flat();
}

function eligibilityOptionsForSaq(saqTypeCode: string): CaptureFieldOption[] {
  const common = {
    A: [
      "El comerciante acepta pagos sin almacenar, procesar ni transmitir datos de tarjeta en sistemas propios.",
      "Todas las funciones de pago son subcontratadas a proveedores validados o compatibles con PCI DSS.",
      "El sitio del comerciante no recibe datos del titular de la tarjeta.",
    ],
    A_EP: [
      "El comerciante acepta pagos de comercio electronico y el sitio puede afectar la seguridad de la transaccion.",
      "El procesamiento de pago es realizado por un proveedor externo compatible con PCI DSS.",
      "El comerciante no almacena datos de tarjeta despues de la autorizacion.",
    ],
    B: [
      "El comerciante utiliza dispositivos de impresion o terminales independientes conectados por IP o telefono.",
      "El comerciante no almacena datos electronicos del titular de la tarjeta.",
      "El entorno cumple con los criterios del SAQ asignado por el ejecutivo.",
    ],
    B_IP: [
      "El comerciante utiliza terminales de pago independientes con conexion IP.",
      "Los terminales no estan conectados a otros sistemas dentro del entorno del comerciante.",
      "El comerciante no almacena datos electronicos del titular de la tarjeta.",
    ],
    C: [
      "El comerciante utiliza una aplicacion de pago conectada a Internet.",
      "El sistema de pago esta aislado de otros sistemas del comerciante.",
      "El comerciante no almacena datos electronicos del titular de la tarjeta.",
    ],
    C_VT: [
      "El comerciante ingresa pagos manualmente en una terminal virtual basada en navegador.",
      "La terminal virtual es provista por un tercero compatible con PCI DSS.",
      "El comerciante no almacena datos electronicos del titular de la tarjeta.",
    ],
  } as Record<string, string[]>;

  return (common[saqTypeCode] ?? common.B).map((label, index) => ({
    value: `eligibility_${index + 1}`,
    label,
  }));
}

function defaultEligibilityValue(saqTypeCode: string) {
  return JSON.stringify(eligibilityOptionsForSaq(saqTypeCode).map((option) => option.value));
}

function buildServiceProviderFields(): CaptureFieldDefinition[] {
  return Array.from({ length: 10 }, (_, index) => {
    const row = index + 1;
    return [
      {
        key: `service_provider_${row}_name`,
        label: `Fila ${row} - Nombre del proveedor de servicio`,
        inputType: "text" as const,
        placeholder: "Nombre del proveedor de servicio",
        required: false,
      },
      {
        key: `service_provider_${row}_description`,
        label: `Fila ${row} - Descripcion del servicio prestado`,
        inputType: "textarea" as const,
        placeholder: "Descripcion del servicio prestado",
        required: false,
      },
    ];
  }).flat();
}

const sectionDefinitions: SaqSectionDefinition[] = [
  {
    id: "part-1a-merchant-evaluated",
    title: "Parte 1a. Comerciante evaluado",
    scope: "FIXED_ALL_SAQS",
    filledBy: "EXECUTIVE_SETUP",
    details: "Informacion del comerciante evaluado tomada del registro del cliente.",
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
    onlyForSaqCodes: ["A", "A_EP", "B", "B_IP", "C", "C_VT", "D_MERCHANT"],
  },
  {
    id: "part-2e-p2pe-solution",
    title: "Parte 2e. Solucion P2PE validada por PCI SSC",
    scope: "VARIABLE_P2PE_ONLY",
    filledBy: "CLIENT_DURING_SAQ",
    details: "Version P2PE de la Parte 2e. Sustituye la tabla general de productos y soluciones validados.",
    onlyForSaqCodes: SAQ_P2PE_CODES,
  },
  {
    id: "part-2f-service-providers",
    title: "Parte 2f. Proveedores de servicios externos",
    scope: "FIXED_ALL_SAQS",
    filledBy: "CLIENT_DURING_SAQ",
    details: "Registro de proveedores externos que almacenan, procesan, transmiten o pueden afectar la seguridad del CDE.",
  },
  {
    id: "part-2h-saq-eligibility",
    title: "Parte 2h. Elegibilidad para llenar el SAQ",
    scope: "VARIABLE_BY_SAQ",
    filledBy: "CLIENT_DURING_SAQ",
    details: "Criterios de elegibilidad preseleccionados por el sistema segun el SAQ asignado.",
    onlyForSaqCodes: SAQ_WITH_ELIGIBILITY_CODES,
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
    title: "Seccion 2. Cuestionario de Autoevaluacion",
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
    id: "part-2a-payment-channels",
    title: "Parte 2a. Canales de Pago del Comerciante",
    details: "Indique todos los canales de pago utilizados por la empresa que se incluyen en esta Evaluacion. Si hay canales no incluidos, indique cuales son y por que se excluyen.",
    completionStage: "DURING_SAQ",
    fields: [
      {
        key: "included_payment_channels",
        label: "Canales de pago utilizados por la empresa que se incluyen en esta Evaluacion",
        inputType: "checkbox-group",
        placeholder: "",
        options: paymentChannelOptions,
      },
      {
        key: "has_excluded_payment_channels",
        label: "Hay algun canal de pago que no este incluido en esta evaluacion?",
        inputType: "radio-group",
        placeholder: "Selecciona una respuesta",
        options: yesNoOptions,
      },
      {
        key: "excluded_payment_channels_explanation",
        label: "En caso afirmativo, canal(es) no incluidos y motivo de exclusion",
        inputType: "textarea",
        placeholder: "Indique que canal(es) no estan incluidos en la evaluacion y explique brevemente por que se han excluido.",
        required: false,
      },
    ],
  },
  {
    id: "part-2b-cardholder-function",
    title: "Parte 2b. Descripcion de la Funcion con Tarjetas de Pago",
    details: "Para cada canal de pago incluido en esta Evaluacion seleccionado en la Parte 2a, describa como la empresa almacena, procesa y/o transmite los datos del titular de la tarjeta.",
    completionStage: "DURING_SAQ",
    fields: buildCardFunctionFields(),
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
        inputType: "radio-group",
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
    title: "Parte 2d. Localidades e Instalaciones en el Ambito de Aplicacion",
    details: "Enumere todos los tipos de ubicaciones fisicas o instalaciones en el ambito de la evaluacion PCI DSS.",
    completionStage: "DURING_SAQ",
    fields: buildFacilityFields(),
  },
  {
    id: "part-2e-validated-products",
    title: "Parte 2e. Productos y Soluciones Validados por PCI SSC",
    details: "Indique si el comerciante utiliza elementos identificados en listas de Productos y Soluciones Validados por PCI SSC y, en caso afirmativo, capture cada elemento en la tabla oficial.",
    completionStage: "DURING_SAQ",
    onlyForSaqCodes: ["A", "A_EP", "B", "B_IP", "C", "C_VT", "D_MERCHANT"],
    fields: [
      {
        key: "uses_pci_validated_products",
        label: "Utiliza el comerciante algun elemento identificado en alguna de las listas de Productos y Soluciones Validados por PCI SSC?",
        inputType: "radio-group",
        placeholder: "Selecciona una respuesta",
        options: yesNoOptions,
      },
      ...buildValidatedProductFields(),
    ],
  },
  {
    id: "part-2e-p2pe-solution",
    title: "Parte 2e. Solucion P2PE validada por PCI SSC",
    details: "Capture la informacion especifica de la solucion P2PE validada.",
    completionStage: "DURING_SAQ",
    onlyForSaqCodes: SAQ_P2PE_CODES,
    fields: buildP2peValidatedSolutionFields(),
  },
  {
    id: "part-2f-service-providers",
    title: "Parte 2f. Proveedores de Servicios Externos",
    details: "Registre relaciones con proveedores externos que almacenan, procesan, transmiten datos del titular, gestionan componentes dentro del alcance o podrian afectar la seguridad del CDE.",
    completionStage: "DURING_SAQ",
    fields: [
      {
        key: "providers_store_process_transmit",
        label: "Almacenan, procesan o transmiten datos del titular de la tarjeta en nombre del comerciante?",
        inputType: "radio-group",
        placeholder: "Selecciona una respuesta",
        options: yesNoOptions,
      },
      {
        key: "providers_manage_system_components",
        label: "Gestionan componentes del sistema incluidos en el ambito de la evaluacion PCI DSS del comerciante?",
        inputType: "radio-group",
        placeholder: "Selecciona una respuesta",
        options: yesNoOptions,
      },
      {
        key: "providers_affect_cde_security",
        label: "Podrian afectar la seguridad del CDE del comerciante?",
        inputType: "radio-group",
        placeholder: "Selecciona una respuesta",
        options: yesNoOptions,
      },
      ...buildServiceProviderFields(),
    ],
  },
  {
    id: "section-3-validation-certification",
    title: "Seccion 3. Detalles de Validacion y Certificacion",
    details: "El estado de conformidad lo calcula el sistema. Si existe No Implementado, el cliente puede indicar excepcion legal y explicar la restriccion.",
    completionStage: "AT_COMPLETION",
    fields: [
      {
        key: "legal_exception_claimed",
        label: "Conforme, pero con una excepcion legal",
        inputType: "radio-group",
        placeholder: "Selecciona una respuesta",
        options: yesNoOptions,
        defaultValue: "NO",
      },
      ...buildLegalExceptionFields(),
    ],
  },
  {
    id: "section-3a-merchant-recognition",
    title: "Seccion 3a. Reconocimiento del comerciante",
    details: "El cliente marca las tres casillas. El nombre, firma y fecha se toman del sistema.",
    completionStage: "AT_COMPLETION",
    fields: [
      {
        key: "merchant_acknowledgements",
        label: "Confirmaciones del comerciante",
        inputType: "checkbox-group",
        placeholder: "",
        options: [
          {
            value: "completed_according_to_instructions",
            label: "El SAQ fue completado de acuerdo con las instrucciones que en el figuran.",
          },
          {
            value: "information_represents_results",
            label: "Toda la informacion contenida en el SAQ y esta declaracion representa fielmente los resultados de la evaluacion.",
          },
          {
            value: "controls_will_be_maintained",
            label: "Los controles PCI DSS se mantendran en todo momento, segun corresponda al entorno del comerciante.",
          },
        ],
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
  const sections = captureSectionDefinitions.filter(
    (section) => !section.onlyForSaqCodes || section.onlyForSaqCodes.includes(saqTypeCode),
  );
  if (SAQ_WITH_ELIGIBILITY_CODES.includes(saqTypeCode)) {
    sections.splice(
      sections.findIndex((section) => section.id === "part-2e-p2pe-solution") >= 0 ? sections.length : Math.max(0, sections.findIndex((section) => section.id === "part-2f-service-providers") + 1),
      0,
      {
        id: "part-2h-saq-eligibility",
        title: "Parte 2h. Elegibilidad para llenar el SAQ",
        details: "El sistema preselecciona los criterios de elegibilidad del SAQ asignado. Si algun criterio no es correcto, solicite revision al ejecutivo.",
        completionStage: "DURING_SAQ",
        onlyForSaqCodes: SAQ_WITH_ELIGIBILITY_CODES,
        fields: [
          {
            key: "eligibility_confirmations",
            label: "Criterios de elegibilidad confirmados",
            inputType: "checkbox-group",
            placeholder: "",
            options: eligibilityOptionsForSaq(saqTypeCode),
            defaultValue: defaultEligibilityValue(saqTypeCode),
          },
          {
            key: "eligibility_change_notes",
            label: "Notas para solicitar revision o cambio de SAQ",
            inputType: "textarea",
            placeholder: "Explique que criterio no corresponde o por que requiere revision del SAQ asignado.",
            required: false,
          },
        ],
      },
    );
  }

  return sections;
}
