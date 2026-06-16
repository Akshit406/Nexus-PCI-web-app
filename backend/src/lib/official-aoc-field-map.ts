export type OfficialAocTemplateConfig = {
  template: string;
  expectedTextFields: number;
  expectedCheckboxes: number;
  expectedSha256: string;
  supportsNotTested: boolean;
};

export type RowRange = {
  start: number;
  rows: number;
  columns: number;
};

export type AocSection3Map = {
  start: number;
  part4Requirements: string[];
};

export type OfficialAocFieldManifest = {
  excludedChannelReason?: number;
  cardFunctionRows?: RowRange;
  environmentDescription?: number;
  facilitiesRows?: RowRange;
  productsRows?: RowRange;
  p2peSolutionFields?: Partial<Record<"name" | "provider" | "version" | "reference" | "expiration" | "description", number>>;
  providersRows?: RowRange;
  serviceProviderFields?: Partial<Record<"services" | "service1" | "service2" | "service3" | "serviceOther" | "serviceExcludedReason" | "storesProcessesTransmits" | "securityInfluence" | "components", number>>;
  checkboxFields?: {
    channels?: Partial<Record<"moto" | "ecommerce" | "present", number>>;
    excludedChannel?: [number, number];
    segmentation?: [number, number];
    products?: [number, number];
    providers?: {
      storesProcessesTransmits?: [number, number];
      managesComponents?: [number, number];
      affectsSecurity?: [number, number];
    };
  };
  section3: AocSection3Map;
};

const STANDARD_CHECKBOX_FIELDS: OfficialAocFieldManifest["checkboxFields"] = {
  channels: { moto: 0, ecommerce: 1, present: 2 },
  excludedChannel: [3, 4],
  segmentation: [5, 6],
  products: [7, 8],
  providers: {
    storesProcessesTransmits: [9, 10],
    managesComponents: [11, 12],
    affectsSecurity: [13, 14],
  },
};

const TWO_CHANNEL_CHECKBOX_FIELDS: OfficialAocFieldManifest["checkboxFields"] = {
  channels: { moto: 0, present: 1 },
  excludedChannel: [2, 3],
  segmentation: [4, 5],
  providers: {
    storesProcessesTransmits: [6, 7],
    managesComponents: [8, 9],
    affectsSecurity: [10, 11],
  },
};

const SPOC_CHECKBOX_FIELDS: OfficialAocFieldManifest["checkboxFields"] = {
  channels: { present: 0 },
  excludedChannel: [1, 2],
  segmentation: [3, 4],
  providers: {
    storesProcessesTransmits: [5, 6],
    managesComponents: [7, 8],
    affectsSecurity: [9, 10],
  },
};

