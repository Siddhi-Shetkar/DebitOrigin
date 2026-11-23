import { and, eq } from 'drizzle-orm';
import { db } from '../../db/index.ts';
import {
  consentDocuments,
  consentExtractionResults,
  investigationCases,
  investigationNotes,
  mandateEvents,
  mandates,
  paymentAttempts,
  verificationResults,
  violations,
} from '../../db/schema.ts';
import { verifyPaymentAttempt } from '../engine/verificationEngine.ts';
import { logAudit, makeUid } from '../utils/security.ts';

function utcDate(year: number, month: number, day: number, hour = 9, minute = 0): Date {
  return new Date(Date.UTC(year, month - 1, day, hour, minute, 0));
}

export async function resetDemoDataForUser(userId: number, ipAddress?: string): Promise<void> {
  // Strictly delete ONLY isDemo = true records owned by this user. Never touches user data.
  await db
    .delete(investigationCases)
    .where(and(eq(investigationCases.userId, userId), eq(investigationCases.isDemo, true)));
  await db
    .delete(violations)
    .where(and(eq(violations.userId, userId), eq(violations.isDemo, true)));
  await db
    .delete(verificationResults)
    .where(and(eq(verificationResults.userId, userId), eq(verificationResults.isDemo, true)));
  await db
    .delete(paymentAttempts)
    .where(and(eq(paymentAttempts.userId, userId), eq(paymentAttempts.isDemo, true)));
  await db
    .delete(mandateEvents)
    .where(and(eq(mandateEvents.userId, userId), eq(mandateEvents.isDemo, true)));
  await db
    .delete(consentDocuments)
    .where(and(eq(consentDocuments.userId, userId), eq(consentDocuments.isDemo, true)));
  await db
    .delete(mandates)
    .where(and(eq(mandates.userId, userId), eq(mandates.isDemo, true)));

  await logAudit(userId, 'DEMO_DATA_RESET', 'demo_dataset', userId, { isDemo: true }, ipAddress);
}

