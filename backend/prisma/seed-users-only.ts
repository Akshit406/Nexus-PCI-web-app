import "dotenv/config";
import bcrypt from "bcryptjs";
import { PrismaClient, UserRoleCode, ClientStatus } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  // Upsert roles
  const [adminRole, executiveRole, clientRole] = await Promise.all([
    prisma.role.upsert({ where: { code: UserRoleCode.ADMIN },    update: {}, create: { code: UserRoleCode.ADMIN,     name: "Administrator" } }),
    prisma.role.upsert({ where: { code: UserRoleCode.EXECUTIVE }, update: {}, create: { code: UserRoleCode.EXECUTIVE, name: "Executive" } }),
    prisma.role.upsert({ where: { code: UserRoleCode.CLIENT },   update: {}, create: { code: UserRoleCode.CLIENT,    name: "Client" } }),
  ]);

  const tempPassword   = await bcrypt.hash("Temp1234!",  10);
  const strongPassword = await bcrypt.hash("Nexus1234!", 10);

  // Admin
  await prisma.user.upsert({
    where: { username: "farenas_admin" },
    update: {},
    create: {
      roleId: adminRole.id,
      email: "admin@pcinexus.local",
      username: "farenas_admin",
      passwordHash: strongPassword,
      firstName: "Federico",
      lastName: "Arenas",
      mustChangePassword: false,
      mfaEnabled: false,
    },
  });

  // Executives
  const vFlores = await prisma.user.upsert({
    where: { username: "VFlores" },
    update: {},
    create: {
      roleId: executiveRole.id,
      email: "vflores@pcinexus.local",
      username: "VFlores",
      passwordHash: strongPassword,
      firstName: "Valeria",
      lastName: "Flores",
      mustChangePassword: false,
    },
  });

  await prisma.user.upsert({
    where: { username: "AArenas" },
    update: {},
    create: {
      roleId: executiveRole.id,
      email: "aarenas@pcinexus.local",
      username: "AArenas",
      passwordHash: strongPassword,
      firstName: "Alejandro",
      lastName: "Arenas",
      mustChangePassword: false,
    },
  });

  // Demo client user
  const clientUser = await prisma.user.upsert({
    where: { username: "cliente_demo" },
    update: {},
    create: {
      roleId: clientRole.id,
      email: "cliente.demo@pcinexus.local",
      username: "cliente_demo",
      passwordHash: tempPassword,
      firstName: "Ana",
      lastName: "Lopez",
      mustChangePassword: true,
    },
  });

  // Partner user
  const partnerUser = await prisma.user.upsert({
    where: { username: "socio_kronos" },
    update: {},
    create: {
      roleId: clientRole.id,
      email: "socio.kronos@pcinexus.local",
      username: "socio_kronos",
      passwordHash: strongPassword,
      firstName: "Socio",
      lastName: "Kronos",
      mustChangePassword: false,
    },
  });

  // Demo client company
  let client = await prisma.client.findFirst({ where: { companyName: "Kronos Digital Group" } });
  if (!client) {
    client = await prisma.client.create({
      data: {
        companyName: "Kronos Digital Group",
        dbaName: "Kronos",
        businessType: "Terminales conectadas IP",
        taxId: "YFYY134920",
        website: "https://www.kronos-demo.com",
        primaryContactName: "Ana Lopez",
        primaryContactEmail: clientUser.email,
        status: ClientStatus.IN_PROGRESS,
      },
    });
  }

  // Link users to client
  await prisma.clientUser.upsert({
    where: { clientId_userId: { clientId: client.id, userId: clientUser.id } },
    update: {},
    create: { clientId: client.id, userId: clientUser.id, isPrimary: true },
  });

  await prisma.clientUser.upsert({
    where: { clientId_userId: { clientId: client.id, userId: partnerUser.id } },
    update: {},
    create: { clientId: client.id, userId: partnerUser.id, isPrimary: false },
  });

  await prisma.executiveClientAssignment.upsert({
    where: { executiveUserId_clientId_isActive: { executiveUserId: vFlores.id, clientId: client.id, isActive: true } },
    update: {},
    create: { executiveUserId: vFlores.id, clientId: client.id, isActive: true },
  });

  console.log("Users seeded successfully.");
  console.log("  cliente_demo  / Temp1234!  (client - must change password on first login)");
  console.log("  socio_kronos  / Nexus1234! (client)");
  console.log("  VFlores       / Nexus1234! (executive)");
  console.log("  farenas_admin / Nexus1234! (admin)");
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
