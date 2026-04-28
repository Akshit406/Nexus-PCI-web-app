import { CertificationStatus, MessageType } from "@prisma/client";
import { prisma } from "./prisma";
import { sendEmail } from "./email";

const DAY_MS = 24 * 60 * 60 * 1000;
const ABANDONED_PROCESS_STATUSES: CertificationStatus[] = [
  CertificationStatus.DRAFT,
  CertificationStatus.IN_PROGRESS,
];
const DOCUMENT_REFRESH_STATUSES: CertificationStatus[] = [
  CertificationStatus.DRAFT,
  CertificationStatus.IN_PROGRESS,
  CertificationStatus.READY_TO_GENERATE,
];

type ReminderCandidate = {
  key: string;
  title: string;
  message: string;
  certificationId: string;
  clientId: string;
  email?: string | null;
};

async function sendReminder(candidate: ReminderCandidate) {
  const existing = await prisma.notificationLog.findUnique({
    where: {
      certificationId_notificationKey_channel: {
        certificationId: candidate.certificationId,
        notificationKey: candidate.key,
        channel: "DASHBOARD",
      },
    },
  });

  if (existing) {
    return { key: candidate.key, skipped: true };
  }

  await prisma.$transaction([
    prisma.dashboardMessage.create({
      data: {
        clientId: candidate.clientId,
        certificationId: candidate.certificationId,
        title: candidate.title,
        message: candidate.message,
        messageType: MessageType.WARNING,
      },
    }),
    prisma.notificationLog.create({
      data: {
        clientId: candidate.clientId,
        certificationId: candidate.certificationId,
        notificationKey: candidate.key,
        channel: "DASHBOARD",
        sentTo: candidate.email ?? undefined,
      },
    }),
  ]);

  if (candidate.email) {
    await sendEmail({
      to: candidate.email,
      subject: candidate.title,
      text: candidate.message,
    });
  }

  return { key: candidate.key, skipped: false };
}

export async function runPhase2ReminderScan(now = new Date()) {
  const certifications = await prisma.certification.findMany({
    where: { status: { not: CertificationStatus.ARCHIVED } },
    include: {
      client: { include: { users: { include: { user: true } } } },
      paymentStatus: true,
      documents: true,
      answers: true,
      saqType: true,
    },
  });

  const candidates: ReminderCandidate[] = [];

  for (const certification of certifications) {
    const primaryEmail =
      certification.client.primaryContactEmail ??
      certification.client.users.find((link) => link.isPrimary)?.user.email ??
      certification.client.users[0]?.user.email;

    if (certification.validUntil) {
      const daysUntilExpiration = Math.ceil((certification.validUntil.getTime() - now.getTime()) / DAY_MS);
      for (const days of [60, 30, 15]) {
        if (daysUntilExpiration <= days && daysUntilExpiration > days - 7) {
          candidates.push({
            key: `EXPIRATION_${days}_DAY`,
            title: `Recordatorio de vencimiento a ${days} dias`,
            message: `La certificacion ${certification.saqType.name} de ${certification.client.companyName} vence en aproximadamente ${daysUntilExpiration} dias.`,
            certificationId: certification.id,
            clientId: certification.clientId,
            email: primaryEmail,
          });
        }
      }
    }

    const startedAt = certification.startedAt ?? certification.createdAt;
    const daysSinceStart = Math.floor((now.getTime() - startedAt.getTime()) / DAY_MS);
    if (ABANDONED_PROCESS_STATUSES.includes(certification.status) && daysSinceStart >= 14 && certification.answers.length === 0) {
      candidates.push({
        key: "ABANDONED_PROCESS_14_DAY",
        title: "Proceso pendiente de avance",
        message: "No se han registrado respuestas recientes. Revisa el cuestionario y documentos pendientes para continuar.",
        certificationId: certification.id,
        clientId: certification.clientId,
        email: primaryEmail,
      });
    }

    const lastDocumentAt = certification.documents.reduce<Date | null>(
      (latest, document) => (!latest || document.createdAt > latest ? document.createdAt : latest),
      null,
    );
    const staleDocumentDays = lastDocumentAt ? Math.floor((now.getTime() - lastDocumentAt.getTime()) / DAY_MS) : daysSinceStart;
    if (staleDocumentDays >= 30 && DOCUMENT_REFRESH_STATUSES.includes(certification.status)) {
      candidates.push({
        key: "DOCUMENT_REFRESH_30_DAY",
        title: "Revision documental sugerida",
        message: "Te sugerimos revisar si la evidencia o documentacion cargada sigue vigente para el ciclo actual.",
        certificationId: certification.id,
        clientId: certification.clientId,
        email: primaryEmail,
      });
    }
  }

  const results = [];
  for (const candidate of candidates) {
    results.push(await sendReminder(candidate));
  }

  return {
    scanned: certifications.length,
    candidates: candidates.length,
    sent: results.filter((result) => !result.skipped).length,
    skipped: results.filter((result) => result.skipped).length,
    results,
  };
}
