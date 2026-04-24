import "dotenv/config";
import bcrypt from "bcryptjs";
import { PrismaClient, AnswerValue, CertificationStatus, ClientStatus, JustificationType, MessageType, PaymentState, UserRoleCode } from "@prisma/client";

const prisma = new PrismaClient();

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

  const admin = await prisma.user.create({
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

  const saqTypes = await Promise.all([
    prisma.saqType.create({ data: { code: "A", name: "SAQ A", templateVersion: "v4.0.1-r1" } }),
    prisma.saqType.create({ data: { code: "A_EP", name: "SAQ A-EP", templateVersion: "v4.0.1" } }),
    prisma.saqType.create({ data: { code: "B", name: "SAQ B", templateVersion: "v3.2.1" } }),
    prisma.saqType.create({ data: { code: "B_IP", name: "SAQ B-IP", templateVersion: "v4.0.1" } }),
    prisma.saqType.create({ data: { code: "C", name: "SAQ C", templateVersion: "v4.0.1" } }),
    prisma.saqType.create({ data: { code: "C_VT", name: "SAQ C-VT", templateVersion: "v4.0.1" } }),
    prisma.saqType.create({ data: { code: "D_MERCHANT", name: "SAQ D Merchant", templateVersion: "v4.0.1", supportsNotTested: true } }),
    prisma.saqType.create({ data: { code: "D_SERVICE_PROVIDER", name: "SAQ D Service Provider", templateVersion: "v4.0.1-r2", supportsNotTested: true } }),
  ]);

  const saqBip = saqTypes.find((item) => item.code === "B_IP")!;

  const topicDefinitions = [
    ["1", "Controles de Red"],
    ["2", "Configuración Segura"],
    ["3", "Protección de Datos"],
    ["4", "Cifrado en Tránsito"],
    ["5", "Protección contra Malware"],
    ["6", "Desarrollo Seguro"],
    ["7", "Acceso por Necesidad de Negocio"],
    ["8", "Identificación y Autenticación"],
    ["9", "Acceso Físico"],
    ["10", "Registro y Monitoreo"],
    ["11", "Pruebas de Seguridad"],
    ["12", "Gobierno y Políticas"],
  ] as const;

  const topicMap = new Map<string, string>();
  for (const [index, [code, name]] of topicDefinitions.entries()) {
    const topic = await prisma.pciTopic.create({
      data: { code, name, displayOrder: index + 1 },
    });
    topicMap.set(code, topic.id);
  }

  const requirementDefinitions = [
    ["2.1.1", "2", "Los valores predeterminados proporcionados por el proveedor y las cuentas predeterminadas innecesarias se eliminan o deshabilitan antes de instalar un sistema en la red.", "Revisar estándares de hardening y evidencias del cambio."],
    ["2.2.2", "2", "Todos los cambios en las configuraciones de seguridad se gestionan mediante un proceso de control de cambios.", "Validar proceso de cambios y aprobaciones."],
    ["6.2.4", "6", "Las vulnerabilidades de seguridad del software se identifican y gestionan.", "Revisar backlog de vulnerabilidades y acciones correctivas."],
    ["8.2.1", "8", "A todos los usuarios se les asigna un ID único antes de permitir el acceso a los componentes del sistema o a los datos de titulares de tarjeta.", "Validar directorio y usuarios individuales."],
    ["8.2.2", "8", "Las cuentas compartidas o genéricas solo se usan cuando son necesarias por excepción.", "Revisar cuentas compartidas y controles compensatorios."],
    ["9.1.1", "9", "Todas las políticas y procedimientos operativos identificados en el requisito 9 están documentados, actualizados, en uso y son conocidos.", "Validar política física y su publicación."],
    ["9.4.1", "9", "Todos los medios que contienen datos de tarjetahabiente están protegidos físicamente.", "Verificar controles de resguardo físico."],
    ["10.2.1", "10", "Los mecanismos de registro capturan eventos de acceso de usuarios y administradores.", "Revisar logs y evidencias de monitoreo."],
    ["11.3.1", "11", "Se realizan escaneos internos de vulnerabilidades al menos trimestralmente.", "Validar calendario de escaneos y resultados."],
    ["12.1.1", "12", "Existe una política general de seguridad de la información establecida, publicada y mantenida.", "Revisar política y aceptación."],
  ] as const;

  const requirementIds = new Map<string, string>();
  let displayOrder = 1;
  for (const [code, topicCode, description, testingProcedures] of requirementDefinitions) {
    const requirement = await prisma.pciRequirement.create({
      data: {
        requirementCode: code,
        title: code,
        description,
        testingProcedures,
        topicId: topicMap.get(topicCode)!,
        requirementVersion: "phase1-seed",
      },
    });
    requirementIds.set(code, requirement.id);

    await prisma.saqRequirementMap.create({
      data: {
        saqTypeId: saqBip.id,
        requirementId: requirement.id,
        displayOrder: displayOrder++,
        requiresEvidence: ["10.2.1", "11.3.1", "12.1.1"].includes(code),
        allowNotTested: false,
      },
    });
  }

  const previousCertification = await prisma.certification.create({
    data: {
      clientId: client.id,
      saqTypeId: saqBip.id,
      cycleYear: 2025,
      status: CertificationStatus.FINALIZED,
      startedAt: new Date("2025-02-01T00:00:00.000Z"),
      finalizedAt: new Date("2025-02-20T00:00:00.000Z"),
      issuedAt: new Date("2025-02-20T00:00:00.000Z"),
      validUntil: new Date("2026-02-20T00:00:00.000Z"),
      isLocked: true,
      lastViewedTopicCode: "8",
      templateVersionSnapshot: "v4.0.1",
      mappingVersionSnapshot: "phase1-seed",
    },
  });

  const currentCertification = await prisma.certification.create({
    data: {
      clientId: client.id,
      saqTypeId: saqBip.id,
      cycleYear: 2026,
      status: CertificationStatus.IN_PROGRESS,
      startedAt: new Date(),
      isLocked: false,
      lastViewedTopicCode: "8",
      preloadedFromCertificationId: previousCertification.id,
      templateVersionSnapshot: "v4.0.1",
      mappingVersionSnapshot: "phase1-seed",
    },
  });

  const seededAnswers: Array<[string, AnswerValue, string | null, JustificationType | null]> = [
    ["2.1.1", AnswerValue.IMPLEMENTED, null, null],
    ["2.2.2", AnswerValue.IMPLEMENTED, null, null],
    ["6.2.4", AnswerValue.IMPLEMENTED, null, null],
    ["8.2.1", AnswerValue.IMPLEMENTED, null, null],
    ["8.2.2", AnswerValue.NOT_APPLICABLE, "No existen cuentas compartidas en el entorno evaluado.", JustificationType.NA_ANNEX_C],
  ];

  for (const [requirementCode, answerValue, explanation, justificationType] of seededAnswers) {
    const answer = await prisma.certificationAnswer.create({
      data: {
        certificationId: currentCertification.id,
        requirementId: requirementIds.get(requirementCode)!,
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
      notes: "El cliente puede continuar con el SAQ, pero no podrá generar documentos hasta liquidar el pago.",
    },
  });

  await prisma.dashboardMessage.createMany({
    data: [
      {
        clientId: client.id,
        certificationId: currentCertification.id,
        title: "Respuestas precargadas",
        message: "Tus respuestas de la certificación anterior fueron precargadas. Revísalas y realiza los ajustes necesarios antes de cerrar la edición.",
        messageType: MessageType.INFO,
      },
      {
        clientId: client.id,
        certificationId: currentCertification.id,
        title: "Pago pendiente para generación",
        message: "Puedes completar el cuestionario normalmente, pero la generación del SAQ y diploma quedará bloqueada hasta que el ejecutivo marque el pago como realizado.",
        messageType: MessageType.WARNING,
      },
    ],
  });

  console.log("Phase 1 seed complete.");
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
