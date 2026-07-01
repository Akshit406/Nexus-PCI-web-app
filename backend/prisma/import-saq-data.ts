import "dotenv/config";
import path from "node:path";
import { Prisma, PrismaClient } from "@prisma/client";
import {
  OfficialDocumentKind,
  applyOfficialSaqQuestionSnapshot,
  resolveBundledOfficialDocument,
} from "../src/lib/official-document-registry";
import { listOfficialAocTemplateConfigs } from "../src/lib/official-aoc-field-map";
import { listOfficialSaqTemplateConfigs } from "../src/lib/official-saq-field-map";

const DEFAULT_TEMPLATE_VERSION = "PCI DSS v4.0.1";

const SAQ_NAMES: Record<string, string> = {
  A: "SAQ A",
  A_EP: "SAQ A-EP",
  B: "SAQ B",
  B_IP: "SAQ B-IP",
  C: "SAQ C",
  C_VT: "SAQ C-VT",
  D_MERCHANT: "SAQ D Merchant",
  D_SERVICE_PROVIDER: "SAQ D Service Provider",
  D_P2PE: "SAQ D P2PE",
  P2PE: "SAQ P2PE",
  SPOC: "SAQ SPoC",
  SPoC: "SAQ SPoC",
};

type ImportSummary = {
  source: string;
  topics: number;
  requirements: number;
  saqTypes: number;
  mappings: number;
  officialDocuments: number;
  mappingsBySaq: Record<string, number>;
};

function validationFor(canApply: boolean, errors: string[] = [], warnings: string[] = []) {
  return JSON.stringify({
    canApply,
    errors,
    warnings,
    addedRequirements: [],
    removedRequirements: [],
    changedRequirements: [],
  });
}

async function ensureActiveBundledDocumentVersion(input: {
  prisma: PrismaClient | Prisma.TransactionClient;
  saqTypeId: string;
  kind: OfficialDocumentKind;
  fileName: string;
  bundledTemplatePath: string;
  sha256: string;
  textFieldCount: number;
  checkboxCount: number;
  parsedSectionsJson: string;
  parsedRequirementsJson: string;
  validationJson: string;
}) {
  const existingActive = await input.prisma.officialDocumentVersion.findFirst({
    where: { saqTypeId: input.saqTypeId, kind: input.kind, isActive: true },
    orderBy: { appliedAt: "desc" },
  });
  // An applied upload is an explicit admin decision and must survive restarts.
  // An unchanged bundled version is already seeded, so avoid creating duplicates.
  if (existingActive?.storagePath) {
    return { version: existingActive, created: false, updated: false };
  }
  if (existingActive?.sha256 === input.sha256) {
    const needsRefresh =
      existingActive.fileName !== input.fileName ||
      existingActive.bundledTemplatePath !== input.bundledTemplatePath ||
      existingActive.textFieldCount !== input.textFieldCount ||
      existingActive.checkboxCount !== input.checkboxCount ||
      existingActive.parsedSectionsJson !== input.parsedSectionsJson ||
      existingActive.parsedRequirementsJson !== input.parsedRequirementsJson ||
      existingActive.validationJson !== input.validationJson;

    if (!needsRefresh) {
      return { version: existingActive, created: false, updated: false };
    }

    const version = await input.prisma.officialDocumentVersion.update({
      where: { id: existingActive.id },
      data: {
        fileName: input.fileName,
        bundledTemplatePath: input.bundledTemplatePath,
        textFieldCount: input.textFieldCount,
        checkboxCount: input.checkboxCount,
        parsedSectionsJson: input.parsedSectionsJson,
        parsedRequirementsJson: input.parsedRequirementsJson,
        validationJson: input.validationJson,
        appliedAt: new Date(),
      },
    });
    return { version, created: false, updated: true };
  }
  if (existingActive) {
    await input.prisma.officialDocumentVersion.update({
      where: { id: existingActive.id },
      data: { isActive: false },
    });
  }

  const version = await input.prisma.officialDocumentVersion.create({
    data: {
      saqTypeId: input.saqTypeId,
      kind: input.kind,
      fileName: input.fileName,
      storagePath: null,
      bundledTemplatePath: input.bundledTemplatePath,
      sha256: input.sha256,
      textFieldCount: input.textFieldCount,
      checkboxCount: input.checkboxCount,
      parsedSectionsJson: input.parsedSectionsJson,
      parsedRequirementsJson: input.parsedRequirementsJson,
      validationJson: input.validationJson,
      isActive: true,
      appliedAt: new Date(),
    },
  });
  return { version, created: true, updated: false };
}

