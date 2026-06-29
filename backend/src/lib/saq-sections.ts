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

export type OfficialSectionLike = {
  id: string;
  title?: string | null;
};

const SAQ_P2PE_CODES = ["P2PE", "D_P2PE", "SPOC", "SPoC"];
const SAQ_SERVICE_PROVIDER_CODES = ["D_SERVICE_PROVIDER"];
const SAQ_WITH_ELIGIBILITY_CODES = ["A", "A_EP", "B", "B_IP", "C", "C_VT", "P2PE", "D_P2PE", "SPOC", "SPoC"];
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

function buildValidatedPaymentSolutionFields(saqTypeCode: string): CaptureFieldDefinition[] {
  const solutionKind = ["SPOC", "SPoC"].includes(saqTypeCode) ? "SPoC" : "P2PE";
  return [
    {
      key: "payment_solution_provider_name",
      label: `Nombre del proveedor de soluciones ${solutionKind}`,
      inputType: "text",
      placeholder: `Proveedor de la solucion ${solutionKind} validada.`,
    },
    {
      key: "payment_solution_name",
      label: `Nombre de la solucion ${solutionKind}`,
      inputType: "text",
      placeholder: `Nombre oficial de la solucion ${solutionKind}.`,
    },
    {
      key: "payment_solution_reference",
      label: `Lista de soluciones ${solutionKind} - Referencia #`,
      inputType: "text",
      placeholder: "Numero de referencia en PCI SSC.",
    },
    {
      key: "payment_solution_listed_devices",
      label: solutionKind === "SPoC"
        ? "Lista de dispositivos SCRP utilizados por el comerciante"
        : "Dispositivos POI listados utilizados por el comerciante",
      inputType: "textarea",
      placeholder: "Enumere los dispositivos incluidos en la lista oficial de la solucion.",
    },
    {
      key: "payment_solution_reevaluation_date",
      label: "Fecha de reevaluacion de la solucion",
      inputType: "date",
      placeholder: "AAAA-MM-DD",
    },
    ...(solutionKind === "SPoC"
      ? [{
          key: "payment_solution_annual_checkpoint_date",
          label: "Fecha del punto de control anual de la solucion SPoC",
          inputType: "date" as const,
          placeholder: "AAAA-MM-DD",
        }]
      : []),
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
      "El comerciante solo acepta transacciones sin tarjeta (comercio electronico o pedidos por correo o telefono).",
      "Todo el procesamiento de datos del titular de la tarjeta se subcontrata por completo a un TPSP/procesador de pagos en conformidad con PCI DSS.",
      "El comerciante no almacena, procesa ni transmite electronicamente datos del titular de la tarjeta en sus sistemas o instalaciones.",
      "El comerciante ha confirmado que los TPSP estan en conformidad con PCI DSS para los servicios utilizados.",
      "Cualquier dato del titular de la tarjeta conservado por el comerciante esta impreso y no se recibe electronicamente.",
      "Para comercio electronico, todos los elementos de los formularios de pago entregados al navegador se originan unica y directamente en un TPSP/procesador de pagos en conformidad con PCI DSS.",
      "Para comercio electronico, el comerciante ha confirmado que su sitio no es susceptible a ataques de scripts que puedan afectar sus sistemas de comercio electronico.",
    ],
    A_EP: [
      "El comerciante solo acepta transacciones de comercio electronico.",
      "Todo el procesamiento de datos del titular de la tarjeta, excepto la pagina de pago, se subcontrata a un TPSP/procesador de pagos en conformidad con PCI DSS.",
      "El sitio web de comercio electronico del comerciante no recibe datos del titular de la tarjeta, pero controla como los clientes o sus datos son redirigidos al TPSP/procesador.",
      "Si el sitio web del comerciante esta alojado en un TPSP, el TPSP cumple todos los requisitos aplicables de PCI DSS.",
      "Cada elemento de las paginas de pago entregadas al navegador del cliente se origina en el sitio web del comerciante o en un TPSP en conformidad con PCI DSS.",
      "El comerciante no almacena, procesa ni transmite electronicamente datos del titular de la tarjeta en sus sistemas o instalaciones.",
      "El comerciante ha confirmado que sus TPSP estan en conformidad con PCI DSS para los servicios utilizados.",
      "Cualquier dato del titular de la tarjeta conservado por el comerciante esta impreso y no se recibe electronicamente.",
    ],
    B: [
      "El comerciante utiliza unicamente una impresora y/o terminales autonomos de marcacion para recabar informacion de tarjetas de pago.",
      "Los terminales autonomos de acceso telefonico no estan conectados a ningun otro sistema del entorno comercial.",
      "Los terminales autonomos de acceso telefonico no estan conectados a Internet.",
      "El comerciante no almacena datos del titular de la tarjeta en formato electronico.",
      "Cualquier dato del titular de la tarjeta conservado por el comerciante esta impreso y no se recibe electronicamente.",
    ],
    B_IP: [
      "El comerciante solo utiliza dispositivos PTS POI autonomos aprobados por PCI, conectados via IP al procesador de pagos.",
      "Los dispositivos PTS POI autonomos conectados por IP estan validados en el programa PTS POI publicado por PCI SSC.",
      "Los dispositivos PTS POI autonomos conectados por IP no estan conectados a ningun otro sistema dentro del entorno del comerciante.",
      "La unica transmision de datos del titular de la tarjeta se realiza desde los dispositivos PTS POI aprobados al procesador de pagos.",
      "El dispositivo PTS POI no depende de otro dispositivo para conectarse al procesador de pagos.",
      "El comerciante no almacena datos del titular de la tarjeta en formato electronico.",
      "Cualquier dato del titular de la tarjeta conservado por el comerciante esta impreso y no se recibe electronicamente.",
    ],
    C: [
      "El comerciante tiene un sistema de aplicacion de pago y una conexion a Internet en el mismo dispositivo y/o en la misma LAN.",
      "El sistema de aplicacion de pagos no esta conectado a ningun otro sistema dentro del entorno del comerciante.",
      "La ubicacion fisica del entorno POS no esta conectada a otras locaciones y cualquier LAN es para una sola ubicacion.",
      "El comerciante no almacena datos del titular de la tarjeta en formato electronico.",
      "Cualquier dato del titular de la tarjeta conservado por el comerciante esta impreso y no se recibe electronicamente.",
    ],
    C_VT: [
      "El unico procesamiento de pagos se realiza a traves de una terminal de pago virtual accedida mediante un navegador web conectado a Internet.",
      "La terminal de pago virtual es suministrada y alojada por un proveedor de servicios externo en conformidad con PCI DSS.",
      "La terminal virtual solo es accesible desde un dispositivo informatico aislado en una unica locacion y no conectado a otras locaciones o sistemas.",
      "El dispositivo informatico no tiene instalado software que almacene datos del titular de la tarjeta.",
      "El dispositivo informatico no tiene hardware conectado utilizado para capturar o almacenar datos del titular de la tarjeta.",
      "El comerciante no recibe, transmite ni almacena electronicamente datos del titular de la tarjeta por ningun canal.",
      "Cualquier dato del titular de la tarjeta conservado por el comerciante esta impreso y no se recibe electronicamente.",
    ],
    P2PE: [
      "Todo el procesamiento de pagos se realiza a traves de una solucion P2PE validada por PCI.",
      "Los unicos sistemas del entorno del comerciante que almacenan, procesan o transmiten datos del titular son terminales de pago de una solucion P2PE listada por PCI.",
      "El comerciante no recibe, transmite ni almacena datos del titular de la tarjeta por medios electronicos.",
      "Cualquier dato del titular de la tarjeta conservado por el comerciante esta impreso y no se recibe electronicamente.",
      "El comerciante ha implementado todos los controles del Manual de Instrucciones P2PE suministrado por el proveedor de la solucion P2PE.",
    ],
    D_P2PE: [
      "Todo el procesamiento de pagos se realiza a traves de una solucion P2PE validada por PCI.",
      "Los unicos sistemas del entorno del comerciante que almacenan, procesan o transmiten datos del titular son terminales de pago de una solucion P2PE listada por PCI.",
      "El comerciante no recibe, transmite ni almacena datos del titular de la tarjeta por medios electronicos.",
      "Cualquier dato del titular de la tarjeta conservado por el comerciante esta impreso y no se recibe electronicamente.",
      "El comerciante ha implementado todos los controles del Manual de Instrucciones P2PE suministrado por el proveedor de la solucion P2PE.",
    ],
    SPOC: [
      "Todo el procesamiento de pagos se realiza unicamente a traves de un canal de pago con tarjeta presencial.",
      "Toda la entrada de datos de tarjetahabiente se realiza a traves de un SCRP que forma parte de una solucion SPoC validada, aprobada y listada por PCI SSC.",
      "Los unicos sistemas en el entorno SPoC del comerciante que almacenan, procesan o transmiten datos del titular son los usados como parte de la solucion SPoC validada.",
      "El comerciante no recibe, transmite ni almacena datos del titular de la tarjeta por medios electronicos.",
      "Este canal de pagos no esta conectado a ningun otro sistema dentro del entorno del comerciante.",
      "Cualquier dato del titular de la tarjeta conservado por el comerciante esta impreso y no se recibe electronicamente.",
      "El comerciante ha implementado todos los controles de la guia del usuario SPoC proporcionada por el proveedor de la solucion SPoC.",
    ],
    SPoC: [
      "Todo el procesamiento de pagos se realiza unicamente a traves de un canal de pago con tarjeta presencial.",
      "Toda la entrada de datos de tarjetahabiente se realiza a traves de un SCRP que forma parte de una solucion SPoC validada, aprobada y listada por PCI SSC.",
      "Los unicos sistemas en el entorno SPoC del comerciante que almacenan, procesan o transmiten datos del titular son los usados como parte de la solucion SPoC validada.",
      "El comerciante no recibe, transmite ni almacena datos del titular de la tarjeta por medios electronicos.",
      "Este canal de pagos no esta conectado a ningun otro sistema dentro del entorno del comerciante.",
      "Cualquier dato del titular de la tarjeta conservado por el comerciante esta impreso y no se recibe electronicamente.",
      "El comerciante ha implementado todos los controles de la guia del usuario SPoC proporcionada por el proveedor de la solucion SPoC.",
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

function serviceProviderPart2aSection(): CaptureSectionDefinition {
  return {
    id: "part-2a-payment-channels",
    title: "Parte 2a. Servicios evaluados del proveedor de servicios",
    details: "Indique los servicios del proveedor de servicios que se incluyen en esta evaluacion.",
    completionStage: "DURING_SAQ",
    onlyForSaqCodes: SAQ_SERVICE_PROVIDER_CODES,
    fields: [
      {
        key: "services_evaluated",
        label: "Servicios evaluados",
        inputType: "textarea",
        placeholder: "Describa los servicios incluidos en esta evaluacion.",
      },
      {
        key: "service_1",
        label: "Servicio 1",
        inputType: "text",
        placeholder: "Primer servicio evaluado.",
      },
      {
        key: "service_2",
        label: "Servicio 2",
        inputType: "text",
        placeholder: "Segundo servicio evaluado.",
        required: false,
      },
      {
        key: "service_3",
        label: "Servicio 3",
        inputType: "text",
        placeholder: "Tercer servicio evaluado.",
        required: false,
      },
      {
        key: "service_other",
        label: "Otros",
        inputType: "text",
        placeholder: "Otros servicios incluidos.",
        required: false,
      },
      {
        key: "service_excluded_reason",
        label: "Motivo de exclusion de servicios no incluidos",
        inputType: "textarea",
        placeholder: "Indique servicios no incluidos y el motivo de exclusion, si aplica.",
        required: false,
      },
    ],
  };
}

function serviceProviderPart2bSection(): CaptureSectionDefinition {
  return {
    id: "part-2b-cardholder-function",
    title: "Parte 2b. Descripcion de la funcion del proveedor de servicios",
    details: "Describa como el proveedor de servicios almacena, procesa, transmite o puede influir en la seguridad de los datos del titular de la tarjeta.",
    completionStage: "DURING_SAQ",
    onlyForSaqCodes: SAQ_SERVICE_PROVIDER_CODES,
    fields: [
      {
        key: "service_provider_stores_processes_transmits",
        label: "Describe como el proveedor de servicios almacena, procesa o transmite datos del titular de la tarjeta",
        inputType: "textarea",
        placeholder: "Describa la funcion relacionada con datos del titular de la tarjeta.",
      },
      {
        key: "service_provider_security_influence",
        label: "Describe como el proveedor de servicios participa o tiene la capacidad de influir en la seguridad de los datos del titular de la tarjeta",
        inputType: "textarea",
        placeholder: "Describa la capacidad de influir en la seguridad del CDE o de los datos.",
      },
    ],
  };
}

function adaptSectionForSaq(section: CaptureSectionDefinition, saqTypeCode: string) {
  if (SAQ_SERVICE_PROVIDER_CODES.includes(saqTypeCode) && section.id === "part-2a-payment-channels") {
    return serviceProviderPart2aSection();
  }
  if (SAQ_SERVICE_PROVIDER_CODES.includes(saqTypeCode) && section.id === "part-2b-cardholder-function") {
    return serviceProviderPart2bSection();
  }
  if (section.id === "part-2a-payment-channels" && ["P2PE", "D_P2PE", "SPOC", "SPoC"].includes(saqTypeCode)) {
    const allowedChannels = ["SPOC", "SPoC"].includes(saqTypeCode) ? ["CARD_PRESENT"] : ["MOTO", "CARD_PRESENT"];
    return {
      ...section,
      fields: section.fields.map((field) => field.key === "included_payment_channels"
        ? { ...field, options: field.options?.filter((option) => allowedChannels.includes(option.value)) }
        : field),
    };
  }
  if (section.id === "part-2e-p2pe-solution") {
    const isSpoc = ["SPOC", "SPoC"].includes(saqTypeCode);
    return {
      ...section,
      title: isSpoc
        ? "Parte 2e. Solucion validada de Entrada de PIN basada en software en COTS (SPoC)"
        : "Parte 2e. Solucion P2PE validada por PCI SSC",
      details: `Proporcione la informacion de la solucion ${isSpoc ? "SPoC" : "P2PE"} validada que utiliza el comerciante.`,
      fields: buildValidatedPaymentSolutionFields(saqTypeCode),
    };
  }
  return section;
}

function adaptPlanSectionForSaq(section: SaqSectionDefinition, saqTypeCode: string) {
  if (SAQ_SERVICE_PROVIDER_CODES.includes(saqTypeCode) && section.id === "part-2a-payment-channels") {
    return {
      ...section,
      title: "Parte 2a. Servicios evaluados del proveedor de servicios",
      details: "Servicios del proveedor de servicios incluidos en esta evaluacion.",
    };
  }
  if (SAQ_SERVICE_PROVIDER_CODES.includes(saqTypeCode) && section.id === "part-2b-cardholder-function") {
    return {
      ...section,
      title: "Parte 2b. Descripcion de la funcion del proveedor de servicios",
      details: "Descripcion de como el proveedor almacena, procesa, transmite o influye en la seguridad de datos del titular.",
    };
  }
  return section;
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
    id: "part-1b-assessor",
    title: "Parte 1b. Asesor",
    scope: "FIXED_ALL_SAQS",
    filledBy: "EXECUTIVE_SETUP",
    details: "Informacion del ISA/QSA tomada de la configuracion de la certificacion.",
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
    onlyForSaqCodes: ["A", "A_EP", "B", "B_IP", "C", "C_VT", "D_MERCHANT", "D_SERVICE_PROVIDER"],
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
    title: "Parte 3a. Reconocimiento del comerciante",
    scope: "FIXED_ALL_SAQS",
    filledBy: "CLIENT_AT_COMPLETION",
    details: "Bloque final que el cliente completa al concluir el SAQ.",
  },
  {
    id: "section-3b-merchant-declaration",
    title: "Parte 3b. Declaracion del comerciante",
    scope: "FIXED_ALL_SAQS",
    filledBy: "SYSTEM_FROM_ANSWERS",
    details: "Firma, nombre, cargo y fecha del comerciante usados en la declaracion oficial.",
  },
  {
    id: "section-3c-qsa-declaration",
    title: "Parte 3c. Declaracion del Asesor de Seguridad Calificado (QSA)",
    scope: "FIXED_ALL_SAQS",
    filledBy: "EXECUTIVE_SETUP",
    details: "Datos del QSA usados por el documento oficial cuando correspondan.",
  },
  {
    id: "section-3d-isa-participation",
    title: "Parte 3d. Participacion del Asesor de Seguridad Interna (ISA)",
    scope: "FIXED_ALL_SAQS",
    filledBy: "EXECUTIVE_SETUP",
    details: "Datos del ISA usados por el documento oficial cuando correspondan.",
  },
  {
    id: "section-4-action-plan",
    title: "Parte 4. Plan de accion para estado de No Conformidad",
    scope: "FIXED_ALL_SAQS",
    filledBy: "SYSTEM_FROM_ANSWERS",
    details: "Se completa cuando existen requisitos No Implementado que resultan en No Conformidad.",
    condition: "Visible para documentar requisitos No Implementado que resultan en No Conformidad.",
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
    onlyForSaqCodes: ["A", "A_EP", "B", "B_IP", "C", "C_VT", "D_MERCHANT", "D_SERVICE_PROVIDER"],
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
    fields: buildValidatedPaymentSolutionFields("P2PE"),
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
    title: "Parte 3a. Reconocimiento del comerciante",
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
    .map((section) => adaptPlanSectionForSaq(section, saqTypeCode))
    .map((section, index) => ({
      id: section.id,
      title: section.title,
      details: section.details,
      condition: section.condition ?? null,
      displayOrder: index + 1,
    }));
}

export function getSaqCaptureSections(saqTypeCode: string) {
  const sections = captureSectionDefinitions
    .filter((section) => !section.onlyForSaqCodes || section.onlyForSaqCodes.includes(saqTypeCode))
    .map((section) => adaptSectionForSaq(section, saqTypeCode));
  if (SAQ_WITH_ELIGIBILITY_CODES.includes(saqTypeCode)) {
    const providersIndex = sections.findIndex((section) => section.id === "part-2f-service-providers");
    const insertIndex = providersIndex >= 0 ? providersIndex + 1 : sections.length;
    sections.splice(
      insertIndex,
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

function sectionMatchesSaq(section: { onlyForSaqCodes?: string[] }, saqTypeCode: string) {
  return !section.onlyForSaqCodes || section.onlyForSaqCodes.includes(saqTypeCode);
}

function staticPlanById(saqTypeCode: string) {
  return new Map(
    sectionDefinitions
      .filter((section) => sectionMatchesSaq(section, saqTypeCode))
      .map((section) => adaptPlanSectionForSaq(section, saqTypeCode))
      .map((section) => [section.id, section]),
  );
}

function staticCaptureById(saqTypeCode: string) {
  return new Map(getSaqCaptureSections(saqTypeCode).map((section) => [section.id, section]));
}

export function getSaqSectionPlanFromOfficialSections(saqTypeCode: string, officialSections?: OfficialSectionLike[] | null) {
  if (!officialSections?.length) {
    return getSaqSectionPlan(saqTypeCode);
  }

  const definitions = staticPlanById(saqTypeCode);
  const seen = new Set<string>();
  return officialSections
    .filter((section) => definitions.has(section.id))
    .filter((section) => {
      if (seen.has(section.id)) return false;
      seen.add(section.id);
      return true;
    })
    .map((officialSection, index) => {
      const definition = definitions.get(officialSection.id)!;
      return {
        id: definition.id,
        title: officialSection.title?.trim() || definition.title,
        details: definition.details,
        condition: definition.condition ?? null,
        displayOrder: index + 1,
      };
    });
}

export function getSaqCaptureSectionsFromOfficialSections(saqTypeCode: string, officialSections?: OfficialSectionLike[] | null) {
  if (!officialSections?.length) {
    return getSaqCaptureSections(saqTypeCode);
  }

  const definitions = staticCaptureById(saqTypeCode);
  const seen = new Set<string>();
  return officialSections
    .filter((section) => definitions.has(section.id))
    .filter((section) => {
      if (seen.has(section.id)) return false;
      seen.add(section.id);
      return true;
    })
    .map((section) => definitions.get(section.id)!);
}
