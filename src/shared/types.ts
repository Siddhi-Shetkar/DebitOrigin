export type BillingFrequency =
  | 'DAILY'
  | 'WEEKLY'
  | 'MONTHLY'
  | 'QUARTERLY'
  | 'YEARLY'
  | 'AS_PRESENTED';

export type MandateStatus =
  | 'ACTIVE'
  | 'PAUSED'
  | 'REVOKED'
  | 'EXPIRED'
  | 'NEEDS_REVIEW'
  | 'PENDING_CONSENT';

export type MandateEventType =
  | 'CONSENT_CREATED'
  | 'CONSENT_APPROVED'
  | 'AMOUNT_MODIFIED'
  | 'FREQUENCY_MODIFIED'
  | 'MERCHANT_MODIFIED'
  | 'MANDATE_PAUSED'
  | 'MANDATE_RESUMED'
  | 'MANDATE_REVOKED'
  | 'MANDATE_EXPIRED'
  | 'PRE_DEBIT_NOTIFICATION'
  | 'DEBIT_ATTEMPTED'
  | 'DEBIT_PROCESSED'
  | 'DEBIT_REJECTED';

export type EvidenceStatus = 'VERIFIED' | 'MISSING' | 'AMBIGUOUS' | 'NONE';

export type VerificationStatus = 'VERIFIED' | 'FLAGGED' | 'BLOCKED' | 'NEEDS_REVIEW';

export type SeverityLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export type ViolationClassification = 'CONFIRMED_VIOLATION' | 'INCOMPLETE_EVIDENCE';

export type ViolationType =
  | 'UNAUTHORIZED_AMOUNT_INCREASE'
  | 'UNAUTHORIZED_AMOUNT_DECREASE'
  | 'FREQUENCY_MISMATCH'
  | 'MERCHANT_MISMATCH'
  | 'PAYMENT_AFTER_REVOCATION'
  | 'PAYMENT_AFTER_EXPIRY'
  | 'PAYMENT_DURING_PAUSE'
  | 'DUPLICATE_DEBIT_ATTEMPT'
  | 'OUTSIDE_BILLING_SCHEDULE'
  | 'MISSING_AUTHORIZATION_EVIDENCE'
  | 'UNSUPPORTED_MANDATE_MODIFICATION'
  | 'AMBIGUOUS_CONSENT';

export type InvestigationStatus = 'OPEN' | 'UNDER_REVIEW' | 'CLOSED' | 'REOPENED';

export type InvestigationDecision =
  | 'CONFIRMED_UNAUTHORIZED'
  | 'CUSTOMER_AUTHORIZED_VERIFIED'
  | 'MERCHANT_ERROR'
  | 'INSUFFICIENT_EVIDENCE'
  | 'ESCALATED';

export interface MandateSnapshotState {
  amount: number;
  currency: string;
  billingFrequency: string;
  merchantId: string;
  merchantName: string;
  billingSchedule: string;
  billingDayOfMonth: number | null;
  status: MandateStatus;
  consentEvidenceStatus: EvidenceStatus;
  consentEvidenceRef: string | null;
  effectiveTimestamp: string;
}

