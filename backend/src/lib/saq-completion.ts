import { AnswerValue } from "@prisma/client";
import { CaptureFieldDefinition, CaptureSectionDefinition, getSaqCaptureSections } from "./saq-sections";

export const CURRENT_SAQ_CAPTURE_SCHEMA_VERSION = "official-saq-docx-v1";

export type SaqCaptureSectionCompletionStatus = "PENDING" | "REVIEW" | "COMPLETE";

export type SaqCaptureSectionCompletion = {
  id: string;
  title: string;
  status: SaqCaptureSectionCompletionStatus;
  needsReview: boolean;
  missingFields: string[];
  blockerMessages: string[];
};

export type SaqQuestionnaireCompletion = {
  overall: {
    completed: number;
    total: number;
    percentage: number;
  };
  requirements: {
    answered: number;
    total: number;
    percentage: number;
  };
  captureSections: SaqCaptureSectionCompletion[];
};

type RequirementMapping = {
  requirementId: string;
  requirement: {
    requirementCode: string;
    description?: string | null;
  };
};

type CertificationAnswerLike = {
  requirementId: string;
  answerValue: AnswerValue;
  requirement?: {
    requirementCode: string;
    description?: string | null;
  };
};

type SectionInputLike = {
  sectionId: string;
  payloadJson: string;
};

export function parseSectionPayload(payloadJson: string) {
  try {
    const parsed = JSON.parse(payloadJson);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return Object.fromEntries(
        Object.entries(parsed).map(([key, value]) => [key, typeof value === "string" ? value : String(value ?? "")]),
      );
    }
  } catch {}

  return {};
}

export function parseJsonArray(value?: string) {
  if (!value) {
    return [];
  }

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }
}

function isRequiredFieldComplete(value: string, inputType: CaptureFieldDefinition["inputType"]) {
  if (inputType === "checkbox-group") {
    return parseJsonArray(value).length > 0;
  }

  return value.trim().length > 0;
}

function legalExceptionRows(values: Record<string, string>, maxRows = 12) {
  return Array.from({ length: maxRows }, (_, index) => {
    const row = index + 1;
    return {
      requirement: values[`legal_exception_${row}_requirement`]?.trim() ?? "",
      restriction: values[`legal_exception_${row}_restriction`]?.trim() ?? "",
    };
  }).filter((row) => row.requirement || row.restriction);
}

function valuesForSection(section: CaptureSectionDefinition, savedValues: Record<string, string>) {
  return Object.fromEntries(
    section.fields.map((field) => [field.key, savedValues[field.key] ?? field.defaultValue ?? ""]),
  );
}

function selectedPaymentChannelLabels(input: {
  sections: CaptureSectionDefinition[];
  sectionInputsById: Map<string, Record<string, string>>;
}) {
  const paymentSection = input.sections.find((item) => item.id === "part-2a-payment-channels");
  const paymentValues = input.sectionInputsById.get("part-2a-payment-channels") ?? {};
  const selectedChannels = parseJsonArray(paymentValues.included_payment_channels);
  return (
    paymentSection?.fields
      .find((field) => field.key === "included_payment_channels")
      ?.options?.filter((option) => selectedChannels.includes(option.value))
      .map((option) => option.label) ?? []
  );
}

