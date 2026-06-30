import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { buildSaqQuestionnaireTopics, loadSaqQuestionnaireDefinition } from "../src/lib/saq-questionnaire-definition";

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
    const ok =
      questionCount === definition.mappings.length &&
      questionCount > 0 &&
      hasQuestionnaireSection &&
      definition.officialSections.length >= definition.sectionPlan.length;
    if (!ok) {
      failures.push(`${saqType.code}: preview definition is incomplete.`);
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