export async function loadDemoDataForUser(
  userId: number,
  userFullName: string,
  ipAddress?: string
): Promise<{ mandatesCreated: number; attemptsCreated: number; casesCreated: number }> {
  // Reset any existing demo records cleanly first without touching user's own mandates
  await resetDemoDataForUser(userId, ipAddress);

  interface DemoScenarioSpec {
    mandate: {
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
      billingDayOfMonth: number;
      startDate: Date;
      endDate: Date;
      status: string;
      originalConsentTimestamp: Date;
      consentEvidenceRef: string | null;
      conditions: string;
    };
    events: Array<{
      eventType: string;
      eventTimestamp: Date;
      previousValue?: Record<string, unknown> | null;
      newValue?: Record<string, unknown> | null;
      actor: string;
      customerApproved: boolean;
      customerApprovalRef?: string | null;
      evidenceRef?: string | null;
      evidenceStatus: string;
      metadata?: Record<string, unknown> | null;
    }>;
    attempts: Array<{
      attemptTimestamp: Date;
      attemptedAmount: number;
      currency: string;
      attemptedMerchantId: string;
      attemptedMerchantName: string;
      attemptedFrequency: string;
      openCase?: {
        title: string;
        status: string;
        note: string;
      };
    }>;
  }

  const scenarios: DemoScenarioSpec[] = [
    // 1. Signature Scenario: Unauthorized amount drift ₹499 -> ₹799 while mandate still shows ACTIVE
    {
      mandate: {
        mandateCode: 'DEMO-MND-499-799',
        customerId: 'DEMO-CUST-1001',
        customerName: 'Ananya Verma (Synthetic)',
        merchantId: 'MRC-CLOUDSTREAM-IN',
        merchantName: 'CloudStream Media India (Demo)',
        authorizedAmount: 499,
        currentMerchantAmount: 799,
        currency: 'INR',
        billingFrequency: 'MONTHLY',
        currentMerchantFrequency: 'MONTHLY',
        billingSchedule: 'Day 5 of every month',
        billingDayOfMonth: 5,
        startDate: utcDate(2026, 1, 5),
        endDate: utcDate(2027, 1, 5),
        status: 'ACTIVE',
        originalConsentTimestamp: utcDate(2026, 1, 5, 10, 15),
        consentEvidenceRef: 'EVD-UPI-AUTOPAY-9041',
        conditions: 'Standard Monthly Plan. Any tariff increase requires fresh customer OTP re-authentication.',
      },
      events: [
        {
          eventType: 'CONSENT_CREATED',
          eventTimestamp: utcDate(2026, 1, 5, 10, 12),
          newValue: { amount: 499, billingFrequency: 'MONTHLY', merchantId: 'MRC-CLOUDSTREAM-IN' },
          actor: 'MERCHANT',
          customerApproved: false,
          evidenceRef: 'REQ-INIT-9041',
          evidenceStatus: 'VERIFIED',
        },
        {
          eventType: 'CONSENT_APPROVED',
          eventTimestamp: utcDate(2026, 1, 5, 10, 15),
          newValue: { amount: 499, billingFrequency: 'MONTHLY', merchantId: 'MRC-CLOUDSTREAM-IN', merchantName: 'CloudStream Media India (Demo)' },
          actor: 'CUSTOMER',
          customerApproved: true,
          customerApprovalRef: 'NPCI-OTP-9041',
          evidenceRef: 'EVD-UPI-AUTOPAY-9041',
          evidenceStatus: 'VERIFIED',
          metadata: { channel: 'UPI AutoPay e-Mandate' },
        },
        {
          eventType: 'PRE_DEBIT_NOTIFICATION',
          eventTimestamp: utcDate(2026, 2, 3, 9, 0),
          newValue: { amount: 499 },
          actor: 'SYSTEM',
          customerApproved: false,
          evidenceRef: 'PDN-FEB-9041',
          evidenceStatus: 'VERIFIED',
        },
        {
          eventType: 'DEBIT_PROCESSED',
          eventTimestamp: utcDate(2026, 2, 5, 9, 0),
          newValue: { amount: 499 },
          actor: 'SYSTEM',
          customerApproved: false,
          evidenceRef: 'TXN-FEB05-499',
          evidenceStatus: 'VERIFIED',
        },
        {
          eventType: 'AMOUNT_MODIFIED',
          eventTimestamp: utcDate(2026, 3, 2, 16, 40),
          previousValue: { amount: 499 },
          newValue: { amount: 799 },
          actor: 'MERCHANT',
          customerApproved: false,
          customerApprovalRef: null,
          evidenceRef: null,
          evidenceStatus: 'NONE',
          metadata: { internalReason: 'Silent tier repricing without customer re-consent' },
        },
      ],
      attempts: [
        {
          attemptTimestamp: utcDate(2026, 2, 5, 9, 0),
          attemptedAmount: 499,
          currency: 'INR',
          attemptedMerchantId: 'MRC-CLOUDSTREAM-IN',
          attemptedMerchantName: 'CloudStream Media India (Demo)',
          attemptedFrequency: 'MONTHLY',
        },
        {
          attemptTimestamp: utcDate(2026, 4, 5, 9, 5),
          attemptedAmount: 799,
          currency: 'INR',
          attemptedMerchantId: 'MRC-CLOUDSTREAM-IN',
          attemptedMerchantName: 'CloudStream Media India (Demo)',
          attemptedFrequency: 'MONTHLY',
          openCase: {
            title: 'Unauthorized ₹499 → ₹799 tariff drift on CloudStream Media',
            status: 'UNDER_REVIEW',
            note: 'Replay confirmed merchant modified internal billing amount on March 2 without customer OTP or mandate re-authentication.',
          },
        },
      ],
    },

    // 2. Valid ₹499 recurring debit
    {
      mandate: {
        mandateCode: 'DEMO-MND-VALID-499',
        customerId: 'DEMO-CUST-1002',
        customerName: 'Rohan Kulkarni (Synthetic)',
        merchantId: 'MRC-PULSEAUDIO-IN',
        merchantName: 'PulseAudio Plus (Demo)',
        authorizedAmount: 499,
        currentMerchantAmount: 499,
        currency: 'INR',
        billingFrequency: 'MONTHLY',
        currentMerchantFrequency: 'MONTHLY',
        billingSchedule: 'Day 5 of every month',
        billingDayOfMonth: 5,
        startDate: utcDate(2026, 1, 5),
        endDate: utcDate(2027, 1, 5),
        status: 'ACTIVE',
        originalConsentTimestamp: utcDate(2026, 1, 5, 11, 0),
        consentEvidenceRef: 'EVD-ENACH-4421',
        conditions: 'Fixed monthly recurring subscription.',
      },
      events: [
        {
          eventType: 'CONSENT_APPROVED',
          eventTimestamp: utcDate(2026, 1, 5, 11, 0),
          newValue: { amount: 499, billingFrequency: 'MONTHLY', merchantId: 'MRC-PULSEAUDIO-IN' },
          actor: 'CUSTOMER',
          customerApproved: true,
          customerApprovalRef: 'ENACH-SIGN-4421',
          evidenceRef: 'EVD-ENACH-4421',
          evidenceStatus: 'VERIFIED',
        },
        {
          eventType: 'DEBIT_PROCESSED',
          eventTimestamp: utcDate(2026, 2, 5, 9, 0),
          newValue: { amount: 499 },
          actor: 'SYSTEM',
          customerApproved: false,
          evidenceRef: 'TXN-PULSE-FEB',
          evidenceStatus: 'VERIFIED',
        },
      ],
      attempts: [
        {
          attemptTimestamp: utcDate(2026, 3, 5, 9, 10),
          attemptedAmount: 499,
          currency: 'INR',
          attemptedMerchantId: 'MRC-PULSEAUDIO-IN',
          attemptedMerchantName: 'PulseAudio Plus (Demo)',
          attemptedFrequency: 'MONTHLY',
        },
      ],
    },

    // 3. Payment after mandate revocation
    {
      mandate: {
        mandateCode: 'DEMO-MND-REVOKED',
        customerId: 'DEMO-CUST-1003',
        customerName: 'Meera Nair (Synthetic)',
        merchantId: 'MRC-APEXFIT-IN',
        merchantName: 'ApexFit Clubs India (Demo)',
        authorizedAmount: 1499,
        currentMerchantAmount: 1499,
        currency: 'INR',
        billingFrequency: 'MONTHLY',
        currentMerchantFrequency: 'MONTHLY',
        billingSchedule: 'Day 10 of every month',
        billingDayOfMonth: 10,
        startDate: utcDate(2026, 1, 10),
        endDate: utcDate(2027, 1, 10),
        status: 'REVOKED',
        originalConsentTimestamp: utcDate(2026, 1, 10, 8, 30),
        consentEvidenceRef: 'EVD-ENACH-7712',
        conditions: 'Customer may revoke mandate at any time with immediate effect.',
      },
      events: [
        {
          eventType: 'CONSENT_APPROVED',
          eventTimestamp: utcDate(2026, 1, 10, 8, 30),
          newValue: { amount: 1499, billingFrequency: 'MONTHLY', merchantId: 'MRC-APEXFIT-IN' },
          actor: 'CUSTOMER',
          customerApproved: true,
          customerApprovalRef: 'OTP-7712',
          evidenceRef: 'EVD-ENACH-7712',
          evidenceStatus: 'VERIFIED',
        },
        {
          eventType: 'DEBIT_PROCESSED',
          eventTimestamp: utcDate(2026, 2, 10, 9, 0),
          newValue: { amount: 1499 },
          actor: 'SYSTEM',
          customerApproved: false,
          evidenceRef: 'TXN-FIT-FEB',
          evidenceStatus: 'VERIFIED',
        },
        {
          eventType: 'MANDATE_REVOKED',
          eventTimestamp: utcDate(2026, 2, 22, 18, 15),
          previousValue: { status: 'ACTIVE' },
          newValue: { status: 'REVOKED' },
          actor: 'CUSTOMER',
          customerApproved: true,
          customerApprovalRef: 'REV-BANK-7712',
          evidenceRef: 'EVD-REVOCATION-7712',
          evidenceStatus: 'VERIFIED',
        },
      ],
      attempts: [
        {
          attemptTimestamp: utcDate(2026, 3, 10, 9, 0),
          attemptedAmount: 1499,
          currency: 'INR',
          attemptedMerchantId: 'MRC-APEXFIT-IN',
          attemptedMerchantName: 'ApexFit Clubs India (Demo)',
          attemptedFrequency: 'MONTHLY',
          openCase: {
            title: 'Post-revocation debit attempted by ApexFit Clubs',
            status: 'OPEN',
            note: 'Customer revoked e-mandate on Feb 22 via bank portal; merchant attempted billing 16 days later.',
          },
        },
      ],
    },

    // 4. Payment during pause
    {
      mandate: {
        mandateCode: 'DEMO-MND-PAUSED',
        customerId: 'DEMO-CUST-1004',
        customerName: 'Kabir Deshmukh (Synthetic)',
        merchantId: 'MRC-NEWSWIRE-IN',
        merchantName: 'NewsWire Digital Digest (Demo)',
        authorizedAmount: 299,
        currentMerchantAmount: 299,
        currency: 'INR',
        billingFrequency: 'MONTHLY',
        currentMerchantFrequency: 'MONTHLY',
        billingSchedule: 'Day 12 of every month',
        billingDayOfMonth: 12,
        startDate: utcDate(2026, 1, 12),
        endDate: utcDate(2027, 1, 12),
        status: 'PAUSED',
        originalConsentTimestamp: utcDate(2026, 1, 12, 10, 0),
        consentEvidenceRef: 'EVD-UPI-5519',
        conditions: 'Paused mandates must not be billed until customer explicitly resumes.',
      },
      events: [
        {
          eventType: 'CONSENT_APPROVED',
          eventTimestamp: utcDate(2026, 1, 12, 10, 0),
          newValue: { amount: 299, billingFrequency: 'MONTHLY', merchantId: 'MRC-NEWSWIRE-IN' },
          actor: 'CUSTOMER',
          customerApproved: true,
          customerApprovalRef: 'OTP-5519',
          evidenceRef: 'EVD-UPI-5519',
          evidenceStatus: 'VERIFIED',
        },
        {
          eventType: 'MANDATE_PAUSED',
          eventTimestamp: utcDate(2026, 2, 18, 14, 0),
          previousValue: { status: 'ACTIVE' },
          newValue: { status: 'PAUSED' },
          actor: 'CUSTOMER',
          customerApproved: true,
          customerApprovalRef: 'PAU-5519',
          evidenceRef: 'EVD-PAUSE-5519',
          evidenceStatus: 'VERIFIED',
        },
      ],
      attempts: [
        {
          attemptTimestamp: utcDate(2026, 3, 12, 9, 0),
          attemptedAmount: 299,
          currency: 'INR',
          attemptedMerchantId: 'MRC-NEWSWIRE-IN',
          attemptedMerchantName: 'NewsWire Digital Digest (Demo)',
          attemptedFrequency: 'MONTHLY',
        },
      ],
    },

    // 5. Valid customer-approved amount modification
    {
      mandate: {
        mandateCode: 'DEMO-MND-APPROVED-UPG',
        customerId: 'DEMO-CUST-1005',
        customerName: 'Diya Menon (Synthetic)',
        merchantId: 'MRC-CLOUDLEDGER-IN',
        merchantName: 'CloudLedger Pro SaaS (Demo)',
        authorizedAmount: 999,
        currentMerchantAmount: 1499,
        currency: 'INR',
        billingFrequency: 'MONTHLY',
        currentMerchantFrequency: 'MONTHLY',
        billingSchedule: 'Day 5 of every month',
        billingDayOfMonth: 5,
        startDate: utcDate(2026, 1, 5),
        endDate: utcDate(2027, 1, 5),
        status: 'ACTIVE',
        originalConsentTimestamp: utcDate(2026, 1, 5, 9, 30),
        consentEvidenceRef: 'EVD-CL-8820',
        conditions: 'Plan upgrades require 2FA OTP consent confirmation.',
      },
      events: [
        {
          eventType: 'CONSENT_APPROVED',
          eventTimestamp: utcDate(2026, 1, 5, 9, 30),
          newValue: { amount: 999, billingFrequency: 'MONTHLY', merchantId: 'MRC-CLOUDLEDGER-IN' },
          actor: 'CUSTOMER',
          customerApproved: true,
          customerApprovalRef: 'OTP-ORIG-8820',
          evidenceRef: 'EVD-CL-8820',
          evidenceStatus: 'VERIFIED',
        },
        {
          eventType: 'AMOUNT_MODIFIED',
          eventTimestamp: utcDate(2026, 2, 22, 15, 20),
          previousValue: { amount: 999 },
          newValue: { amount: 1499 },
          actor: 'CUSTOMER',
          customerApproved: true,
          customerApprovalRef: 'OTP-UPG-8821',
          evidenceRef: 'EVD-UPGRADE-8821',
          evidenceStatus: 'VERIFIED',
          metadata: { plan: 'Pro Team Upgrade' },
        },
      ],
      attempts: [
        {
          attemptTimestamp: utcDate(2026, 3, 5, 9, 0),
          attemptedAmount: 1499,
          currency: 'INR',
          attemptedMerchantId: 'MRC-CLOUDLEDGER-IN',
          attemptedMerchantName: 'CloudLedger Pro SaaS (Demo)',
          attemptedFrequency: 'MONTHLY',
        },
      ],
    },

    // 6. Duplicate debit within same billing cycle
    {
      mandate: {
        mandateCode: 'DEMO-MND-DUPLICATE',
        customerId: 'DEMO-CUST-1006',
        customerName: 'Vikram Rao (Synthetic)',
        merchantId: 'MRC-SHIELDSURE-IN',
        merchantName: 'ShieldSure Protect (Demo)',
        authorizedAmount: 799,
        currentMerchantAmount: 799,
        currency: 'INR',
        billingFrequency: 'MONTHLY',
        currentMerchantFrequency: 'MONTHLY',
        billingSchedule: 'Day 5 of every month',
        billingDayOfMonth: 5,
        startDate: utcDate(2026, 1, 5),
        endDate: utcDate(2027, 1, 5),
        status: 'ACTIVE',
        originalConsentTimestamp: utcDate(2026, 1, 5, 10, 0),
        consentEvidenceRef: 'EVD-SHIELD-3109',
        conditions: 'Single monthly premium debit on Day 5.',
      },
      events: [
        {
          eventType: 'CONSENT_APPROVED',
          eventTimestamp: utcDate(2026, 1, 5, 10, 0),
          newValue: { amount: 799, billingFrequency: 'MONTHLY', merchantId: 'MRC-SHIELDSURE-IN' },
          actor: 'CUSTOMER',
          customerApproved: true,
          customerApprovalRef: 'OTP-3109',
          evidenceRef: 'EVD-SHIELD-3109',
          evidenceStatus: 'VERIFIED',
        },
        {
          eventType: 'DEBIT_PROCESSED',
          eventTimestamp: utcDate(2026, 3, 5, 9, 0),
          newValue: { amount: 799 },
          actor: 'SYSTEM',
          customerApproved: false,
          evidenceRef: 'TXN-SHIELD-MAR05-AM',
          evidenceStatus: 'VERIFIED',
        },
      ],
      attempts: [
        {
          attemptTimestamp: utcDate(2026, 3, 5, 14, 30),
          attemptedAmount: 799,
          currency: 'INR',
          attemptedMerchantId: 'MRC-SHIELDSURE-IN',
          attemptedMerchantName: 'ShieldSure Protect (Demo)',
          attemptedFrequency: 'MONTHLY',
          openCase: {
            title: 'Duplicate same-day ₹799 debit attempted by ShieldSure Protect',
            status: 'OPEN',
            note: 'Second ₹799 debit attempt occurred 5.5 hours after verified morning billing TXN-SHIELD-MAR05-AM within the same monthly cycle.',
          },
        },
      ],
    },

    // 7. Incomplete consent evidence -> NEEDS_REVIEW
    {
      mandate: {
        mandateCode: 'DEMO-MND-INCOMPLETE',
        customerId: 'DEMO-CUST-1007',
        customerName: 'Nisha Kapoor (Synthetic)',
        merchantId: 'MRC-SKILLFORGE-IN',
        merchantName: 'SkillForge Academy (Demo)',
        authorizedAmount: 1999,
        currentMerchantAmount: 1999,
        currency: 'INR',
        billingFrequency: 'MONTHLY',
        currentMerchantFrequency: 'MONTHLY',
        billingSchedule: 'Day 8 of every month',
        billingDayOfMonth: 8,
        startDate: utcDate(2026, 1, 8),
        endDate: utcDate(2027, 1, 8),
        status: 'NEEDS_REVIEW',
        originalConsentTimestamp: utcDate(2026, 1, 8, 12, 0),
        consentEvidenceRef: null,
        conditions: 'Uploaded legacy scan lacked readable OTP confirmation reference.',
      },
      events: [
        {
          eventType: 'CONSENT_CREATED',
          eventTimestamp: utcDate(2026, 1, 8, 12, 0),
          newValue: { amount: 1999, billingFrequency: 'MONTHLY', merchantId: 'MRC-SKILLFORGE-IN' },
          actor: 'MERCHANT',
          customerApproved: false,
          customerApprovalRef: null,
          evidenceRef: null,
          evidenceStatus: 'MISSING',
        },
      ],
      attempts: [
        {
          attemptTimestamp: utcDate(2026, 3, 8, 9, 0),
          attemptedAmount: 1999,
          currency: 'INR',
          attemptedMerchantId: 'MRC-SKILLFORGE-IN',
          attemptedMerchantName: 'SkillForge Academy (Demo)',
          attemptedFrequency: 'MONTHLY',
        },
      ],
    },
  ];

  let mandatesCreated = 0;
  let attemptsCreated = 0;
  let casesCreated = 0;
  const mandateIdByCode = new Map<string, number>();

  for (const spec of scenarios) {
    const [createdMandate] = await db
      .insert(mandates)
      .values({
        userId,
        ...spec.mandate,
        isDemo: true,
      })
      .returning();
    mandatesCreated += 1;
    mandateIdByCode.set(createdMandate.mandateCode, createdMandate.id);

    // Insert immutable events
    const insertedEvents = [];
    for (const ev of spec.events) {
      const [row] = await db
        .insert(mandateEvents)
        .values({
          eventUid: makeUid('EVT'),
          userId,
          mandateId: createdMandate.id,
          eventType: ev.eventType,
          eventTimestamp: ev.eventTimestamp,
          previousValue: ev.previousValue ?? null,
          newValue: ev.newValue ?? null,
          actor: ev.actor,
          customerApproved: ev.customerApproved,
          customerApprovalRef: ev.customerApprovalRef ?? null,
          evidenceRef: ev.evidenceRef ?? null,
          evidenceStatus: ev.evidenceStatus,
          metadata: ev.metadata ?? null,
          isDemo: true,
        })
        .returning();
      insertedEvents.push(row);
    }

    // Run real deterministic verification engine for each payment attempt
    const priorAttempts: Array<{
      attemptUid: string;
      attemptTimestamp: Date;
      attemptedAmount: number;
      currency: string;
      status: string;
    }> = [];

    for (const att of spec.attempts) {
      const attemptUid = makeUid('PAY');
      const [createdAttempt] = await db
        .insert(paymentAttempts)
        .values({
          attemptUid,
          userId,
          mandateId: createdMandate.id,
          attemptTimestamp: att.attemptTimestamp,
          attemptedAmount: att.attemptedAmount,
          currency: att.currency,
          attemptedMerchantId: att.attemptedMerchantId,
          attemptedMerchantName: att.attemptedMerchantName,
          attemptedFrequency: att.attemptedFrequency,
          isDemo: true,
        })
        .returning();
      attemptsCreated += 1;

      const engineOutput = verifyPaymentAttempt(
        createdMandate,
        insertedEvents.map((e) => ({
          id: e.id,
          eventUid: e.eventUid,
          mandateId: e.mandateId,
          eventType: e.eventType,
          eventTimestamp: e.eventTimestamp,
          previousValue: (e.previousValue as Record<string, unknown> | null) ?? null,
          newValue: (e.newValue as Record<string, unknown> | null) ?? null,
          actor: e.actor,
          customerApproved: e.customerApproved,
          customerApprovalRef: e.customerApprovalRef,
          evidenceRef: e.evidenceRef,
          evidenceStatus: e.evidenceStatus,
          idempotencyKey: e.idempotencyKey,
          metadata: (e.metadata as Record<string, unknown> | null) ?? null,
        })),
        {
          attemptUid,
          attemptTimestamp: att.attemptTimestamp,
          attemptedAmount: att.attemptedAmount,
          currency: att.currency,
          attemptedMerchantId: att.attemptedMerchantId,
          attemptedMerchantName: att.attemptedMerchantName,
          attemptedFrequency: att.attemptedFrequency,
        },
        priorAttempts
      );

      priorAttempts.push({
        attemptUid,
        attemptTimestamp: att.attemptTimestamp,
        attemptedAmount: att.attemptedAmount,
        currency: att.currency,
        status: engineOutput.status,
      });

      const [verRow] = await db
        .insert(verificationResults)
        .values({
          userId,
          paymentAttemptId: createdAttempt.id,
          mandateId: createdMandate.id,
          attemptTimestamp: att.attemptTimestamp,
          attemptedAmount: att.attemptedAmount,
          expectedAuthorizedAmount: engineOutput.expectedAuthorizedAmount,
          currency: att.currency,
          status: engineOutput.status,
          severity: engineOutput.severity,
          anomalyScore: engineOutput.anomalyScore,
          violationCategories: engineOutput.violationCategories,
          relevantEventIds: engineOutput.relevantEventIds,
          replaySnapshot: engineOutput.replay,
          deterministicExplanation: engineOutput.deterministicExplanation,
          aiExplanation: engineOutput.deterministicExplanation,
          aiExplanationProvider: 'deterministic-engine',
          isDemo: true,
        })
        .returning();

      for (const v of engineOutput.violations) {
        await db.insert(violations).values({
          userId,
          verificationResultId: verRow.id,
          mandateId: createdMandate.id,
          violationType: v.violationType,
          severity: v.severity,
          classification: v.classification,
          expectedAuthorization: v.expectedAuthorization,
          actualAttempt: v.actualAttempt,
          relevantEventIds: v.relevantEventIds,
          evidenceRefs: v.evidenceRefs,
          explanation: v.explanation,
          isDemo: true,
        });
      }

      if (att.openCase) {
        const [invCase] = await db
          .insert(investigationCases)
          .values({
            caseUid: makeUid('INV'),
            userId,
            mandateId: createdMandate.id,
            paymentAttemptId: createdAttempt.id,
            verificationResultId: verRow.id,
            title: att.openCase.title,
            status: att.openCase.status,
            severity: engineOutput.severity,
            isDemo: true,
          })
          .returning();

        await db.insert(investigationNotes).values({
          userId,
          caseId: invCase.id,
          authorName: userFullName,
          noteType: 'NOTE',
          content: att.openCase.note,
        });
        casesCreated += 1;
      }
    }
  }

  // Link synthetic demo consent documents & extractions directly to their demo mandates
  const cloudStreamMandateId = mandateIdByCode.get('DEMO-MND-499-799') ?? null;
  const incompleteMandateId = mandateIdByCode.get('DEMO-MND-INCOMPLETE') ?? null;

  const [demoDoc1] = await db
    .insert(consentDocuments)
    .values({
      userId,
      mandateId: cloudStreamMandateId,
      fileName: 'CloudStream_eMandate_Synthetic_Demo.pdf',
      mimeType: 'application/pdf',
      fileSizeBytes: 48210,
      sha256Hash: 'demo-synthetic-sha256-9041',
      storageRef: 'DOC-DEMO-9041',
      rawTextSnippet:
        'Synthetic UPI AutoPay Consent — Customer: Ananya Verma (DEMO-CUST-1001), Merchant: CloudStream Media India (MRC-CLOUDSTREAM-IN), Authorized Amount: INR 499, Frequency: MONTHLY, Day 5.',
      isDemo: true,
    })
    .returning();

  await db.insert(consentExtractionResults).values({
    userId,
    documentId: demoDoc1.id,
    mandateId: cloudStreamMandateId,
    provider: 'deterministic-engine',
    extractedJson: {
      customerName: 'Ananya Verma (Synthetic)',
      customerId: 'DEMO-CUST-1001',
      merchantName: 'CloudStream Media India (Demo)',
      merchantId: 'MRC-CLOUDSTREAM-IN',
      mandateCode: 'DEMO-MND-499-799',
      authorizedAmount: 499,
      currency: 'INR',
      billingFrequency: 'MONTHLY',
      billingSchedule: 'Day 5 of every month',
      billingDayOfMonth: 5,
      startDate: '2026-01-05',
      endDate: '2027-01-05',
      conditions: 'Standard Monthly Plan. Any tariff increase requires fresh customer OTP re-authentication.',
      consentStatus: 'ACTIVE',
    },
    confidenceScore: 0.96,
    missingFields: [],
    ambiguousFields: [],
    reviewStatus: 'REVIEWED_SAVED',
    reviewedAt: new Date(),
  });

  const [demoDoc2] = await db
    .insert(consentDocuments)
    .values({
      userId,
      mandateId: incompleteMandateId,
      fileName: 'SkillForge_Legacy_Scan_Incomplete_Demo.pdf',
      mimeType: 'application/pdf',
      fileSizeBytes: 31480,
      sha256Hash: 'demo-synthetic-sha256-1999',
      storageRef: 'DOC-DEMO-1999',
      rawTextSnippet:
        'Synthetic Legacy Scan — Customer: Nisha Kapoor (DEMO-CUST-1007), Merchant: SkillForge Academy (MRC-SKILLFORGE-IN), Amount: INR 1999 MONTHLY. OTP/Signature block illegible.',
      isDemo: true,
    })
    .returning();

  await db.insert(consentExtractionResults).values({
    userId,
    documentId: demoDoc2.id,
    mandateId: incompleteMandateId,
    provider: 'deterministic-engine',
    extractedJson: {
      customerName: 'Nisha Kapoor (Synthetic)',
      customerId: 'DEMO-CUST-1007',
      merchantName: 'SkillForge Academy (Demo)',
      merchantId: 'MRC-SKILLFORGE-IN',
      mandateCode: 'DEMO-MND-INCOMPLETE',
      authorizedAmount: 1999,
      currency: 'INR',
      billingFrequency: 'MONTHLY',
      billingSchedule: 'Day 8 of every month',
      billingDayOfMonth: 8,
      startDate: '2026-01-08',
      endDate: '2027-01-08',
      conditions: 'Uploaded legacy scan lacked readable OTP confirmation reference.',
      consentStatus: 'NEEDS_REVIEW',
    },
    confidenceScore: 0.52,
    missingFields: ['consentEvidenceRef'],
    ambiguousFields: ['customer_otp_or_signature'],
    reviewStatus: 'NEEDS_REVIEW',
    reviewedAt: null,
  });

  await logAudit(
    userId,
    'DEMO_DATA_LOADED',
    'demo_dataset',
    userId,
    { mandatesCreated, attemptsCreated, casesCreated, isDemo: true },
    ipAddress
  );

  return { mandatesCreated, attemptsCreated, casesCreated };
}
