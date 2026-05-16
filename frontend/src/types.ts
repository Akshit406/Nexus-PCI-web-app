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
    requiredEvidenceCount: number;
    uploadedEvidenceCount: number;
    generatedDocumentCount: number;
  };
  generation: {
    ready: boolean;
    blockers: string[];
    blockerCounts?: Record<string, number>;
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
  requirementId?: string | null;
  topicCode?: string | null;
  generatedType?: string | null;
  generatedAt?: string | null;
  version?: number;
  isArchived?: boolean;
  parentDocumentId?: string | null;
  mimeType: string;
  fileSizeBytes: number;
  notes: string;
  createdAt: string;
};

export type ClientDocumentsResponse = {
  certificationId: string | null;
  items: ClientDocumentItem[];
};

export type DocumentTemplateItem = {
  id: string;
  key: string;
  title: string;
  description: string;
  fileName: string;
  fileType: string;
  mimeType: string;
  fileSizeBytes: number;
  isActive: boolean;
  isArchived: boolean;
  createdAt: string;
  updatedAt: string;
  downloadUrl: string;
};

export type DocumentTemplatesResponse = {
  items: DocumentTemplateItem[];
};

export type AdminSaqEvidenceRequirement = {
  id: string;
  requirementId: string;
  requirementCode: string;
  title: string;
  description: string;
  topicCode: string;
  topicName: string;
  displayOrder: number;
  requiresEvidence: boolean;
};

export type AdminSaqEvidenceType = {
  id: string;
  code: string;
  name: string;
  templateVersion?: string | null;
  mappings: AdminSaqEvidenceRequirement[];
};

export type AdminSaqEvidenceResponse = {
  items: AdminSaqEvidenceType[];
};

export type AdminClientItem = {
  id: string;
  companyName: string;
  businessType: string;
  status: string;
  dbaName?: string | null;
  website?: string | null;
  taxId?: string | null;
  postalAddress?: string | null;
  fiscalAddress?: string | null;
  primaryContactName?: string | null;
  primaryContactTitle?: string | null;
  primaryContactEmail?: string | null;
  primaryContactPhone?: string | null;
  username?: string | null;
  executiveUserId?: string | null;
  users: Array<{
    id: string;
    username: string;
    email: string;
    firstName: string;
    lastName: string;
    isPrimary: boolean;
    isActive: boolean;
    mustChangePassword: boolean;
  }>;
  currentCertification: {
    id: string;
    cycleYear: number;
    saqTypeId: string;
    status: string;
    saqTypeCode: string;
    saqTypeName: string;
    paymentState: string;
  } | null;
};

export type AdminClientManagementResponse = {
  saqTypes: Array<{
    id: string;
    code: string;
    name: string;
    templateVersion?: string | null;
  }>;
  executives: Array<{
    id: string;
    firstName: string;
    lastName: string;
    username: string;
    email: string;
  }>;
  items: AdminClientItem[];
};

export type AdminClientCreatedResponse = {
  id: string;
  companyName: string;
  username: string;
  temporaryPassword: string;
  certificationId: string;
  saqTypeCode: string;
  cycleYear: number;
};

export type AdminClientUpdatedResponse = {
  id: string;
  companyName: string;
  username: string;
  passwordReset: boolean;
  certificationId: string;
  saqTypeCode: string;
  cycleYear: number;
};

export type AdminClientUserCreatedResponse = {
  id: string;
  username: string;
  temporaryPassword: string;
  clientId: string;
  isPrimary: boolean;
};

export type AdminClientUserUpdatedResponse = {
  id: string;
  username: string;
  clientId: string;
  isPrimary: boolean;
  isActive: boolean;
  passwordReset: boolean;
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
  evidence: Array<{
    id: string;
    title: string;
    fileName: string;
    fileSizeBytes: number;
    createdAt: string;
    version: number;
  }>;
};

export type SaqTopic = {
  topicCode: string;
  topicName: string;
  requirements: SaqRequirement[];
};

export type SaqCaptureField = {
  key: string;
  label: string;
  inputType: "text" | "textarea" | "select" | "checkbox-group" | "radio-group" | "number" | "date";
  placeholder: string;
  options: Array<{
    value: string;
    label: string;
  }>;
  required: boolean;
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
  sectionPlan: Array<{
    id: string;
    title: string;
    details: string;
    condition: string | null;
    displayOrder: number;
  }>;
  captureSections: SaqCaptureSection[];
  autoSections: SaqAutoSection[];
  topics: SaqTopic[];
};