const OFFICIAL_AOC_TEMPLATES: Record<string, OfficialAocTemplateConfig> = {
  A: {
    template: "aoc/PCIDSSv401AOCforSAQAr1.docx",
    expectedTextFields: 147,
    expectedCheckboxes: 88,
    expectedSha256: "d51a677666ff1e94e16ec5fd6352ba3c031f81ee74ab4d509d3f32e6c6584c9c",
    supportsNotTested: false,
  },
  A_EP: {
    template: "aoc/PCIDSSv401AOCforSAQAEP.docx",
    expectedTextFields: 157,
    expectedCheckboxes: 123,
    expectedSha256: "d8e752f2dccaea68dd64c1c282bda34696de67b61a2da1df37b9f0a144b46cab",
    supportsNotTested: false,
  },
  B: {
    template: "aoc/PCIDSSv401AOCforSAQB.docx",
    expectedTextFields: 149,
    expectedCheckboxes: 62,
    expectedSha256: "933273922af1a1537b6e32c1350e2512e54f1b5b2e2116c8e49835f9df862ba5",
    supportsNotTested: false,
  },
  B_IP: {
    template: "aoc/PCIDSSv401AOCforSAQBIP.docx",
    expectedTextFields: 156,
    expectedCheckboxes: 114,
    expectedSha256: "b2bed6b59b560b084a34f539011501ba17663cc60ca4a67f7fdc19e83b4718ee",
    supportsNotTested: false,
  },
  C: {
    template: "aoc/PCIDSSv401AOCforSAQC.docx",
    expectedTextFields: 153,
    expectedCheckboxes: 120,
    expectedSha256: "5c0dfdba1130644afd46bd6e558a18e4e15097b6506229ec6d089db78b93325d",
    supportsNotTested: false,
  },
  C_VT: {
    template: "aoc/PCIDSSv401AOCforSAQCVT.docx",
    expectedTextFields: 155,
    expectedCheckboxes: 108,
    expectedSha256: "98674459b8aa1ab8f4182786eda82ed60a6242f11835166d200f18ae737689ea",
    supportsNotTested: false,
  },
  D_MERCHANT: {
    template: "aoc/PCIDSSv401AOCforSAQDMerchant.docx",
    expectedTextFields: 151,
    expectedCheckboxes: 120,
    expectedSha256: "3cf6892b9f43f70655e4f7605c03a1418b240fc13c6052207a7eb72d6d4037ca",
    supportsNotTested: true,
  },
  D_SERVICE_PROVIDER: {
    template: "aoc/PCIDSSv401AOCforSAQDServiceProviderr1.docx",
    expectedTextFields: 162,
    expectedCheckboxes: 190,
    expectedSha256: "9d03476771ce5b58c414ac9227692523abefcc44811aff27af293401be67d49e",
    supportsNotTested: true,
  },
  D_P2PE: {
    template: "aoc/PCIDSSv401AOCforSAQP2PE.docx",
    expectedTextFields: 96,
    expectedCheckboxes: 49,
    expectedSha256: "b76aef39cc9c6cd5d95bc16714f16946b3745123630aa5d99bffe48995289841",
    supportsNotTested: true,
  },
  P2PE: {
    template: "aoc/PCIDSSv401AOCforSAQP2PE.docx",
    expectedTextFields: 96,
    expectedCheckboxes: 49,
    expectedSha256: "b76aef39cc9c6cd5d95bc16714f16946b3745123630aa5d99bffe48995289841",
    supportsNotTested: true,
  },
  SPOC: {
    template: "aoc/PCIDSSv401AOCforSAQSPoC.docx",
    expectedTextFields: 98,
    expectedCheckboxes: 56,
    expectedSha256: "e8ed6f6796af5b405d361c27363a3adaae1c8c5a81b0f447cde5a6004ffb5e43",
    supportsNotTested: false,
  },
  SPoC: {
    template: "aoc/PCIDSSv401AOCforSAQSPoC.docx",
    expectedTextFields: 98,
    expectedCheckboxes: 56,
    expectedSha256: "e8ed6f6796af5b405d361c27363a3adaae1c8c5a81b0f447cde5a6004ffb5e43",
    supportsNotTested: false,
  },
};

