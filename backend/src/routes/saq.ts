import { Router } from "express";
import { AnswerValue, CertificationStatus, JustificationType, UserRoleCode } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { writeAuditLog } from "../lib/audit";
import { AuthenticatedRequest, requireAuth, requireRole } from "../middleware/auth";

const router = Router();

function getUserAgentHeader(value: string | string[] | undefined) {
  return Array.isArray(value) ? value.join(", ") : value;
}

async function getActiveCertificationForClient(clientId: string) {
  return prisma.certification.findFirst({
    where: {
      clientId,
      status: { in: [CertificationStatus.DRAFT, CertificationStatus.IN_PROGRESS, CertificationStatus.READY_TO_GENERATE] },
    },
    include: {
      saqType: true,
      answers: { include: { justification: true } },
      signature: true,
      paymentStatus: true,
    },
    orderBy: { cycleYear: "desc" },
  });
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
    });

    return acc;
  }, []);

  res.json({
    certification: {
      id: certification.id,
      saqTypeCode: certification.saqType.code,
      saqTypeName: certification.saqType.name,
      supportsNotTested: certification.saqType.supportsNotTested,
      isLocked: certification.isLocked,
      lastViewedTopicCode: certification.lastViewedTopicCode,
      paymentState: certification.paymentStatus?.state ?? "UNPAID",
      hasSignature: Boolean(certification.signature),
    },
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

  await prisma.certification.update({
    where: { id: certification.id },
    data: { lastViewedTopicCode: parsed.data.topicCode },
  });

  res.json({ success: true });
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

  if ((answerValue === AnswerValue.CCW || answerValue === AnswerValue.NOT_APPLICABLE || answerValue === AnswerValue.NOT_TESTED) && !explanation) {
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
