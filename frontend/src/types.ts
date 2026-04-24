export type DashboardResponse = {
  client: {
    id: string;
    companyName: string;
    businessType: string;
  };
  certification: {
    id: string;
    cycleYear: number;
    status: string;
    saqType: string;
    paymentState: string;
    lastViewedTopicCode?: string | null;
    preloadedFromCertificationId?: string | null;
    issueDate?: string | null;
    validUntil?: string | null;
    isLocked: boolean;
    hasSignature: boolean;
    signaturePreviewUrl?: string | null;
  };
  stats: {
    totalRequirements: number;
    answeredCount: number;
    unansweredCount: number;
    progressPercentage: number;
    pendingEvidenceCount: number;
  };
  topics: Array<{
    topicCode: string;
    topicName: string;
    total: number;
    answered: number;
    percentage: number;
  }>;
  messages: Array<{
    id: string;
    title: string;
    message: string;
    messageType: "INFO" | "WARNING" | "SUCCESS";
  }>;
};

export type ClientDocumentItem = {
  id: string;
  title: string;
  fileName: string;
  category: string;
  sourceTemplateKey?: string | null;
  mimeType: string;
  fileSizeBytes: number;
  notes: string;
  createdAt: string;
};

export type ClientDocumentsResponse = {
  certificationId: string | null;
  items: ClientDocumentItem[];
};

export type SaqRequirement = {
  id: string;
  code: string;
  description: string;
  testingProcedures?: string | null;
  answerValue: string | null;
  explanation: string;
  resolutionDate: string | null;
  isPreloaded: boolean;
  justificationType: string | null;
  requiresEvidence: boolean;
  allowNotTested: boolean;
};

export type SaqTopic = {
  topicCode: string;
  topicName: string;
  requirements: SaqRequirement[];
};

export type SaqCaptureField = {
  key: string;
  label: string;
  inputType: "text" | "textarea";
  placeholder: string;
  value: string;
};

export type SaqCaptureSection = {
  id: string;
  title: string;
  details: string;
  completionStage: "DURING_SAQ" | "AT_COMPLETION";
  fields: SaqCaptureField[];
};

export type SaqAutoSection = {
  id: string;
  title: string;
  details: string;
  summaryRows: Array<{
    label: string;
    value: string;
  }>;
  entries: Array<{
    title: string;
    lines: string[];
  }>;
  emptyMessage: string | null;
};

export type SaqResponse = {
  certification: {
    id: string;
    saqTypeCode: string;
    saqTypeName: string;
    templateVersion?: string | null;
    supportsNotTested: boolean;
    isLocked: boolean;
    lastViewedTopicCode?: string | null;
    paymentState: string;
    hasSignature: boolean;
  };
  structuralNotes: string[];
  sectionPlan: Array<{
    id: string;
    title: string;
    scope: "FIXED_ALL_SAQS" | "VARIABLE_ALL_SAQS" | "VARIABLE_BY_SAQ" | "VARIABLE_P2PE_ONLY";
    filledBy:
      | "EXECUTIVE_SETUP"
      | "CLIENT_DURING_SAQ"
      | "CLIENT_AT_COMPLETION"
      | "SYSTEM_FROM_ANSWERS"
      | "SYSTEM_FROM_SAQ_SELECTION";
    details: string;
    condition: string | null;
    displayOrder: number;
  }>;
  captureSections: SaqCaptureSection[];
  autoSections: SaqAutoSection[];
  topics: SaqTopic[];
};