const AOC_MANIFESTS: Record<string, OfficialAocFieldManifest> = {
  A: {
    excludedChannelReason: 16,
    cardFunctionRows: { start: 17, rows: 3, columns: 2 },
    environmentDescription: 23,
    facilitiesRows: { start: 24, rows: 8, columns: 3 },
    productsRows: { start: 48, rows: 10, columns: 5 },
    providersRows: { start: 98, rows: 10, columns: 2 },
    checkboxFields: STANDARD_CHECKBOX_FIELDS,
    section3: { start: 118, part4Requirements: ["2", "3", "6", "8", "9", "11", "12"] },
  },
  A_EP: {
    excludedChannelReason: 16,
    cardFunctionRows: { start: 17, rows: 3, columns: 2 },
    environmentDescription: 23,
    facilitiesRows: { start: 24, rows: 8, columns: 3 },
    productsRows: { start: 48, rows: 11, columns: 5 },
    providersRows: { start: 103, rows: 10, columns: 2 },
    checkboxFields: STANDARD_CHECKBOX_FIELDS,
    section3: { start: 123, part4Requirements: ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12"] },
  },
  B: {
    excludedChannelReason: 16,
    cardFunctionRows: { start: 17, rows: 3, columns: 2 },
    environmentDescription: 23,
    facilitiesRows: { start: 24, rows: 26, columns: 3 },
    providersRows: { start: 103, rows: 10, columns: 2 },
    checkboxFields: STANDARD_CHECKBOX_FIELDS,
    section3: { start: 123, part4Requirements: ["3", "7", "9", "12"] },
  },
  B_IP: {
    excludedChannelReason: 16,
    cardFunctionRows: { start: 17, rows: 3, columns: 2 },
    environmentDescription: 23,
    facilitiesRows: { start: 24, rows: 8, columns: 3 },
    productsRows: { start: 48, rows: 11, columns: 5 },
    providersRows: { start: 103, rows: 10, columns: 2 },
    checkboxFields: STANDARD_CHECKBOX_FIELDS,
    section3: { start: 123, part4Requirements: ["1", "2", "3", "4", "6", "7", "8", "9", "11", "12"] },
  },
  C: {
    excludedChannelReason: 16,
    cardFunctionRows: { start: 17, rows: 3, columns: 2 },
    environmentDescription: 23,
    facilitiesRows: { start: 24, rows: 8, columns: 3 },
    productsRows: { start: 48, rows: 10, columns: 5 },
    providersRows: { start: 98, rows: 10, columns: 2 },
    checkboxFields: STANDARD_CHECKBOX_FIELDS,
    section3: { start: 119, part4Requirements: ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12"] },
  },
  C_VT: {
    excludedChannelReason: 16,
    cardFunctionRows: { start: 17, rows: 3, columns: 2 },
    environmentDescription: 23,
    facilitiesRows: { start: 24, rows: 8, columns: 3 },
    productsRows: { start: 48, rows: 11, columns: 5 },
    providersRows: { start: 103, rows: 10, columns: 2 },
    checkboxFields: STANDARD_CHECKBOX_FIELDS,
    section3: { start: 124, part4Requirements: ["1", "2", "3", "4", "5", "6", "7", "8", "9", "12"] },
  },
  D_MERCHANT: {
    excludedChannelReason: 16,
    cardFunctionRows: { start: 17, rows: 3, columns: 2 },
    environmentDescription: 23,
    facilitiesRows: { start: 24, rows: 9, columns: 3 },
    productsRows: { start: 51, rows: 9, columns: 5 },
    providersRows: { start: 96, rows: 10, columns: 2 },
    checkboxFields: STANDARD_CHECKBOX_FIELDS,
    section3: { start: 116, part4Requirements: ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "A2"] },
  },
  D_SERVICE_PROVIDER: {
    serviceProviderFields: {
      services: 16,
      service1: 17,
      service2: 18,
      service3: 19,
      serviceOther: 20,
      serviceExcludedReason: 26,
      storesProcessesTransmits: 27,
      securityInfluence: 28,
      components: 29,
    },
    environmentDescription: 30,
    facilitiesRows: { start: 31, rows: 24, columns: 3 },
    providersRows: { start: 103, rows: 10, columns: 2 },
    section3: { start: 126, part4Requirements: ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "A1", "A2"] },
  },
  D_P2PE: {
    excludedChannelReason: 16,
    cardFunctionRows: { start: 17, rows: 2, columns: 2 },
    environmentDescription: 21,
    facilitiesRows: { start: 22, rows: 8, columns: 3 },
    p2peSolutionFields: { provider: 46, name: 47, reference: 48, description: 49, expiration: 50 },
    providersRows: { start: 51, rows: 10, columns: 2 },
    checkboxFields: TWO_CHANNEL_CHECKBOX_FIELDS,
    section3: { start: 71, part4Requirements: ["3", "9", "12"] },
  },
  P2PE: {} as OfficialAocFieldManifest,
  SPOC: {
    excludedChannelReason: 16,
    cardFunctionRows: { start: 17, rows: 2, columns: 2 },
    environmentDescription: 21,
    facilitiesRows: { start: 22, rows: 8, columns: 3 },
    p2peSolutionFields: { provider: 46, name: 47, reference: 48, description: 49, expiration: 50 },
    providersRows: { start: 52, rows: 10, columns: 2 },
    checkboxFields: SPOC_CHECKBOX_FIELDS,
    section3: { start: 72, part4Requirements: ["3", "8", "9", "12"] },
  },
  SPoC: {} as OfficialAocFieldManifest,
};

AOC_MANIFESTS.P2PE = AOC_MANIFESTS.D_P2PE;
AOC_MANIFESTS.SPoC = AOC_MANIFESTS.SPOC;

export function getOfficialAocTemplateConfig(saqTypeCode: string | null | undefined): OfficialAocTemplateConfig | undefined {
  return saqTypeCode ? OFFICIAL_AOC_TEMPLATES[saqTypeCode] : undefined;
}

export function getOfficialAocFieldManifest(saqTypeCode: string | null | undefined): OfficialAocFieldManifest | undefined {
  return saqTypeCode ? AOC_MANIFESTS[saqTypeCode] : undefined;
}

export function listOfficialAocTemplateConfigs() {
  return Object.entries(OFFICIAL_AOC_TEMPLATES).map(([code, config]) => ({ code, ...config }));
}
