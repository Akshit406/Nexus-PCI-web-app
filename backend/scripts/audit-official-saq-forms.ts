import "dotenv/config";
import { extractLegacyFields } from "../src/lib/official-saq-form-engine";
import { listOfficialSaqTemplateConfigs } from "../src/lib/official-saq-field-map";
import { readTemplate } from "../src/lib/doc-template-engine";
import PizZip from "pizzip";

async function main() {
  const rows: Array<{
    code: string;
    template: string;
    textFields: number;
    expectedTextFields: number;
    checkboxes: number;
    expectedCheckboxes: number;
    ok: boolean;
  }> = [];

  for (const config of listOfficialSaqTemplateConfigs()) {
    const template = await readTemplate(config.template);
    const zip = new PizZip(template);
    const document = zip.file("word/document.xml");
    if (!document) {
      throw new Error(`${config.template} is missing word/document.xml`);
    }

    const fields = extractLegacyFields(document.asText());
    const textFields = fields.filter((field) => field.kind === "text").length;
    const checkboxes = fields.filter((field) => field.kind === "checkbox").length;
    rows.push({
      code: config.code,
      template: config.template,
      textFields,
      expectedTextFields: config.expectedTextFields,
      checkboxes,
      expectedCheckboxes: config.expectedCheckboxes,
      ok: textFields === config.expectedTextFields && checkboxes === config.expectedCheckboxes,
    });
  }

  console.table(rows);
  const failed = rows.filter((row) => !row.ok);
  if (failed.length > 0) {
    throw new Error(`Official SAQ form audit failed for: ${failed.map((row) => row.code).join(", ")}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
