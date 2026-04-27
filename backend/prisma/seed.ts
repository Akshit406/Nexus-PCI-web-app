import "dotenv/config";
import bcrypt from "bcryptjs";
import {
  AnswerValue,
  CertificationStatus,
  ClientStatus,
  JustificationType,
  MessageType,
  PaymentState,
  PrismaClient,
  UserRoleCode,
} from "@prisma/client";
import { importSaqData } from "./import-saq-data";

const prisma = new PrismaClient();
const IMPORT_MAPPING_VERSION = "pci-dss-v4.0.1-excel";

async function main() {
  await prisma.auditLog.deleteMany();
  await prisma.passwordResetToken.deleteMany();
  await prisma.dashboardMessage.deleteMany();
  await prisma.paymentStatus.deleteMany();
  await prisma.clientDocument.deleteMany();
  await prisma.signature.deleteMany();
  await prisma.certificationSectionInput.deleteMany();
  await prisma.answerJustification.deleteMany();
  await prisma.certificationAnswer.deleteMany();
  await prisma.certification.deleteMany();
  await prisma.saqRequirementMap.deleteMany();
  await prisma.pciRequirement.deleteMany();
  await prisma.pciTopic.deleteMany();
  await prisma.saqType.deleteMany();
  await prisma.executiveClientAssignment.deleteMany();
  await prisma.clientUser.deleteMany();
  await prisma.client.deleteMany();
  await prisma.user.deleteMany();
  await prisma.role.deleteMany();

  const [adminRole, executiveRole, clientRole] = await Promise.all([
    prisma.role.create({ data: { code: UserRoleCode.ADMIN, name: "Administrator" } }),
    prisma.role.create({ data: { code: UserRoleCode.EXECUTIVE, name: "Executive" } }),
    prisma.role.create({ data: { code: UserRoleCode.CLIENT, name: "Client" } }),
  ]);

  const tempPassword = await bcrypt.hash("Temp1234!", 10);
  const strongPassword = await bcrypt.hash("Nexus1234!", 10);

  await prisma.user.create({
    data: {
      roleId: adminRole.id,
      email: "admin@pcinexus.local",
      username: "farenas_admin",
      passwordHash: strongPassword,
      firstName: "Federico",
      lastName: "Arenas",
      mustChangePassword: false,
      mfaEnabled: true,
    },
  });

  const vFlores = await prisma.user.create({
    data: {
      roleId: executiveRole.id,
      email: "vflores@pcinexus.local",
      username: "VFlores",
      passwordHash: strongPassword,
      firstName: "Valeria",
      lastName: "Flores",
      mustChangePassword: false,
    },
  });

  await prisma.user.create({
    data: {
      roleId: executiveRole.id,
      email: "aarenas@pcinexus.local",
      username: "AArenas",
      passwordHash: strongPassword,
      firstName: "Alejandro",
      lastName: "Arenas",
      mustChangePassword: false,
    },
  });

  const clientUser = await prisma.user.create({
    data: {
      roleId: clientRole.id,
      email: "cliente.demo@pcinexus.local",
      username: "cliente_demo",
      passwordHash: tempPassword,
      firstName: "Ana",
      lastName: "Lopez",
      mustChangePassword: true,
    },
  });

  const partnerUser = await prisma.user.create({
    data: {
      roleId: clientRole.id,
      email: "socio.kronos@pcinexus.local",
      username: "socio_kronos",
      passwordHash: strongPassword,
      firstName: "Socio",
      lastName: "Kronos",
      mustChangePassword: false,
    },
  });

  const client = await prisma.client.create({
    data: {
      companyName: "Kronos Digital Group",
      businessType: "Terminales conectadas IP",
      taxId: "YFYY134920",
      website: "https://www.kronos-demo.com",
      postalAddress: "Calle 62 #729, CDMX",
      fiscalAddress: "Av. Fiscal 73, CDMX",
      primaryContactName: "Ana Lopez",
      primaryContactTitle: "Coordinadora de Cumplimiento",
      primaryContactEmail: clientUser.email,
      primaryContactPhone: "5541882904",
      adminContactName: "Diego Herrera",
      adminContactEmail: "diego@kronos.com",
      adminContactPhone: "5514734495",
      status: ClientStatus.IN_PROGRESS,
    },
  });

  await prisma.clientUser.create({
    data: { clientId: client.id, userId: clientUser.id, isPrimary: true },
  });

  await prisma.clientUser.create({
    data: { clientId: client.id, userId: partnerUser.id, isPrimary: false },
  });

  await prisma.executiveClientAssignment.create({
    data: { executiveUserId: vFlores.id, clientId: client.id, isActive: true },
  });

  const importSummary = await importSaqData(prisma);
  const demoSaq = await prisma.saqType.findUniqueOrThrow({ where: { code: "B" } });
  const demoMappings = await prisma.saqRequirementMap.findMany({
    where: { saqTypeId: demoSaq.id, isActive: true },
    include: { requirement: true },
    orderBy: { displayOrder: "asc" },
  });

  if (demoMappings.length === 0) {
    throw new Error("Seed cannot continue because SAQ B has no imported requirement mappings.");
  }

  const firstTopicCode = demoMappings[0].requirement.requirementCode.split(".")[0];

  const previousCertification = await prisma.certification.create({
    data: {
      clientId: client.id,
      saqTypeId: demoSaq.id,
      cycleYear: 2025,
      status: CertificationStatus.FINALIZED,
      startedAt: new Date("2025-02-01T00:00:00.000Z"),
      finalizedAt: new Date("2025-02-20T00:00:00.000Z"),
      issuedAt: new Date("2025-02-20T00:00:00.000Z"),
      validUntil: new Date("2026-02-20T00:00:00.000Z"),
      isLocked: true,
      lastViewedTopicCode: firstTopicCode,
      templateVersionSnapshot: demoSaq.templateVersion,
      mappingVersionSnapshot: IMPORT_MAPPING_VERSION,
    },
  });

  const currentCertification = await prisma.certification.create({
    data: {
      clientId: client.id,
      saqTypeId: demoSaq.id,
      cycleYear: 2026,
      status: CertificationStatus.IN_PROGRESS,
      startedAt: new Date(),
      isLocked: false,
      lastViewedTopicCode: firstTopicCode,
      preloadedFromCertificationId: previousCertification.id,
      templateVersionSnapshot: demoSaq.templateVersion,
      mappingVersionSnapshot: IMPORT_MAPPING_VERSION,
    },
  });

  const seededAnswers = demoMappings.slice(0, 5).map((mapping, index) => ({
    requirementId: mapping.requirementId,
    answerValue: index === 4 ? AnswerValue.NOT_APPLICABLE : AnswerValue.IMPLEMENTED,
    explanation: index === 4 ? "No aplica al entorno evaluado para esta demostracion." : null,
    justificationType: index === 4 ? JustificationType.NA_ANNEX_C : null,
  }));

  for (const { requirementId, answerValue, explanation, justificationType } of seededAnswers) {
    const answer = await prisma.certificationAnswer.create({
      data: {
        certificationId: currentCertification.id,
        requirementId,
        answerValue,
        isPreloaded: true,
        answeredByUserId: clientUser.id,
        explanation,
      },
    });

    if (explanation && justificationType) {
      await prisma.answerJustification.create({
        data: {
          certificationAnswerId: answer.id,
          justificationType,
          details: explanation,
        },
      });
    }
  }

  await prisma.paymentStatus.create({
    data: {
      clientId: client.id,
      certificationId: currentCertification.id,
      state: PaymentState.UNPAID,
      updatedByUserId: vFlores.id,
      notes: "El cliente puede continuar con el SAQ, pero no podra generar documentos hasta liquidar el pago.",
    },
  });

  await prisma.dashboardMessage.createMany({
    data: [
      {
        clientId: client.id,
        certificationId: currentCertification.id,
        title: "Respuestas precargadas",
        message: "Tus respuestas de la certificacion anterior fueron precargadas. Revisalas y realiza los ajustes necesarios antes de cerrar la edicion.",
        messageType: MessageType.INFO,
      },
      {
        clientId: client.id,
        certificationId: currentCertification.id,
        title: "Pago pendiente para generacion",
        message: "Puedes completar el cuestionario normalmente, pero la generacion del SAQ y diploma quedara bloqueada hasta que el ejecutivo marque el pago como realizado.",
        messageType: MessageType.WARNING,
      },
    ],
  });

  console.log("Phase 1 seed complete.");
  console.log(`Imported ${importSummary.requirements} requirements and ${importSummary.mappings} SAQ mappings from requisitosvsSAQ.xlsx.`);
  console.log(`Demo certification uses ${demoSaq.name} with ${demoMappings.length} mapped requirements.`);
  console.log("Client login: cliente_demo / Temp1234!");
  console.log("Partner login: socio_kronos / Nexus1234!");
  console.log("Admin login: farenas_admin / Nexus1234!");
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