export interface ReplayEventInput {
  id?: number;
  eventUid: string;
  mandateId?: number;
  eventType: MandateEventType | string;
  eventTimestamp: string | Date;
  previousValue?: Record<string, unknown> | null;
  newValue?: Record<string, unknown> | null;
  actor: string;
  customerApproved: boolean;
  customerApprovalRef?: string | null;
  evidenceRef?: string | null;
  evidenceStatus: EvidenceStatus | string;
  idempotencyKey?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface ReplayMandateInput {
  id?: number;
  mandateCode: string;
  customerId: string;
  customerName: string;
  merchantId: string;
  merchantName: string;
  authorizedAmount: number;
  currentMerchantAmount: number;
  currency: string;
  billingFrequency: string;
  currentMerchantFrequency: string;
  billingSchedule: string;
  billingDayOfMonth?: number | null;
  requireApprovalForDecrease?: boolean;
  startDate: string | Date;
  endDate?: string | Date | null;
  status: string;
  originalConsentTimestamp: string | Date;
  consentEvidenceRef?: string | null;
  conditions?: string | null;
}

export interface ModificationRecord {
  eventUid: string;
  eventType: string;
  eventTimestamp: string;
  actor: string;
  field: string;
  previousValue: unknown;
  newValue: unknown;
  customerApproved: boolean;
  customerApprovalRef: string | null;
  evidenceRef: string | null;
  evidenceStatus: string;
  reason: string;
}

export interface ReplayTimelineEntry {
  eventUid: string;
  eventType: string;
  eventTimestamp: string;
  actor: string;
  previousValue: Record<string, unknown> | null;
  newValue: Record<string, unknown> | null;
  customerApproved: boolean;
  customerApprovalRef: string | null;
  evidenceRef: string | null;
  evidenceStatus: string;
  includedInReplay: boolean;
  appliedToAuthorizedTerms: boolean;
  driftFlag: 'NONE' | 'UNSUPPORTED_CHANGE' | 'MISSING_EVIDENCE' | 'AMBIGUOUS_EVIDENCE' | 'STATE_BLOCKER';
  summary: string;
}

export interface ReplayResult {
  asOfTimestamp: string;
  mandateCode: string;
  originalConsent: MandateSnapshotState;
  reconstructedAuthorization: MandateSnapshotState;
  merchantSideRecord: MandateSnapshotState;
  approvedModifications: ModificationRecord[];
  unsupportedModifications: ModificationRecord[];
  ambiguousOrMissingEvidenceEvents: ModificationRecord[];
  timeline: ReplayTimelineEntry[];
  relevantEventIds: string[];
  deduplicatedEventCount: number;
  hadConsentApproval: boolean;
  isExpiredAtTimestamp: boolean;
}

export interface PaymentAttemptInput {
  attemptUid?: string;
  attemptTimestamp: string | Date;
  attemptedAmount: number;
  currency: string;
  attemptedMerchantId: string;
  attemptedMerchantName: string;
  attemptedFrequency?: string | null;
}

export interface DetectedViolation {
  violationType: ViolationType;
  severity: SeverityLevel;
  classification: ViolationClassification;
  relevantEventIds: string[];
  expectedAuthorization: Record<string, unknown>;
  actualAttempt: Record<string, unknown>;
  explanation: string;
  evidenceRefs: string[];
}

export interface VerificationEngineOutput {
  status: VerificationStatus;
  severity: SeverityLevel;
  expectedAuthorizedAmount: number;
  attemptedAmount: number;
  amountDelta: number;
  currency: string;
  anomalyScore: number;
  violations: DetectedViolation[];
  violationCategories: ViolationType[];
  relevantEventIds: string[];
  replay: ReplayResult;
  deterministicExplanation: string;
}

export interface ExtractedConsentFields {
  customerName: string | null;
  customerId: string | null;
  merchantName: string | null;
  merchantId: string | null;
  mandateCode: string | null;
  authorizedAmount: number | null;
  currency: string | null;
  billingFrequency: BillingFrequency | null;
  billingSchedule: string | null;
  billingDayOfMonth: number | null;
  startDate: string | null;
  endDate: string | null;
  conditions: string | null;
  consentStatus: MandateStatus | null;
  originalConsentTimestamp: string | null;
  confidenceScore: number;
  missingFields: string[];
  ambiguousFields: string[];
  fieldNotes: Record<string, string>;
}

export interface UserProfile {
  id: number;
  uid: string;
  fullName: string;
  email: string;
  organization: string;
  authProvider: string;
  emailVerified: boolean;
  onboardingCompleted: boolean;
  createdAt: string;
}

export interface EvaluationScenarioMetrics {
  scenario: string;
  total: number;
  correct: number;
  accuracy: number;
  expectedFlagged: boolean;
}

export interface EvaluationReport {
  totalCases: number;
  calibrationCases: number;
  holdoutTestCases: number;
  splitStrategy: string;
  overall: {
    precision: number;
    recall: number;
    f1Score: number;
    falsePositiveRate: number;
    accuracy: number;
    confusionMatrix: {
      truePositives: number;
      falsePositives: number;
      trueNegatives: number;
      falseNegatives: number;
    };
    suspiciousExposureIdentified: number;
    totalSuspiciousExposure: number;
    exposureCaptureRate: number;
  };
  holdout: {
    precision: number;
    recall: number;
    f1Score: number;
    falsePositiveRate: number;
    accuracy: number;
    confusionMatrix: {
      truePositives: number;
      falsePositives: number;
      trueNegatives: number;
      falseNegatives: number;
    };
    suspiciousExposureIdentified: number;
  };
  byScenario: EvaluationScenarioMetrics[];
  sampleCases: Array<{
    caseId: string;
    scenario: string;
    split: 'CALIBRATION' | 'HOLDOUT';
    expectedOutcome: VerificationStatus;
    actualOutcome: VerificationStatus;
    attemptedAmount: number;
    expectedAmount: number;
    currency: string;
    matched: boolean;
    violations: string[];
  }>;
  generatedAt: string;
}
