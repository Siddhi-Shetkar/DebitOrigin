import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { replayMandateAuthorization } from '../replayEngine.ts';
import { verifyPaymentAttempt } from '../verificationEngine.ts';
import { runRiskEvaluationBenchmark } from '../evaluationEngine.ts';
import type { ReplayEventInput, ReplayMandateInput } from '../../../shared/types.ts';

function baseMandate(overrides: Partial<ReplayMandateInput> = {}): ReplayMandateInput {
  return {
    mandateCode: 'MND-TEST-001',
    customerId: 'CUST-101',
    customerName: 'Aarav Sharma',
    merchantId: 'MRC-STREAM-01',
    merchantName: 'StreamPulse Media',
    authorizedAmount: 499,
    currentMerchantAmount: 499,
    currency: 'INR',
    billingFrequency: 'MONTHLY',
    currentMerchantFrequency: 'MONTHLY',
    billingSchedule: 'Day 5 of every month',
    billingDayOfMonth: 5,
    startDate: '2026-01-05T09:00:00.000Z',
    endDate: '2027-01-05T09:00:00.000Z',
    status: 'ACTIVE',
    originalConsentTimestamp: '2026-01-05T09:00:00.000Z',
    consentEvidenceRef: 'EVD-OTP-001',
    ...overrides,
  };
}

