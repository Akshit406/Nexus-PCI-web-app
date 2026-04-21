import { Router } from "express";
import { CertificationStatus, UserRoleCode } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { AuthenticatedRequest, requireAuth, requireRole } from "../middleware/auth";

const router = Router();

router.get("/dashboard", requireAuth, requireRole([UserRoleCode.CLIENT]), async (req: AuthenticatedRequest, res) => {
  const clientId = req.auth?.clientId;
  if (!clientId) {
    return res.status(400).json({ message: "Client context missing." });
  }

  const client = await prisma.client.findUnique({ where: { id: clientId } });
  const certification = await prisma.certification.findFirst({
    where: {
      clientId,
      status: { in: [CertificationStatus.DRAFT, CertificationStatus.IN_PROGRESS, CertificationStatus.READY_TO_GENERATE] },
    },
    include: {
      saqType: true,
      paymentStatus: true,
      answers: { include: { requirement: { include: { topic: true } } } },
      dashboardMessages: { where: { isActive: true }, orderBy: { createdAt: "desc" } },
      signature: true,
    },
    orderBy: { cycleYear: "desc" },
  });

  if (!client || !certification) {
    return res.status(404).json({ message: "Active certification not found." });
  }

  const mappedRequirements = await prisma.saqRequirementMap.findMany({
    where: { saqTypeId: certification.saqTypeId, isActive: true },
    include: { requirement: { include: { topic: true } } },
    orderBy: { displayOrder: "asc" },
  });

  const totalRequirements = mappedRequirements.length;
  const answeredCount = certification.answers.length;
  const unansweredCount = totalRequirements - answeredCount;

  const topicProgress = mappedRequirements.reduce<Record<string, { topicCode: string; topicName: string; total: number; answered: number }>>(
    (acc, item) => {
      const topicCode = item.requirement.topic.code;
      if (!acc[topicCode]) {
        acc[topicCode] = { topicCode, topicName: item.requirement.topic.name, total: 0, answered: 0 };
      }
      acc[topicCode].total += 1;
      if (certification.answers.some((answer) => answer.requirementId === item.requirementId)) {
        acc[topicCode].answered += 1;
      }
      return acc;
    },
    {},
  );

  res.json({
    client: {
      id: client.id,
      companyName: client.companyName,
      businessType: client.businessType,
    },
    certification: {
      id: certification.id,
      cycleYear: certification.cycleYear,
      status: certification.status,
      saqType: certification.saqType.name,
      paymentState: certification.paymentStatus?.state ?? "UNPAID",
      lastViewedTopicCode: certification.lastViewedTopicCode,
      preloadedFromCertificationId: certification.preloadedFromCertificationId,
      issueDate: certification.issuedAt,
      validUntil: certification.validUntil,
      isLocked: certification.isLocked,
      hasSignature: Boolean(certification.signature),
      signaturePreviewUrl: certification.signature?.imageDataUrl ?? null,
    },
    stats: {
      totalRequirements,
      answeredCount,
      unansweredCount,
      progressPercentage: totalRequirements > 0 ? Math.round((answeredCount / totalRequirements) * 100) : 0,
      pendingEvidenceCount: 0,
    },
    topics: Object.values(topicProgress).map((topic) => ({
      ...topic,
      percentage: topic.total > 0 ? Math.round((topic.answered / topic.total) * 100) : 0,
    })),
    messages: certification.dashboardMessages,
  });
});

export default router;
