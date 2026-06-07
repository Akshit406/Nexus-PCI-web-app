// Maps a SAQ type code (from the DB) to the official PCI SSC template files
// bundled under backend/templates/. Filenames must match exactly.
//
// Codes that have no entry (or whose template file is missing) fall back to the
// pdfkit generator at render time.

export type SaqTemplateEntry = {
  // Relative to backend/templates/
  saqTemplate?: string;
  aocTemplate?: string;
  // The official .docx files ship as blank forms. They must be tagged with
  // docxtemplater placeholders before they can be filled; until then the
  // renderer falls back to the pdfkit official-structure generator so we never
  // emit a blank official form. Flip these to true per template once tagged
  // and verified.
  saqTagged?: boolean;
  aocTagged?: boolean;
};

const TEMPLATE_MAP: Record<string, SaqTemplateEntry> = {
  A_EP: { saqTemplate: "saq/PCIDSSv401SAQAEPLA.docx", aocTemplate: "aoc/PCIDSSv401AOCforSAQAEP.docx" },
  B: { saqTemplate: "saq/PCIDSSv401SAQBLA.docx", aocTemplate: "aoc/PCIDSSv401AOCforSAQB.docx" },
  B_IP: { saqTemplate: "saq/PCIDSSv401SAQBIPLA.docx", aocTemplate: "aoc/PCIDSSv401AOCforSAQBIP.docx" },
  C: { saqTemplate: "saq/PCIDSSv401SAQCLA.docx", aocTemplate: "aoc/PCIDSSv401AOCforSAQC.docx" },
  C_VT: { saqTemplate: "saq/PCIDSSv401SAQCVTLA.docx", aocTemplate: "aoc/PCIDSSv401AOCforSAQCVT.docx" },
  D_MERCHANT: { saqTemplate: "saq/PCIDSSv401SAQDMerchantLA.docx", aocTemplate: "aoc/PCIDSSv401AOCforSAQDMerchant.docx" },
  D_P2PE: { saqTemplate: "saq/PCIDSSv401SAQP2PELA.docx", aocTemplate: "aoc/PCIDSSv401AOCforSAQP2PE.docx" },
  // P2PE alias (some code paths use "P2PE" instead of "D_P2PE").
  P2PE: { saqTemplate: "saq/PCIDSSv401SAQP2PELA.docx", aocTemplate: "aoc/PCIDSSv401AOCforSAQP2PE.docx" },
  // SAQ D Service Provider template exists; the SAQ type must be added to the
  // data model before this is exercised end to end.
  D_SERVICE_PROVIDER: {
    saqTemplate: "saq/PCIDSSv401SAQDServiceProviderr2LA.docx",
    aocTemplate: "aoc/PCIDSSv401AOCforSAQDServiceProviderr1.docx",
  },
  // AOC-only template available for SAQ A.
  A: { aocTemplate: "aoc/PCIDSSv401AOCforSAQAr1.docx" },
};

export const DIPLOMA_TEMPLATE = "diploma/Diplomanexus.pptx";

export function getSaqTemplateEntry(saqTypeCode: string | null | undefined): SaqTemplateEntry {
  if (!saqTypeCode) {
    return {};
  }
  return TEMPLATE_MAP[saqTypeCode] ?? {};
}

// Only use the official .docx when it has been tagged and verified.
export function getTaggedSaqTemplate(saqTypeCode: string | null | undefined): string | undefined {
  const entry = getSaqTemplateEntry(saqTypeCode);
  return entry.saqTagged ? entry.saqTemplate : undefined;
}

export function getTaggedAocTemplate(saqTypeCode: string | null | undefined): string | undefined {
  const entry = getSaqTemplateEntry(saqTypeCode);
  return entry.aocTagged ? entry.aocTemplate : undefined;
}