describe('DebitOrigin Consent Drift Replay & Verification Engine', () => {
  it('blocks unauthorized merchant-side amount increase (₹499 -> ₹799) while mandate stays ACTIVE', () => {
    const mandate = baseMandate({ currentMerchantAmount: 799 });
    const events: ReplayEventInput[] = [
      {
        eventUid: 'EVT-1',
        eventType: 'CONSENT_APPROVED',
        eventTimestamp: '2026-01-05T09:00:00.000Z',
        newValue: { amount: 499, billingFrequency: 'MONTHLY' },
        actor: 'CUSTOMER',
        customerApproved: true,
        customerApprovalRef: 'OTP-JAN5',
        evidenceRef: 'EVD-OTP-001',
        evidenceStatus: 'VERIFIED',
      },
      {
        eventUid: 'EVT-2',
        eventType: 'DEBIT_PROCESSED',
        eventTimestamp: '2026-02-05T09:00:00.000Z',
        newValue: { amount: 499 },
        actor: 'SYSTEM',
        customerApproved: true,
        evidenceRef: 'TXN-FEB5',
        evidenceStatus: 'VERIFIED',
      },
      {
        eventUid: 'EVT-3',
        eventType: 'AMOUNT_MODIFIED',
        eventTimestamp: '2026-03-02T14:30:00.000Z',
        previousValue: { amount: 499 },
        newValue: { amount: 799 },
        actor: 'MERCHANT',
        customerApproved: false,
        evidenceStatus: 'NONE',
      },
    ];

    const result = verifyPaymentAttempt(mandate, events, {
      attemptUid: 'PAY-APR5',
      attemptTimestamp: '2026-04-05T09:00:00.000Z',
      attemptedAmount: 799,
      currency: 'INR',
      attemptedMerchantId: 'MRC-STREAM-01',
      attemptedMerchantName: 'StreamPulse Media',
      attemptedFrequency: 'MONTHLY',
    });

    assert.equal(result.status, 'BLOCKED');
    assert.equal(result.expectedAuthorizedAmount, 499);
    assert.equal(result.amountDelta, 300);
    assert.equal(result.replay.merchantSideRecord.amount, 799);
    assert.equal(result.replay.reconstructedAuthorization.amount, 499);
    assert.equal(result.replay.unsupportedModifications.length, 1);
    assert.ok(result.violationCategories.includes('UNAUTHORIZED_AMOUNT_INCREASE'));
  });

  it('verifies customer-approved amount modification with valid evidence', () => {
    const mandate = baseMandate({ currentMerchantAmount: 899 });
    const events: ReplayEventInput[] = [
      {
        eventUid: 'EVT-1',
        eventType: 'CONSENT_APPROVED',
        eventTimestamp: '2026-01-05T09:00:00.000Z',
        newValue: { amount: 499, billingFrequency: 'MONTHLY' },
        actor: 'CUSTOMER',
        customerApproved: true,
        customerApprovalRef: 'OTP-JAN5',
        evidenceRef: 'EVD-OTP-001',
        evidenceStatus: 'VERIFIED',
      },
      {
        eventUid: 'EVT-2',
        eventType: 'AMOUNT_MODIFIED',
        eventTimestamp: '2026-03-02T11:00:00.000Z',
        previousValue: { amount: 499 },
        newValue: { amount: 899 },
        actor: 'CUSTOMER',
        customerApproved: true,
        customerApprovalRef: 'OTP-MAR2',
        evidenceRef: 'EVD-UPG-002',
        evidenceStatus: 'VERIFIED',
      },
    ];

    const result = verifyPaymentAttempt(mandate, events, {
      attemptUid: 'PAY-APR5',
      attemptTimestamp: '2026-04-05T09:00:00.000Z',
      attemptedAmount: 899,
      currency: 'INR',
      attemptedMerchantId: 'MRC-STREAM-01',
      attemptedMerchantName: 'StreamPulse Media',
      attemptedFrequency: 'MONTHLY',
    });

    assert.equal(result.status, 'VERIFIED');
    assert.equal(result.expectedAuthorizedAmount, 899);
    assert.equal(result.replay.approvedModifications.length, 1);
    assert.equal(result.violations.length, 0);
  });

  it('keeps historical replay invariant to later events & handles out-of-order + duplicate events', () => {
    const mandate = baseMandate({ currentMerchantAmount: 1299 });
    // Intentionally out-of-order and containing a duplicate event
    const events: ReplayEventInput[] = [
      {
        eventUid: 'EVT-LATER',
        eventType: 'AMOUNT_MODIFIED',
        eventTimestamp: '2026-05-01T10:00:00.000Z',
        previousValue: { amount: 499 },
        newValue: { amount: 1299 },
        actor: 'MERCHANT',
        customerApproved: false,
        evidenceStatus: 'NONE',
      },
      {
        eventUid: 'EVT-1-DUP',
        eventType: 'CONSENT_APPROVED',
        eventTimestamp: '2026-01-05T09:00:00.000Z',
        newValue: { amount: 499, billingFrequency: 'MONTHLY' },
        actor: 'CUSTOMER',
        customerApproved: true,
        customerApprovalRef: 'OTP-JAN5',
        evidenceRef: 'EVD-OTP-001',
        evidenceStatus: 'VERIFIED',
      },
      {
        eventUid: 'EVT-1',
        eventType: 'CONSENT_APPROVED',
        eventTimestamp: '2026-01-05T09:00:00.000Z',
        newValue: { amount: 499, billingFrequency: 'MONTHLY' },
        actor: 'CUSTOMER',
        customerApproved: true,
        customerApprovalRef: 'OTP-JAN5',
        evidenceRef: 'EVD-OTP-001',
        evidenceStatus: 'VERIFIED',
      },
    ];

    const replayFeb = replayMandateAuthorization(mandate, events, '2026-02-05T09:00:00.000Z');
    assert.equal(replayFeb.deduplicatedEventCount, 1);
    assert.equal(replayFeb.reconstructedAuthorization.amount, 499);
    assert.equal(replayFeb.unsupportedModifications.length, 0);

    const verifyFeb = verifyPaymentAttempt(mandate, events, {
      attemptTimestamp: '2026-02-05T09:00:00.000Z',
      attemptedAmount: 499,
      currency: 'INR',
      attemptedMerchantId: 'MRC-STREAM-01',
      attemptedMerchantName: 'StreamPulse Media',
      attemptedFrequency: 'MONTHLY',
    });
    assert.equal(verifyFeb.status, 'VERIFIED');
  });

  it('blocks debits after revocation, during pause, and after expiry', () => {
    const mandate = baseMandate();
    const eventsRevoked: ReplayEventInput[] = [
      {
        eventUid: 'EVT-1',
        eventType: 'CONSENT_APPROVED',
        eventTimestamp: '2026-01-05T09:00:00.000Z',
        newValue: { amount: 499, billingFrequency: 'MONTHLY' },
        actor: 'CUSTOMER',
        customerApproved: true,
        customerApprovalRef: 'OTP-1',
        evidenceRef: 'EVD-1',
        evidenceStatus: 'VERIFIED',
      },
      {
        eventUid: 'EVT-2',
        eventType: 'MANDATE_REVOKED',
        eventTimestamp: '2026-02-20T09:00:00.000Z',
        actor: 'CUSTOMER',
        customerApproved: true,
        evidenceRef: 'REV-1',
        evidenceStatus: 'VERIFIED',
      },
    ];

    const resRevoked = verifyPaymentAttempt(mandate, eventsRevoked, {
      attemptTimestamp: '2026-03-05T09:00:00.000Z',
      attemptedAmount: 499,
      currency: 'INR',
      attemptedMerchantId: 'MRC-STREAM-01',
      attemptedMerchantName: 'StreamPulse Media',
      attemptedFrequency: 'MONTHLY',
    });
    assert.equal(resRevoked.status, 'BLOCKED');
    assert.ok(resRevoked.violationCategories.includes('PAYMENT_AFTER_REVOCATION'));

    const eventsPaused: ReplayEventInput[] = [
      eventsRevoked[0],
      {
        eventUid: 'EVT-PAU',
        eventType: 'MANDATE_PAUSED',
        eventTimestamp: '2026-02-15T09:00:00.000Z',
        actor: 'CUSTOMER',
        customerApproved: true,
        evidenceRef: 'PAU-1',
        evidenceStatus: 'VERIFIED',
      },
    ];
    const resPaused = verifyPaymentAttempt(mandate, eventsPaused, {
      attemptTimestamp: '2026-03-05T09:00:00.000Z',
      attemptedAmount: 499,
      currency: 'INR',
      attemptedMerchantId: 'MRC-STREAM-01',
      attemptedMerchantName: 'StreamPulse Media',
      attemptedFrequency: 'MONTHLY',
    });
    assert.equal(resPaused.status, 'BLOCKED');
    assert.ok(resPaused.violationCategories.includes('PAYMENT_DURING_PAUSE'));

    const expiredMandate = baseMandate({ endDate: '2026-02-28T23:59:59.000Z' });
    const resExpired = verifyPaymentAttempt(expiredMandate, [eventsRevoked[0]], {
      attemptTimestamp: '2026-03-05T09:00:00.000Z',
      attemptedAmount: 499,
      currency: 'INR',
      attemptedMerchantId: 'MRC-STREAM-01',
      attemptedMerchantName: 'StreamPulse Media',
      attemptedFrequency: 'MONTHLY',
    });
    assert.equal(resExpired.status, 'BLOCKED');
    assert.ok(resExpired.violationCategories.includes('PAYMENT_AFTER_EXPIRY'));
  });

  it('distinguishes incomplete evidence (NEEDS_REVIEW) from confirmed violation', () => {
    const mandate = baseMandate({ status: 'NEEDS_REVIEW', consentEvidenceRef: null });
    const events: ReplayEventInput[] = [
      {
        eventUid: 'EVT-MISS',
        eventType: 'CONSENT_CREATED',
        eventTimestamp: '2026-01-05T09:00:00.000Z',
        newValue: { amount: 499, billingFrequency: 'MONTHLY' },
        actor: 'MERCHANT',
        customerApproved: false,
        evidenceStatus: 'MISSING',
      },
    ];

    const res = verifyPaymentAttempt(mandate, events, {
      attemptTimestamp: '2026-03-05T09:00:00.000Z',
      attemptedAmount: 499,
      currency: 'INR',
      attemptedMerchantId: 'MRC-STREAM-01',
      attemptedMerchantName: 'StreamPulse Media',
      attemptedFrequency: 'MONTHLY',
    });

    assert.equal(res.status, 'NEEDS_REVIEW');
    assert.equal(res.violations[0]?.classification, 'INCOMPLETE_EVIDENCE');
  });

  it('flags duplicate debits within the same billing cycle window', () => {
    const mandate = baseMandate();
    const events: ReplayEventInput[] = [
      {
        eventUid: 'EVT-1',
        eventType: 'CONSENT_APPROVED',
        eventTimestamp: '2026-01-05T09:00:00.000Z',
        newValue: { amount: 499, billingFrequency: 'MONTHLY' },
        actor: 'CUSTOMER',
        customerApproved: true,
        customerApprovalRef: 'OTP-1',
        evidenceRef: 'EVD-1',
        evidenceStatus: 'VERIFIED',
      },
      {
        eventUid: 'EVT-DUP-1',
        eventType: 'DEBIT_PROCESSED',
        eventTimestamp: '2026-03-05T09:00:00.000Z',
        newValue: { amount: 499 },
        actor: 'SYSTEM',
        customerApproved: true,
        evidenceRef: 'TXN-1',
        evidenceStatus: 'VERIFIED',
      },
    ];

    const res = verifyPaymentAttempt(mandate, events, {
      attemptTimestamp: '2026-03-05T15:00:00.000Z',
      attemptedAmount: 499,
      currency: 'INR',
      attemptedMerchantId: 'MRC-STREAM-01',
      attemptedMerchantName: 'StreamPulse Media',
      attemptedFrequency: 'MONTHLY',
    });

    assert.equal(res.status, 'FLAGGED');
    assert.ok(res.violationCategories.includes('DUPLICATE_DEBIT_ATTEMPT'));
  });

  it('never treats DEBIT_PROCESSED or DEBIT_ATTEMPTED (₹499) as an amount modification', () => {
    const mandate = baseMandate({ currentMerchantAmount: 499 });
    const events: ReplayEventInput[] = [
      {
        eventUid: 'EVT-1',
        eventType: 'CONSENT_APPROVED',
        eventTimestamp: '2026-01-05T09:00:00.000Z',
        newValue: { amount: 499, billingFrequency: 'MONTHLY' },
        actor: 'CUSTOMER',
        customerApproved: true,
        customerApprovalRef: 'OTP-JAN5',
        evidenceRef: 'EVD-OTP-001',
        evidenceStatus: 'VERIFIED',
      },
      {
        eventUid: 'EVT-2',
        eventType: 'DEBIT_ATTEMPTED',
        eventTimestamp: '2026-02-05T08:59:00.000Z',
        newValue: { amount: 499 },
        actor: 'SYSTEM',
        customerApproved: false,
        evidenceRef: 'ATT-FEB5',
        evidenceStatus: 'VERIFIED',
      },
      {
        eventUid: 'EVT-3',
        eventType: 'DEBIT_PROCESSED',
        eventTimestamp: '2026-02-05T09:00:00.000Z',
        previousValue: { amount: 499 },
        newValue: { amount: 499 },
        actor: 'SYSTEM',
        // Even if legacy data persisted customerApproved: true on DEBIT_PROCESSED,
        // replay must never interpret a debit event as an approved modification.
        customerApproved: true,
        customerApprovalRef: 'LEGACY-REF',
        evidenceRef: 'TXN-FEB5',
        evidenceStatus: 'VERIFIED',
      },
    ];

    const replay = replayMandateAuthorization(mandate, events, '2026-02-05T09:05:00.000Z');
    assert.equal(replay.approvedModifications.length, 0);
    assert.equal(replay.unsupportedModifications.length, 0);
    assert.equal(replay.reconstructedAuthorization.amount, 499);
    const debitEntry = replay.timeline.find((t) => t.eventUid === 'EVT-3');
    assert.equal(debitEntry?.appliedToAuthorizedTerms, false);
  });

  it('ignores no-op AMOUNT_MODIFIED events (₹499 -> ₹499) and does not record them as modifications', () => {
    const mandate = baseMandate({ currentMerchantAmount: 499 });
    const events: ReplayEventInput[] = [
      {
        eventUid: 'EVT-1',
        eventType: 'CONSENT_APPROVED',
        eventTimestamp: '2026-01-05T09:00:00.000Z',
        newValue: { amount: 499, billingFrequency: 'MONTHLY' },
        actor: 'CUSTOMER',
        customerApproved: true,
        customerApprovalRef: 'OTP-JAN5',
        evidenceRef: 'EVD-OTP-001',
        evidenceStatus: 'VERIFIED',
      },
      {
        eventUid: 'EVT-NOOP',
        eventType: 'AMOUNT_MODIFIED',
        eventTimestamp: '2026-02-15T10:00:00.000Z',
        previousValue: { amount: 499 },
        newValue: { amount: 499 },
        actor: 'CUSTOMER',
        customerApproved: true,
        customerApprovalRef: 'OTP-NOOP',
        evidenceRef: 'EVD-NOOP',
        evidenceStatus: 'VERIFIED',
      },
    ];

    const replay = replayMandateAuthorization(mandate, events, '2026-03-05T09:00:00.000Z');
    assert.equal(replay.approvedModifications.length, 0);
    assert.equal(replay.unsupportedModifications.length, 0);
    assert.equal(replay.reconstructedAuthorization.amount, 499);
  });

  it('reconstructs exact authorization at each payment attempt timestamp across unapproved and approved ₹499 -> ₹799 changes', () => {
    const mandate = baseMandate({ currentMerchantAmount: 799 });
    const events: ReplayEventInput[] = [
      {
        eventUid: 'EVT-1',
        eventType: 'CONSENT_APPROVED',
        eventTimestamp: '2026-01-05T09:00:00.000Z',
        newValue: { amount: 499, billingFrequency: 'MONTHLY' },
        actor: 'CUSTOMER',
        customerApproved: true,
        customerApprovalRef: 'OTP-JAN5',
        evidenceRef: 'EVD-OTP-001',
        evidenceStatus: 'VERIFIED',
      },
      {
        eventUid: 'EVT-2',
        eventType: 'DEBIT_PROCESSED',
        eventTimestamp: '2026-02-05T09:00:00.000Z',
        newValue: { amount: 499 },
        actor: 'SYSTEM',
        customerApproved: false,
        evidenceRef: 'TXN-FEB5',
        evidenceStatus: 'VERIFIED',
      },
      {
        eventUid: 'EVT-3',
        eventType: 'AMOUNT_MODIFIED',
        eventTimestamp: '2026-03-02T14:30:00.000Z',
        previousValue: { amount: 499 },
        newValue: { amount: 799 },
        actor: 'MERCHANT',
        customerApproved: false,
        evidenceStatus: 'NONE',
      },
      {
        eventUid: 'EVT-4',
        eventType: 'AMOUNT_MODIFIED',
        eventTimestamp: '2026-05-10T11:00:00.000Z',
        previousValue: { amount: 499 },
        newValue: { amount: 799 },
        actor: 'CUSTOMER',
        customerApproved: true,
        customerApprovalRef: 'OTP-MAY10',
        evidenceRef: 'EVD-UPG-MAY10',
        evidenceStatus: 'VERIFIED',
      },
    ];

    // 1. At Feb 5 (before any modification): ₹499 authorized, 0 modifications
    const febResult = verifyPaymentAttempt(mandate, events, {
      attemptUid: 'PAY-FEB5',
      attemptTimestamp: '2026-02-05T09:00:00.000Z',
      attemptedAmount: 499,
      currency: 'INR',
      attemptedMerchantId: 'MRC-STREAM-01',
      attemptedMerchantName: 'StreamPulse Media',
      attemptedFrequency: 'MONTHLY',
    });
    assert.equal(febResult.status, 'VERIFIED');
    assert.equal(febResult.expectedAuthorizedAmount, 499);
    assert.equal(febResult.replay.approvedModifications.length, 0);
    assert.equal(febResult.replay.unsupportedModifications.length, 0);

    // 2. At Apr 5 (after unapproved merchant change, before customer approval): still ₹499 authorized
    const aprResult = verifyPaymentAttempt(mandate, events, {
      attemptUid: 'PAY-APR5',
      attemptTimestamp: '2026-04-05T09:00:00.000Z',
      attemptedAmount: 799,
      currency: 'INR',
      attemptedMerchantId: 'MRC-STREAM-01',
      attemptedMerchantName: 'StreamPulse Media',
      attemptedFrequency: 'MONTHLY',
    });
    assert.equal(aprResult.status, 'BLOCKED');
    assert.equal(aprResult.expectedAuthorizedAmount, 499);
    assert.equal(aprResult.replay.reconstructedAuthorization.amount, 499);
    assert.equal(aprResult.replay.merchantSideRecord.amount, 799);
    assert.equal(aprResult.replay.approvedModifications.length, 0);
    assert.equal(aprResult.replay.unsupportedModifications.length, 1);

    // 3. At Jun 5 (after customer-approved ₹499 -> ₹799 modification): ₹799 authorized
    const junResult = verifyPaymentAttempt(mandate, events, {
      attemptUid: 'PAY-JUN5',
      attemptTimestamp: '2026-06-05T09:00:00.000Z',
      attemptedAmount: 799,
      currency: 'INR',
      attemptedMerchantId: 'MRC-STREAM-01',
      attemptedMerchantName: 'StreamPulse Media',
      attemptedFrequency: 'MONTHLY',
    });
    assert.equal(junResult.status, 'VERIFIED');
    assert.equal(junResult.expectedAuthorizedAmount, 799);
    assert.equal(junResult.replay.reconstructedAuthorization.amount, 799);
    assert.equal(junResult.replay.approvedModifications.length, 1);
    assert.equal(junResult.replay.approvedModifications[0].eventUid, 'EVT-4');
  });

  it('passes the customer-isolated risk evaluation benchmark with mathematically consistent case counts and zero leakage', () => {
    const report = runRiskEvaluationBenchmark();
    assert.ok(report.totalCases >= 150);
    assert.ok(report.holdoutTestCases >= 40);

    // FIX 4 invariants: total cases must equal confusion matrix sum, split sum, and scenario sum
    const cm = report.overall.confusionMatrix;
    const matrixSum = cm.truePositives + cm.falsePositives + cm.trueNegatives + cm.falseNegatives;
    const scenarioSum = report.byScenario.reduce((acc, s) => acc + s.total, 0);

    assert.equal(report.totalCases, matrixSum);
    assert.equal(report.totalCases, scenarioSum);
    assert.equal(report.totalCases, report.calibrationCases + report.holdoutTestCases);
    assert.equal(report.overall.precision, 1);
    assert.equal(report.overall.recall, 1);
    assert.equal(report.overall.f1Score, 1);
    assert.equal(report.overall.falsePositiveRate, 0);
  });
});
