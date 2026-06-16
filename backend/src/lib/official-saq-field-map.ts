export type OfficialSaqTemplateConfig = {
  template: string;
  expectedTextFields: number;
  expectedCheckboxes: number;
  expectedSha256: string;
  supportsNotTested: boolean;
};

const OFFICIAL_SAQ_TEMPLATES: Record<string, OfficialSaqTemplateConfig> = {
  A: {
    template: "saq/PCIDSSv4_0_1SAQAr1LA.docx",
    expectedTextFields: 185,
    expectedCheckboxes: 194,
    expectedSha256: "94c6da247262bd0864b0c5d52d816c7b931b8223cb1a138367738b4225277fd5",
    supportsNotTested: false,
  },
  A_EP: {
    template: "saq/PCIDSSv401SAQAEPLA.docx",
    expectedTextFields: 195,
    expectedCheckboxes: 725,
    expectedSha256: "06fa43ceb84ebe89a69a7c2ba27efbef9c0c53852f081f903084e285dde10958",
    supportsNotTested: false,
  },
  B: {
    template: "saq/PCIDSSv401SAQBLA.docx",
    expectedTextFields: 187,
    expectedCheckboxes: 168,
    expectedSha256: "6a8c2f0044086bac466c03b6389dbb5bf8801115c65fe9aa6f66b119c04c0df4",
    supportsNotTested: false,
  },
  B_IP: {
    template: "saq/PCIDSSv401SAQBIPLA.docx",
    expectedTextFields: 194,
    expectedCheckboxes: 324,
    expectedSha256: "1fb0728be99e3241dccc9ef817334467228fd62ae29e225b713baee63c4c9f15",
    supportsNotTested: false,
  },
  C: {
    template: "saq/PCIDSSv401SAQCLA.docx",
    expectedTextFields: 193,
    expectedCheckboxes: 642,
    expectedSha256: "0fe90d9499ce27ca19faa0301eac262a83f1bfd76dbec0fe3fb14750c732f012",
    supportsNotTested: false,
  },
  C_VT: {
    template: "saq/PCIDSSv401SAQCVTLA.docx",
    expectedTextFields: 193,
    expectedCheckboxes: 322,
    expectedSha256: "8fcfa31346e61d5805d95fdd3721c36d648c74800e2398e9181ec11ecd5c67f7",
    supportsNotTested: false,
  },
  D_MERCHANT: {
    template: "saq/PCIDSSv401SAQDMerchantLA.docx",
    expectedTextFields: 234,
    expectedCheckboxes: 1383,
    expectedSha256: "b28f74269855bb1eed220b990ee32c4b501c3173fdb2d07c1cd65243435bbdc0",
    supportsNotTested: true,
  },
  D_SERVICE_PROVIDER: {
    template: "saq/PCIDSSv401SAQDServiceProviderr2LA.docx",
    expectedTextFields: 646,
    expectedCheckboxes: 1599,
    expectedSha256: "47819cc5962717fc0a799f8c220099eafa3036bd20f946d4724959478d0c0101",
    supportsNotTested: true,
  },
  D_P2PE: {
    template: "saq/PCIDSSv401SAQP2PELA.docx",
    expectedTextFields: 134,
    expectedCheckboxes: 131,
    expectedSha256: "ed1368dc70b243b95c259899b5c716463d29317566e48abc29d292c30f43105b",
    supportsNotTested: true,
  },
  P2PE: {
    template: "saq/PCIDSSv401SAQP2PELA.docx",
    expectedTextFields: 134,
    expectedCheckboxes: 131,
    expectedSha256: "ed1368dc70b243b95c259899b5c716463d29317566e48abc29d292c30f43105b",
    supportsNotTested: true,
  },
  SPOC: {
    template: "saq/PCIDSSv401SAQSPoCLA.docx",
    expectedTextFields: 136,
    expectedCheckboxes: 142,
    expectedSha256: "4c98d4ad9e700b6cf06cae31e3976136718f77fcc67b7e6983b67e10401e5f04",
    supportsNotTested: false,
  },
  SPoC: {
    template: "saq/PCIDSSv401SAQSPoCLA.docx",
    expectedTextFields: 136,
    expectedCheckboxes: 142,
    expectedSha256: "4c98d4ad9e700b6cf06cae31e3976136718f77fcc67b7e6983b67e10401e5f04",
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
