import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const templates = [
  {
    key: "antimalware-procedimiento",
    title: "Procedimiento de instalacion y validacion antimalware",
    description: "Plantilla editable para documentar controles antimalware, alcance operativo y responsables del proceso.",
    fileName: "antimalware-procedimiento.docx",
    fileType: "DOCX editable",
  },
  {
    key: "r11-pruebas-seguridad",
    title: "R11 pruebas de seguridad de sistemas y redes",
    description: "Plantilla base para formalizar escaneos, revisiones periodicas, hallazgos y seguimiento del requisito 11.",
    fileName: "r11-pruebas-seguridad.docx",
    fileType: "DOCX editable",
  },
  {
    key: "r12-politica-seguridad",
    title: "R12 politica de seguridad de la informacion",
    description: "Plantilla editable para registrar politica de seguridad, responsabilidades y ciclo de actualizacion documental.",
    fileName: "r12-politica-seguridad.docx",
    fileType: "DOCX editable",
  },
];

async function copyTemplate(fileName: string) {
  const sourcePath = path.resolve(process.cwd(), "..", "frontend", "public", "templates", "editable", fileName);
  const relativeDirectory = path.join("document-templates", "seed");
  const destinationDirectory = path.join(process.cwd(), "storage", relativeDirectory);
  await fs.mkdir(destinationDirectory, { recursive: true });
  const destinationPath = path.join(destinationDirectory, fileName);
  await fs.copyFile(sourcePath, destinationPath);
  const stat = await fs.stat(destinationPath);
  return {
    storagePath: path.join(relativeDirectory, fileName),
    fileSizeBytes: stat.size,
  };
}

async function main() {
  const admin = await prisma.user.findFirst({
    where: { role: { code: "ADMIN" } },
  });

  for (const template of templates) {
    const stored = await copyTemplate(template.fileName);
    await prisma.documentTemplate.upsert({
      where: { key: template.key },
      create: {
        ...template,
        mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        storagePath: stored.storagePath,
        fileSizeBytes: stored.fileSizeBytes,
        createdByUserId: admin?.id,
        updatedByUserId: admin?.id,
      },
      update: {
        title: template.title,
        description: template.description,
        fileName: template.fileName,
        fileType: template.fileType,
        mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        storagePath: stored.storagePath,
        fileSizeBytes: stored.fileSizeBytes,
        isActive: true,
        isArchived: false,
        archivedAt: null,
        updatedByUserId: admin?.id,
      },
    });
  }

  console.log(`Seeded ${templates.length} editable document templates.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => prisma.$disconnect());
