import type {
  DetectedViolation,
  PaymentAttemptInput,
  ReplayEventInput,
  ReplayMandateInput,
  ReplayResult,
  SeverityLevel,
  VerificationEngineOutput,
  VerificationStatus,
  ViolationType,
} from '../../shared/types.ts';
import { replayMandateAuthorization } from './replayEngine.ts';

const SEVERITY_RANK: Record<SeverityLevel, number> = {
  LOW: 1,
  MEDIUM: 2,
  HIGH: 3,
  CRITICAL: 4,
};

function maxSeverity(a: SeverityLevel, b: SeverityLevel): SeverityLevel {
  return SEVERITY_RANK[a] >= SEVERITY_RANK[b] ? a : b;
}

function toMs(d: string | Date): number {
  return (d instanceof Date ? d : new Date(d)).getTime();
}

function formatMoney(currency: string, amount: number): string {
  const symbol = currency === 'INR' ? '₹' : currency === 'USD' ? '$' : `${currency} `;
  return `${symbol}${Number(amount).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}

function isWithinDuplicateWindow(
  prevMs: number,
  currentMs: number,
  frequency: string
): boolean {
  const diffHours = (currentMs - prevMs) / (1000 * 60 * 60);
  if (diffHours < 0) return false;
  switch (frequency.toUpperCase()) {
    case 'DAILY':
      return diffHours < 18;
    case 'WEEKLY':
      return diffHours < 72;
    case 'MONTHLY':
    case 'QUARTERLY':
    case 'YEARLY':
      return diffHours <= 48;
    default:
      return diffHours <= 24;
  }
}

export interface PriorAttemptContext {
  attemptUid: string;
  attemptTimestamp: string | Date;
  attemptedAmount: number;
  currency: string;
  status?: string;
}

/**
 * Deterministic Payment Verification & Consent Drift Detection Engine.
 * Primary decision is strictly rule-based and reproducible from event history.
 * Includes a secondary statistical anomaly score (0-100) for analyst prioritization only.
 */
export function verifyPaymentAttempt(
  mandate: ReplayMandateInput,
  events: ReplayEventInput[],
  attempt: PaymentAttemptInput,
  priorAttempts: PriorAttemptContext[] = []
): VerificationEngineOutput {
  const replay = replayMandateAuthorization(mandate, events, attempt.attemptTimestamp);
  const auth = replay.reconstructedAuthorization;
  const violations: DetectedViolation[] = [];

  const attemptMs = toMs(attempt.attemptTimestamp);
  const attemptIso = new Date(attemptMs).toISOString();
  const amountDelta = Number((attempt.attemptedAmount - auth.amount).toFixed(2));

  const actualAttemptSummary = {
    attemptUid: attempt.attemptUid ?? 'PENDING',
    amount: attempt.attemptedAmount,
    currency: attempt.currency,
    merchantId: attempt.attemptedMerchantId,
    merchantName: attempt.attemptedMerchantName,
    frequency: attempt.attemptedFrequency ?? null,
    timestamp: attemptIso,
  };

  const expectedAuthSummary = {
    amount: auth.amount,
    currency: auth.currency,
    merchantId: auth.merchantId,
    merchantName: auth.merchantName,
    billingFrequency: auth.billingFrequency,
    billingSchedule: auth.billingSchedule,
    status: auth.status,
    consentEvidenceStatus: auth.consentEvidenceStatus,
  };

  // Rule 1: Payment after mandate revocation
  if (auth.status === 'REVOKED') {
    const revEvents = replay.timeline
      .filter((e) => e.includedInReplay && e.eventType === 'MANDATE_REVOKED')
      .map((e) => e.eventUid);
    const revRefs = replay.timeline
      .filter((e) => e.includedInReplay && e.eventType === 'MANDATE_REVOKED' && e.evidenceRef)
      .map((e) => e.evidenceRef as string);
    violations.push({
      violationType: 'PAYMENT_AFTER_REVOCATION',
      severity: 'CRITICAL',
      classification: 'CONFIRMED_VIOLATION',
      relevantEventIds: revEvents,
      expectedAuthorization: expectedAuthSummary,
      actualAttempt: actualAttemptSummary,
      evidenceRefs: revRefs,
      explanation: `Debit of ${formatMoney(attempt.currency, attempt.attemptedAmount)} was attempted after the customer mandate was revoked on ${auth.effectiveTimestamp.slice(0, 10)}.`,
    });
  }

  // Rule 2: Payment after mandate expiry
  if (auth.status === 'EXPIRED' || replay.isExpiredAtTimestamp) {
    const expEvents = replay.timeline
      .filter((e) => e.includedInReplay && e.eventType === 'MANDATE_EXPIRED')
      .map((e) => e.eventUid);
    violations.push({
      violationType: 'PAYMENT_AFTER_EXPIRY',
      severity: 'CRITICAL',
      classification: 'CONFIRMED_VIOLATION',
      relevantEventIds: expEvents.length > 0 ? expEvents : replay.relevantEventIds.slice(0, 2),
      expectedAuthorization: expectedAuthSummary,
      actualAttempt: actualAttemptSummary,
      evidenceRefs: auth.consentEvidenceRef ? [auth.consentEvidenceRef] : [],
      explanation: `Debit was attempted on ${attemptIso.slice(0, 10)}, after mandate authorization expired${mandate.endDate ? ` on ${new Date(mandate.endDate).toISOString().slice(0, 10)}` : ''}.`,
    });
  }

  // Rule 3: Payment during paused period
  if (auth.status === 'PAUSED') {
    const pauseEvents = replay.timeline
      .filter((e) => e.includedInReplay && (e.eventType === 'MANDATE_PAUSED' || e.eventType === 'MANDATE_RESUMED'))
      .map((e) => e.eventUid);
    violations.push({
      violationType: 'PAYMENT_DURING_PAUSE',
      severity: 'HIGH',
      classification: 'CONFIRMED_VIOLATION',
      relevantEventIds: pauseEvents,
      expectedAuthorization: expectedAuthSummary,
      actualAttempt: actualAttemptSummary,
      evidenceRefs: auth.consentEvidenceRef ? [auth.consentEvidenceRef] : [],
      explanation: `Debit of ${formatMoney(attempt.currency, attempt.attemptedAmount)} was attempted while the mandate was in PAUSED state without a customer-confirmed resumption.`,
    });
  }

  // Rule 4: Merchant mismatch
  if (attempt.attemptedMerchantId.trim().toLowerCase() !== auth.merchantId.trim().toLowerCase()) {
    const merchantModEvents = replay.unsupportedModifications
      .filter((m) => m.field === 'merchant')
      .map((m) => m.eventUid);
    violations.push({
      violationType: 'MERCHANT_MISMATCH',
      severity: 'CRITICAL',
      classification: 'CONFIRMED_VIOLATION',
      relevantEventIds: merchantModEvents.length > 0 ? merchantModEvents : replay.relevantEventIds.slice(0, 2),
      expectedAuthorization: expectedAuthSummary,
      actualAttempt: actualAttemptSummary,
      evidenceRefs: auth.consentEvidenceRef ? [auth.consentEvidenceRef] : [],
      explanation: `Payment attempt originated from merchant ${attempt.attemptedMerchantName} (${attempt.attemptedMerchantId}), which does not match customer-authorized merchant ${auth.merchantName} (${auth.merchantId}).`,
    });
  }

  // Rule 5 & 6: Unauthorized amount increase / decrease
  const amountUnsupportedEvents = replay.unsupportedModifications
    .filter((m) => m.field === 'amount')
    .map((m) => m.eventUid);
  const amountAmbiguousEvents = replay.ambiguousOrMissingEvidenceEvents
    .filter((m) => m.field === 'amount')
    .map((m) => m.eventUid);

  if (attempt.attemptedAmount > auth.amount + 0.009) {
    if (amountAmbiguousEvents.length > 0 && amountUnsupportedEvents.length === 0) {
      violations.push({
        violationType: 'MISSING_AUTHORIZATION_EVIDENCE',
        severity: 'MEDIUM',
        classification: 'INCOMPLETE_EVIDENCE',
        relevantEventIds: amountAmbiguousEvents,
        expectedAuthorization: expectedAuthSummary,
        actualAttempt: actualAttemptSummary,
        evidenceRefs: auth.consentEvidenceRef ? [auth.consentEvidenceRef] : [],
        explanation: `Attempted debit of ${formatMoney(attempt.currency, attempt.attemptedAmount)} exceeds verified authorization (${formatMoney(auth.currency, auth.amount)}); a modification record exists but lacks verifiable customer consent evidence.`,
      });
    } else {
      const pctIncrease = auth.amount > 0 ? ((attempt.attemptedAmount - auth.amount) / auth.amount) * 100 : 100;
      violations.push({
        violationType: 'UNAUTHORIZED_AMOUNT_INCREASE',
        severity: pctIncrease >= 50 ? 'CRITICAL' : 'HIGH',
        classification: 'CONFIRMED_VIOLATION',
        relevantEventIds: amountUnsupportedEvents.length > 0 ? amountUnsupportedEvents : replay.relevantEventIds.slice(0, 2),
        expectedAuthorization: expectedAuthSummary,
        actualAttempt: actualAttemptSummary,
        evidenceRefs: auth.consentEvidenceRef ? [auth.consentEvidenceRef] : [],
        explanation: `Attempted debit of ${formatMoney(attempt.currency, attempt.attemptedAmount)} exceeds customer-authorized amount of ${formatMoney(auth.currency, auth.amount)} by ${formatMoney(attempt.currency, amountDelta)} (+${pctIncrease.toFixed(1)}%). No customer-approved amount modification was found before ${attemptIso.slice(0, 10)}.`,
      });
    }
  } else if (
    mandate.requireApprovalForDecrease &&
    attempt.attemptedAmount < auth.amount - 0.009
  ) {
    violations.push({
      violationType: 'UNAUTHORIZED_AMOUNT_DECREASE',
      severity: 'MEDIUM',
      classification: 'CONFIRMED_VIOLATION',
      relevantEventIds: amountUnsupportedEvents,
      expectedAuthorization: expectedAuthSummary,
      actualAttempt: actualAttemptSummary,
      evidenceRefs: auth.consentEvidenceRef ? [auth.consentEvidenceRef] : [],
      explanation: `Mandate terms require explicit customer approval for amount decreases; attempted ${formatMoney(attempt.currency, attempt.attemptedAmount)} vs authorized ${formatMoney(auth.currency, auth.amount)}.`,
    });
  }

  // Rule 7: Billing frequency mismatch
  if (
    attempt.attemptedFrequency &&
    attempt.attemptedFrequency.toUpperCase() !== auth.billingFrequency.toUpperCase() &&
    auth.billingFrequency.toUpperCase() !== 'AS_PRESENTED'
  ) {
    const freqModEvents = replay.unsupportedModifications
      .filter((m) => m.field === 'billingFrequency')
      .map((m) => m.eventUid);
    violations.push({
      violationType: 'FREQUENCY_MISMATCH',
      severity: 'HIGH',
      classification: 'CONFIRMED_VIOLATION',
      relevantEventIds: freqModEvents.length > 0 ? freqModEvents : replay.relevantEventIds.slice(0, 2),
      expectedAuthorization: expectedAuthSummary,
      actualAttempt: actualAttemptSummary,
      evidenceRefs: auth.consentEvidenceRef ? [auth.consentEvidenceRef] : [],
      explanation: `Payment attempt uses ${attempt.attemptedFrequency} billing frequency, conflicting with customer-authorized ${auth.billingFrequency} cadence.`,
    });
  }

  // Rule 8: Duplicate debit attempt detection (checks both event history & prior attempts)
  const priorDebitTimestamps: Array<{ ref: string; ms: number; amount: number }> = [];
  for (const ev of replay.timeline) {
    if (
      ev.includedInReplay &&
      (ev.eventType === 'DEBIT_PROCESSED' || ev.eventType === 'DEBIT_ATTEMPTED')
    ) {
      const evMs = toMs(ev.eventTimestamp);
      if (evMs < attemptMs) {
        const evAmt =
          typeof ev.newValue?.amount === 'number'
            ? ev.newValue.amount
            : typeof ev.newValue?.attemptedAmount === 'number'
              ? ev.newValue.attemptedAmount
              : attempt.attemptedAmount;
        priorDebitTimestamps.push({ ref: ev.eventUid, ms: evMs, amount: evAmt });
      }
    }
  }
  for (const pa of priorAttempts) {
    if (attempt.attemptUid && pa.attemptUid === attempt.attemptUid) continue;
    const paMs = toMs(pa.attemptTimestamp);
    if (paMs <= attemptMs && pa.status !== 'BLOCKED') {
      priorDebitTimestamps.push({ ref: pa.attemptUid, ms: paMs, amount: pa.attemptedAmount });
    }
  }

  const duplicateHit = priorDebitTimestamps.find(
    (p) =>
      Math.abs(p.amount - attempt.attemptedAmount) < 0.01 &&
      isWithinDuplicateWindow(p.ms, attemptMs, auth.billingFrequency)
  );
  if (duplicateHit) {
    const hoursApart = Math.max(0.1, (attemptMs - duplicateHit.ms) / (1000 * 60 * 60));
    violations.push({
      violationType: 'DUPLICATE_DEBIT_ATTEMPT',
      severity: 'HIGH',
      classification: 'CONFIRMED_VIOLATION',
      relevantEventIds: [duplicateHit.ref],
      expectedAuthorization: expectedAuthSummary,
      actualAttempt: actualAttemptSummary,
      evidenceRefs: [duplicateHit.ref],
      explanation: `Potential duplicate debit of ${formatMoney(attempt.currency, attempt.attemptedAmount)} detected ${hoursApart.toFixed(1)} hours after prior debit reference ${duplicateHit.ref} within the same ${auth.billingFrequency} billing window.`,
    });
  }

  // Rule 9: Billing outside authorized schedule
  if (
    auth.billingDayOfMonth &&
    auth.billingFrequency === 'MONTHLY' &&
    auth.status === 'ACTIVE'
  ) {
    const attemptDay = new Date(attemptMs).getUTCDate();
    const diff = Math.min(
      Math.abs(attemptDay - auth.billingDayOfMonth),
      30 - Math.abs(attemptDay - auth.billingDayOfMonth)
    );
    if (diff > 3) {
      violations.push({
        violationType: 'OUTSIDE_BILLING_SCHEDULE',
        severity: 'MEDIUM',
        classification: 'CONFIRMED_VIOLATION',
        relevantEventIds: replay.relevantEventIds.slice(0, 1),
        expectedAuthorization: expectedAuthSummary,
        actualAttempt: actualAttemptSummary,
        evidenceRefs: auth.consentEvidenceRef ? [auth.consentEvidenceRef] : [],
        explanation: `Debit occurred on day ${attemptDay} of the month, outside the customer-authorized billing schedule (day ${auth.billingDayOfMonth} ± 3 days).`,
      });
    }
  }

  // Rule 10: Unresolved unsupported mandate modifications present in history
  const unresolvedUnsupportedMods = replay.unsupportedModifications.filter((u) => {
    const uMs = toMs(u.eventTimestamp);
    return !replay.approvedModifications.some(
      (a) => a.field === u.field && toMs(a.eventTimestamp) > uMs
    );
  });
  if (unresolvedUnsupportedMods.length > 0) {
    const hasSpecificMismatchAlready = violations.some((v) =>
      [
        'UNAUTHORIZED_AMOUNT_INCREASE',
        'UNAUTHORIZED_AMOUNT_DECREASE',
        'FREQUENCY_MISMATCH',
        'MERCHANT_MISMATCH',
        'PAYMENT_DURING_PAUSE',
      ].includes(v.violationType)
    );
    if (!hasSpecificMismatchAlready) {
      violations.push({
        violationType: 'UNSUPPORTED_MANDATE_MODIFICATION',
        severity: 'HIGH',
        classification: 'CONFIRMED_VIOLATION',
        relevantEventIds: unresolvedUnsupportedMods.map((m) => m.eventUid),
        expectedAuthorization: expectedAuthSummary,
        actualAttempt: actualAttemptSummary,
        evidenceRefs: [],
        explanation: `Merchant-side mandate record contains ${unresolvedUnsupportedMods.length} unresolved unsupported modification(s) without customer consent prior to this attempt.`,
      });
    }
  }

  // Rule 11 & 12: Missing authorization evidence / Ambiguous consent
  if (auth.consentEvidenceStatus === 'MISSING' || (!replay.hadConsentApproval && auth.consentEvidenceStatus !== 'AMBIGUOUS')) {
    const alreadyMissing = violations.some((v) => v.violationType === 'MISSING_AUTHORIZATION_EVIDENCE');
    if (!alreadyMissing) {
      violations.push({
        violationType: 'MISSING_AUTHORIZATION_EVIDENCE',
        severity: 'MEDIUM',
        classification: 'INCOMPLETE_EVIDENCE',
        relevantEventIds: replay.relevantEventIds,
        expectedAuthorization: expectedAuthSummary,
        actualAttempt: actualAttemptSummary,
        evidenceRefs: [],
        explanation: `No verified customer authorization evidence was found prior to ${attemptIso.slice(0, 10)}. Evidence is incomplete and requires manual review.`,
      });
    }
  } else if (
    auth.consentEvidenceStatus === 'AMBIGUOUS' ||
    auth.status === 'NEEDS_REVIEW' ||
    (replay.ambiguousOrMissingEvidenceEvents.length > 0 && violations.length === 0)
  ) {
    violations.push({
      violationType: 'AMBIGUOUS_CONSENT',
      severity: 'MEDIUM',
      classification: 'INCOMPLETE_EVIDENCE',
      relevantEventIds: replay.ambiguousOrMissingEvidenceEvents.map((m) => m.eventUid),
      expectedAuthorization: expectedAuthSummary,
      actualAttempt: actualAttemptSummary,
      evidenceRefs: auth.consentEvidenceRef ? [auth.consentEvidenceRef] : [],
      explanation: `Consent documentation or modification evidence is ambiguous or marked for review. Manual verification is required before treating this attempt as authorized.`,
    });
  }

  // Determine deterministic verification status & severity
  const BLOCKING_RULES: ViolationType[] = [
    'PAYMENT_AFTER_REVOCATION',
    'PAYMENT_AFTER_EXPIRY',
    'PAYMENT_DURING_PAUSE',
    'MERCHANT_MISMATCH',
    'UNAUTHORIZED_AMOUNT_INCREASE',
    'FREQUENCY_MISMATCH',
  ];

  const FLAGGING_RULES: ViolationType[] = [
    'DUPLICATE_DEBIT_ATTEMPT',
    'OUTSIDE_BILLING_SCHEDULE',
    'UNAUTHORIZED_AMOUNT_DECREASE',
    'UNSUPPORTED_MANDATE_MODIFICATION',
  ];

  let status: VerificationStatus = 'VERIFIED';
  let severity: SeverityLevel = 'LOW';

  if (violations.some((v) => BLOCKING_RULES.includes(v.violationType))) {
    status = 'BLOCKED';
  } else if (violations.some((v) => FLAGGING_RULES.includes(v.violationType))) {
    status = 'FLAGGED';
  } else if (violations.some((v) => v.classification === 'INCOMPLETE_EVIDENCE')) {
    status = 'NEEDS_REVIEW';
  }

  for (const v of violations) {
    severity = maxSeverity(severity, v.severity);
  }

  // Secondary statistical anomaly signal (supplementary only — deterministic rules govern status)
  let anomalyScore = 4;
  if (auth.amount > 0 && attempt.attemptedAmount > auth.amount) {
    const ratio = (attempt.attemptedAmount - auth.amount) / auth.amount;
    anomalyScore += Math.min(45, Math.round(ratio * 60));
  }
  anomalyScore += Math.min(30, replay.unsupportedModifications.length * 18);
  if (auth.status === 'REVOKED' || auth.status === 'EXPIRED') anomalyScore += 45;
  if (auth.status === 'PAUSED') anomalyScore += 32;
  if (duplicateHit) anomalyScore += 28;
  if (auth.consentEvidenceStatus === 'MISSING' || auth.consentEvidenceStatus === 'AMBIGUOUS') {
    anomalyScore += 22;
  }
  anomalyScore = Math.max(0, Math.min(99, anomalyScore));

  // Deterministic factual explanation strictly grounded in replay evidence
  const deterministicExplanation = buildDeterministicExplanation(
    status,
    attempt,
    replay,
    violations
  );

  const violationCategories = Array.from(new Set(violations.map((v) => v.violationType)));
  const relevantEventIds = Array.from(
    new Set([
      ...replay.relevantEventIds,
      ...violations.flatMap((v) => v.relevantEventIds),
    ])
  );

  return {
    status,
    severity,
    expectedAuthorizedAmount: auth.amount,
    attemptedAmount: attempt.attemptedAmount,
    amountDelta,
    currency: attempt.currency,
    anomalyScore,
    violations,
    violationCategories,
    relevantEventIds,
    replay,
    deterministicExplanation,
  };
}

function buildDeterministicExplanation(
  status: VerificationStatus,
  attempt: PaymentAttemptInput,
  replay: ReplayResult,
  violations: DetectedViolation[]
): string {
  const auth = replay.reconstructedAuthorization;
  const attemptAmtStr = formatMoney(attempt.currency, attempt.attemptedAmount);
  const authAmtStr = formatMoney(auth.currency, auth.amount);

  if (status === 'VERIFIED') {
    const mods =
      replay.approvedModifications.length > 0
        ? ` including ${replay.approvedModifications.length} customer-approved modification(s)`
        : '';
    return `The attempted debit of ${attemptAmtStr} matches the customer's reconstructed authorization of ${authAmtStr} (${auth.billingFrequency}) valid at ${replay.asOfTimestamp.slice(0, 10)}${mods}. Mandate status was ACTIVE with verified consent evidence${auth.consentEvidenceRef ? ` (${auth.consentEvidenceRef})` : ''}.`;
  }

  const reasons = violations.map((v) => v.explanation).join(' ');
  const unsupportedNote =
    replay.unsupportedModifications.length > 0
      ? ` ${replay.unsupportedModifications.length} merchant-side modification(s) lacked supporting customer consent evidence.`
      : '';

  if (status === 'NEEDS_REVIEW') {
    return `Verification outcome: NEEDS_REVIEW. ${reasons} Because supporting authorization evidence is incomplete or ambiguous, this attempt is flagged for human review rather than treated as confirmed fraud.`;
  }

  return `Verification outcome: ${status}. ${reasons}${unsupportedNote}`;
}
