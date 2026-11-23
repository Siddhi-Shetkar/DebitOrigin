import type {
  EvaluationReport,
  EvaluationScenarioMetrics,
  PaymentAttemptInput,
  ReplayEventInput,
  ReplayMandateInput,
  VerificationStatus,
} from '../../shared/types.ts';
import { verifyPaymentAttempt, type PriorAttemptContext } from './verificationEngine.ts';

interface SyntheticEvalCase {
  caseId: string;
  customerId: string;
  scenario: string;
  split: 'CALIBRATION' | 'HOLDOUT';
  mandate: ReplayMandateInput;
  events: ReplayEventInput[];
  attempt: PaymentAttemptInput;
  priorAttempts?: PriorAttemptContext[];
  expectedOutcome: VerificationStatus;
  isSuspiciousGroundTruth: boolean;
}

function makeDate(year: number, month: number, day: number, hour = 9): string {
  return new Date(Date.UTC(year, month - 1, day, hour, 0, 0)).toISOString();
}

const MERCHANTS = [
  { id: 'MRC-STREAM-01', name: 'StreamPulse Media Pvt Ltd' },
  { id: 'MRC-CLOUD-02', name: 'CloudLedger India Technologies' },
  { id: 'MRC-FIT-03', name: 'ApexFit Membership Co' },
  { id: 'MRC-INS-04', name: 'ShieldSure MicroInsurance' },
  { id: 'MRC-EDU-05', name: 'SkillForge Learning Labs' },
  { id: 'MRC-SAAS-06', name: 'WorkGrid Analytics' },
];

const BASE_AMOUNTS = [299, 499, 799, 999, 1499, 2499, 4999];

/**
 * Generates deterministic, realistic, customer-isolated synthetic test cases
 * across all 12 required consent-drift & legitimate recurring debit scenarios.
 * Splits strictly by customerId (70% CALIBRATION / 30% HOLDOUT) to eliminate data leakage.
 */
