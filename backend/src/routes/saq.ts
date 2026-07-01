import { Router } from "express";
import { AnswerValue, CertificationStatus, JustificationType, MessageType, UserRoleCode } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { writeAuditLog } from "../lib/audit";
import { getSaqCaptureSections } from "../lib/saq-sections";
import {
  CURRENT_SAQ_CAPTURE_SCHEMA_VERSION,
  areSaqCaptureSectionsCompleteFromCompletion,
  buildSaqQuestionnaireCompletion,
} from "../lib/saq-completion";
import { calculateSaqValidationStatus, getSaqValidationStatusLabel, getSaqValidationStatusText } from "../lib/saq-status";
import { buildSaqQuestionnaireTopics, loadSaqQuestionnaireDefinition } from "../lib/saq-questionnaire-definition";
import { AuthenticatedRequest, requireAuth, requireRole } from "../middleware/auth";

const router = Router();

function getUserAgentHeader(value: string | string[] | undefined) {
  return Array.isArray(value) ? value.join(", ") : value;
}

function parseJsonRecord(payloadJson: string) {
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

function firstNonEmpty(...values: Array<string | null | undefined>) {
  return values.find((value) => value?.trim())?.trim();
}

function requiredValue(...values: Array<string | null | undefined>) {
  return firstNonEmpty(...values) ?? "Pendiente";
}

function optionalValue(...values: Array<string | null | undefined>) {
  return firstNonEmpty(...values) ?? "No aplica";
}

function parseCcwData(explanation?: string | null) {
  if (!explanation) {
    return null;
  }

  const parsed = parseJsonRecord(explanation);
  if (Object.keys(parsed).length > 0) {
    return parsed;
  }

  return { restrictions: explanation };
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

function formatDate(value?: Date | null) {
  if (!value) {
    return "Pendiente";
  }

  return new Intl.DateTimeFormat("es-MX", {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(value);
}

async function getActiveCertificationForClient(clientId: string) {
  return prisma.certification.findFirst({
    where: {
      clientId,
      status: {
        in: [
          CertificationStatus.DRAFT,
          CertificationStatus.IN_PROGRESS,
          CertificationStatus.READY_TO_GENERATE,
          CertificationStatus.GENERATED,
          CertificationStatus.FINALIZED,
        ],
      },
    },
    include: {
      client: true,
      saqType: {
        include: {
          requirementMap: {
            where: { isActive: true },
            select: { requirementId: true },
          },
        },
      },
      answers: { include: { justification: true, requirement: true } },
      sectionInputs: true,
      signature: true,
      paymentStatus: true,
      documents: {
        where: {
          category: "EVIDENCE",
          isArchived: false,
        },
        orderBy: { createdAt: "desc" },
      },
    },
    orderBy: { cycleYear: "desc" },
  });
}

function countAnswersByTopic(
  certification: NonNullable<Awaited<ReturnType<typeof getActiveCertificationForClient>>>,
  mappedRequirementIds: string[] = [],
) {
  const mappedRequirementSet = new Set(mappedRequirementIds);
  const filteredAnswers = mappedRequirementSet.size > 0
    ? certification.answers.filter((answer) => mappedRequirementSet.has(answer.requirementId))
    : certification.answers;

  return Array.from({ length: 12 }, (_, index) => {
    const topicCode = String(index + 1);
    const topicAnswers = filteredAnswers.filter((answer) =>
      answer.requirement.requirementCode.startsWith(`${topicCode}.`),
    );

    return {
      topicCode,
      implemented: topicAnswers.filter((answer) => answer.answerValue === AnswerValue.IMPLEMENTED).length,
      ccw: topicAnswers.filter((answer) => answer.answerValue === AnswerValue.CCW).length,
      notApplicable: topicAnswers.filter((answer) => answer.answerValue === AnswerValue.NOT_APPLICABLE).length,
      notTested: topicAnswers.filter((answer) => answer.answerValue === AnswerValue.NOT_TESTED).length,
      notImplemented: topicAnswers.filter((answer) => answer.answerValue === AnswerValue.NOT_IMPLEMENTED).length,
      totalAnswered: topicAnswers.filter((answer) => Boolean(answer.answerValue)).length,
    };
  });
}

function latestResolutionDate(answers: NonNullable<Awaited<ReturnType<typeof getActiveCertificationForClient>>>["answers"]) {
  const dates = answers
    .filter((answer) => answer.answerValue === AnswerValue.NOT_IMPLEMENTED && answer.resolutionDate)
    .map((answer) => answer.resolutionDate!.getTime());
  return dates.length ? new Date(Math.max(...dates)) : null;
}

function buildAutoSections(
  certification: Awaited<ReturnType<typeof getActiveCertificationForClient>>,
  captureDefinitions = certification ? getSaqCaptureSections(certification.saqType.code) : [],
) {
  if (!certification) {
    return [];
  }

  const mappedRequirementIds = certification.saqType.requirementMap.map((mapping) => mapping.requirementId);
  const mappedRequirementSet = new Set(mappedRequirementIds);
  // Only count answers that belong to the currently assigned SAQ. Answers left over
  // from a previous SAQ assignment must not influence Section 3 / Part 4 calculations.
  const answers = certification.answers.filter((answer) => mappedRequirementSet.has(answer.requirementId));
  const ccwAnswers = answers.filter((answer) => answer.answerValue === AnswerValue.CCW);
  const naAnswers = answers.filter((answer) => answer.answerValue === AnswerValue.NOT_APPLICABLE);
  const notTestedAnswers = answers.filter((answer) => answer.answerValue === AnswerValue.NOT_TESTED);
  const notImplementedAnswers = answers.filter((answer) => answer.answerValue === AnswerValue.NOT_IMPLEMENTED);
  const hasNotImplemented = notImplementedAnswers.length > 0;
  const finalDeadline = latestResolutionDate(answers);
  const sectionInputsById = new Map(certification.sectionInputs.map((input) => [input.sectionId, parseJsonRecord(input.payloadJson)]));
  const section3Values = sectionInputsById.get("section-3-validation-certification") ?? {};
  const hasLegalException = hasNotImplemented && section3Values.legal_exception_claimed === "YES";
  const legalRows = legalExceptionRows(section3Values);
  const completion = buildSaqQuestionnaireCompletion({
    saqTypeCode: certification.saqType.code,
    mappedRequirements: certification.saqType.requirementMap.map((mapping) => ({
      requirementId: mapping.requirementId,
      requirement: { requirementCode: "", description: "" },
    })),
    answers,
    sectionInputs: certification.sectionInputs,
    captureSections: captureDefinitions,
  });
  const validationStatus = calculateSaqValidationStatus({
    mappedRequirementIds,
    answers,
    hasLegalException,
    allSaqSectionsComplete: areSaqCaptureSectionsCompleteFromCompletion(completion),
  });
  const validationStatusLabel = getSaqValidationStatusLabel(validationStatus);
  const validationStatusText = getSaqValidationStatusText(validationStatus);
  const appliesPart4 = validationStatus === "NON_CONFORMING" && notImplementedAnswers.length > 0;

  return [
    {
      id: "part-1a-merchant-evaluated",
      title: "Parte 1a. Comerciante Evaluado",
      details: "Informacion del comerciante evaluado tomada del registro del cliente.",
      summaryRows: [
        { label: "Nombre legal del comerciante", value: certification.client.companyName },
        { label: "Nombre comercial de la compania (DBA)", value: certification.client.dbaName ?? certification.client.companyName },
        { label: "Tipo de negocio", value: certification.client.businessType },
        { label: "Sitio web", value: optionalValue(certification.client.website) },
        { label: "Direccion postal", value: optionalValue(certification.client.postalAddress) },
        { label: "Direccion fiscal", value: optionalValue(certification.client.fiscalAddress) },
        { label: "Nombre del contacto de la compania", value: requiredValue(certification.client.primaryContactName, certification.client.adminContactName) },
        { label: "Titulo del contacto de la compania", value: optionalValue(certification.client.primaryContactTitle) },
        { label: "Numero de telefono del contacto", value: requiredValue(certification.client.primaryContactPhone, certification.client.adminContactPhone) },
        { label: "Direccion de correo electronico del contacto", value: requiredValue(certification.client.primaryContactEmail, certification.client.adminContactEmail) },
      ],
      entries: [],
      emptyMessage: null,
    },
    {
      id: "part-1b-assessor",
      title: "Parte 1b. Asesor",
      details: "Informacion del ISA/QSA tomada de la configuracion de la certificacion.",
      summaryRows: [
        { label: "Nombre del ISA", value: optionalValue(certification.assessorIsaName) },
        { label: "Empresa QSA", value: optionalValue(certification.assessorQsaCompany) },
        { label: "Asesor lider QSA", value: optionalValue(certification.assessorQsaLeadName) },
      ],
      entries: [],
      emptyMessage: null,
    },
    {
      id: "annex-b-ccw",
      title: "Anexo B. Ficha de control compensatorio",
      details: "La aplicacion genera una ficha por cada requerimiento respondido como CCW.",
      summaryRows: [{ label: "Fichas generadas", value: String(ccwAnswers.length) }],
      entries: ccwAnswers.map((answer) => {
        const ccwData = parseCcwData(answer.explanation);
        return {
          title: `${answer.requirement.requirementCode} - ${answer.requirement.title}`,
          lines: [
            `Requisito: ${answer.requirement.description}`,
            `Restricciones: ${ccwData?.restrictions || "Pendiente"}`,
            `Definicion del control: ${ccwData?.definition || "Pendiente"}`,
            `Objetivo: ${ccwData?.objective || "Pendiente"}`,
            `Riesgo identificado: ${ccwData?.risk || "Pendiente"}`,
            `Validacion: ${ccwData?.validation || "Pendiente"}`,
            `Mantenimiento: ${ccwData?.maintenance || "Pendiente"}`,
          ],
        };
      }),
      emptyMessage: "No existen requerimientos respondidos como CCW.",
    },
    {
      id: "annex-c-not-applicable",
      title: "Anexo C. Explicacion de requisitos no aplicables",
      details: "El sistema consolida las justificaciones capturadas para las respuestas No Aplicable.",
      summaryRows: [{ label: "Requisitos marcados", value: String(naAnswers.length) }],
      entries: naAnswers.map((answer) => ({
        title: `${answer.requirement.requirementCode} - ${answer.requirement.title}`,
        lines: [`Requisito: ${answer.requirement.description}`, `Justificacion: ${answer.explanation || "Pendiente"}`],
      })),
      emptyMessage: "No existen requerimientos marcados como No Aplicable.",
    },
    {
      id: "annex-d-not-tested",
      title: "Anexo D. Explicacion de requisitos no probados",
      details: "El sistema consolida las explicaciones y fechas de resolucion registradas en el cuestionario.",
      summaryRows: [{ label: "Requisitos marcados", value: String(notTestedAnswers.length) }],
      entries: notTestedAnswers.map((answer) => ({
        title: `${answer.requirement.requirementCode} - ${answer.requirement.title}`,
        lines: [
          `Requisito: ${answer.requirement.description}`,
          `Explicacion: ${answer.explanation || "Pendiente"}`,
          `Fecha de resolucion: ${formatDate(answer.resolutionDate)}`,
        ],
      })),
      emptyMessage: "No existen requerimientos marcados como No Probado.",
    },
    {
      id: "section-3-validation-certification",
      title: "Parte 3. Validacion PCI DSS",
      details: "El sistema pre-llena el estado de conformidad. El estado solo cambia modificando las respuestas del cuestionario.",
      summaryRows: [
        { label: "Nombre del comerciante", value: certification.client.companyName },
        { label: "Estado calculado", value: validationStatusLabel },
        { label: "Texto explicativo", value: validationStatusText },
        // Only emit the row that corresponds to the actual calculated status, so a
        // clean SAQ never shows "No Conformidad" (even with value "Sin marcar").
        ...(validationStatus === "CONFORMING" ? [{ label: "En Conformidad", value: "Marcado" }] : []),
        ...(validationStatus === "NON_CONFORMING" ? [{ label: "No Conformidad", value: "Marcado" }] : []),
        ...(validationStatus === "LEGAL_EXCEPTION" ? [{ label: "Conforme con excepcion legal", value: "Marcado" }] : []),
        ...(hasNotImplemented
          ? [{ label: "Fecha limite para estar en conformidad", value: finalDeadline ? formatDate(finalDeadline) : "No aplica" }]
          : []),
      ],
      entries: notImplementedAnswers.map((answer) => {
        const legalRow = legalRows.find((row) => row.requirement.includes(answer.requirement.requirementCode));
        return {
          title: `${answer.requirement.requirementCode} - ${answer.requirement.title}`,
          lines: [
            `Estado: No Implementado`,
            `Descripcion: ${answer.requirement.description}`,
            `Acciones o explicacion: ${answer.explanation || "Pendiente"}`,
            `Fecha objetivo: ${formatDate(answer.resolutionDate)}`,
            ...(hasLegalException ? [`Restriccion legal: ${legalRow?.restriction || "Pendiente"}`] : []),
          ],
        };
      }),
      emptyMessage: null,
    },
    {
      id: "section-3b-merchant-declaration",
      title: "Parte 3b. Declaracion del comerciante",
      details: "Firma, nombre, cargo y fecha usados en la declaracion oficial del comerciante.",
      summaryRows: [
        { label: "Nombre del firmante", value: requiredValue(certification.client.primaryContactName, certification.client.adminContactName, certification.client.companyName) },
        { label: "Cargo del firmante", value: optionalValue(certification.client.primaryContactTitle) },
        { label: "Firma", value: certification.signature ? "Registrada" : "Pendiente" },
        { label: "Fecha", value: formatDate(new Date()) },
      ],
      entries: [],
      emptyMessage: null,
    },
    {
      id: "section-3c-qsa-declaration",
      title: "Parte 3c. Declaracion del Asesor de Seguridad Calificado (QSA)",
      details: "Datos del QSA usados por el documento oficial cuando correspondan.",
      summaryRows: [
        { label: "Empresa QSA", value: optionalValue(certification.assessorQsaCompany) },
        { label: "Asesor lider QSA", value: optionalValue(certification.assessorQsaLeadName) },
      ],
      entries: [],
      emptyMessage: null,
    },
    {
      id: "section-3d-isa-participation",
      title: "Parte 3d. Participacion del Asesor de Seguridad Interna (ISA)",
      details: "Datos del ISA usados por el documento oficial cuando correspondan.",
      summaryRows: [{ label: "Nombre del ISA", value: optionalValue(certification.assessorIsaName) }],
      entries: [],
      emptyMessage: null,
    },
    // Part 4 is only relevant when there are NOT_IMPLEMENTED requirements that result
    // in NON_CONFORMING. Hide the whole section otherwise so it does not appear as a
    // pending step in the questionnaire navigation for a clean SAQ.
    ...(appliesPart4
      ? [{
          id: "section-4-action-plan",
          title: "Parte 4. Plan de accion para estado de No Conformidad",
          details: "Esta parte se completa cuando existen requisitos No Implementado que resultan en No Conformidad.",
          summaryRows: [
            { label: "Aplica Parte 4", value: "Si" },
            { label: "Requisitos No Implementado", value: String(notImplementedAnswers.length) },
          ],
          entries: notImplementedAnswers.map((answer) => ({
            title: `${answer.requirement.requirementCode} - ${answer.requirement.title}`,
            lines: [
              `Requisito: ${answer.requirement.description}`,
              `Acciones de remediacion: ${answer.explanation || "Pendiente"}`,
              `Fecha compromiso: ${formatDate(answer.resolutionDate)}`,
            ],
          })),
          emptyMessage: null,
        }]
      : []),
  ];
}

router.get("/current", requireAuth, requireRole([UserRoleCode.CLIENT]), async (req: AuthenticatedRequest, res) => {
  const clientId = req.auth?.clientId;
  if (!clientId) {
    return res.status(400).json({ message: "Client context missing." });
  }

  const certification = await getActiveCertificationForClient(clientId);
  if (!certification) {
    return res.status(404).json({ message: "Active certification not found." });
  }

  const definition = await loadSaqQuestionnaireDefinition(certification.saqTypeId);
  if (!definition.ok) {
    return res.status(definition.status).json({ message: definition.message });
  }
  const mappedRequirements = definition.mappings;

  const answersByRequirement = new Map(certification.answers.map((answer) => [answer.requirementId, answer]));
  const evidenceByRequirement = new Map<string, typeof certification.documents>();
  for (const document of certification.documents) {
    if (!document.requirementId) {
      continue;
    }
    evidenceByRequirement.set(document.requirementId, [...(evidenceByRequirement.get(document.requirementId) ?? []), document]);
  }

  const topics = buildSaqQuestionnaireTopics({ definition, answersByRequirement, evidenceByRequirement });

  const captureInputMap = new Map(
    certification.sectionInputs.map((sectionInput) => [sectionInput.sectionId, parseJsonRecord(sectionInput.payloadJson)]),
  );
  const captureDefinitions = definition.captureSections;
  const completion = buildSaqQuestionnaireCompletion({
    saqTypeCode: certification.saqType.code,
    mappedRequirements,
    answers: certification.answers,
    sectionInputs: certification.sectionInputs,
    captureSections: captureDefinitions,
  });
  const completionBySectionId = new Map(completion.captureSections.map((section) => [section.id, section]));

  const captureSections = captureDefinitions.map((section) => {
    const currentValues = captureInputMap.get(section.id) ?? {};
    const sectionCompletion = completionBySectionId.get(section.id);
    return {
      id: section.id,
      title: section.title,
      details: section.details,
      completionStage: section.completionStage,
      status: sectionCompletion?.status ?? "PENDING",
      needsReview: sectionCompletion?.needsReview ?? false,
      missingFields: sectionCompletion?.missingFields ?? [],
      fields: section.fields.map((field) => ({
        ...field,
        options: field.options ?? [],
        required: field.required ?? true,
        value: currentValues[field.key] ?? field.defaultValue ?? "",
      })),
    };
  });

  // Part 4 is only relevant when there is at least one NOT_IMPLEMENTED answer in the
  // currently mapped SAQ. Otherwise we hide it from the section plan so the
  // questionnaire navigation does not show a "Plan de accion para No Conformidad"
  // step on a clean / fully-implemented SAQ.
  const mappedRequirementIdSet = new Set(mappedRequirements.map((mapping) => mapping.requirementId));
  const hasNotImplementedInScope = certification.answers.some(
    (answer) => answer.answerValue === AnswerValue.NOT_IMPLEMENTED && mappedRequirementIdSet.has(answer.requirementId),
  );
  const sectionPlan = definition.sectionPlan.filter(
    (section) => section.id !== "section-4-action-plan" || hasNotImplementedInScope,
  );

  res.json({
    certification: {
      id: certification.id,
      saqTypeCode: certification.saqType.code,
      saqTypeName: certification.saqType.name,
      templateVersion: certification.saqType.templateVersion ?? null,
      supportsNotTested: certification.saqType.supportsNotTested,
      isLocked: certification.isLocked,
      lastViewedTopicCode: certification.lastViewedTopicCode,
      paymentState: certification.paymentStatus?.state ?? "UNPAID",
      hasSignature: Boolean(certification.signature),
    },
    sectionPlan,
    captureSections,
    autoSections: buildAutoSections(certification, captureDefinitions),
    completion,
    topics,
  });
});

router.patch("/active-topic", requireAuth, requireRole([UserRoleCode.CLIENT]), async (req: AuthenticatedRequest, res) => {
  const schema = z.object({ topicCode: z.string().min(1) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success || !req.auth?.clientId) {
    return res.status(400).json({ message: "Invalid topic payload." });
  }

  const certification = await getActiveCertificationForClient(req.auth.clientId);
  if (!certification) {
    return res.status(404).json({ message: "Active certification not found." });
  }
  if (certification.isLocked) {
    return res.status(400).json({ message: "Certification is locked." });
  }

  await prisma.certification.update({
    where: { id: certification.id },
    data: { lastViewedTopicCode: parsed.data.topicCode },
  });

  res.json({ success: true });
});

router.put("/sections/:sectionId", requireAuth, requireRole([UserRoleCode.CLIENT]), async (req: AuthenticatedRequest, res) => {
  const schema = z.object({ values: z.record(z.string(), z.string()) });
  const parsed = schema.safeParse(req.body);
  const sectionId = Array.isArray(req.params.sectionId) ? req.params.sectionId[0] : req.params.sectionId;

  if (!parsed.success || !req.auth?.clientId || !sectionId) {
    return res.status(400).json({ message: "Invalid section payload." });
  }

  const certification = await getActiveCertificationForClient(req.auth.clientId);
  if (!certification || certification.isLocked) {
    return res.status(400).json({ message: "Certification is not editable." });
  }

  const definition = await loadSaqQuestionnaireDefinition(certification.saqTypeId);
  if (!definition.ok) {
    return res.status(definition.status).json({ message: definition.message });
  }
  const sectionDefinition = definition.captureSections.find((section) => section.id === sectionId);
  if (!sectionDefinition) {
    return res.status(404).json({ message: "Capture section not found." });
  }

  const allowedKeys = new Set(sectionDefinition.fields.map((field) => field.key));
  const normalizedValues = Object.fromEntries(
    Object.entries(parsed.data.values)
      .filter(([key]) => allowedKeys.has(key))
      .map(([key, value]) => [key, value.trim()]),
  );
  const versionedValues = {
    ...normalizedValues,
    __schemaVersion: CURRENT_SAQ_CAPTURE_SCHEMA_VERSION,
    __reviewedAt: new Date().toISOString(),
  };

  const sectionInput = await prisma.certificationSectionInput.upsert({
    where: {
      certificationId_sectionId: {
        certificationId: certification.id,
        sectionId,
      },
    },
    update: {
      payloadJson: JSON.stringify(versionedValues),
    },
    create: {
      certificationId: certification.id,
      sectionId,
      payloadJson: JSON.stringify(versionedValues),
    },
  });

  await writeAuditLog({
    userId: req.auth.userId,
    roleCode: req.auth.role,
    actionType: "SAQ_SECTION_CAPTURE_UPDATED",
    targetTable: "CertificationSectionInput",
    targetId: sectionInput.id,
    clientId: req.auth.clientId,
    certificationId: certification.id,
    ipAddress: req.ip,
    userAgent: getUserAgentHeader(req.headers["user-agent"]),
    metadata: { sectionId },
  });

  res.json({ success: true });
});

router.post("/change-request", requireAuth, requireRole([UserRoleCode.CLIENT]), async (req: AuthenticatedRequest, res) => {
  const schema = z.object({
    reason: z.string().min(5),
    requestedSaqTypeId: z.string().min(1).optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success || !req.auth?.clientId) {
    return res.status(400).json({ message: "Invalid change request payload." });
  }

  const certification = await getActiveCertificationForClient(req.auth.clientId);
  if (!certification || certification.isLocked) {
    return res.status(400).json({ message: "Certification is not editable." });
  }

  // Prevent stacking duplicate open requests for the same certification.
  const existingPending = await prisma.saqChangeRequest.findFirst({
    where: { certificationId: certification.id, status: "PENDING" },
  });
  if (existingPending) {
    return res.status(409).json({ message: "Ya existe una solicitud de cambio de SAQ pendiente." });
  }

  const reason = parsed.data.reason.trim();
  const result = await prisma.$transaction(async (tx) => {
    const message = await tx.dashboardMessage.create({
      data: {
        clientId: req.auth!.clientId!,
        certificationId: certification.id,
        title: "Solicitud de revision de SAQ",
        message: `El cliente solicito revisar el SAQ asignado. Motivo: ${reason}`,
        messageType: MessageType.WARNING,
      },
    });

    const changeRequest = await tx.saqChangeRequest.create({
      data: {
        clientId: req.auth!.clientId!,
        certificationId: certification.id,
        requestedByUserId: req.auth!.userId,
        currentSaqTypeId: certification.saqTypeId,
        requestedSaqTypeId: parsed.data.requestedSaqTypeId ?? null,
        reason,
        status: "PENDING",
      },
    });

    return { message, changeRequest };
  });

  await writeAuditLog({
    userId: req.auth.userId,
    roleCode: req.auth.role,
    actionType: "SAQ_CHANGE_REVIEW_REQUESTED",
    targetTable: "SaqChangeRequest",
    targetId: result.changeRequest.id,
    clientId: req.auth.clientId,
    certificationId: certification.id,
    ipAddress: req.ip,
    userAgent: getUserAgentHeader(req.headers["user-agent"]),
    metadata: { reason },
  });

  res.status(201).json({ success: true, changeRequest: result.changeRequest });
});

router.put("/answers/:requirementId", requireAuth, requireRole([UserRoleCode.CLIENT]), async (req: AuthenticatedRequest, res) => {
  const schema = z.object({
    answerValue: z.nativeEnum(AnswerValue),
    explanation: z.string().optional(),
    resolutionDate: z.string().datetime().optional().nullable(),
    activeTopicCode: z.string().optional(),
  });

  const parsed = schema.safeParse(req.body);
  const requirementId = Array.isArray(req.params.requirementId) ? req.params.requirementId[0] : req.params.requirementId;
  if (!parsed.success || !req.auth?.clientId || !requirementId) {
    return res.status(400).json({ message: "Invalid answer payload." });
  }

  const certification = await getActiveCertificationForClient(req.auth.clientId);
  if (!certification || certification.isLocked) {
    return res.status(400).json({ message: "Certification is not editable." });
  }

  const answerValue = parsed.data.answerValue;
  const trimmedExplanation = parsed.data.explanation?.trim();
  const justificationType =
    answerValue === AnswerValue.CCW
      ? JustificationType.CCW_ANNEX_B
      : answerValue === AnswerValue.NOT_APPLICABLE
        ? JustificationType.NA_ANNEX_C
        : answerValue === AnswerValue.NOT_TESTED
          ? JustificationType.NOT_TESTED_ANNEX_D
          : null;

  // Explanation is only meaningful for answers that require justification
  // (CCW / NA / NT) or for NOT_IMPLEMENTED action plan entries. When the
  // client switches back to IMPLEMENTED we must explicitly clear the
  // previously stored explanation / resolution date instead of leaving them
  // in the database, otherwise stale "Pendiente"-style notes bleed into the
  // generated SAQ PDF (see SAQ-Prueba-Locked-2026 regression).
  const allowsExplanation = answerValue !== AnswerValue.IMPLEMENTED;
  const explanationToStore = allowsExplanation && trimmedExplanation ? trimmedExplanation : null;
  const allowsResolutionDate =
    answerValue === AnswerValue.NOT_IMPLEMENTED || answerValue === AnswerValue.NOT_TESTED;
  const resolutionDateToStore =
    allowsResolutionDate && parsed.data.resolutionDate ? new Date(parsed.data.resolutionDate) : null;

  const answer = await prisma.certificationAnswer.upsert({
    where: {
      certificationId_requirementId: {
        certificationId: certification.id,
        requirementId,
      },
    },
    update: {
      answerValue,
      explanation: explanationToStore,
      resolutionDate: resolutionDateToStore,
      answeredByUserId: req.auth.userId,
      isPreloaded: false,
    },
    create: {
      certificationId: certification.id,
      requirementId,
      answerValue,
      explanation: explanationToStore,
      resolutionDate: resolutionDateToStore,
      answeredByUserId: req.auth.userId,
      isPreloaded: false,
    },
  });

  if (justificationType && explanationToStore) {
    await prisma.answerJustification.upsert({
      where: { certificationAnswerId: answer.id },
      update: { justificationType, details: explanationToStore },
      create: { certificationAnswerId: answer.id, justificationType, details: explanationToStore },
    });
  } else {
    await prisma.answerJustification.deleteMany({ where: { certificationAnswerId: answer.id } });
  }

  if (parsed.data.activeTopicCode) {
    await prisma.certification.update({
      where: { id: certification.id },
      data: { lastViewedTopicCode: parsed.data.activeTopicCode },
    });
  }

  await writeAuditLog({
    userId: req.auth.userId,
    roleCode: req.auth.role,
    actionType: "SAQ_ANSWER_UPSERTED",
    targetTable: "CertificationAnswer",
    targetId: answer.id,
    clientId: req.auth.clientId,
    certificationId: certification.id,
    ipAddress: req.ip,
    userAgent: getUserAgentHeader(req.headers["user-agent"]),
    metadata: { requirementId, answerValue },
  });

  res.json({ success: true });
});

router.post("/signature", requireAuth, requireRole([UserRoleCode.CLIENT]), async (req: AuthenticatedRequest, res) => {
  const schema = z.object({ imageDataUrl: z.string().min(1) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success || !req.auth?.clientId) {
    return res.status(400).json({ message: "Invalid signature payload." });
  }

  const certification = await getActiveCertificationForClient(req.auth.clientId);
  if (!certification) {
    return res.status(404).json({ message: "Active certification not found." });
  }
  if (certification.isLocked) {
    return res.status(400).json({ message: "Certification is locked." });
  }

  const signature = await prisma.signature.upsert({
    where: { certificationId: certification.id },
    update: { imageDataUrl: parsed.data.imageDataUrl, uploadedByUserId: req.auth.userId },
    create: {
      certificationId: certification.id,
      clientId: req.auth.clientId,
      uploadedByUserId: req.auth.userId,
      imageDataUrl: parsed.data.imageDataUrl,
      signatureType: "upload",
    },
  });

  await writeAuditLog({
    userId: req.auth.userId,
    roleCode: req.auth.role,
    actionType: "SIGNATURE_UPSERTED",
    targetTable: "Signature",
    targetId: signature.id,
    clientId: req.auth.clientId,
    certificationId: certification.id,
    ipAddress: req.ip,
    userAgent: getUserAgentHeader(req.headers["user-agent"]),
  });

  res.json({ success: true, signatureId: signature.id });
});

export default router;
