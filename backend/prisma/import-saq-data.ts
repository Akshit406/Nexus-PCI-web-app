import "dotenv/config";
import path from "node:path";
import fs from "node:fs";
import { PrismaClient, Prisma } from "@prisma/client";
import * as XLSX from "xlsx";

const DEFAULT_MAPPING_VERSION = "pci-dss-v4.0.1-excel";

const topicDefinitions = [
  ["1", "Instalar y mantener los controles de seguridad de la red"],
  ["2", "Aplicar configuraciones seguras a todos los componentes del sistema"],
  ["3", "Proteger los datos de cuenta almacenados"],
  ["4", "Proteger los datos de titulares de tarjeta con criptografia fuerte durante la transmision"],
  ["5", "Proteger todos los sistemas y redes contra software malicioso"],
  ["6", "Desarrollar y mantener sistemas y software seguros"],
  ["7", "Restringir el acceso a componentes del sistema y datos de titulares de tarjeta"],
  ["8", "Identificar usuarios y autenticar el acceso a componentes del sistema"],
  ["9", "Restringir el acceso fisico a datos de titulares de tarjeta"],
  ["10", "Registrar y monitorear todo acceso a componentes del sistema y datos de titulares de tarjeta"],
  ["11", "Probar regularmente la seguridad de sistemas y redes"],
  ["12", "Mantener una politica de seguridad de la informacion"],
] as const;

const saqColumnDefinitions = [
  { columnIndex: 0, header: "SAQ A", code: "A", name: "SAQ A", supportsNotTested: false },
  { columnIndex: 1, header: "SAQ A-EP", code: "A_EP", name: "SAQ A-EP", supportsNotTested: false },
  { columnIndex: 2, header: "SAQ B", code: "B", name: "SAQ B", supportsNotTested: false },
  { columnIndex: 3, header: "SAQ C", code: "C", name: "SAQ C", supportsNotTested: false },
  { columnIndex: 4, header: "SAQ C-VT", code: "C_VT", name: "SAQ C-VT", supportsNotTested: false },
  { columnIndex: 5, header: "SAQ D-M", code: "D_MERCHANT", name: "SAQ D Merchant", supportsNotTested: true },
  { columnIndex: 6, header: "SAQ D-P2PE", code: "D_P2PE", name: "SAQ D P2PE", supportsNotTested: true },
] as const;

type SaqCode = (typeof saqColumnDefinitions)[number]["code"];

type ImportSummary = {
  workbookPath: string;
  topics: number;
  requirements: number;
  saqTypes: number;
  mappings: number;
  mappingsBySaq: Record<string, number>;
};

type ParsedRequirement = {
  code: string;
  topicCode: string;
  title: string;
  description: string;
  sourceRow: number;
  saqCodes: SaqCode[];
};

function findWorkbookPath() {
  const candidates = [
    path.resolve(__dirname, "../../requisitosvsSAQ.xlsx"),
    path.resolve(process.cwd(), "../requisitosvsSAQ.xlsx"),
    path.resolve(process.cwd(), "requisitosvsSAQ.xlsx"),
  ];

  const workbookPath = candidates.find((candidate) => fs.existsSync(candidate));
  if (!workbookPath) {
    throw new Error(`Could not find requisitosvsSAQ.xlsx. Checked: ${candidates.join(", ")}`);
  }

  return workbookPath;
}