export function buildSyntheticEvaluationDataset(): SyntheticEvalCase[] {
  const cases: SyntheticEvalCase[] = [];

  const scenarioDefs: Array<{
    name: string;
    count: number;
    builder: (idx: number, customerId: string, mandateCode: string) => Omit<SyntheticEvalCase, 'caseId' | 'customerId' | 'scenario' | 'split'>;
  }> = [
    {
      name: 'Valid recurring debit',
      count: 42,
      builder: (i, customerId, mandateCode) => {
        const merchant = MERCHANTS[i % MERCHANTS.length];
        const amount = BASE_AMOUNTS[i % BASE_AMOUNTS.length];
        const billingDay = 5 + (i % 15);
        return {
          mandate: {
            mandateCode,
            customerId,
            customerName: `Synthetic Customer ${customerId}`,
            merchantId: merchant.id,
            merchantName: merchant.name,
            authorizedAmount: amount,
            currentMerchantAmount: amount,
            currency: 'INR',
            billingFrequency: 'MONTHLY',
            currentMerchantFrequency: 'MONTHLY',
            billingSchedule: `Day ${billingDay} of every month`,
            billingDayOfMonth: billingDay,
            startDate: makeDate(2026, 1, billingDay),
            endDate: makeDate(2027, 1, billingDay),
            status: 'ACTIVE',
            originalConsentTimestamp: makeDate(2026, 1, billingDay),
            consentEvidenceRef: `EVD-OTP-${mandateCode}`,
          },
          events: [
            {
              eventUid: `EVT-${mandateCode}-1`,
              eventType: 'CONSENT_APPROVED',
              eventTimestamp: makeDate(2026, 1, billingDay),
              newValue: { amount, billingFrequency: 'MONTHLY', merchantId: merchant.id },
              actor: 'CUSTOMER',
              customerApproved: true,
              customerApprovalRef: `OTP-${mandateCode}`,
              evidenceRef: `EVD-OTP-${mandateCode}`,
              evidenceStatus: 'VERIFIED',
            },
            {
              eventUid: `EVT-${mandateCode}-2`,
              eventType: 'DEBIT_PROCESSED',
              eventTimestamp: makeDate(2026, 2, billingDay),
              newValue: { amount },
              actor: 'SYSTEM',
              customerApproved: false,
              evidenceRef: `TXN-${mandateCode}-FEB`,
              evidenceStatus: 'VERIFIED',
            },
          ],
          attempt: {
            attemptUid: `PAY-${mandateCode}-MAR`,
            attemptTimestamp: makeDate(2026, 3, billingDay),
            attemptedAmount: amount,
            currency: 'INR',
            attemptedMerchantId: merchant.id,
            attemptedMerchantName: merchant.name,
            attemptedFrequency: 'MONTHLY',
          },
          expectedOutcome: 'VERIFIED',
          isSuspiciousGroundTruth: false,
        };
      },
    },
    {
      name: 'Approved amount modification',
      count: 14,
      builder: (i, customerId, mandateCode) => {
        const merchant = MERCHANTS[i % MERCHANTS.length];
        const origAmount = BASE_AMOUNTS[i % BASE_AMOUNTS.length];
        const newAmount = origAmount + 300;
        const billingDay = 5 + (i % 10);
        return {
          mandate: {
            mandateCode,
            customerId,
            customerName: `Synthetic Customer ${customerId}`,
            merchantId: merchant.id,
            merchantName: merchant.name,
            authorizedAmount: origAmount,
            currentMerchantAmount: newAmount,
            currency: 'INR',
            billingFrequency: 'MONTHLY',
            currentMerchantFrequency: 'MONTHLY',
            billingSchedule: `Day ${billingDay} of every month`,
            billingDayOfMonth: billingDay,
            startDate: makeDate(2026, 1, billingDay),
            endDate: makeDate(2027, 1, billingDay),
            status: 'ACTIVE',
            originalConsentTimestamp: makeDate(2026, 1, billingDay),
            consentEvidenceRef: `EVD-ORIG-${mandateCode}`,
          },
          events: [
            {
              eventUid: `EVT-${mandateCode}-1`,
              eventType: 'CONSENT_APPROVED',
              eventTimestamp: makeDate(2026, 1, billingDay),
              newValue: { amount: origAmount, billingFrequency: 'MONTHLY' },
              actor: 'CUSTOMER',
              customerApproved: true,
              customerApprovalRef: `OTP-ORIG-${mandateCode}`,
              evidenceRef: `EVD-ORIG-${mandateCode}`,
              evidenceStatus: 'VERIFIED',
            },
            {
              eventUid: `EVT-${mandateCode}-2`,
              eventType: 'AMOUNT_MODIFIED',
              eventTimestamp: makeDate(2026, 2, 18),
              previousValue: { amount: origAmount },
              newValue: { amount: newAmount },
              actor: 'CUSTOMER',
              customerApproved: true,
              customerApprovalRef: `OTP-UPG-${mandateCode}`,
              evidenceRef: `EVD-UPG-${mandateCode}`,
              evidenceStatus: 'VERIFIED',
            },
          ],
          attempt: {
            attemptUid: `PAY-${mandateCode}-MAR`,
            attemptTimestamp: makeDate(2026, 3, billingDay),
            attemptedAmount: newAmount,
            currency: 'INR',
            attemptedMerchantId: merchant.id,
            attemptedMerchantName: merchant.name,
            attemptedFrequency: 'MONTHLY',
          },
          expectedOutcome: 'VERIFIED',
          isSuspiciousGroundTruth: false,
        };
      },
    },
    {
      name: 'Historical replay after later modifications',
      count: 12,
      builder: (i, customerId, mandateCode) => {
        const merchant = MERCHANTS[i % MERCHANTS.length];
        const origAmount = 499 + (i % 4) * 100;
        const laterAmount = origAmount + 400;
        return {
          mandate: {
            mandateCode,
            customerId,
            customerName: `Synthetic Customer ${customerId}`,
            merchantId: merchant.id,
            merchantName: merchant.name,
            authorizedAmount: origAmount,
            currentMerchantAmount: laterAmount,
            currency: 'INR',
            billingFrequency: 'MONTHLY',
            currentMerchantFrequency: 'MONTHLY',
            billingSchedule: 'Day 5 of every month',
            billingDayOfMonth: 5,
            startDate: makeDate(2026, 1, 5),
            endDate: makeDate(2027, 1, 5),
            status: 'ACTIVE',
            originalConsentTimestamp: makeDate(2026, 1, 5),
            consentEvidenceRef: `EVD-HIST-${mandateCode}`,
          },
          events: [
            {
              eventUid: `EVT-${mandateCode}-1`,
              eventType: 'CONSENT_APPROVED',
              eventTimestamp: makeDate(2026, 1, 5),
              newValue: { amount: origAmount, billingFrequency: 'MONTHLY' },
              actor: 'CUSTOMER',
              customerApproved: true,
              customerApprovalRef: `OTP-${mandateCode}`,
              evidenceRef: `EVD-HIST-${mandateCode}`,
              evidenceStatus: 'VERIFIED',
            },
            // Later merchant change in March must NOT affect February historical verification
            {
              eventUid: `EVT-${mandateCode}-2`,
              eventType: 'AMOUNT_MODIFIED',
              eventTimestamp: makeDate(2026, 3, 12),
              previousValue: { amount: origAmount },
              newValue: { amount: laterAmount },
              actor: 'MERCHANT',
              customerApproved: false,
              evidenceStatus: 'NONE',
            },
          ],
          attempt: {
            attemptUid: `PAY-${mandateCode}-FEB`,
            attemptTimestamp: makeDate(2026, 2, 5),
            attemptedAmount: origAmount,
            currency: 'INR',
            attemptedMerchantId: merchant.id,
            attemptedMerchantName: merchant.name,
            attemptedFrequency: 'MONTHLY',
          },
          expectedOutcome: 'VERIFIED',
          isSuspiciousGroundTruth: false,
        };
      },
    },
    {
      name: 'Amount increase without consent',
      count: 20,
      builder: (i, customerId, mandateCode) => {
        const merchant = MERCHANTS[i % MERCHANTS.length];
        const origAmount = i === 0 ? 499 : BASE_AMOUNTS[i % BASE_AMOUNTS.length];
        const driftedAmount = i === 0 ? 799 : origAmount + 300 + (i % 5) * 100;
        return {
          mandate: {
            mandateCode,
            customerId,
            customerName: `Synthetic Customer ${customerId}`,
            merchantId: merchant.id,
            merchantName: merchant.name,
            authorizedAmount: origAmount,
            currentMerchantAmount: driftedAmount,
            currency: 'INR',
            billingFrequency: 'MONTHLY',
            currentMerchantFrequency: 'MONTHLY',
            billingSchedule: 'Day 5 of every month',
            billingDayOfMonth: 5,
            startDate: makeDate(2026, 1, 5),
            endDate: makeDate(2027, 1, 5),
            status: 'ACTIVE',
            originalConsentTimestamp: makeDate(2026, 1, 5),
            consentEvidenceRef: `EVD-BASE-${mandateCode}`,
          },
          events: [
            {
              eventUid: `EVT-${mandateCode}-1`,
              eventType: 'CONSENT_APPROVED',
              eventTimestamp: makeDate(2026, 1, 5),
              newValue: { amount: origAmount, billingFrequency: 'MONTHLY' },
              actor: 'CUSTOMER',
              customerApproved: true,
              customerApprovalRef: `OTP-${mandateCode}`,
              evidenceRef: `EVD-BASE-${mandateCode}`,
              evidenceStatus: 'VERIFIED',
            },
            {
              eventUid: `EVT-${mandateCode}-2`,
              eventType: 'DEBIT_PROCESSED',
              eventTimestamp: makeDate(2026, 2, 5),
              newValue: { amount: origAmount },
              actor: 'SYSTEM',
              customerApproved: false,
              evidenceRef: `TXN-FEB-${mandateCode}`,
              evidenceStatus: 'VERIFIED',
            },
            {
              eventUid: `EVT-${mandateCode}-3`,
              eventType: 'AMOUNT_MODIFIED',
              eventTimestamp: makeDate(2026, 3, 2),
              previousValue: { amount: origAmount },
              newValue: { amount: driftedAmount },
              actor: 'MERCHANT',
              customerApproved: false,
              evidenceStatus: 'NONE',
            },
          ],
          attempt: {
            attemptUid: `PAY-${mandateCode}-APR`,
            attemptTimestamp: makeDate(2026, 4, 5),
            attemptedAmount: driftedAmount,
            currency: 'INR',
            attemptedMerchantId: merchant.id,
            attemptedMerchantName: merchant.name,
            attemptedFrequency: 'MONTHLY',
          },
          expectedOutcome: 'BLOCKED',
          isSuspiciousGroundTruth: true,
        };
      },
    },
    {
      name: 'Frequency mismatch',
      count: 10,
      builder: (i, customerId, mandateCode) => {
        const merchant = MERCHANTS[i % MERCHANTS.length];
        const amount = BASE_AMOUNTS[i % BASE_AMOUNTS.length];
        return {
          mandate: {
            mandateCode,
            customerId,
            customerName: `Synthetic Customer ${customerId}`,
            merchantId: merchant.id,
            merchantName: merchant.name,
            authorizedAmount: amount,
            currentMerchantAmount: amount,
            currency: 'INR',
            billingFrequency: 'MONTHLY',
            currentMerchantFrequency: 'WEEKLY',
            billingSchedule: 'Day 5 of every month',
            billingDayOfMonth: 5,
            startDate: makeDate(2026, 1, 5),
            endDate: makeDate(2027, 1, 5),
            status: 'ACTIVE',
            originalConsentTimestamp: makeDate(2026, 1, 5),
            consentEvidenceRef: `EVD-FREQ-${mandateCode}`,
          },
          events: [
            {
              eventUid: `EVT-${mandateCode}-1`,
              eventType: 'CONSENT_APPROVED',
              eventTimestamp: makeDate(2026, 1, 5),
              newValue: { amount, billingFrequency: 'MONTHLY' },
              actor: 'CUSTOMER',
              customerApproved: true,
              customerApprovalRef: `OTP-${mandateCode}`,
              evidenceRef: `EVD-FREQ-${mandateCode}`,
              evidenceStatus: 'VERIFIED',
            },
            {
              eventUid: `EVT-${mandateCode}-2`,
              eventType: 'FREQUENCY_MODIFIED',
              eventTimestamp: makeDate(2026, 2, 10),
              previousValue: { billingFrequency: 'MONTHLY' },
              newValue: { billingFrequency: 'WEEKLY' },
              actor: 'MERCHANT',
              customerApproved: false,
              evidenceStatus: 'NONE',
            },
          ],
          attempt: {
            attemptUid: `PAY-${mandateCode}-MAR`,
            attemptTimestamp: makeDate(2026, 3, 5),
            attemptedAmount: amount,
            currency: 'INR',
            attemptedMerchantId: merchant.id,
            attemptedMerchantName: merchant.name,
            attemptedFrequency: 'WEEKLY',
          },
          expectedOutcome: 'BLOCKED',
          isSuspiciousGroundTruth: true,
        };
      },
    },
    {
      name: 'Merchant mismatch',
      count: 10,
      builder: (i, customerId, mandateCode) => {
        const merchant = MERCHANTS[i % MERCHANTS.length];
        const rogueMerchant = MERCHANTS[(i + 2) % MERCHANTS.length];
        const amount = BASE_AMOUNTS[i % BASE_AMOUNTS.length];
        return {
          mandate: {
            mandateCode,
            customerId,
            customerName: `Synthetic Customer ${customerId}`,
            merchantId: merchant.id,
            merchantName: merchant.name,
            authorizedAmount: amount,
            currentMerchantAmount: amount,
            currency: 'INR',
            billingFrequency: 'MONTHLY',
            currentMerchantFrequency: 'MONTHLY',
            billingSchedule: 'Day 5 of every month',
            billingDayOfMonth: 5,
            startDate: makeDate(2026, 1, 5),
            endDate: makeDate(2027, 1, 5),
            status: 'ACTIVE',
            originalConsentTimestamp: makeDate(2026, 1, 5),
            consentEvidenceRef: `EVD-MRC-${mandateCode}`,
          },
          events: [
            {
              eventUid: `EVT-${mandateCode}-1`,
              eventType: 'CONSENT_APPROVED',
              eventTimestamp: makeDate(2026, 1, 5),
              newValue: { amount, billingFrequency: 'MONTHLY', merchantId: merchant.id, merchantName: merchant.name },
              actor: 'CUSTOMER',
              customerApproved: true,
              customerApprovalRef: `OTP-${mandateCode}`,
              evidenceRef: `EVD-MRC-${mandateCode}`,
              evidenceStatus: 'VERIFIED',
            },
          ],
          attempt: {
            attemptUid: `PAY-${mandateCode}-MAR`,
            attemptTimestamp: makeDate(2026, 3, 5),
            attemptedAmount: amount,
            currency: 'INR',
            attemptedMerchantId: rogueMerchant.id,
            attemptedMerchantName: rogueMerchant.name,
            attemptedFrequency: 'MONTHLY',
          },
          expectedOutcome: 'BLOCKED',
          isSuspiciousGroundTruth: true,
        };
      },
    },
    {
      name: 'Debit after revocation',
      count: 12,
      builder: (i, customerId, mandateCode) => {
        const merchant = MERCHANTS[i % MERCHANTS.length];
        const amount = BASE_AMOUNTS[i % BASE_AMOUNTS.length];
        return {
          mandate: {
            mandateCode,
            customerId,
            customerName: `Synthetic Customer ${customerId}`,
            merchantId: merchant.id,
            merchantName: merchant.name,
            authorizedAmount: amount,
            currentMerchantAmount: amount,
            currency: 'INR',
            billingFrequency: 'MONTHLY',
            currentMerchantFrequency: 'MONTHLY',
            billingSchedule: 'Day 10 of every month',
            billingDayOfMonth: 10,
            startDate: makeDate(2026, 1, 10),
            endDate: makeDate(2027, 1, 10),
            status: 'ACTIVE',
            originalConsentTimestamp: makeDate(2026, 1, 10),
            consentEvidenceRef: `EVD-REV-${mandateCode}`,
          },
          events: [
            {
              eventUid: `EVT-${mandateCode}-1`,
              eventType: 'CONSENT_APPROVED',
              eventTimestamp: makeDate(2026, 1, 10),
              newValue: { amount, billingFrequency: 'MONTHLY' },
              actor: 'CUSTOMER',
              customerApproved: true,
              customerApprovalRef: `OTP-${mandateCode}`,
              evidenceRef: `EVD-REV-${mandateCode}`,
              evidenceStatus: 'VERIFIED',
            },
            {
              eventUid: `EVT-${mandateCode}-2`,
              eventType: 'MANDATE_REVOKED',
              eventTimestamp: makeDate(2026, 2, 20),
              previousValue: { status: 'ACTIVE' },
              newValue: { status: 'REVOKED' },
              actor: 'CUSTOMER',
              customerApproved: true,
              customerApprovalRef: `REV-${mandateCode}`,
              evidenceRef: `EVD-REV-REQ-${mandateCode}`,
              evidenceStatus: 'VERIFIED',
            },
          ],
          attempt: {
            attemptUid: `PAY-${mandateCode}-MAR`,
            attemptTimestamp: makeDate(2026, 3, 10),
            attemptedAmount: amount,
            currency: 'INR',
            attemptedMerchantId: merchant.id,
            attemptedMerchantName: merchant.name,
            attemptedFrequency: 'MONTHLY',
          },
          expectedOutcome: 'BLOCKED',
          isSuspiciousGroundTruth: true,
        };
      },
    },
    {
      name: 'Debit during pause',
      count: 10,
      builder: (i, customerId, mandateCode) => {
        const merchant = MERCHANTS[i % MERCHANTS.length];
        const amount = BASE_AMOUNTS[i % BASE_AMOUNTS.length];
        return {
          mandate: {
            mandateCode,
            customerId,
            customerName: `Synthetic Customer ${customerId}`,
            merchantId: merchant.id,
            merchantName: merchant.name,
            authorizedAmount: amount,
            currentMerchantAmount: amount,
            currency: 'INR',
            billingFrequency: 'MONTHLY',
            currentMerchantFrequency: 'MONTHLY',
            billingSchedule: 'Day 12 of every month',
            billingDayOfMonth: 12,
            startDate: makeDate(2026, 1, 12),
            endDate: makeDate(2027, 1, 12),
            status: 'PAUSED',
            originalConsentTimestamp: makeDate(2026, 1, 12),
            consentEvidenceRef: `EVD-PAU-${mandateCode}`,
          },
          events: [
            {
              eventUid: `EVT-${mandateCode}-1`,
              eventType: 'CONSENT_APPROVED',
              eventTimestamp: makeDate(2026, 1, 12),
              newValue: { amount, billingFrequency: 'MONTHLY' },
              actor: 'CUSTOMER',
              customerApproved: true,
              customerApprovalRef: `OTP-${mandateCode}`,
              evidenceRef: `EVD-PAU-${mandateCode}`,
              evidenceStatus: 'VERIFIED',
            },
            {
              eventUid: `EVT-${mandateCode}-2`,
              eventType: 'MANDATE_PAUSED',
              eventTimestamp: makeDate(2026, 2, 15),
              previousValue: { status: 'ACTIVE' },
              newValue: { status: 'PAUSED' },
              actor: 'CUSTOMER',
              customerApproved: true,
              evidenceRef: `PAU-${mandateCode}`,
              evidenceStatus: 'VERIFIED',
            },
          ],
          attempt: {
            attemptUid: `PAY-${mandateCode}-MAR`,
            attemptTimestamp: makeDate(2026, 3, 12),
            attemptedAmount: amount,
            currency: 'INR',
            attemptedMerchantId: merchant.id,
            attemptedMerchantName: merchant.name,
            attemptedFrequency: 'MONTHLY',
          },
          expectedOutcome: 'BLOCKED',
          isSuspiciousGroundTruth: true,
        };
      },
    },
    {
      name: 'Debit after expiry',
      count: 10,
      builder: (i, customerId, mandateCode) => {
        const merchant = MERCHANTS[i % MERCHANTS.length];
        const amount = BASE_AMOUNTS[i % BASE_AMOUNTS.length];
        return {
          mandate: {
            mandateCode,
            customerId,
            customerName: `Synthetic Customer ${customerId}`,
            merchantId: merchant.id,
            merchantName: merchant.name,
            authorizedAmount: amount,
            currentMerchantAmount: amount,
            currency: 'INR',
            billingFrequency: 'MONTHLY',
            currentMerchantFrequency: 'MONTHLY',
            billingSchedule: 'Day 5 of every month',
            billingDayOfMonth: 5,
            startDate: makeDate(2025, 3, 5),
            endDate: makeDate(2026, 3, 1),
            status: 'ACTIVE',
            originalConsentTimestamp: makeDate(2025, 3, 5),
            consentEvidenceRef: `EVD-EXP-${mandateCode}`,
          },
          events: [
            {
              eventUid: `EVT-${mandateCode}-1`,
              eventType: 'CONSENT_APPROVED',
              eventTimestamp: makeDate(2025, 3, 5),
              newValue: { amount, billingFrequency: 'MONTHLY' },
              actor: 'CUSTOMER',
              customerApproved: true,
              customerApprovalRef: `OTP-${mandateCode}`,
              evidenceRef: `EVD-EXP-${mandateCode}`,
              evidenceStatus: 'VERIFIED',
            },
          ],
          attempt: {
            attemptUid: `PAY-${mandateCode}-MAR`,
            attemptTimestamp: makeDate(2026, 3, 5),
            attemptedAmount: amount,
            currency: 'INR',
            attemptedMerchantId: merchant.id,
            attemptedMerchantName: merchant.name,
            attemptedFrequency: 'MONTHLY',
          },
          expectedOutcome: 'BLOCKED',
          isSuspiciousGroundTruth: true,
        };
      },
    },
    {
      name: 'Duplicate debit',
      count: 10,
      builder: (i, customerId, mandateCode) => {
        const merchant = MERCHANTS[i % MERCHANTS.length];
        const amount = BASE_AMOUNTS[i % BASE_AMOUNTS.length];
        return {
          mandate: {
            mandateCode,
            customerId,
            customerName: `Synthetic Customer ${customerId}`,
            merchantId: merchant.id,
            merchantName: merchant.name,
            authorizedAmount: amount,
            currentMerchantAmount: amount,
            currency: 'INR',
            billingFrequency: 'MONTHLY',
            currentMerchantFrequency: 'MONTHLY',
            billingSchedule: 'Day 5 of every month',
            billingDayOfMonth: 5,
            startDate: makeDate(2026, 1, 5),
            endDate: makeDate(2027, 1, 5),
            status: 'ACTIVE',
            originalConsentTimestamp: makeDate(2026, 1, 5),
            consentEvidenceRef: `EVD-DUP-${mandateCode}`,
          },
          events: [
            {
              eventUid: `EVT-${mandateCode}-1`,
              eventType: 'CONSENT_APPROVED',
              eventTimestamp: makeDate(2026, 1, 5),
              newValue: { amount, billingFrequency: 'MONTHLY' },
              actor: 'CUSTOMER',
              customerApproved: true,
              customerApprovalRef: `OTP-${mandateCode}`,
              evidenceRef: `EVD-DUP-${mandateCode}`,
              evidenceStatus: 'VERIFIED',
            },
            {
              eventUid: `EVT-${mandateCode}-2`,
              eventType: 'DEBIT_PROCESSED',
              eventTimestamp: makeDate(2026, 3, 5, 9),
              newValue: { amount },
              actor: 'SYSTEM',
              customerApproved: false,
              evidenceRef: `TXN-DUP-${mandateCode}`,
              evidenceStatus: 'VERIFIED',
            },
          ],
          attempt: {
            attemptUid: `PAY-${mandateCode}-DUP`,
            attemptTimestamp: makeDate(2026, 3, 5, 14),
            attemptedAmount: amount,
            currency: 'INR',
            attemptedMerchantId: merchant.id,
            attemptedMerchantName: merchant.name,
            attemptedFrequency: 'MONTHLY',
          },
          expectedOutcome: 'FLAGGED',
          isSuspiciousGroundTruth: true,
        };
      },
    },
    {
      name: 'Missing consent evidence',
      count: 10,
      builder: (i, customerId, mandateCode) => {
        const merchant = MERCHANTS[i % MERCHANTS.length];
        const amount = BASE_AMOUNTS[i % BASE_AMOUNTS.length];
        return {
          mandate: {
            mandateCode,
            customerId,
            customerName: `Synthetic Customer ${customerId}`,
            merchantId: merchant.id,
            merchantName: merchant.name,
            authorizedAmount: amount,
            currentMerchantAmount: amount,
            currency: 'INR',
            billingFrequency: 'MONTHLY',
            currentMerchantFrequency: 'MONTHLY',
            billingSchedule: 'Day 5 of every month',
            billingDayOfMonth: 5,
            startDate: makeDate(2026, 1, 5),
            endDate: makeDate(2027, 1, 5),
            status: 'NEEDS_REVIEW',
            originalConsentTimestamp: makeDate(2026, 1, 5),
            consentEvidenceRef: null,
          },
          events: [
            {
              eventUid: `EVT-${mandateCode}-1`,
              eventType: 'CONSENT_CREATED',
              eventTimestamp: makeDate(2026, 1, 5),
              newValue: { amount, billingFrequency: 'MONTHLY' },
              actor: 'MERCHANT',
              customerApproved: false,
              evidenceRef: null,
              evidenceStatus: 'MISSING',
            },
          ],
          attempt: {
            attemptUid: `PAY-${mandateCode}-MAR`,
            attemptTimestamp: makeDate(2026, 3, 5),
            attemptedAmount: amount,
            currency: 'INR',
            attemptedMerchantId: merchant.id,
            attemptedMerchantName: merchant.name,
            attemptedFrequency: 'MONTHLY',
          },
          expectedOutcome: 'NEEDS_REVIEW',
          isSuspiciousGroundTruth: true,
        };
      },
    },
    {
      name: 'Ambiguous consent',
      count: 10,
      builder: (i, customerId, mandateCode) => {
        const merchant = MERCHANTS[i % MERCHANTS.length];
        const amount = BASE_AMOUNTS[i % BASE_AMOUNTS.length];
        return {
          mandate: {
            mandateCode,
            customerId,
            customerName: `Synthetic Customer ${customerId}`,
            merchantId: merchant.id,
            merchantName: merchant.name,
            authorizedAmount: amount,
            currentMerchantAmount: amount,
            currency: 'INR',
            billingFrequency: 'MONTHLY',
            currentMerchantFrequency: 'MONTHLY',
            billingSchedule: 'Day 5 of every month',
            billingDayOfMonth: 5,
            startDate: makeDate(2026, 1, 5),
            endDate: makeDate(2027, 1, 5),
            status: 'NEEDS_REVIEW',
            originalConsentTimestamp: makeDate(2026, 1, 5),
            consentEvidenceRef: `SCAN-UNCLEAR-${mandateCode}`,
          },
          events: [
            {
              eventUid: `EVT-${mandateCode}-1`,
              eventType: 'CONSENT_APPROVED',
              eventTimestamp: makeDate(2026, 1, 5),
              newValue: { amount, billingFrequency: 'MONTHLY' },
              actor: 'CUSTOMER',
              customerApproved: true,
              evidenceRef: `SCAN-UNCLEAR-${mandateCode}`,
              evidenceStatus: 'AMBIGUOUS',
            },
          ],
          attempt: {
            attemptUid: `PAY-${mandateCode}-MAR`,
            attemptTimestamp: makeDate(2026, 3, 5),
            attemptedAmount: amount,
            currency: 'INR',
            attemptedMerchantId: merchant.id,
            attemptedMerchantName: merchant.name,
            attemptedFrequency: 'MONTHLY',
          },
          expectedOutcome: 'NEEDS_REVIEW',
          isSuspiciousGroundTruth: true,
        };
      },
    },
  ];

  let seq = 1;
  for (const def of scenarioDefs) {
    for (let i = 0; i < def.count; i++) {
      const customerId = `SYN-CUST-${String(seq).padStart(4, '0')}`;
      const mandateCode = `SYN-MND-${String(seq).padStart(4, '0')}`;
      // Deterministic customer-level split: ~30% holdout (every 10th customer with mod 10 >= 7)
      const split: 'CALIBRATION' | 'HOLDOUT' = seq % 10 >= 7 ? 'HOLDOUT' : 'CALIBRATION';
      const built = def.builder(i, customerId, mandateCode);
      cases.push({
        caseId: `EVAL-${String(seq).padStart(3, '0')}`,
        customerId,
        scenario: def.name,
        split,
        ...built,
      });
      seq += 1;
    }
  }

  return cases;
}