export async function importSaqData(
  prisma: PrismaClient | Prisma.TransactionClient,
): Promise<ImportSummary> {
  const mappingsBySaq: Record<string, number> = {};
  const requirementCodes = new Set<string>();
  const topicCodes = new Set<string>();
  let officialDocuments = 0;

  for (const config of listOfficialSaqTemplateConfigs()) {
    const bundled = await resolveBundledOfficialDocument("SAQ", config.code);
    if (!bundled) {
      throw new Error(`No bundled official SAQ document is configured for ${config.code}.`);
    }
    if (bundled.parsed.validationErrors.length > 0) {
      throw new Error(`${config.code} SAQ parse failed: ${bundled.parsed.validationErrors.join(" | ")}`);
    }
    if (bundled.parsed.textFieldCount !== config.expectedTextFields || bundled.parsed.checkboxCount !== config.expectedCheckboxes) {
      throw new Error(
        `${config.code} SAQ shape mismatch. Expected ${config.expectedTextFields}/${config.expectedCheckboxes}; found ${bundled.parsed.textFieldCount}/${bundled.parsed.checkboxCount}.`,
      );
    }

    const saqType = await prisma.saqType.upsert({
      where: { code: config.code },
      update: {
        name: SAQ_NAMES[config.code] ?? `SAQ ${config.code}`,
        templateVersion: DEFAULT_TEMPLATE_VERSION,
        sourceDocument: path.basename(config.template),
        supportsNotTested: config.supportsNotTested,
        isActive: true,
      },
      create: {
        code: config.code,
        name: SAQ_NAMES[config.code] ?? `SAQ ${config.code}`,
        templateVersion: DEFAULT_TEMPLATE_VERSION,
        sourceDocument: path.basename(config.template),
        supportsNotTested: config.supportsNotTested,
        isActive: true,
      },
    });

    const activeDocument = await ensureActiveBundledDocumentVersion({
      prisma,
      saqTypeId: saqType.id,
      kind: "SAQ",
      fileName: bundled.fileName,
      bundledTemplatePath: config.template,
      sha256: bundled.sha256,
      textFieldCount: bundled.parsed.textFieldCount,
      checkboxCount: bundled.parsed.checkboxCount,
      parsedSectionsJson: JSON.stringify(bundled.parsed.sections),
      parsedRequirementsJson: JSON.stringify(bundled.parsed.requirements),
      validationJson: validationFor(true, [], bundled.parsed.validationWarnings),
    });
    officialDocuments += 1;

    if (activeDocument.created || activeDocument.updated) {
      await applyOfficialSaqQuestionSnapshot({
        tx: prisma,
        saqType,
        fileName: bundled.fileName,
        sha256: bundled.sha256,
        requirements: bundled.parsed.requirements,
        resetUnlockedCertifications: false,
      });
    }

    mappingsBySaq[config.code] = bundled.parsed.requirements.length;
    for (const requirement of bundled.parsed.requirements) {
      requirementCodes.add(requirement.code);
      topicCodes.add(requirement.topicCode);
    }
  }

  for (const config of listOfficialAocTemplateConfigs()) {
    const bundled = await resolveBundledOfficialDocument("AOC", config.code);
    if (!bundled) {
      throw new Error(`No bundled official AOC document is configured for ${config.code}.`);
    }
    if (bundled.parsed.validationErrors.length > 0) {
      throw new Error(`${config.code} AOC parse failed: ${bundled.parsed.validationErrors.join(" | ")}`);
    }
    if (bundled.parsed.textFieldCount !== config.expectedTextFields || bundled.parsed.checkboxCount !== config.expectedCheckboxes) {
      throw new Error(
        `${config.code} AOC shape mismatch. Expected ${config.expectedTextFields}/${config.expectedCheckboxes}; found ${bundled.parsed.textFieldCount}/${bundled.parsed.checkboxCount}.`,
      );
    }

    const saqType = await prisma.saqType.upsert({
      where: { code: config.code },
      update: {
        name: SAQ_NAMES[config.code] ?? `SAQ ${config.code}`,
        templateVersion: DEFAULT_TEMPLATE_VERSION,
        sourceDocument: path.basename(config.template),
        supportsNotTested: config.supportsNotTested,
        isActive: true,
      },
      create: {
        code: config.code,
        name: SAQ_NAMES[config.code] ?? `SAQ ${config.code}`,
        templateVersion: DEFAULT_TEMPLATE_VERSION,
        sourceDocument: path.basename(config.template),
        supportsNotTested: config.supportsNotTested,
        isActive: true,
      },
    });

    await ensureActiveBundledDocumentVersion({
      prisma,
      saqTypeId: saqType.id,
      kind: "AOC",
      fileName: bundled.fileName,
      bundledTemplatePath: config.template,
      sha256: bundled.sha256,
      textFieldCount: bundled.parsed.textFieldCount,
      checkboxCount: bundled.parsed.checkboxCount,
      parsedSectionsJson: "[]",
      parsedRequirementsJson: "[]",
      validationJson: validationFor(true, [], bundled.parsed.validationWarnings),
    });
    officialDocuments += 1;
  }

  const activeMappings = await prisma.saqRequirementMap.findMany({
    where: { isActive: true },
    include: { requirement: true },
  });
  for (const mapping of activeMappings) {
    requirementCodes.add(mapping.requirement.requirementCode);
    topicCodes.add(mapping.requirement.requirementCode.split(".")[0] ?? "");
  }

  return {
    source: "official-docx",
    topics: Array.from(topicCodes).filter(Boolean).length,
    requirements: requirementCodes.size,
    saqTypes: listOfficialSaqTemplateConfigs().length,
    mappings: activeMappings.length,
    officialDocuments,
    mappingsBySaq,
  };
}

async function main() {
  const prisma = new PrismaClient();
  try {
    const summary = await importSaqData(prisma);
    console.log("Official SAQ/AOC DOCX import complete.");
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
