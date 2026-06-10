export type OfficialSaqTemplateConfig = {
  template: string;
  expectedTextFields: number;
  expectedCheckboxes: number;
  supportsNotTested: boolean;
};

const OFFICIAL_SAQ_TEMPLATES: Record<string, OfficialSaqTemplateConfig> = {
  A_EP: {
    template: "saq/PCIDSSv401SAQAEPLA.docx",
    expectedTextFields: 195,
    expectedCheckboxes: 709,
    supportsNotTested: false,
  },
  B: {
    template: "saq/PCIDSSv401SAQBLA.docx",
    expectedTextFields: 187,
    expectedCheckboxes: 162,
    supportsNotTested: false,
  },
  B_IP: {
    template: "saq/PCIDSSv401SAQBIPLA.docx",
    expectedTextFields: 194,
    expectedCheckboxes: 310,
    supportsNotTested: false,
  },
  C: {
    template: "saq/PCIDSSv401SAQCLA.docx",
    expectedTextFields: 193,
    expectedCheckboxes: 632,
    supportsNotTested: false,
  },
  C_VT: {
    template: "saq/PCIDSSv401SAQCVTLA.docx",
    expectedTextFields: 193,
    expectedCheckboxes: 308,
    supportsNotTested: false,
  },
  D_MERCHANT: {
    template: "saq/PCIDSSv401SAQDMerchantLA.docx",
    expectedTextFields: 234,
    expectedCheckboxes: 1383,
    supportsNotTested: true,
  },
  D_SERVICE_PROVIDER: {
    template: "saq/PCIDSSv401SAQDServiceProviderr2LA.docx",
    expectedTextFields: 646,
    expectedCheckboxes: 1599,
    supportsNotTested: true,
  },
  D_P2PE: {
    template: "saq/PCIDSSv401SAQP2PELA.docx",
    expectedTextFields: 134,
    expectedCheckboxes: 129,
    supportsNotTested: true,
  },
  P2PE: {
    template: "saq/PCIDSSv401SAQP2PELA.docx",
    expectedTextFields: 134,
    expectedCheckboxes: 129,
    supportsNotTested: true,
  },
  SPOC: {
    template: "saq/PCIDSSv401SAQSPoCLA.docx",
    expectedTextFields: 136,
    expectedCheckboxes: 140,
    supportsNotTested: false,
  },
  SPoC: {
    template: "saq/PCIDSSv401SAQSPoCLA.docx",
    expectedTextFields: 136,
    expectedCheckboxes: 140,
    supportsNotTested: false,
  },
};

export function getOfficialSaqTemplateConfig(
  saqTypeCode: string | null | undefined,
): OfficialSaqTemplateConfig | undefined {
  if (!saqTypeCode) {
    return undefined;
  }
  return OFFICIAL_SAQ_TEMPLATES[saqTypeCode];
}

export function listOfficialSaqTemplateConfigs() {
  return Object.entries(OFFICIAL_SAQ_TEMPLATES).map(([code, config]) => ({ code, ...config }));
}