function computeBinaryMetrics(
  records: Array<{
    isSuspiciousGroundTruth: boolean;
    predictedSuspicious: boolean;
    attemptedAmount: number;
  }>
) {
  let tp = 0;
  let fp = 0;
  let tn = 0;
  let fn = 0;
  let suspiciousExposureIdentified = 0;
  let totalSuspiciousExposure = 0;

  for (const r of records) {
    if (r.isSuspiciousGroundTruth) {
      totalSuspiciousExposure += r.attemptedAmount;
      if (r.predictedSuspicious) {
        tp += 1;
        suspiciousExposureIdentified += r.attemptedAmount;
      } else {
        fn += 1;
      }
    } else {
      if (r.predictedSuspicious) {
        fp += 1;
      } else {
        tn += 1;
      }
    }
  }

  const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
  const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
  const f1Score = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
  const falsePositiveRate = fp + tn > 0 ? fp / (fp + tn) : 0;
  const accuracy = records.length > 0 ? (tp + tn) / records.length : 0;
  const exposureCaptureRate =
    totalSuspiciousExposure > 0 ? suspiciousExposureIdentified / totalSuspiciousExposure : 0;

  return {
    precision: Number(precision.toFixed(4)),
    recall: Number(recall.toFixed(4)),
    f1Score: Number(f1Score.toFixed(4)),
    falsePositiveRate: Number(falsePositiveRate.toFixed(4)),
    accuracy: Number(accuracy.toFixed(4)),
    confusionMatrix: {
      truePositives: tp,
      falsePositives: fp,
      trueNegatives: tn,
      falseNegatives: fn,
    },
    suspiciousExposureIdentified: Number(suspiciousExposureIdentified.toFixed(2)),
    totalSuspiciousExposure: Number(totalSuspiciousExposure.toFixed(2)),
    exposureCaptureRate: Number(exposureCaptureRate.toFixed(4)),
  };
}

