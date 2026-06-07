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
  testingProcedures?: string | null;
  topicCode: string;
  topicName: string;
  displayOrder: number;
  requiresEvidence: boolean;
  requiresCcwJustification: boolean;
  requiresNaJustification: boolean;
  allowNotTested: boolean;
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

export type AdminPciTopic = {
  id: string;
  code: string;
  name: string;
};

export type AdminPciRequirementItem = {
  id: string;
  requirementCode: string;
  title: string;
  description: string;
  testingProcedures?: string | null;
  requirementVersion?: string | null;
  topicCode: string;
  topicName: string;
  updatedAt?: string;
};

export type AdminAvailableRequirementItem = {
  id: string;
  requirementCode: string;
  title: string;
  topicCode: string;
  topicName: string;
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
  adminContactName?: string | null;
  adminContactEmail?: string | null;
  adminContactPhone?: string | null;
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
    isLocked: boolean;
    finalizedAt: string | null;
  } | null;
};

export type AdminCertificationReopenedResponse = {
  id: string;
  status: string;
  isLocked: boolean;
  reason: string;
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

export type AdminExecutiveItem = {
  id: string;
  username: string;
  email: string;
  firstName: string;
  lastName: string;
  phone?: string | null;
  isActive: boolean;
  mustChangePassword: boolean;
  assignedClientCount: number;
  clients: Array<{
    id: string;
    companyName: string;
    status: string;
    certificationStatus?: string | null;
    paymentState: string;
    saqTypeCode?: string | null;
  }>;
};

export type AdminExecutivesResponse = {
  items: AdminExecutiveItem[];
};

export type AdminExecutiveCreatedResponse = {
  id: string;
  username: string;
  temporaryPassword: string;
};

export type AdminExecutiveUpdatedResponse = {
  id: string;
  username: string;
  isActive: boolean;
  passwordReset: boolean;
};

export type ExecutiveCertificationsResponse = {
  items: Array<{
    id: string;
    clientId: string;
    companyName: string;
    saqType: string;
    saqTypeId?: string;
    cycleYear: number;
    status: string;
    assessorIsaName?: string | null;
    assessorQsaCompany?: string | null;
    assessorQsaLeadName?: string | null;
    paymentState: string;
    paymentNotes?: string | null;
    payerBank?: string | null;
    paymentReference?: string | null;
    paymentAmount?: number | null;
    paymentCurrency?: string | null;
    paidAt?: string | null;
    generatedDocumentCount: number;
    evidenceCount: number;
    answeredCount: number;
    issuedAt?: string | null;
    validUntil?: string | null;
  }>;
};

export type ExecutiveSaqTypesResponse = {
  saqTypes: Array<{
    id: string;
    code: string;
    name: string;
    supportsNotTested: boolean;
  }>;
};

export type SaqChangeRequestsResponse = {
  items: Array<{
    id: string;
    clientId: string;
    companyName: string;
    certificationId: string;
    currentSaqType: string;
    currentSaqTypeId?: string | null;
    requestedSaqTypeId?: string | null;
    requestedSaqType?: string | null;
    reason: string;
    status: "PENDING" | "APPROVED" | "REJECTED";
    resolutionNotes?: string | null;
    createdAt: string;
    resolvedAt?: string | null;
  }>;
};

export type AdminOperationsSummary = {
  generatedAt: string;
  maintenance: {
    enabled: boolean;
    message: string;
  };
  counts: {
    activeClients: number;
    activeUsers: number;
    activeAdmins: number;
    activeExecutives: number;
    activeCertifications: number;
    readyToGenerate: number;
    generated: number;
    generatedDocuments: number;
    activeTemplates: number;
    activeSaqTypes: number;
    activeMappings: number;
    activeAssignments: number;
    notificationCount: number;
    auditLogCount: number;
  };
  certificationStatus: Record<string, number>;
  paymentStatus: Record<string, number>;
  paymentBreakdown: {
    PAID: string[];
    PENDING: string[];
    UNPAID: string[];
    OVERDUE: string[];
  };
  expirations: Array<{
    certificationId: string;
    clientId: string;
    companyName: string;
    saqTypeCode: string;
    status: string;
    paymentState: string;
    validUntil: string | null;
  }>;
  renewalsOverdue: Array<{
    certificationId: string;
    clientId: string;
    companyName: string;
    saqTypeCode: string;
    status: string;
    paymentState: string;
    validUntil: string | null;
    daysOverdue: number;
  }>;
  abandoned: Array<{
    certificationId: string;
    clientId: string;
    companyName: string;
    saqTypeCode: string;
    status: string;
    paymentState: string;
    lastActivityAt: string;
  }>;
  executivePortfolio: Array<{
    executiveUserId: string;
    name: string;
    username: string;
    email: string;
    activeClientCount: number;
    clients: string[];
  }>;
  mappingIssues: Array<{
    saqTypeCode: string;
    severity: string;
    message: string;
  }>;
  dataHealth: {
    ok: boolean;
    warnings: string[];
    roles: string[];
  };
  reminderScheduler: {
    enabled: boolean;
    intervalMinutes: number;
    running: boolean;
    lastStartedAt: string | null;
    lastFinishedAt: string | null;
    lastResult: unknown;
    lastError: string | null;
    nextRunAt: string | null;
    runInProgress: boolean;
  };
  recentAuditLogs: AdminAuditLogItem[];
  backupGuidance: {
    database: string[];
    uploads: string[];
    productionSeed: string[];
  };
};

export type AdminAuditLogItem = {
  id: string;
  actionType: string;
  warningLevel: "LOW" | "MEDIUM" | "HIGH" | string;
  targetTable?: string | null;
  targetId?: string | null;
  clientId?: string | null;
  certificationId?: string | null;
  roleCode?: string | null;
  user: {
    username: string;
    email: string;
    name: string;
  } | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  metadata?: Record<string, unknown> | null;
  createdAt: string;
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
