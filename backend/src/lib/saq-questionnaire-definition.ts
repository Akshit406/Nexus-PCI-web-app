import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import {
  getSaqCaptureSectionsFromOfficialSections,
  getSaqSectionPlanFromOfficialSections,
  OfficialSectionLike,
} from "./saq-sections";

type MappingWithRequirement = Prisma.SaqRequirementMapGetPayload<{
  include: { requirement: { include: { topic: true } } };
}>;

type RequirementAnswerView = {
  answerValue: string;
  explanation: string | null;
  resolutionDate: Date | null;
  isPreloaded: boolean;
  justification?: { justificationType: string } | null;
};

type EvidenceView = {
  id: string;
  title: string;
  fileName: string;
  fileSizeBytes: number;
  createdAt: Date;
  version: number;
};

export type SaqQuestionnaireDefinitionResult =
  | {
      ok: true;
      saqType: {
        id: string;
        code: string;
        name: string;
        templateVersion: string | null;
        supportsNotTested: boolean;
      };
      document: {
        id: string;
        fileName: string;
        sha256: string;
        appliedAt: Date | null;
      };
      mappings: MappingWithRequirement[];
      officialSections: OfficialSectionLike[];
      captureSections: ReturnType<typeof getSaqCaptureSectionsFromOfficialSections>;
      sectionPlan: ReturnType<typeof getSaqSectionPlanFromOfficialSections>;
    }
  | { ok: false; status: 404 | 409; message: string };

function parseOfficialSections(value: string): OfficialSectionLike[] | null {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export async function loadSaqQuestionnaireDefinition(saqTypeId: string): Promise<SaqQuestionnaireDefinitionResult> {
  const saqType = await prisma.saqType.findFirst({
    where: { id: saqTypeId, isActive: true },
    select: {
      id: true,
      code: true,
      name: true,
      templateVersion: true,
      supportsNotTested: true,
    },
  });
  if (!saqType) {
    return { ok: false, status: 404, message: "SAQ no encontrado o inactivo." };
  }

  const [document, mappings] = await Promise.all([
    prisma.officialDocumentVersion.findFirst({
      where: { saqTypeId, kind: "SAQ", isActive: true },
      orderBy: { appliedAt: "desc" },
      select: {
        id: true,
        fileName: true,
        sha256: true,
        appliedAt: true,
        parsedSectionsJson: true,
      },
    }),
    prisma.saqRequirementMap.findMany({
      where: { saqTypeId, isActive: true },
      include: { requirement: { include: { topic: true } } },
      orderBy: { displayOrder: "asc" },
    }),
  ]);

  if (!document) {
    return {
      ok: false,
      status: 409,
      message: `No hay un documento SAQ oficial aplicado para ${saqType.code}.`,
    };
  }
  const officialSections = parseOfficialSections(document.parsedSectionsJson);
  if (!officialSections) {
    return {
      ok: false,
      status: 409,
      message: `El manifiesto aplicado para ${saqType.code} no contiene secciones validas.`,
    };
  }
  if (mappings.length === 0) {
    return {
      ok: false,
      status: 409,
      message: `El SAQ ${saqType.code} no tiene requisitos aplicados.`,
    };
  }

  return {
    ok: true,
    saqType,
    document: {
      id: document.id,
      fileName: document.fileName,
      sha256: document.sha256,
      appliedAt: document.appliedAt,
    },
    mappings,
    officialSections,
    captureSections: getSaqCaptureSectionsFromOfficialSections(saqType.code, officialSections),
    sectionPlan: getSaqSectionPlanFromOfficialSections(saqType.code, officialSections),
  };
}

export function buildSaqQuestionnaireTopics(input: {
  definition: Extract<SaqQuestionnaireDefinitionResult, { ok: true }>;
  answersByRequirement?: Map<string, RequirementAnswerView>;
  evidenceByRequirement?: Map<string, EvidenceView[]>;
}) {
  const { definition } = input;
  return definition.mappings.reduce<
    Array<{
      topicCode: string;
      topicName: string;
      requirements: Array<Record<string, unknown>>;
    }>
  >((topics, mapping) => {
    const answer = input.answersByRequirement?.get(mapping.requirementId);
    let topic = topics.find((entry) => entry.topicCode === mapping.requirement.topic.code);
    if (!topic) {
      topic = {
        topicCode: mapping.requirement.topic.code,
        topicName: mapping.topicTitleOverride ?? mapping.requirement.topic.name,
        requirements: [],
      };
      topics.push(topic);
    }

    topic.requirements.push({
      id: mapping.requirement.id,
      code: mapping.requirement.requirementCode,
      description: mapping.descriptionOverride ?? mapping.requirement.description,
      testingProcedures: mapping.testingProceduresOverride ?? mapping.requirement.testingProcedures,
      applicabilityNotes: mapping.applicabilityNotesOverride ?? mapping.requirement.applicabilityNotes,
      answerValue: answer?.answerValue ?? null,
      explanation: answer?.explanation ?? "",
      resolutionDate: answer?.resolutionDate ?? null,
      isPreloaded: answer?.isPreloaded ?? false,
      justificationType: answer?.justification?.justificationType ?? null,
      requiresEvidence: mapping.requiresEvidence,
      allowNotTested: mapping.allowNotTested || definition.saqType.supportsNotTested,
      evidence: (input.evidenceByRequirement?.get(mapping.requirementId) ?? []).map((document) => ({
        id: document.id,
        title: document.title,
        fileName: document.fileName,
        fileSizeBytes: document.fileSizeBytes,
        createdAt: document.createdAt,
        version: document.version,
      })),
    });
    return topics;
  }, []);
}
