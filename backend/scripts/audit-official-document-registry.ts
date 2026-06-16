import "dotenv/config";
import { listOfficialSaqTemplateConfigs } from "../src/lib/official-saq-field-map";
import { readTemplate } from "../src/lib/doc-template-engine";
import { getSaqCaptureSectionsFromOfficialSections, getSaqSectionPlanFromOfficialSections } from "../src/lib/saq-sections";
import { parseOfficialSaqDocument } from "../src/lib/official-document-registry";

const REQUIRED_SECTION_IDS = [
  "part-1a-merchant-evaluated",
  "part-1b-assessor",
  "part-2a-payment-channels",
  "part-2b-cardholder-function",
  "part-2c-cardholder-environment",
  "part-2d-scope-facilities",
  "part-2f-service-providers",
  "part-2g-assessment-summary",
  "part-2-questionnaire",
  "section-3-validation-certification",
  "section-3a-merchant-recognition",
  "section-3b-merchant-declaration",
  "section-3c-qsa-declaration",
  "section-3d-isa-participation",
];

const ELIGIBILITY_SAQS = new Set(["A", "A_EP", "B", "B_IP", "C", "C_VT", "P2PE", "D_P2PE", "SPOC", "SPoC"]);

async function main() {
  const rows: Array<{
    code: string;
    sections: number;
    captureSections: number;
    requirements: number;
    has2g: boolean;
    has2h: boolean;
    ok: boolean;
  }> = [];

  for (const config of listOfficialSaqTemplateConfigs()) {
    const buffer = await readTemplate(config.template);
    const parsed = parseOfficialSaqDocument(buffer, config.code);
    const sectionIds = new Set(parsed.sections.map((section) => section.id));
    const missing = REQUIRED_SECTION_IDS.filter((id) => !sectionIds.has(id));
    if (ELIGIBILITY_SAQS.has(config.code) && !sectionIds.has("part-2h-saq-eligibility")) {
      missing.push("part-2h-saq-eligibility");
    }
    const plan = getSaqSectionPlanFromOfficialSections(config.code, parsed.sections);
    const capture = getSaqCaptureSectionsFromOfficialSections(config.code, parsed.sections);
    const missingFromPlan = parsed.sections
      .filter((section) => !["annex-b-ccw", "annex-c-not-applicable", "annex-d-not-tested"].includes(section.id))
      .filter((section) => !plan.some((item) => item.id === section.id))
      .map((section) => section.id);
    const missingCapture = capture.length === 0 ? ["captureSections"] : [];
    const ok =
      parsed.validationErrors.length === 0 &&
      parsed.requirements.length > 0 &&
      missing.length === 0 &&
      missingFromPlan.length === 0 &&
      missingCapture.length === 0;

    rows.push({
      code: config.code,
      sections: parsed.sections.length,
      captureSections: capture.length,
      requirements: parsed.requirements.length,
      has2g: sectionIds.has("part-2g-assessment-summary"),
      has2h: sectionIds.has("part-2h-saq-eligibility"),
      ok,
    });

    if (!ok) {
      throw new Error(
        `${config.code} official document registry audit failed. Parse errors: ${parsed.validationErrors.join(" | ") || "none"}. Missing sections: ${missing.join(", ") || "none"}. Missing plan: ${missingFromPlan.join(", ") || "none"}. Missing capture: ${missingCapture.join(", ") || "none"}.`,
      );
    }
  }

  console.table(rows);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