function normalizeText(value: unknown) {
  return String(value ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function normalizeHeader(value: unknown) {
  return normalizeText(value).replace(/\s+/g, " ").trim();
}

function isMarked(value: unknown) {
  return normalizeText(value).toLowerCase() === "x";
}

function makeRequirementTitle(description: string) {
  const firstLine = description.split("\n").find((line) => line.trim())?.trim() ?? description;
  return firstLine.length > 180 ? `${firstLine.slice(0, 177).trimEnd()}...` : firstLine;
}

function requirementNeedsEvidence(requirementCode: string) {
  const topicCode = requirementCode.split(".")[0];
  return topicCode === "10" || topicCode === "11" || topicCode === "12";
}

function parseWorkbook(workbookPath: string) {
  const workbook = XLSX.readFile(workbookPath, { cellDates: false });
  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) {
    throw new Error("requisitosvsSAQ.xlsx does not contain any worksheets.");
  }

  const worksheet = workbook.Sheets[firstSheetName];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(worksheet, { header: 1, defval: "" });
  const headerRow = rows[0] ?? [];

  for (const saqColumn of saqColumnDefinitions) {
    const header = normalizeHeader(headerRow[saqColumn.columnIndex]);
    if (header !== saqColumn.header) {
      throw new Error(`Unexpected header in column ${saqColumn.columnIndex + 1}. Expected "${saqColumn.header}", found "${header}".`);
    }
  }

  const requirementPattern = /^\s*(\d+\.\d+\.\d+(?:\.\d+)*)\b\s*([\s\S]*)$/;
  const requirements: ParsedRequirement[] = [];

  rows.slice(1).forEach((row, index) => {
    const sourceRow = index + 2;
    const rawText = normalizeText(row[7]);
    const match = rawText.match(requirementPattern);
    if (!match) {
      return;
    }

    const code = match[1];
    const description = normalizeText(match[2]);
    if (!description) {
      return;
    }

    requirements.push({
      code,
      topicCode: code.split(".")[0],
      title: makeRequirementTitle(description),
      description,
      sourceRow,
      saqCodes: saqColumnDefinitions
        .filter((saqColumn) => isMarked(row[saqColumn.columnIndex]))
        .map((saqColumn) => saqColumn.code),
    });
  });

  return requirements;
}

export async function importSaqData(
  prisma: PrismaClient | Prisma.TransactionClient,
  workbookPath = findWorkbookPath(),
): Promise<ImportSummary> {
  const parsedRequirements = parseWorkbook(workbookPath);
  if (parsedRequirements.length === 0) {
    throw new Error("No importable requirement rows were found in requisitosvsSAQ.xlsx.");
  }

  const topicIdByCode = new Map<string, string>();
  for (const [index, [code, name]] of topicDefinitions.entries()) {
    const topic = await prisma.pciTopic.upsert({
      where: { code },
      update: { name, displayOrder: index + 1 },
      create: { code, name, displayOrder: index + 1 },
    });
    topicIdByCode.set(code, topic.id);
  }

  const saqTypeIdByCode = new Map<SaqCode, string>();
  for (const saqColumn of saqColumnDefinitions) {
    const saqType = await prisma.saqType.upsert({
      where: { code: saqColumn.code },
      update: {
        name: saqColumn.name,
        templateVersion: "v4.0.1",
        sourceDocument: path.basename(workbookPath),
        supportsNotTested: saqColumn.supportsNotTested,
        isActive: true,
      },
      create: {
        code: saqColumn.code,
        name: saqColumn.name,
        templateVersion: "v4.0.1",
        sourceDocument: path.basename(workbookPath),
        supportsNotTested: saqColumn.supportsNotTested,
        isActive: true,
      },
    });
    saqTypeIdByCode.set(saqColumn.code, saqType.id);
  }

  const requirementIdByCode = new Map<string, string>();
  for (const requirement of parsedRequirements) {
    const topicId = topicIdByCode.get(requirement.topicCode);
    if (!topicId) {
      throw new Error(`Requirement ${requirement.code} references unknown topic ${requirement.topicCode}.`);
    }

    const importedRequirement = await prisma.pciRequirement.upsert({
      where: { requirementCode: requirement.code },
      update: {
        title: requirement.title,
        description: requirement.description,
        testingProcedures: null,
        topicId,
        requirementVersion: "PCI DSS v4.0.1",
        isActive: true,
      },
      create: {
        requirementCode: requirement.code,
        title: requirement.title,
        description: requirement.description,
        testingProcedures: null,
        topicId,
        requirementVersion: "PCI DSS v4.0.1",
        isActive: true,
      },
    });
    requirementIdByCode.set(requirement.code, importedRequirement.id);
  }

  const importedSaqTypeIds = [...saqTypeIdByCode.values()];
  await prisma.saqRequirementMap.deleteMany({
    where: { saqTypeId: { in: importedSaqTypeIds } },
  });

  const displayOrderBySaq = new Map(saqColumnDefinitions.map((saqColumn) => [saqColumn.code, 1]));
  const mappingRows: Prisma.SaqRequirementMapCreateManyInput[] = [];

  for (const requirement of parsedRequirements) {
    const requirementId = requirementIdByCode.get(requirement.code);
    if (!requirementId) {
      continue;
    }

    for (const saqCode of requirement.saqCodes) {
      const saqTypeId = saqTypeIdByCode.get(saqCode);
      if (!saqTypeId) {
        continue;
      }

      const displayOrder = displayOrderBySaq.get(saqCode) ?? 1;
      displayOrderBySaq.set(saqCode, displayOrder + 1);

      mappingRows.push({
        saqTypeId,
        requirementId,
        displayOrder,
        requiresEvidence: requirementNeedsEvidence(requirement.code),
        requiresCcwJustification: true,
        requiresNaJustification: true,
        allowNotTested: saqColumnDefinitions.find((saqColumn) => saqColumn.code === saqCode)?.supportsNotTested ?? false,
        isActive: true,
        mappingVersion: DEFAULT_MAPPING_VERSION,
      });
    }
  }

  if (mappingRows.length > 0) {
    await prisma.saqRequirementMap.createMany({ data: mappingRows });
  }

  const mappingsBySaq = Object.fromEntries(
    saqColumnDefinitions.map((saqColumn) => [saqColumn.code, (displayOrderBySaq.get(saqColumn.code) ?? 1) - 1]),
  );

  return {
    workbookPath,
    topics: topicDefinitions.length,
    requirements: parsedRequirements.length,
    saqTypes: saqColumnDefinitions.length,
    mappings: mappingRows.length,
    mappingsBySaq,
  };
}

async function main() {
  const prisma = new PrismaClient();
  try {
    const summary = await importSaqData(prisma);
    console.log("SAQ data import complete.");
    console.log(JSON.stringify(summary, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
