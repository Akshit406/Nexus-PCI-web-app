import { Router } from "express";
import { AnswerValue, CertificationStatus, JustificationType, MessageType, UserRoleCode } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { writeAuditLog } from "../lib/audit";
import { getSaqCaptureSections, getSaqSectionPlan } from "../lib/saq-sections";
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
      saqType: true,
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

function countAnswersByTopic(certification: NonNullable<Awaited<ReturnType<typeof getActiveCertificationForClient>>>) {
  return Array.from({ length: 12 }, (_, index) => {
    const topicCode = String(index + 1);
    const topicAnswers = certification.answers.filter((answer) =>
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

function buildAutoSections(certification: Awaited<ReturnType<typeof getActiveCertificationForClient>>) {
  if (!certification) {
    return [];
  }

  const answers = certification.answers;
  const ccwAnswers = answers.filter((answer) => answer.answerValue === AnswerValue.CCW);
  const naAnswers = answers.filter((answer) => answer.answerValue === AnswerValue.NOT_APPLICABLE);
  const notTestedAnswers = answers.filter((answer) => answer.answerValue === AnswerValue.NOT_TESTED);
  const notImplementedAnswers = answers.filter((answer) => answer.answerValue === AnswerValue.NOT_IMPLEMENTED);
  const allRequirementsAnswered = answers.length > 0 && answers.every((answer) => Boolean(answer.answerValue));
  const hasNotImplemented = notImplementedAnswers.length > 0;
  const finalDeadline = latestResolutionDate(answers);
  const sectionInputsById = new Map(certification.sectionInputs.map((input) => [input.sectionId, parseJsonRecord(input.payloadJson)]));
  const section3Values = sectionInputsById.get("section-3-validation-certification") ?? {};
  const hasLegalException = hasNotImplemented && section3Values.legal_exception_claimed === "YES";
  const legalRows = legalExceptionRows(section3Values);
  const allConforming =
    allRequirementsAnswered &&
    answers.every(
      (answer) =>
        answer.answerValue === AnswerValue.IMPLEMENTED ||
        answer.answerValue === AnswerValue.CCW ||
        answer.answerValue === AnswerValue.NOT_APPLICABLE,
    );

  return [
    {
      id: "part-1-evaluation-information",
      title: "Seccion 1. Informacion de la evaluacion",
      details: "Esta informacion viene del registro del cliente. Si requiere cambios, contacte a su ejecutivo.",
      summaryRows: [
        { label: "Empresa", value: certification.client.companyName },
        { label: "Contacto principal", value: certification.client.primaryContactName ?? "Pendiente" },
        { label: "Cargo del contacto", value: certification.client.primaryContactTitle ?? "Pendiente" },
        { label: "Correo principal", value: certification.client.primaryContactEmail ?? "Pendiente" },
        { label: "Telefono principal", value: certification.client.primaryContactPhone ?? "Pendiente" },
        { label: "SAQ asignado", value: certification.saqType.name },
        { label: "Ciclo", value: String(certification.cycleYear) },
      ],
      entries: [],
      emptyMessage: null,
    },
    {
      id: "part-1a-merchant-evaluated",
      title: "Parte 1a. Comerciante Evaluado",
      details: "Informacion del comerciante evaluado tomada del registro del cliente. El cliente la revisa, pero no la edita.",
      summaryRows: [
        { label: "Nombre legal del comerciante", value: certification.client.companyName },
        { label: "Tipo de negocio", value: certification.client.businessType },
        { label: "Sitio web", value: certification.client.website ?? "Pendiente" },
        { label: "Direccion postal", value: certification.client.postalAddress ?? "Pendiente" },
        { label: "Direccion fiscal", value: certification.client.fiscalAddress ?? "Pendiente" },
        { label: "Contacto administrativo", value: certification.client.adminContactName ?? "Pendiente" },
        { label: "Correo administrativo", value: certification.client.adminContactEmail ?? "Pendiente" },
      ],
      entries: [],
      emptyMessage: null,
    },
    {
      id: "part-2g-assessment-summary",
      title: "Parte 2g. Resumen de la evaluacion",
      details: "Indica todas las respuestas seleccionadas para cada requisito PCI DSS, siguiendo el formato oficial del resumen de evaluacion.",
      summaryRows: [
        { label: "SAQ asignado", value: certification.saqType.code },
        { label: "Implementado", value: String(answers.filter((item) => item.answerValue === AnswerValue.IMPLEMENTED).length) },
        { label: "Implementado con CCW", value: String(ccwAnswers.length) },
        { label: "No Aplicable", value: String(naAnswers.length) },
        { label: "No Probado", value: String(notTestedAnswers.length) },
        { label: "No Implementado", value: String(answers.filter((item) => item.answerValue === AnswerValue.NOT_IMPLEMENTED).length) },
      ],
      entries: countAnswersByTopic(certification).map((topic) => ({
        title: `Requisito ${topic.topicCode}:`,
        lines: [
          `Implementado: ${topic.implemented}`,
          `Implementado con CCW: ${topic.ccw}`,
          `No Aplicable: ${topic.notApplicable}`,
          `No Probado: ${topic.notTested}`,
          `No Implementado: ${topic.notImplemented}`,
          `Total respondido: ${topic.totalAnswered}`,
        ],
      })),
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
      title: "Seccion 3. Detalles de validacion y certificacion",
      details: "El sistema pre-llena el estado de conformidad. El estado solo cambia modificando las respuestas del cuestionario.",
      summaryRows: [
        { label: "Nombre del comerciante", value: certification.client.companyName },
        { label: "Estado calculado", value: allConforming ? "En Conformidad" : hasLegalException ? "Conforme con excepcion legal" : hasNotImplemented ? "No Conformidad" : "Pendiente" },
        { label: "En Conformidad", value: allConforming ? "Marcado" : "Sin marcar" },
        { label: "No Conformidad", value: hasNotImplemented && !hasLegalException ? "Marcado" : "Sin marcar" },
        { label: "Conforme con excepcion legal", value: hasLegalException ? "Marcado" : "Sin marcar" },
        { label: "Fecha limite para estar en conformidad", value: formatDate(finalDeadline) },
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

  const mappedRequirements = await prisma.saqRequirementMap.findMany({
    where: { saqTypeId: certification.saqTypeId, isActive: true },
    include: { requirement: { include: { topic: true } } },
    orderBy: { displayOrder: "asc" },
  });

  const answersByRequirement = new Map(certification.answers.map((answer) => [answer.requirementId, answer]));
  const evidenceByRequirement = new Map<string, typeof certification.documents>();
  for (const document of certification.documents) {
    if (!document.requirementId) {
      continue;
    }
    evidenceByRequirement.set(document.requirementId, [...(evidenceByRequirement.get(document.requirementId) ?? []), document]);
  }

  const topics = mappedRequirements.reduce<
    Array<{
      topicCode: string;
      topicName: string;
      requirements: Array<Record<string, unknown>>;
    }>
  >((acc, item) => {
    const answer = answersByRequirement.get(item.requirementId);
    let topic = acc.find((entry) => entry.topicCode === item.requirement.topic.code);
    if (!topic) {
      topic = {
        topicCode: item.requirement.topic.code,
        topicName: item.requirement.topic.name,
        requirements: [],
      };
      acc.push(topic);
    }

    topic.requirements.push({
      id: item.requirement.id,
      code: item.requirement.requirementCode,
      description: item.requirement.description,
      testingProcedures: item.requirement.testingProcedures,
      answerValue: answer?.answerValue ?? null,
      explanation: answer?.explanation ?? "",
      resolutionDate: answer?.resolutionDate ?? null,
      isPreloaded: answer?.isPreloaded ?? false,
      justificationType: answer?.justification?.justificationType ?? null,
      requiresEvidence: item.requiresEvidence,
      allowNotTested: item.allowNotTested || certification.saqType.supportsNotTested,
      evidence: (evidenceByRequirement.get(item.requirementId) ?? []).map((document) => ({
        id: document.id,
        title: document.title,
        fileName: document.fileName,
        fileSizeBytes: document.fileSizeBytes,
        createdAt: document.createdAt,
        version: document.version,
      })),
    });

    return acc;
  }, []);

  const captureInputMap = new Map(
    certification.sectionInputs.map((sectionInput) => [sectionInput.sectionId, parseJsonRecord(sectionInput.payloadJson)]),
  );

  const captureSections = getSaqCaptureSections(certification.saqType.code).map((section) => {
    const currentValues = captureInputMap.get(section.id) ?? {};
    return {
      id: section.id,
      title: section.title,
      details: section.details,
      completionStage: section.completionStage,
      fields: section.fields.map((field) => ({
        ...field,
        options: field.options ?? [],
        required: field.required ?? true,
        value: currentValues[field.key] ?? field.defaultValue ?? "",
      })),
    };
  });

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
    sectionPlan: getSaqSectionPlan(certification.saqType.code),
    captureSections,
    autoSections: buildAutoSections(certification),
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

  const sectionDefinition = getSaqCaptureSections(certification.saqType.code).find((section) => section.id === sectionId);
  if (!sectionDefinition) {
    return res.status(404).json({ message: "Capture section not found." });
  }

  const allowedKeys = new Set(sectionDefinition.fields.map((field) => field.key));
  const normalizedValues = Object.fromEntries(
    Object.entries(parsed.data.values)
      .filter(([key]) => allowedKeys.has(key))
      .map(([key, value]) => [key, value.trim()]),
  );

  const sectionInput = await prisma.certificationSectionInput.upsert({
    where: {
      certificationId_sectionId: {
        certificationId: certification.id,
        sectionId,
      },
    },
    update: {
      payloadJson: JSON.stringify(normalizedValues),
    },
    create: {
      certificationId: certification.id,
      sectionId,
      payloadJson: JSON.stringify(normalizedValues),
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
  const schema = z.object({ reason: z.string().min(5) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success || !req.auth?.clientId) {
    return res.status(400).json({ message: "Invalid change request payload." });
  }

  const certification = await getActiveCertificationForClient(req.auth.clientId);
  if (!certification || certification.isLocked) {
    return res.status(400).json({ message: "Certification is not editable." });
  }

  const message = await prisma.dashboardMessage.create({
    data: {
      clientId: req.auth.clientId,
      certificationId: certification.id,
      title: "Solicitud de revision de SAQ",
      message: `El cliente solicito revisar el SAQ asignado. Motivo: ${parsed.data.reason.trim()}`,
      messageType: MessageType.WARNING,
    },
  });

  await writeAuditLog({
    userId: req.auth.userId,
    roleCode: req.auth.role,
    actionType: "SAQ_CHANGE_REVIEW_REQUESTED",
    targetTable: "DashboardMessage",
    targetId: message.id,
    clientId: req.auth.clientId,
    certificationId: certification.id,
    ipAddress: req.ip,
    userAgent: getUserAgentHeader(req.headers["user-agent"]),
    metadata: { reason: parsed.data.reason.trim() },
  });

  res.status(201).json({ success: true, message });
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
  const explanation = parsed.data.explanation?.trim() || undefined;
  const justificationType =
    answerValue === AnswerValue.CCW
      ? JustificationType.CCW_ANNEX_B
      : answerValue === AnswerValue.NOT_APPLICABLE
        ? JustificationType.NA_ANNEX_C
        : answerValue === AnswerValue.NOT_TESTED
          ? JustificationType.NOT_TESTED_ANNEX_D
          : null;

  if (
    (answerValue === AnswerValue.CCW ||
      answerValue === AnswerValue.NOT_APPLICABLE ||
      answerValue === AnswerValue.NOT_TESTED ||
      answerValue === AnswerValue.NOT_IMPLEMENTED) &&
    !explanation
  ) {
    return res.status(400).json({ message: "This answer type requires an explanation." });
  }

  const answer = await prisma.certificationAnswer.upsert({
    where: {
      certificationId_requirementId: {
        certificationId: certification.id,
        requirementId,
      },
    },
    update: {
      answerValue,
      explanation,
      resolutionDate: parsed.data.resolutionDate ? new Date(parsed.data.resolutionDate) : null,
      answeredByUserId: req.auth.userId,
      isPreloaded: false,
    },
    create: {
      certificationId: certification.id,
      requirementId,
      answerValue,
      explanation,
      resolutionDate: parsed.data.resolutionDate ? new Date(parsed.data.resolutionDate) : null,
      answeredByUserId: req.auth.userId,
      isPreloaded: false,
    },
  });

  if (justificationType && explanation) {
    await prisma.answerJustification.upsert({
      where: { certificationAnswerId: answer.id },
      update: { justificationType, details: explanation },
      create: { certificationAnswerId: answer.id, justificationType, details: explanation },
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
