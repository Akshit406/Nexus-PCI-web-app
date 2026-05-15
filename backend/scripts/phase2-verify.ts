import "dotenv/config";
import express from "express";
import { AddressInfo } from "node:net";
import bcrypt from "bcryptjs";
import { AnswerValue, CertificationStatus, PaymentState, UserRoleCode } from "@prisma/client";
import { prisma } from "../src/lib/prisma";
import { getSaqCaptureSections } from "../src/lib/saq-sections";
import { signAuthToken } from "../src/lib/auth";
import { AuthenticatedRequest } from "../src/middleware/auth";
import adminClientRoutes from "../src/routes/admin-clients";
import { canAccessCertification, canAccessClient, validateGenerationReadiness } from "../src/routes/client";

function assert(condition: unknown, message: string) {
  if (!condition) {
    throw new Error(`Phase 2 verification failed: ${message}`);
  }
}

function requiredValueForField(field: { inputType: string; options?: Array<{ value: string }> }) {
  if (field.inputType === "checkbox-group") {
    return JSON.stringify((field.options ?? [{ value: "MOTO" }]).map((option) => option.value));
  }
  if (field.inputType === "select" || field.inputType === "radio-group") {
    return field.options?.[0]?.value ?? "NO";
  }
  if (field.inputType === "number") {
    return "1";
  }
  if (field.inputType === "date") {
    return "2099-12-31";
  }
  return "Dato de verificacion";
}

async function loadCertification(id: string) {
  const certification = await prisma.certification.findUnique({
    where: { id },
    include: {
      client: true,
      saqType: true,
      answers: { include: { justification: true, requirement: { include: { topic: true } } } },
      sectionInputs: true,
      signature: true,
      paymentStatus: true,
      dashboardMessages: { where: { isActive: true }, orderBy: { createdAt: "desc" } },
      documents: true,
    },
  });

  if (!certification) {
    throw new Error("Verification certification disappeared.");
  }
  return certification;
}

