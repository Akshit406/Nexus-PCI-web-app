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

export type SaqResponse = {
  certification: {
    id: string;
    saqTypeCode: string;
    saqTypeName: string;
    supportsNotTested: boolean;
    isLocked: boolean;
    lastViewedTopicCode?: string | null;
    paymentState: string;
    hasSignature: boolean;
  };
  topics: SaqTopic[];
};
