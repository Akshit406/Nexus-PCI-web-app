import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { buildSaqQuestionnaireTopics, loadSaqQuestionnaireDefinition } from "../src/lib/saq-questionnaire-definition";

const GENERATED_ONLY_SECTION_IDS = new Set(["part-2g-assessment-summary"]);
const P2PE_SECTION_FILTER_SAQS = new Set(["P2PE", "D_P2PE", "SPOC", "SPoC"]);
const P2PE_FILTERED_SECTION_IDS = new Set(["part-2a-payment-channels", "part-2e-p2pe-solution", "part-2g-assessment-summary"]);

async function main() {
  const saqTypes = await prisma.saqType.findMany({
    where: { isActive: true },
    orderBy: { code: "asc" },
    select: { id: true, code: true },
  });
  const rows: Array<Record<string, unknown>> = [];
  const failures: string[] = [];

  for (const saqType of saqTypes) {
    const definition = await loadSaqQuestionnaireDefinition(saqType.id);
    if (!definition.ok) {
      failures.push(`${saqType.code}: ${definition.message}`);
      rows.push({ code: saqType.code, ok: false, error: definition.message });
      continue;
    }

    const topics = buildSaqQuestionnaireTopics({ definition });
    const questionCount = topics.reduce((total, topic) => total + topic.requirements.length, 0);
    const hasQuestionnaireSection = definition.sectionPlan.some((section) => section.id === "part-2-questionnaire");
    const hasConditionalSection = definition.sectionPlan.some((section) => Boolean(section.condition));
    const generatedOnlyInClientPlan = definition.sectionPlan.some((section) => GENERATED_ONLY_SECTION_IDS.has(section.id))
      || definition.captureSections.some((section) => GENERATED_ONLY_SECTION_IDS.has(section.id));
    const p2peFilteredSections = P2PE_SECTION_FILTER_SAQS.has(saqType.code)
      ? definition.officialSections
          .filter((section) => P2PE_FILTERED_SECTION_IDS.has(section.id))
          .map((section) => section.id)
      : [];
    const ok =
      questionCount === definition.mappings.length &&
      questionCount > 0 &&
      hasQuestionnaireSection &&
      !generatedOnlyInClientPlan &&
      p2peFilteredSections.length === 0 &&
      definition.officialSections.length >= definition.sectionPlan.length;
    if (!ok) {
      failures.push(
        `${saqType.code}: preview definition is incomplete. generatedOnlyInClientPlan=${generatedOnlyInClientPlan}; p2peFilteredSections=${p2peFilteredSections.join(",") || "none"}.`,
      );
    }
    rows.push({
      code: saqType.code,
      sections: definition.sectionPlan.length,
      officialSections: definition.officialSections.length,
      captureSections: definition.captureSections.length,
      topics: topics.length,
      questions: questionCount,
      conditionalSections: hasConditionalSection,
      document: definition.document.fileName,
      ok,
    });
  }

  console.table(rows);
  if (failures.length) {
    throw new Error(failures.join("\n"));
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