function missingFieldsForSection(input: {
  section: CaptureSectionDefinition;
  sections: CaptureSectionDefinition[];
  values: Record<string, string>;
  sectionInputsById: Map<string, Record<string, string>>;
  answers: CertificationAnswerLike[];
  mappedRequirementIds: string[];
}) {
  const missing: string[] = [];

  for (const field of input.section.fields) {
    if (field.required === false) {
      continue;
    }
    if (!isRequiredFieldComplete(String(input.values[field.key] ?? ""), field.inputType)) {
      missing.push(field.label);
    }
  }

  if (
    input.section.id === "part-2a-payment-channels" &&
    input.values.has_excluded_payment_channels === "YES" &&
    !input.values.excluded_payment_channels_explanation?.trim()
  ) {
    missing.push("Canal(es) no incluidos y motivo de exclusion");
  }

  if (input.section.id === "part-2b-cardholder-function") {
    const channelLabels = selectedPaymentChannelLabels({
      sections: input.sections,
      sectionInputsById: input.sectionInputsById,
    });
    for (let row = 1; row <= channelLabels.length; row += 1) {
      if (!input.values[`card_function_${row}_description`]?.trim()) {
        missing.push(`Descripcion para ${channelLabels[row - 1]}`);
      }
    }
  }

  if (input.section.id === "part-2e-validated-products" && input.values.uses_pci_validated_products === "YES") {
    const hasCompleteProductRow = Array.from({ length: 4 }, (_, index) => index + 1).some((row) =>
      ["name", "version", "standard", "reference", "expiration"].every((column) =>
        input.values[`validated_product_${row}_${column}`]?.trim(),
      ),
    );
    if (!hasCompleteProductRow) {
      missing.push("Al menos una fila completa de producto o solucion validado por PCI SSC");
    }

    for (let row = 1; row <= 4; row += 1) {
      const columns = ["name", "version", "standard", "reference", "expiration"];
      const rowValues = columns.map((column) => input.values[`validated_product_${row}_${column}`]?.trim() ?? "");
      if (rowValues.some(Boolean) && rowValues.some((value) => !value)) {
        missing.push(`Todos los campos de la fila ${row} de productos validados`);
      }
    }
  }

  if (input.section.id === "part-2f-service-providers") {
    const hasServiceProvider = [
      input.values.providers_store_process_transmit,
      input.values.providers_manage_system_components,
      input.values.providers_affect_cde_security,
    ].includes("YES");
    if (hasServiceProvider && (!input.values.service_provider_1_name?.trim() || !input.values.service_provider_1_description?.trim())) {
      missing.push("Nombre del proveedor de servicio y descripcion del servicio prestado");
    }

    for (let row = 1; row <= 10; row += 1) {
      const name = input.values[`service_provider_${row}_name`]?.trim() ?? "";
      const description = input.values[`service_provider_${row}_description`]?.trim() ?? "";
      if ((name || description) && (!name || !description)) {
        missing.push(`Nombre y descripcion de la fila ${row} de proveedores`);
      }
    }
  }

  if (input.section.id === "part-2h-saq-eligibility") {
    const selected = parseJsonArray(input.values.eligibility_confirmations);
    const expectedCount = input.section.fields.find((field) => field.key === "eligibility_confirmations")?.options?.length ?? 0;
    if (selected.length < expectedCount && !input.values.eligibility_change_notes?.trim()) {
      missing.push("Nota de revision cuando no se cumplen todos los criterios de elegibilidad");
    }
  }

  if (input.section.id === "section-3-validation-certification") {
    const mappedRequirementSet = new Set(input.mappedRequirementIds);
    const notImplementedAnswers = input.answers.filter(
      (answer) => answer.answerValue === AnswerValue.NOT_IMPLEMENTED && mappedRequirementSet.has(answer.requirementId),
    );
    if (input.values.legal_exception_claimed === "YES" && notImplementedAnswers.length === 0) {
      missing.push("Requisito No Implementado para justificar excepcion legal");
    }
    if (input.values.legal_exception_claimed === "YES") {
      const rows = legalExceptionRows(input.values);
      for (const answer of notImplementedAnswers) {
        const code = answer.requirement?.requirementCode ?? "";
        const matchingRow = rows.find((row) => code && row.requirement.includes(code));
        if (!matchingRow?.restriction) {
          missing.push(`Restriccion legal para el requisito ${code || answer.requirementId}`);
        }
      }
    }
  }

  if (input.section.id === "section-3a-merchant-recognition" && parseJsonArray(input.values.merchant_acknowledgements).length < 3) {
    missing.push("Tres casillas de Reconocimiento del comerciante");
  }

  return Array.from(new Set(missing));
}

export function buildSaqQuestionnaireCompletion(input: {
  saqTypeCode: string;
  mappedRequirements: RequirementMapping[];
  answers: CertificationAnswerLike[];
  sectionInputs: SectionInputLike[];
}) {
  const sections = getSaqCaptureSections(input.saqTypeCode);
  const sectionInputsById = new Map(input.sectionInputs.map((item) => [item.sectionId, parseSectionPayload(item.payloadJson)]));
  const mappedRequirementIds = input.mappedRequirements.map((mapping) => mapping.requirementId);
  const answersByRequirement = new Map(input.answers.map((answer) => [answer.requirementId, answer]));
  const answered = mappedRequirementIds.filter((requirementId) => answersByRequirement.has(requirementId)).length;
  const requirementPercentage = mappedRequirementIds.length > 0 ? Math.round((answered / mappedRequirementIds.length) * 100) : 0;

  const captureSections = sections.map<SaqCaptureSectionCompletion>((section) => {
    const savedValues = sectionInputsById.get(section.id) ?? {};
    const values = valuesForSection(section, savedValues);
    const missingFields = missingFieldsForSection({
      section,
      sections,
      values,
      sectionInputsById,
      answers: input.answers,
      mappedRequirementIds,
    });
    const currentSchema = savedValues.__schemaVersion === CURRENT_SAQ_CAPTURE_SCHEMA_VERSION;
    const needsReview = missingFields.length === 0 && !currentSchema;
    const status: SaqCaptureSectionCompletionStatus = missingFields.length > 0 ? "PENDING" : needsReview ? "REVIEW" : "COMPLETE";
    const blockerMessages =
      status === "COMPLETE"
        ? []
        : needsReview
          ? [`Revisa y confirma ${section.title}.`]
          : missingFields.map((field) => `Falta completar ${section.title}: ${field}.`);

    return {
      id: section.id,
      title: section.title,
      status,
      needsReview,
      missingFields,
      blockerMessages,
    };
  });

  const completedCaptureSections = captureSections.filter((section) => section.status === "COMPLETE").length;
  const completed = answered + completedCaptureSections;
  const total = mappedRequirementIds.length + captureSections.length;

  return {
    overall: {
      completed,
      total,
      percentage: total > 0 ? Math.round((completed / total) * 100) : 0,
    },
    requirements: {
      answered,
      total: mappedRequirementIds.length,
      percentage: requirementPercentage,
    },
    captureSections,
  } satisfies SaqQuestionnaireCompletion;
}

export function areSaqCaptureSectionsCompleteFromCompletion(completion: SaqQuestionnaireCompletion) {
  return completion.captureSections.every((section) => section.status === "COMPLETE");
}