/**
 * Executes the real deterministic verification engine across all synthetic evaluation cases
 * and computes real precision, recall, F1, FPR, confusion matrix, and exposure metrics dynamically.
 */
export function runRiskEvaluationBenchmark(): EvaluationReport {
  const dataset = buildSyntheticEvaluationDataset();

  const evaluated = dataset.map((item) => {
    const result = verifyPaymentAttempt(
      item.mandate,
      item.events,
      item.attempt,
      item.priorAttempts ?? []
    );
    const predictedSuspicious = result.status !== 'VERIFIED';
    const exactMatch = result.status === item.expectedOutcome;
    return {
      item,
      result,
      predictedSuspicious,
      exactMatch,
    };
  });

  const overall = computeBinaryMetrics(
    evaluated.map((e) => ({
      isSuspiciousGroundTruth: e.item.isSuspiciousGroundTruth,
      predictedSuspicious: e.predictedSuspicious,
      attemptedAmount: e.item.attempt.attemptedAmount,
    }))
  );

  const holdoutItems = evaluated.filter((e) => e.item.split === 'HOLDOUT');
  const holdout = computeBinaryMetrics(
    holdoutItems.map((e) => ({
      isSuspiciousGroundTruth: e.item.isSuspiciousGroundTruth,
      predictedSuspicious: e.predictedSuspicious,
      attemptedAmount: e.item.attempt.attemptedAmount,
    }))
  );

  const scenarioMap = new Map<string, { total: number; correct: number; expectedFlagged: boolean }>();
  for (const e of evaluated) {
    const entry = scenarioMap.get(e.item.scenario) ?? {
      total: 0,
      correct: 0,
      expectedFlagged: e.item.isSuspiciousGroundTruth,
    };
    entry.total += 1;
    if (e.exactMatch) entry.correct += 1;
    scenarioMap.set(e.item.scenario, entry);
  }

  const byScenario: EvaluationScenarioMetrics[] = Array.from(scenarioMap.entries()).map(
    ([scenario, stats]) => ({
      scenario,
      total: stats.total,
      correct: stats.correct,
      accuracy: Number((stats.correct / stats.total).toFixed(4)),
      expectedFlagged: stats.expectedFlagged,
    })
  );

  // Representative sample across scenarios
  const seenScenarios = new Set<string>();
  const sampleCases: EvaluationReport['sampleCases'] = [];
  for (const e of evaluated) {
    if (!seenScenarios.has(e.item.scenario) || sampleCases.length < 18) {
      seenScenarios.add(e.item.scenario);
      sampleCases.push({
        caseId: e.item.caseId,
        scenario: e.item.scenario,
        split: e.item.split,
        expectedOutcome: e.item.expectedOutcome,
        actualOutcome: e.result.status,
        attemptedAmount: e.item.attempt.attemptedAmount,
        expectedAmount: e.result.expectedAuthorizedAmount,
        currency: e.item.attempt.currency,
        matched: e.exactMatch,
        violations: e.result.violationCategories,
      });
    }
    if (sampleCases.length >= 24) break;
  }

  return {
    totalCases: evaluated.length,
    calibrationCases: evaluated.length - holdoutItems.length,
    holdoutTestCases: holdoutItems.length,
    splitStrategy: 'Customer-ID isolated deterministic split (70% calibration / 30% holdout, zero shared customer or mandate histories)',
    overall,
    holdout: {
      precision: holdout.precision,
      recall: holdout.recall,
      f1Score: holdout.f1Score,
      falsePositiveRate: holdout.falsePositiveRate,
      accuracy: holdout.accuracy,
      confusionMatrix: holdout.confusionMatrix,
      suspiciousExposureIdentified: holdout.suspiciousExposureIdentified,
    },
    byScenario,
    sampleCases,
    generatedAt: new Date().toISOString(),
  };
}