async function withAdminClientTestServer<T>(adminToken: string, run: (baseUrl: string) => Promise<T>) {
  const app = express();
  app.use(express.json({ limit: "35mb" }));
  app.use("/admin/clients", adminClientRoutes);

  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    return await run(baseUrl);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

async function adminJsonRequest<T>(input: {
  baseUrl: string;
  token: string;
  path: string;
  method?: string;
  body?: unknown;
}) {
  const response = await fetch(`${input.baseUrl}${input.path}`, {
    method: input.method ?? "GET",
    headers: {
      Authorization: `Bearer ${input.token}`,
      "Content-Type": "application/json",
    },
    body: input.body ? JSON.stringify(input.body) : undefined,
  });
  const data = (await response.json().catch(() => null)) as T | { message?: string } | null;
  assert(response.ok, `Admin client route ${input.method ?? "GET"} ${input.path} failed: ${data && "message" in data ? data.message : response.status}`);
  return data as T;
}

async function main() {
  const markerPrefix = "phase2_verify";
  const marker = `${markerPrefix}_${Date.now()}_${process.pid}`;
  await prisma.auditLog.deleteMany({ where: { OR: [{ metadataJson: { contains: markerPrefix } }, { actionType: { contains: "PHASE2_VERIFY" } }] } });
  const existingClients = await prisma.client.findMany({ where: { companyName: { startsWith: markerPrefix } } });
  if (existingClients.length) {
    const clientIds = existingClients.map((client) => client.id);
    const certifications = await prisma.certification.findMany({ where: { clientId: { in: clientIds } } });
    const certificationIds = certifications.map((item) => item.id);
    await prisma.notificationLog.deleteMany({ where: { clientId: { in: clientIds } } });
    await prisma.clientDocument.deleteMany({ where: { clientId: { in: clientIds } } });
    await prisma.paymentStatus.deleteMany({ where: { clientId: { in: clientIds } } });
    await prisma.dashboardMessage.deleteMany({ where: { clientId: { in: clientIds } } });
    await prisma.signature.deleteMany({ where: { certificationId: { in: certificationIds } } });
    await prisma.certificationSectionInput.deleteMany({ where: { certificationId: { in: certificationIds } } });
    await prisma.answerJustification.deleteMany({ where: { certificationAnswer: { certificationId: { in: certificationIds } } } });
    await prisma.certificationAnswer.deleteMany({ where: { certificationId: { in: certificationIds } } });
    await prisma.executiveClientAssignment.deleteMany({ where: { clientId: { in: clientIds } } });
    await prisma.clientUser.deleteMany({ where: { clientId: { in: clientIds } } });
    await prisma.certification.deleteMany({ where: { clientId: { in: clientIds } } });
    await prisma.client.deleteMany({ where: { id: { in: clientIds } } });
  }
  await prisma.user.deleteMany({ where: { username: { startsWith: markerPrefix } } });

  const role = await prisma.role.findUniqueOrThrow({ where: { code: UserRoleCode.CLIENT } });
  const adminRole = await prisma.role.findUniqueOrThrow({ where: { code: UserRoleCode.ADMIN } });
  const executiveRole = await prisma.role.findUniqueOrThrow({ where: { code: UserRoleCode.EXECUTIVE } });
  const saqType = await prisma.saqType.findFirstOrThrow({ where: { code: "B" } });
  const mappings = await prisma.saqRequirementMap.findMany({
    where: { saqTypeId: saqType.id, isActive: true },
    include: { requirement: { include: { topic: true } } },
    orderBy: { displayOrder: "asc" },
  });
  assert(mappings.length > 0, "SAQ mappings must exist.");
  const evidenceMappings = mappings.filter((mapping) => mapping.requiresEvidence);
  assert(evidenceMappings.length > 0, "At least one mapped requirement should require evidence.");

  const user = await prisma.user.create({
    data: {
      roleId: role.id,
      email: `${marker}@pcinexus.local`,
      username: marker,
      passwordHash: await bcrypt.hash("Verify1234!", 10),
      firstName: "Phase2",
      lastName: "Verifier",
      mustChangePassword: false,
    },
  });
  const client = await prisma.client.create({
    data: {
      companyName: marker,
      businessType: "Verification",
      primaryContactEmail: user.email,
      status: "IN_PROGRESS",
    },
  });
  await prisma.clientUser.create({ data: { clientId: client.id, userId: user.id, isPrimary: true } });
  const otherClient = await prisma.client.create({
    data: {
      companyName: `${marker}_other`,
      businessType: "Verification",
      primaryContactEmail: `${marker}_other@pcinexus.local`,
      status: "IN_PROGRESS",
    },
  });
  const adminUser = await prisma.user.create({
    data: {
      roleId: adminRole.id,
      email: `${marker}_admin@pcinexus.local`,
      username: `${marker}_admin`,
      passwordHash: await bcrypt.hash("Verify1234!", 10),
      firstName: "Phase2",
      lastName: "Admin",
      mustChangePassword: false,
    },
  });
  const executiveUser = await prisma.user.create({
    data: {
      roleId: executiveRole.id,
      email: `${marker}_executive@pcinexus.local`,
      username: `${marker}_executive`,
      passwordHash: await bcrypt.hash("Verify1234!", 10),
      firstName: "Phase2",
      lastName: "Executive",
      mustChangePassword: false,
    },
  });
  await prisma.executiveClientAssignment.create({ data: { executiveUserId: executiveUser.id, clientId: client.id, isActive: true } });
  const certification = await prisma.certification.create({
    data: {
      clientId: client.id,
      saqTypeId: saqType.id,
      cycleYear: 2099,
      status: CertificationStatus.IN_PROGRESS,
      startedAt: new Date(),
    },
  });
  await prisma.paymentStatus.create({ data: { clientId: client.id, certificationId: certification.id, state: PaymentState.UNPAID } });

  const clientReq = { auth: { userId: user.id, role: UserRoleCode.CLIENT, clientId: client.id } } as AuthenticatedRequest;
  const clientOtherReq = { auth: { userId: user.id, role: UserRoleCode.CLIENT, clientId: otherClient.id } } as AuthenticatedRequest;
  const executiveReq = { auth: { userId: executiveUser.id, role: UserRoleCode.EXECUTIVE } } as AuthenticatedRequest;
  const adminReq = { auth: { userId: adminUser.id, role: UserRoleCode.ADMIN } } as AuthenticatedRequest;
  assert(await canAccessClient(clientReq, client.id), "Client should access own client record.");
  assert(!(await canAccessClient(clientReq, otherClient.id)), "Client should not access another client record.");
  assert(await canAccessClient(executiveReq, client.id), "Assigned executive should access assigned client.");
  assert(!(await canAccessClient(executiveReq, otherClient.id)), "Executive should not access unassigned client.");
  assert(await canAccessClient(adminReq, otherClient.id), "Admin should access all clients.");
  assert(Boolean(await canAccessCertification(clientReq, certification.id)), "Client should access own certification.");
  assert(!(await canAccessCertification(clientOtherReq, certification.id)), "Another client should not access certification.");

  const adminToken = signAuthToken({ userId: adminUser.id, role: UserRoleCode.ADMIN });
  await withAdminClientTestServer(adminToken, async (baseUrl) => {
    const created = await adminJsonRequest<{
      id: string;
      username: string;
      certificationId: string;
      saqTypeCode: string;
      cycleYear: number;
    }>({
      baseUrl,
      token: adminToken,
      path: "/admin/clients",
      method: "POST",
      body: {
        companyName: `${marker}_admin_route`,
        businessType: "Verification",
        primaryContactName: "Route Client",
        primaryContactEmail: `${marker}_route_client@pcinexus.local`,
        username: `${marker}_route_client`,
        temporaryPassword: "Verify1234!",
        saqTypeId: saqType.id,
        cycleYear: 2099,
        paymentState: PaymentState.UNPAID,
      },
    });
    assert(created.id && created.certificationId, "Admin route should create client and certification.");

    const updated = await adminJsonRequest<{
      id: string;
      username: string;
      passwordReset: boolean;
      saqTypeCode: string;
      cycleYear: number;
    }>({
      baseUrl,
      token: adminToken,
      path: `/admin/clients/${created.id}`,
      method: "PATCH",
      body: {
        companyName: `${marker}_admin_route_updated`,
        businessType: "Verification updated",
        primaryContactName: "Route Client Updated",
        primaryContactEmail: `${marker}_route_client_updated@pcinexus.local`,
        username: `${marker}_route_client_updated`,
        temporaryPassword: "",
        saqTypeId: saqType.id,
        cycleYear: 2100,
        paymentState: PaymentState.PAID,
      },
    });
    assert(updated.username === `${marker}_route_client_updated` && updated.cycleYear === 2100, "Admin route should edit client primary user and certification.");

    const addedUser = await adminJsonRequest<{
      id: string;
      username: string;
      temporaryPassword: string;
      clientId: string;
    }>({
      baseUrl,
      token: adminToken,
      path: `/admin/clients/${created.id}/users`,
      method: "POST",
      body: {
        fullName: "Route Extra User",
        email: `${marker}_route_extra@pcinexus.local`,
        username: `${marker}_route_extra`,
        temporaryPassword: "Verify1234!",
        isPrimary: false,
      },
    });
    assert(addedUser.clientId === created.id, "Admin route should add an additional client user.");

    const list = await adminJsonRequest<{
      items: Array<{ id: string; users: Array<{ username: string }>; currentCertification: { cycleYear: number } | null }>;
    }>({
      baseUrl,
      token: adminToken,
      path: "/admin/clients",
    });
    const listed = list.items.find((item) => item.id === created.id);
    assert(Boolean(listed), "Admin route list should include edited client.");
    assert(listed!.users.some((user) => user.username === `${marker}_route_extra`), "Admin route list should include added user.");
    assert(listed!.currentCertification?.cycleYear === 2100, "Admin route list should include updated certification.");
  });

  let validation = await validateGenerationReadiness(await loadCertification(certification.id));
  assert(!validation.ready && validation.blockerCounts.unanswered > 0, "Unanswered requirements should block generation.");

  await prisma.certificationAnswer.createMany({
    data: mappings.map((mapping) => ({
      certificationId: certification.id,
      requirementId: mapping.requirementId,
      answerValue: AnswerValue.IMPLEMENTED,
    })),
  });

  const ccwRequirement = mappings[0]!;
  await prisma.certificationAnswer.update({
    where: { certificationId_requirementId: { certificationId: certification.id, requirementId: ccwRequirement.requirementId } },
    data: { answerValue: AnswerValue.CCW, explanation: JSON.stringify({ restrictions: "x" }) },
  });
  validation = await validateGenerationReadiness(await loadCertification(certification.id));
  assert(!validation.ready && validation.blockers.some((blocker) => blocker.includes("CCW")), "Incomplete CCW fields should block generation.");

  await prisma.certificationAnswer.update({
    where: { certificationId_requirementId: { certificationId: certification.id, requirementId: ccwRequirement.requirementId } },
    data: {
      explanation: JSON.stringify({
        restrictions: "restrictions",
        definition: "definition",
        objective: "objective",
        risk: "risk",
        validation: "validation",
        maintenance: "maintenance",
      }),
    },
  });

  const naRequirement = mappings[1]!;
  await prisma.certificationAnswer.update({
    where: { certificationId_requirementId: { certificationId: certification.id, requirementId: naRequirement.requirementId } },
    data: { answerValue: AnswerValue.NOT_APPLICABLE, explanation: "" },
  });
  validation = await validateGenerationReadiness(await loadCertification(certification.id));
  assert(!validation.ready && validation.blockers.some((blocker) => blocker.includes("No Aplicable")), "Missing NA explanation should block generation.");

  await prisma.certificationAnswer.update({
    where: { certificationId_requirementId: { certificationId: certification.id, requirementId: naRequirement.requirementId } },
    data: { explanation: "No aplica al entorno de verificacion." },
  });

  for (const section of getSaqCaptureSections(saqType.code)) {
    const values = Object.fromEntries(section.fields.map((field) => [field.key, field.required === false ? "" : requiredValueForField(field)]));
    if (section.id === "part-2b-cardholder-function") {
      values.card_function_1_channel = "Pedido por correo / por telefono (MOTO)";
      values.card_function_1_description = "Descripcion de canal MOTO.";
      values.card_function_2_channel = "Comercio electronico";
      values.card_function_2_description = "Descripcion de canal ecommerce.";
      values.card_function_3_channel = "Presencial";
      values.card_function_3_description = "Descripcion de canal presencial.";
    }
    await prisma.certificationSectionInput.create({
      data: {
        certificationId: certification.id,
        sectionId: section.id,
        payloadJson: JSON.stringify(values),
      },
    });
  }

  validation = await validateGenerationReadiness(await loadCertification(certification.id));
  assert(!validation.ready && validation.blockerCounts.evidence > 0, "Missing required evidence should block generation.");

  for (const mapping of evidenceMappings) {
    await prisma.clientDocument.create({
      data: {
        clientId: client.id,
        certificationId: certification.id,
        uploadedByUserId: user.id,
        requirementId: mapping.requirementId,
        topicCode: mapping.requirement.topic.code,
        category: "EVIDENCE",
        title: `Evidence ${mapping.requirement.requirementCode}`,
        fileName: "evidence.txt",
        mimeType: "text/plain",
        storagePath: `${marker}/evidence.txt`,
        fileSizeBytes: 10,
      },
    });
  }

  validation = await validateGenerationReadiness(await loadCertification(certification.id));
  assert(!validation.ready && validation.blockerCounts.signature > 0, "Missing signature should block generation.");

  await prisma.signature.create({
    data: {
      clientId: client.id,
      certificationId: certification.id,
      uploadedByUserId: user.id,
      imageDataUrl: "data:image/png;base64,ZmFrZQ==",
    },
  });
  validation = await validateGenerationReadiness(await loadCertification(certification.id));
  assert(!validation.ready && validation.blockerCounts.payment > 0, "Unpaid certification should block generation.");

  await prisma.paymentStatus.update({ where: { certificationId: certification.id }, data: { state: PaymentState.PAID } });
  validation = await validateGenerationReadiness(await loadCertification(certification.id));
  assert(validation.ready, "Fully complete certification should be ready.");

  await prisma.certification.update({
    where: { id: certification.id },
    data: { status: CertificationStatus.FINALIZED, isLocked: true, issuedAt: new Date(), validUntil: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000) },
  });
  const locked = await prisma.certification.findUniqueOrThrow({ where: { id: certification.id } });
  assert(locked.isLocked && locked.status === CertificationStatus.FINALIZED, "Successful generation/finalization should lock certification.");

  console.log("Phase 2 verification passed.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
