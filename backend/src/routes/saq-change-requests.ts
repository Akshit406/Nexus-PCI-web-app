import { Router } from "express";
import { CertificationStatus, MessageType, SaqChangeRequestStatus, UserRoleCode } from "@prisma/client";
import { z } from "zod";
import { writeAuditLog } from "../lib/audit";
import { prisma } from "../lib/prisma";
import { AuthenticatedRequest, requireAuth, requireRole } from "../middleware/auth";

const router = Router();

function getUserAgentHeader(value: string | string[] | undefined) {
  return Array.isArray(value) ? value.join(", ") : value;
}

// Executives may only act on their assigned clients; admins act on all.
function executiveClientFilter(req: AuthenticatedRequest) {
  if (req.auth?.role === UserRoleCode.EXECUTIVE) {
    return {
      client: {
        executiveAssignments: { some: { executiveUserId: req.auth.userId, isActive: true } },
      },
    };
  }
  return {};
}

async function canActOnRequest(req: AuthenticatedRequest, clientId: string) {
  if (req.auth?.role === UserRoleCode.ADMIN) {
    return true;
  }
  if (req.auth?.role === UserRoleCode.EXECUTIVE) {
    const assignment = await prisma.executiveClientAssignment.findFirst({
      where: { executiveUserId: req.auth.userId, clientId, isActive: true },
    });
    return Boolean(assignment);
  }
  return false;
}

router.get(
  "/",
  requireAuth,
  requireRole([UserRoleCode.EXECUTIVE, UserRoleCode.ADMIN]),
  async (req: AuthenticatedRequest, res) => {
    const statusParam = Array.isArray(req.query.status) ? req.query.status[0] : req.query.status;
    const statusFilter =
      statusParam && Object.values(SaqChangeRequestStatus).includes(statusParam as SaqChangeRequestStatus)
        ? { status: statusParam as SaqChangeRequestStatus }
        : {};

    const requests = await prisma.saqChangeRequest.findMany({
      where: { ...statusFilter, ...executiveClientFilter(req) },
      include: {
        client: { select: { companyName: true } },
        certification: { include: { saqType: { select: { name: true, code: true } } } },
      },
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    });

    const requestedTypeIds = requests
      .map((request) => request.requestedSaqTypeId)
      .filter((value): value is string => Boolean(value));
    const requestedTypes = requestedTypeIds.length
      ? await prisma.saqType.findMany({ where: { id: { in: requestedTypeIds } }, select: { id: true, name: true } })
      : [];
    const requestedTypeNameById = new Map(requestedTypes.map((type) => [type.id, type.name]));

    res.json({
      items: requests.map((request) => ({
        id: request.id,
        clientId: request.clientId,
        companyName: request.client.companyName,
        certificationId: request.certificationId,
        currentSaqType: request.certification.saqType.name,
        currentSaqTypeId: request.currentSaqTypeId,
        requestedSaqTypeId: request.requestedSaqTypeId,
        requestedSaqType: request.requestedSaqTypeId ? requestedTypeNameById.get(request.requestedSaqTypeId) ?? null : null,
        reason: request.reason,
        status: request.status,
        resolutionNotes: request.resolutionNotes,
        createdAt: request.createdAt,
        resolvedAt: request.resolvedAt,
      })),
    });
  },
);

router.get(
  "/pending-count",
  requireAuth,
  requireRole([UserRoleCode.EXECUTIVE, UserRoleCode.ADMIN]),
  async (req: AuthenticatedRequest, res) => {
    const count = await prisma.saqChangeRequest.count({
      where: { status: SaqChangeRequestStatus.PENDING, ...executiveClientFilter(req) },
    });
    res.json({ count });
  },
);

router.post(
  "/:id/approve",
  requireAuth,
  requireRole([UserRoleCode.EXECUTIVE, UserRoleCode.ADMIN]),
  async (req: AuthenticatedRequest, res) => {
    const schema = z.object({
      requestedSaqTypeId: z.string().min(1).optional(),
      cycleYear: z.number().int().min(2020).max(2100).optional(),
      notes: z.string().trim().max(500).optional(),
    });
    const parsed = schema.safeParse(req.body);
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    if (!parsed.success || !id || !req.auth) {
      return res.status(400).json({ message: "Datos invalidos." });
    }

    const request = await prisma.saqChangeRequest.findUnique({
      where: { id },
      include: { certification: true },
    });
    if (!request) {
      return res.status(404).json({ message: "Solicitud no encontrada." });
    }
    if (request.status !== SaqChangeRequestStatus.PENDING) {
      return res.status(400).json({ message: "La solicitud ya fue resuelta." });
    }
    if (!(await canActOnRequest(req, request.clientId))) {
      return res.status(403).json({ message: "No tienes acceso a esta solicitud." });
    }

    const targetSaqTypeId = parsed.data.requestedSaqTypeId ?? request.requestedSaqTypeId ?? null;
    const willReassign = Boolean(targetSaqTypeId && targetSaqTypeId !== request.certification.saqTypeId);

    if (willReassign && request.certification.isLocked) {
      return res.status(400).json({
        message: "La certificacion esta bloqueada. Reabrela antes de aplicar el cambio de SAQ.",
      });
    }

    const saqType = targetSaqTypeId
      ? await prisma.saqType.findUnique({ where: { id: targetSaqTypeId } })
      : null;
    if (targetSaqTypeId && (!saqType || !saqType.isActive)) {
      return res.status(404).json({ message: "SAQ destino no encontrado o inactivo." });
    }

    const result = await prisma.$transaction(async (tx) => {
      if (willReassign && saqType) {
        await tx.certification.update({
          where: { id: request.certificationId },
          data: {
            saqTypeId: saqType.id,
            cycleYear: parsed.data.cycleYear ?? request.certification.cycleYear,
            templateVersionSnapshot: saqType.templateVersion,
            status: CertificationStatus.IN_PROGRESS,
          },
        });

        // Drop answers that no longer map to the new SAQ.
        const newMappings = await tx.saqRequirementMap.findMany({
          where: { saqTypeId: saqType.id, isActive: true },
          select: { requirementId: true },
        });
        const validRequirementIds = newMappings.map((mapping) => mapping.requirementId);
        const staleAnswers = await tx.certificationAnswer.findMany({
          where: {
            certificationId: request.certificationId,
            requirementId: { notIn: validRequirementIds.length > 0 ? validRequirementIds : ["__none__"] },
          },
          select: { id: true },
        });
        if (staleAnswers.length > 0) {
          const staleIds = staleAnswers.map((row) => row.id);
          await tx.answerJustification.deleteMany({ where: { certificationAnswerId: { in: staleIds } } });
          await tx.certificationAnswer.deleteMany({ where: { id: { in: staleIds } } });
        }
      }

      const updatedRequest = await tx.saqChangeRequest.update({
        where: { id: request.id },
        data: {
          status: SaqChangeRequestStatus.APPROVED,
          resolvedByUserId: req.auth!.userId,
          resolvedAt: new Date(),
          resolutionNotes: parsed.data.notes?.trim() || null,
          appliedSaqTypeId: willReassign && saqType ? saqType.id : null,
        },
      });

      await tx.dashboardMessage.create({
        data: {
          clientId: request.clientId,
          certificationId: request.certificationId,
          title: "Solicitud de cambio de SAQ aprobada",
          message: willReassign && saqType
            ? `Tu solicitud fue aprobada. El SAQ se actualizo a ${saqType.name}.${parsed.data.notes ? ` Nota: ${parsed.data.notes.trim()}` : ""}`
            : `Tu solicitud de revision de SAQ fue aprobada.${parsed.data.notes ? ` Nota: ${parsed.data.notes.trim()}` : ""}`,
          messageType: MessageType.SUCCESS,
        },
      });

      return updatedRequest;
    });

    await writeAuditLog({
      userId: req.auth.userId,
      roleCode: req.auth.role,
      actionType: "SAQ_CHANGE_REQUEST_APPROVED",
      targetTable: "SaqChangeRequest",
      targetId: result.id,
      clientId: request.clientId,
      certificationId: request.certificationId,
      ipAddress: req.ip,
      userAgent: getUserAgentHeader(req.headers["user-agent"]),
      metadata: { reassigned: willReassign, appliedSaqTypeId: result.appliedSaqTypeId },
    });

    res.json({ id: result.id, status: result.status, reassigned: willReassign });
  },
);

router.post(
  "/:id/reject",
  requireAuth,
  requireRole([UserRoleCode.EXECUTIVE, UserRoleCode.ADMIN]),
  async (req: AuthenticatedRequest, res) => {
    const schema = z.object({ notes: z.string().trim().max(500).optional() });
    const parsed = schema.safeParse(req.body);
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    if (!parsed.success || !id || !req.auth) {
      return res.status(400).json({ message: "Datos invalidos." });
    }

    const request = await prisma.saqChangeRequest.findUnique({ where: { id } });
    if (!request) {
      return res.status(404).json({ message: "Solicitud no encontrada." });
    }
    if (request.status !== SaqChangeRequestStatus.PENDING) {
      return res.status(400).json({ message: "La solicitud ya fue resuelta." });
    }
    if (!(await canActOnRequest(req, request.clientId))) {
      return res.status(403).json({ message: "No tienes acceso a esta solicitud." });
    }

    const result = await prisma.$transaction(async (tx) => {
      const updatedRequest = await tx.saqChangeRequest.update({
        where: { id: request.id },
        data: {
          status: SaqChangeRequestStatus.REJECTED,
          resolvedByUserId: req.auth!.userId,
          resolvedAt: new Date(),
          resolutionNotes: parsed.data.notes?.trim() || null,
        },
      });

      await tx.dashboardMessage.create({
        data: {
          clientId: request.clientId,
          certificationId: request.certificationId,
          title: "Solicitud de cambio de SAQ rechazada",
          message: `Tu solicitud de cambio de SAQ fue rechazada.${parsed.data.notes ? ` Motivo: ${parsed.data.notes.trim()}` : ""}`,
          messageType: MessageType.INFO,
        },
      });

      return updatedRequest;
    });

    await writeAuditLog({
      userId: req.auth.userId,
      roleCode: req.auth.role,
      actionType: "SAQ_CHANGE_REQUEST_REJECTED",
      targetTable: "SaqChangeRequest",
      targetId: result.id,
      clientId: request.clientId,
      certificationId: request.certificationId,
      ipAddress: req.ip,
      userAgent: getUserAgentHeader(req.headers["user-agent"]),
    });

    res.json({ id: result.id, status: result.status });
  },
);

export default router;
