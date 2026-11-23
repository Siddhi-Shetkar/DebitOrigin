import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { and, asc, desc, eq, gte, lte } from 'drizzle-orm';
import { db } from '../../db/index.ts';
import {
  auditLogs,
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
import { requireAuth, type AuthRequest } from '../middleware/auth.ts';
import { replayMandateAuthorization } from '../engine/replayEngine.ts';
import { verifyPaymentAttempt } from '../engine/verificationEngine.ts';
import { runRiskEvaluationBenchmark } from '../engine/evaluationEngine.ts';
import {
  extractConsentDocumentWithAI,
  generateForensicExplanation,
} from '../services/geminiService.ts';
import { loadDemoDataForUser, resetDemoDataForUser } from '../services/demoService.ts';
import {
  createRateLimiter,
  getClientIp,
  logAudit,
  makeUid,
  sha256Buffer,
  validateUploadedFile,
} from '../utils/security.ts';

const router = Router();
router.use(requireAuth);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

const aiLimiter = createRateLimiter({ windowMs: 60 * 1000, max: 20, keyPrefix: 'ai' });

function scopeFilter(scope: unknown): boolean | null {
  if (scope === 'demo') return true;
  if (scope === 'user') return false;
  return null;
}

// ============================================================
// OVERVIEW, SEARCH & NOTIFICATIONS
// ============================================================

router.get('/overview', async (req: AuthRequest, res) => {
  try {
    const userId = req.dbUser!.id;
    const demoOnly = scopeFilter(req.query.scope);

    const mandateCond =
      demoOnly === null
        ? eq(mandates.userId, userId)
        : and(eq(mandates.userId, userId), eq(mandates.isDemo, demoOnly));
    const verCond =
      demoOnly === null
        ? eq(verificationResults.userId, userId)
        : and(eq(verificationResults.userId, userId), eq(verificationResults.isDemo, demoOnly));
    const caseCond =
      demoOnly === null
        ? eq(investigationCases.userId, userId)
        : and(eq(investigationCases.userId, userId), eq(investigationCases.isDemo, demoOnly));
    const violCond =
      demoOnly === null
        ? eq(violations.userId, userId)
        : and(eq(violations.userId, userId), eq(violations.isDemo, demoOnly));

    const [
      userMandates,
      userVerifications,
      userCases,
      userViolations,
      recentAudit,
      userAttempts,
    ] = await Promise.all([
      db.select().from(mandates).where(mandateCond).orderBy(desc(mandates.createdAt)),
      db.select().from(verificationResults).where(verCond).orderBy(desc(verificationResults.attemptTimestamp)),
      db.select().from(investigationCases).where(caseCond).orderBy(desc(investigationCases.updatedAt)),
      db.select().from(violations).where(violCond),
      db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.userId, userId))
        .orderBy(desc(auditLogs.createdAt))
        .limit(12),
      db
        .select()
        .from(paymentAttempts)
        .where(
          demoOnly === null
            ? eq(paymentAttempts.userId, userId)
            : and(eq(paymentAttempts.userId, userId), eq(paymentAttempts.isDemo, demoOnly))
        ),
    ]);

    const mandateById = new Map(userMandates.map((m) => [m.id, m]));
    const attemptById = new Map(userAttempts.map((a) => [a.id, a]));

    let verifiedCount = 0;
    let flaggedCount = 0;
    let blockedCount = 0;
    let needsReviewCount = 0;
    let suspiciousExposure = 0;

    const activityByMonth = new Map<
      string,
      { period: string; verified: number; flagged: number; blocked: number; needsReview: number }
    >();

    for (const v of userVerifications) {
      if (v.status === 'VERIFIED') verifiedCount += 1;
      else if (v.status === 'FLAGGED') {
        flaggedCount += 1;
        suspiciousExposure += v.attemptedAmount;
      } else if (v.status === 'BLOCKED') {
        blockedCount += 1;
        suspiciousExposure += v.attemptedAmount;
      } else if (v.status === 'NEEDS_REVIEW') {
        needsReviewCount += 1;
        suspiciousExposure += v.attemptedAmount;
      }

      const period = v.attemptTimestamp.toISOString().slice(0, 7);
      const bucket = activityByMonth.get(period) ?? {
        period,
        verified: 0,
        flagged: 0,
        blocked: 0,
        needsReview: 0,
      };
      if (v.status === 'VERIFIED') bucket.verified += 1;
      else if (v.status === 'FLAGGED') bucket.flagged += 1;
      else if (v.status === 'BLOCKED') bucket.blocked += 1;
      else bucket.needsReview += 1;
      activityByMonth.set(period, bucket);
    }

    const violationMap = new Map<string, number>();
    for (const viol of userViolations) {
      violationMap.set(viol.violationType, (violationMap.get(viol.violationType) ?? 0) + 1);
    }

    const openReviewCases = userCases.filter(
      (c) => c.status === 'OPEN' || c.status === 'UNDER_REVIEW' || c.status === 'REOPENED'
    ).length;

    const mandatesNeedingAttention = userMandates
      .filter(
        (m) =>
          m.status === 'NEEDS_REVIEW' ||
          m.status === 'REVOKED' ||
          m.status === 'PAUSED' ||
          Math.abs(m.currentMerchantAmount - m.authorizedAmount) > 0.01 ||
          m.currentMerchantFrequency !== m.billingFrequency
      )
      .slice(0, 6);

    const hasDemoData = userMandates.some((m) => m.isDemo);
    const hasUserData = userMandates.some((m) => !m.isDemo);

    return res.json({
      hasDemoData,
      hasUserData,
      metrics: {
        totalMandates: userMandates.length,
        attemptsAnalyzed: userVerifications.length,
        verifiedAttempts: verifiedCount,
        flaggedAttempts: flaggedCount,
        blockedAttempts: blockedCount,
        needsReviewAttempts: needsReviewCount,
        casesRequiringReview: openReviewCases,
        suspiciousExposure: Number(suspiciousExposure.toFixed(2)),
      },
      verificationActivity: Array.from(activityByMonth.values()).sort((a, b) =>
        a.period.localeCompare(b.period)
      ),
      violationDistribution: Array.from(violationMap.entries())
        .map(([category, count]) => ({ category, count }))
        .sort((a, b) => b.count - a.count),
      recentAttempts: userVerifications.slice(0, 8).map((v) => {
        const m = mandateById.get(v.mandateId);
        const a = attemptById.get(v.paymentAttemptId);
        return {
          id: v.id,
          paymentAttemptId: v.paymentAttemptId,
          attemptUid: a?.attemptUid ?? `PAY-${v.paymentAttemptId}`,
          mandateId: v.mandateId,
          mandateCode: m?.mandateCode ?? 'Unknown',
          merchantName: a?.attemptedMerchantName ?? m?.merchantName ?? 'Unknown',
          customerName: m?.customerName ?? 'Unknown',
          attemptTimestamp: v.attemptTimestamp.toISOString(),
          attemptedAmount: v.attemptedAmount,
          expectedAuthorizedAmount: v.expectedAuthorizedAmount,
          currency: v.currency,
          status: v.status,
          severity: v.severity,
          violationCategories: v.violationCategories,
          isDemo: v.isDemo,
        };
      }),
      recentInvestigations: userCases.slice(0, 5).map((c) => {
        const m = mandateById.get(c.mandateId);
        return {
          ...c,
          mandateCode: m?.mandateCode ?? 'Unknown',
          merchantName: m?.merchantName ?? 'Unknown',
        };
      }),
      mandatesRequiringAttention: mandatesNeedingAttention,
      recentActivity: recentAudit,
    });
  } catch (error) {
    console.error('Overview fetch error:', error);
    return res.status(500).json({ error: 'Unable to load dashboard overview.' });
  }
});

router.get('/search', async (req: AuthRequest, res) => {
  try {
    const userId = req.dbUser!.id;
    const q = typeof req.query.q === 'string' ? req.query.q.trim().toLowerCase() : '';
    if (!q) {
      return res.json({ mandates: [], attempts: [], investigations: [] });
    }

    const [allMandates, allAttempts, allCases] = await Promise.all([
      db.select().from(mandates).where(eq(mandates.userId, userId)),
      db.select().from(paymentAttempts).where(eq(paymentAttempts.userId, userId)),
      db.select().from(investigationCases).where(eq(investigationCases.userId, userId)),
    ]);

    return res.json({
      mandates: allMandates
        .filter(
          (m) =>
            m.mandateCode.toLowerCase().includes(q) ||
            m.customerName.toLowerCase().includes(q) ||
            m.merchantName.toLowerCase().includes(q) ||
            m.customerId.toLowerCase().includes(q)
        )
        .slice(0, 6),
      attempts: allAttempts
        .filter(
          (a) =>
            a.attemptUid.toLowerCase().includes(q) ||
            a.attemptedMerchantName.toLowerCase().includes(q) ||
            String(a.attemptedAmount).includes(q)
        )
        .slice(0, 6),
      investigations: allCases
        .filter(
          (c) => c.caseUid.toLowerCase().includes(q) || c.title.toLowerCase().includes(q)
        )
        .slice(0, 6),
    });
  } catch (error) {
    console.error('Global search error:', error);
    return res.status(500).json({ error: 'Search failed.' });
  }
});

router.get('/notifications', async (req: AuthRequest, res) => {
  try {
    const userId = req.dbUser!.id;
    const [flaggedVers, openCases] = await Promise.all([
      db
        .select()
        .from(verificationResults)
        .where(eq(verificationResults.userId, userId))
        .orderBy(desc(verificationResults.verifiedAt))
        .limit(15),
      db
        .select()
        .from(investigationCases)
        .where(eq(investigationCases.userId, userId))
        .orderBy(desc(investigationCases.updatedAt))
        .limit(10),
    ]);

    const items = [
      ...flaggedVers
        .filter((v) => v.status !== 'VERIFIED')
        .slice(0, 6)
        .map((v) => ({
          id: `ver-${v.id}`,
          type: v.status,
          title: `${v.status} debit attempt (${v.currency} ${v.attemptedAmount})`,
          subtitle: `Expected ${v.currency} ${v.expectedAuthorizedAmount} · Severity ${v.severity}`,
          timestamp: v.verifiedAt.toISOString(),
          targetTab: 'replay',
          mandateId: v.mandateId,
          paymentAttemptId: v.paymentAttemptId,
          isDemo: v.isDemo,
        })),
      ...openCases
        .filter((c) => c.status !== 'CLOSED')
        .slice(0, 4)
        .map((c) => ({
          id: `case-${c.id}`,
          type: 'INVESTIGATION',
          title: `${c.caseUid}: ${c.title}`,
          subtitle: `Status ${c.status.replace('_', ' ')} · Severity ${c.severity}`,
          timestamp: c.updatedAt.toISOString(),
          targetTab: 'investigations',
          caseId: c.id,
          isDemo: c.isDemo,
        })),
    ].sort((a, b) => b.timestamp.localeCompare(a.timestamp));

    return res.json({ notifications: items });
  } catch (error) {
    console.error('Notifications error:', error);
    return res.status(500).json({ error: 'Unable to load notifications.' });
  }
});

// ============================================================
// MANDATE MANAGEMENT & APPEND-ONLY EVENTS
// ============================================================

const createMandateSchema = z.object({
  mandateCode: z.string().trim().min(3).max(60),
  customerId: z.string().trim().min(2).max(60),
  customerName: z.string().trim().min(2).max(120),
  merchantId: z.string().trim().min(2).max(60),
  merchantName: z.string().trim().min(2).max(120),
  authorizedAmount: z.number().positive(),
  currency: z.string().trim().min(3).max(6).default('INR'),
  billingFrequency: z.enum(['DAILY', 'WEEKLY', 'MONTHLY', 'QUARTERLY', 'YEARLY', 'AS_PRESENTED']),
  billingSchedule: z.string().trim().min(2).max(120),
  billingDayOfMonth: z.number().int().min(1).max(31).nullable().optional(),
  requireApprovalForDecrease: z.boolean().optional().default(false),
  startDate: z.string().min(8),
  endDate: z.string().nullable().optional(),
  originalConsentTimestamp: z.string().optional(),
  consentEvidenceRef: z.string().trim().max(120).nullable().optional(),
  conditions: z.string().trim().max(1000).nullable().optional(),
  status: z.enum(['ACTIVE', 'PAUSED', 'REVOKED', 'EXPIRED', 'NEEDS_REVIEW', 'PENDING_CONSENT']).optional(),
});

router.get('/mandates', async (req: AuthRequest, res) => {
  try {
    const userId = req.dbUser!.id;
    const demoOnly = scopeFilter(req.query.scope);
    const cond =
      demoOnly === null
        ? eq(mandates.userId, userId)
        : and(eq(mandates.userId, userId), eq(mandates.isDemo, demoOnly));

    const [rows, allEvents, allVers] = await Promise.all([
      db.select().from(mandates).where(cond).orderBy(desc(mandates.createdAt)),
      db.select().from(mandateEvents).where(eq(mandateEvents.userId, userId)),
      db
        .select()
        .from(verificationResults)
        .where(eq(verificationResults.userId, userId))
        .orderBy(desc(verificationResults.attemptTimestamp)),
    ]);

    const eventCounts = new Map<number, number>();
    for (const e of allEvents) {
      eventCounts.set(e.mandateId, (eventCounts.get(e.mandateId) ?? 0) + 1);
    }

    const latestVerByMandate = new Map<number, (typeof allVers)[0]>();
    for (const v of allVers) {
      if (!latestVerByMandate.has(v.mandateId)) {
        latestVerByMandate.set(v.mandateId, v);
      }
    }

    return res.json({
      mandates: rows.map((m) => ({
        ...m,
        eventCount: eventCounts.get(m.id) ?? 0,
        hasMerchantDrift:
          Math.abs(m.currentMerchantAmount - m.authorizedAmount) > 0.01 ||
          m.currentMerchantFrequency !== m.billingFrequency,
        latestVerificationStatus: latestVerByMandate.get(m.id)?.status ?? null,
      })),
    });
  } catch (error) {
    console.error('List mandates error:', error);
    return res.status(500).json({ error: 'Unable to load mandates.' });
  }
});

router.post('/mandates', async (req: AuthRequest, res) => {
  try {
    const parsed = createMandateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: parsed.error.issues[0]?.message ?? 'Invalid mandate details',
        fieldErrors: parsed.error.flatten().fieldErrors,
      });
    }

    const d = parsed.data;
    const userId = req.dbUser!.id;
    const hasEvidence = Boolean(d.consentEvidenceRef && d.consentEvidenceRef.trim().length > 0);
    const derivedStatus = d.status ?? (hasEvidence ? 'ACTIVE' : 'NEEDS_REVIEW');
    const consentTs = new Date(d.originalConsentTimestamp || d.startDate);
    const startDate = new Date(d.startDate);
    const endDate = d.endDate ? new Date(d.endDate) : null;

    if (Number.isNaN(consentTs.getTime()) || Number.isNaN(startDate.getTime())) {
      return res.status(400).json({ error: 'Invalid start date or consent timestamp.' });
    }

    const existingCode = await db
      .select()
      .from(mandates)
      .where(and(eq(mandates.userId, userId), eq(mandates.mandateCode, d.mandateCode)))
      .limit(1);
    if (existingCode.length > 0) {
      return res.status(409).json({
        error: `Mandate ID "${d.mandateCode}" already exists in your workspace.`,
      });
    }

    const created = await db.transaction(async (tx) => {
      const [m] = await tx
        .insert(mandates)
        .values({
          userId,
          mandateCode: d.mandateCode,
          customerId: d.customerId,
          customerName: d.customerName,
          merchantId: d.merchantId,
          merchantName: d.merchantName,
          authorizedAmount: d.authorizedAmount,
          currentMerchantAmount: d.authorizedAmount,
          currency: d.currency.toUpperCase(),
          billingFrequency: d.billingFrequency,
          currentMerchantFrequency: d.billingFrequency,
          billingSchedule: d.billingSchedule,
          billingDayOfMonth: d.billingDayOfMonth ?? null,
          requireApprovalForDecrease: d.requireApprovalForDecrease,
          startDate,
          endDate,
          status: derivedStatus,
          originalConsentTimestamp: consentTs,
          consentEvidenceRef: d.consentEvidenceRef ?? null,
          conditions: d.conditions ?? null,
          isDemo: false,
        })
        .returning();

      // Append initial immutable consent event(s)
      await tx.insert(mandateEvents).values({
        eventUid: makeUid('EVT'),
        userId,
        mandateId: m.id,
        eventType: hasEvidence ? 'CONSENT_APPROVED' : 'CONSENT_CREATED',
        eventTimestamp: consentTs,
        previousValue: null,
        newValue: {
          amount: d.authorizedAmount,
          billingFrequency: d.billingFrequency,
          merchantId: d.merchantId,
          merchantName: d.merchantName,
        },
        actor: hasEvidence ? 'CUSTOMER' : 'MERCHANT',
        customerApproved: hasEvidence,
        customerApprovalRef: hasEvidence ? d.consentEvidenceRef : null,
        evidenceRef: d.consentEvidenceRef ?? null,
        evidenceStatus: hasEvidence ? 'VERIFIED' : 'MISSING',
        isDemo: false,
      });

      return m;
    });

    await logAudit(
      userId,
      'MANDATE_CREATED',
      'mandate',
      created.id,
      { mandateCode: created.mandateCode, amount: created.authorizedAmount },
      getClientIp(req)
    );

    return res.status(201).json({ mandate: created });
  } catch (error) {
    console.error('Create mandate error:', error);
    return res.status(500).json({ error: 'Unable to create mandate.' });
  }
});

router.get('/mandates/:id', async (req: AuthRequest, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid mandate ID.' });

    const userId = req.dbUser!.id;
    const rows = await db
      .select()
      .from(mandates)
      .where(and(eq(mandates.id, id), eq(mandates.userId, userId)))
      .limit(1);

    if (rows.length === 0) return res.status(404).json({ error: 'Mandate not found.' });

    const [events, attempts, verifications, docs] = await Promise.all([
      db
        .select()
        .from(mandateEvents)
        .where(and(eq(mandateEvents.mandateId, id), eq(mandateEvents.userId, userId)))
        .orderBy(asc(mandateEvents.eventTimestamp), asc(mandateEvents.id)),
      db
        .select()
        .from(paymentAttempts)
        .where(and(eq(paymentAttempts.mandateId, id), eq(paymentAttempts.userId, userId)))
        .orderBy(desc(paymentAttempts.attemptTimestamp)),
      db
        .select()
        .from(verificationResults)
        .where(and(eq(verificationResults.mandateId, id), eq(verificationResults.userId, userId))),
      db
        .select()
        .from(consentDocuments)
        .where(and(eq(consentDocuments.mandateId, id), eq(consentDocuments.userId, userId))),
    ]);

    const verByAttempt = new Map(verifications.map((v) => [v.paymentAttemptId, v]));

    return res.json({
      mandate: rows[0],
      events,
      paymentAttempts: attempts.map((a) => ({
        ...a,
        verification: verByAttempt.get(a.id) ?? null,
      })),
      documents: docs,
    });
  } catch (error) {
    console.error('Get mandate detail error:', error);
    return res.status(500).json({ error: 'Unable to load mandate details.' });
  }
});

router.patch('/mandates/:id/metadata', async (req: AuthRequest, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid mandate ID.' });

    const schema = z.object({
      customerName: z.string().trim().min(2).max(120).optional(),
      billingSchedule: z.string().trim().min(2).max(120).optional(),
      billingDayOfMonth: z.number().int().min(1).max(31).nullable().optional(),
      conditions: z.string().trim().max(1000).nullable().optional(),
      endDate: z.string().nullable().optional(),
      requireApprovalForDecrease: z.boolean().optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid metadata update' });
    }

    const userId = req.dbUser!.id;
    const existing = await db
      .select()
      .from(mandates)
      .where(and(eq(mandates.id, id), eq(mandates.userId, userId)))
      .limit(1);
    if (existing.length === 0) return res.status(404).json({ error: 'Mandate not found.' });

    // Permitted non-consent metadata ONLY — never modifies authorizedAmount or customer consent terms
    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (parsed.data.customerName !== undefined) updates.customerName = parsed.data.customerName;
    if (parsed.data.billingSchedule !== undefined) updates.billingSchedule = parsed.data.billingSchedule;
    if (parsed.data.billingDayOfMonth !== undefined) {
      updates.billingDayOfMonth = parsed.data.billingDayOfMonth;
    }
    if (parsed.data.conditions !== undefined) updates.conditions = parsed.data.conditions;
    if (parsed.data.requireApprovalForDecrease !== undefined) {
      updates.requireApprovalForDecrease = parsed.data.requireApprovalForDecrease;
    }
    if (parsed.data.endDate !== undefined) {
      updates.endDate = parsed.data.endDate ? new Date(parsed.data.endDate) : null;
    }

    const [updated] = await db
      .update(mandates)
      .set(updates)
      .where(and(eq(mandates.id, id), eq(mandates.userId, userId)))
      .returning();

    await logAudit(userId, 'MANDATE_METADATA_UPDATED', 'mandate', id, updates, getClientIp(req));
    return res.json({ mandate: updated });
  } catch (error) {
    console.error('Update metadata error:', error);
    return res.status(500).json({ error: 'Unable to update mandate metadata.' });
  }
});

const appendEventSchema = z.object({
  eventType: z.enum([
    'CONSENT_CREATED',
    'CONSENT_APPROVED',
    'AMOUNT_MODIFIED',
    'FREQUENCY_MODIFIED',
    'MERCHANT_MODIFIED',
    'MANDATE_PAUSED',
    'MANDATE_RESUMED',
    'MANDATE_REVOKED',
    'MANDATE_EXPIRED',
    'PRE_DEBIT_NOTIFICATION',
  ]),
  eventTimestamp: z.string().min(8),
  actor: z.enum(['CUSTOMER', 'MERCHANT', 'SYSTEM', 'BANK_NPCI', 'ANALYST']),
  newAmount: z.number().positive().optional(),
  newFrequency: z.enum(['DAILY', 'WEEKLY', 'MONTHLY', 'QUARTERLY', 'YEARLY', 'AS_PRESENTED']).optional(),
  newMerchantId: z.string().trim().min(2).max(60).optional(),
  newMerchantName: z.string().trim().min(2).max(120).optional(),
  customerApproved: z.boolean().default(false),
  customerApprovalRef: z.string().trim().max(120).nullable().optional(),
  evidenceRef: z.string().trim().max(120).nullable().optional(),
  evidenceStatus: z.enum(['VERIFIED', 'MISSING', 'AMBIGUOUS', 'NONE']).default('NONE'),
  notes: z.string().trim().max(500).optional(),
  idempotencyKey: z.string().trim().max(100).optional(),
});

router.post('/mandates/:id/events', async (req: AuthRequest, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid mandate ID.' });

    const parsed = appendEventSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid event payload' });
    }

    const userId = req.dbUser!.id;
    const rows = await db
      .select()
      .from(mandates)
      .where(and(eq(mandates.id, id), eq(mandates.userId, userId)))
      .limit(1);
    if (rows.length === 0) return res.status(404).json({ error: 'Mandate not found.' });
    const m = rows[0];
    const d = parsed.data;
    const evTs = new Date(d.eventTimestamp);
    if (Number.isNaN(evTs.getTime())) {
      return res.status(400).json({ error: 'Invalid event timestamp.' });
    }

    // Duplicate idempotency safeguard
    if (d.idempotencyKey) {
      const dup = await db
        .select()
        .from(mandateEvents)
        .where(
          and(
            eq(mandateEvents.mandateId, id),
            eq(mandateEvents.idempotencyKey, d.idempotencyKey)
          )
        )
        .limit(1);
      if (dup.length > 0) {
        return res.json({ event: dup[0], mandate: m, deduplicated: true });
      }
    }

    // Enforce strict consent rule: approved modification MUST have supporting evidence
    const verifiedCustomerConsent = Boolean(
      d.customerApproved &&
        d.evidenceStatus === 'VERIFIED' &&
        ((d.customerApprovalRef && d.customerApprovalRef.length > 0) ||
          (d.evidenceRef && d.evidenceRef.length > 0))
    );

    if (d.customerApproved && !verifiedCustomerConsent && d.evidenceStatus === 'VERIFIED') {
      return res.status(400).json({
        error:
          'Customer-approved modifications with VERIFIED status require an explicit customer approval or evidence reference.',
      });
    }

    let previousValue: Record<string, unknown> | null = null;
    let newValue: Record<string, unknown> | null = null;
    const mandateUpdates: Record<string, unknown> = { updatedAt: new Date() };

    if (d.eventType === 'AMOUNT_MODIFIED') {
      if (!d.newAmount) {
        return res.status(400).json({ error: 'New amount is required for AMOUNT_MODIFIED events.' });
      }
      previousValue = { amount: m.currentMerchantAmount };
      newValue = { amount: d.newAmount };
      // Merchant-side record updates, NEVER auto-overwrites customer authorizedAmount!
      mandateUpdates.currentMerchantAmount = d.newAmount;
    } else if (d.eventType === 'FREQUENCY_MODIFIED') {
      if (!d.newFrequency) {
        return res.status(400).json({ error: 'New billing frequency is required.' });
      }
      previousValue = { billingFrequency: m.currentMerchantFrequency };
      newValue = { billingFrequency: d.newFrequency };
      mandateUpdates.currentMerchantFrequency = d.newFrequency;
    } else if (d.eventType === 'MERCHANT_MODIFIED') {
      if (!d.newMerchantId) {
        return res.status(400).json({ error: 'New merchant ID is required.' });
      }
      previousValue = { merchantId: m.merchantId, merchantName: m.merchantName };
      newValue = {
        merchantId: d.newMerchantId,
        merchantName: d.newMerchantName || m.merchantName,
      };
    } else if (d.eventType === 'MANDATE_PAUSED') {
      previousValue = { status: m.status };
      newValue = { status: 'PAUSED' };
      mandateUpdates.status = 'PAUSED';
    } else if (d.eventType === 'MANDATE_RESUMED') {
      previousValue = { status: m.status };
      newValue = { status: 'ACTIVE' };
      if (m.status === 'PAUSED') {
        mandateUpdates.status = 'ACTIVE';
      }
    } else if (d.eventType === 'MANDATE_REVOKED') {
      previousValue = { status: m.status };
      newValue = { status: 'REVOKED' };
      mandateUpdates.status = 'REVOKED';
    } else if (d.eventType === 'MANDATE_EXPIRED') {
      previousValue = { status: m.status };
      newValue = { status: 'EXPIRED' };
      mandateUpdates.status = 'EXPIRED';
    } else if (d.eventType === 'CONSENT_APPROVED') {
      newValue = {
        amount: d.newAmount ?? m.authorizedAmount,
        billingFrequency: d.newFrequency ?? m.billingFrequency,
        merchantId: m.merchantId,
      };
      if (verifiedCustomerConsent) {
        mandateUpdates.status = 'ACTIVE';
        if (d.evidenceRef) mandateUpdates.consentEvidenceRef = d.evidenceRef;
      }
    }

    const result = await db.transaction(async (tx) => {
      const [ev] = await tx
        .insert(mandateEvents)
        .values({
          eventUid: makeUid('EVT'),
          userId,
          mandateId: id,
          eventType: d.eventType,
          eventTimestamp: evTs,
          previousValue,
          newValue,
          actor: d.actor,
          customerApproved: d.customerApproved,
          customerApprovalRef: d.customerApprovalRef ?? null,
          evidenceRef: d.evidenceRef ?? null,
          evidenceStatus: d.evidenceStatus,
          idempotencyKey: d.idempotencyKey ?? null,
          metadata: d.notes ? { notes: d.notes } : null,
          isDemo: m.isDemo,
        })
        .returning();

      const [updatedMandate] = await tx
        .update(mandates)
        .set(mandateUpdates)
        .where(and(eq(mandates.id, id), eq(mandates.userId, userId)))
        .returning();

      return { event: ev, mandate: updatedMandate };
    });

    await logAudit(
      userId,
      'MANDATE_EVENT_APPENDED',
      'mandate_event',
      result.event.eventUid,
      { mandateId: id, eventType: d.eventType, customerApproved: d.customerApproved },
      getClientIp(req)
    );

    return res.status(201).json(result);
  } catch (error) {
    console.error('Append event error:', error);
    return res.status(500).json({ error: 'Unable to record mandate event.' });
  }
});

router.delete('/mandates/:id', async (req: AuthRequest, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid mandate ID.' });

    const userId = req.dbUser!.id;
    const deleted = await db
      .delete(mandates)
      .where(and(eq(mandates.id, id), eq(mandates.userId, userId)))
      .returning();

    if (deleted.length === 0) return res.status(404).json({ error: 'Mandate not found.' });

    await logAudit(
      userId,
      'MANDATE_DELETED',
      'mandate',
      id,
      { mandateCode: deleted[0].mandateCode },
      getClientIp(req)
    );
    return res.json({ ok: true });
  } catch (error) {
    console.error('Delete mandate error:', error);
    return res.status(500).json({ error: 'Unable to delete mandate.' });
  }
});

// ============================================================
// AI CONSENT DOCUMENT UPLOAD & EXTRACTION
// ============================================================

router.get('/documents', async (req: AuthRequest, res) => {
  try {
    const userId = req.dbUser!.id;
    const [docs, extractions, userMandates] = await Promise.all([
      db
        .select()
        .from(consentDocuments)
        .where(eq(consentDocuments.userId, userId))
        .orderBy(desc(consentDocuments.uploadedAt)),
      db
        .select()
        .from(consentExtractionResults)
        .where(eq(consentExtractionResults.userId, userId))
        .orderBy(desc(consentExtractionResults.createdAt)),
      db.select().from(mandates).where(eq(mandates.userId, userId)),
    ]);

    const extByDoc = new Map(extractions.map((e) => [e.documentId, e]));
    const mMap = new Map(userMandates.map((m) => [m.id, m]));
    return res.json({
      documents: docs.map((d) => {
        const m = d.mandateId ? mMap.get(d.mandateId) : undefined;
        return {
          ...d,
          mandateCode: m?.mandateCode ?? null,
          customerName: m?.customerName ?? null,
          merchantName: m?.merchantName ?? null,
          extraction: extByDoc.get(d.id) ?? null,
        };
      }),
    });
  } catch (error) {
    console.error('List documents error:', error);
    return res.status(500).json({ error: 'Unable to load consent documents.' });
  }
});

router.post('/documents/extract', aiLimiter, upload.single('file'), async (req: AuthRequest, res) => {
  try {
    const userId = req.dbUser!.id;
    const file = req.file;
    if (!file) {
      return res.status(400).json({ error: 'Please attach a PDF or image consent document.' });
    }

    const validation = validateUploadedFile(file.buffer, file.mimetype);
    if (!validation.valid) {
      return res.status(400).json({ error: validation.error });
    }

    const hash = sha256Buffer(file.buffer);
    const storageRef = makeUid('DOC');
    const safeFileName = file.originalname.replace(/[^a-zA-Z0-9._ -]/g, '_').slice(0, 120);

    const [docRow] = await db
      .insert(consentDocuments)
      .values({
        userId,
        fileName: safeFileName,
        mimeType: file.mimetype,
        fileSizeBytes: file.size,
        sha256Hash: hash,
        storageRef,
        rawTextSnippet:
          file.mimetype === 'text/plain'
            ? file.buffer.toString('utf8').slice(0, 1000)
            : `Binary ${file.mimetype} (${file.size} bytes, SHA-256: ${hash.slice(0, 16)}...)`,
        isDemo: false,
      })
      .returning();

    const aiResult = await extractConsentDocumentWithAI({
      fileBuffer: file.buffer,
      mimeType: file.mimetype,
      fileName: safeFileName,
    });

    const [extractionRow] = await db
      .insert(consentExtractionResults)
      .values({
        userId,
        documentId: docRow.id,
        provider: aiResult.provider,
        extractedJson: aiResult.extracted,
        confidenceScore: aiResult.extracted.confidenceScore,
        missingFields: aiResult.extracted.missingFields,
        ambiguousFields: aiResult.extracted.ambiguousFields,
        reviewStatus: aiResult.reviewStatus,
      })
      .returning();

    await logAudit(
      userId,
      'CONSENT_DOCUMENT_EXTRACTED',
      'consent_document',
      docRow.id,
      {
        fileName: safeFileName,
        provider: aiResult.provider,
        extractionStatus: aiResult.extractionStatus,
        confidence: aiResult.extracted.confidenceScore,
        reviewStatus: aiResult.reviewStatus,
      },
      getClientIp(req)
    );

    return res.status(201).json({
      document: docRow,
      extraction: extractionRow,
      extracted: aiResult.extracted,
      reviewStatus: aiResult.reviewStatus,
      provider: aiResult.provider,
      extractionStatus: aiResult.extractionStatus,
      warningMessage: aiResult.warningMessage,
    });
  } catch (error) {
    console.error('Document extraction error:', error);
    return res.status(500).json({ error: 'Consent document extraction failed.' });
  }
});

router.post('/documents/extractions/:id/commit', async (req: AuthRequest, res) => {
  try {
    const extractionId = Number(req.params.id);
    if (!Number.isInteger(extractionId)) {
      return res.status(400).json({ error: 'Invalid extraction ID.' });
    }

    const userId = req.dbUser!.id;
    const extRows = await db
      .select()
      .from(consentExtractionResults)
      .where(
        and(
          eq(consentExtractionResults.id, extractionId),
          eq(consentExtractionResults.userId, userId)
        )
      )
      .limit(1);
    if (extRows.length === 0) {
      return res.status(404).json({ error: 'Extraction record not found.' });
    }
    const ext = extRows[0];

    const parsed = createMandateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: parsed.error.issues[0]?.message ?? 'Please review and complete required fields.',
      });
    }
    const d = parsed.data;

    const existingCode = await db
      .select()
      .from(mandates)
      .where(and(eq(mandates.userId, userId), eq(mandates.mandateCode, d.mandateCode)))
      .limit(1);
    if (existingCode.length > 0) {
      return res.status(409).json({
        error: `Mandate ID "${d.mandateCode}" already exists. Choose a unique Mandate ID.`,
      });
    }

    const docRows = await db
      .select()
      .from(consentDocuments)
      .where(eq(consentDocuments.id, ext.documentId))
      .limit(1);
    const docRef = docRows[0]?.storageRef ?? `DOC-${ext.documentId}`;

    const consentTs = new Date(d.originalConsentTimestamp || d.startDate);
    const startDate = new Date(d.startDate);
    const endDate = d.endDate ? new Date(d.endDate) : null;
    const markNeedsReview = d.status === 'NEEDS_REVIEW' || ext.confidenceScore < 0.55;
    const finalStatus = d.status ?? (markNeedsReview ? 'NEEDS_REVIEW' : 'ACTIVE');

    const createdMandate = await db.transaction(async (tx) => {
      const [m] = await tx
        .insert(mandates)
        .values({
          userId,
          mandateCode: d.mandateCode,
          customerId: d.customerId,
          customerName: d.customerName,
          merchantId: d.merchantId,
          merchantName: d.merchantName,
          authorizedAmount: d.authorizedAmount,
          currentMerchantAmount: d.authorizedAmount,
          currency: d.currency.toUpperCase(),
          billingFrequency: d.billingFrequency,
          currentMerchantFrequency: d.billingFrequency,
          billingSchedule: d.billingSchedule,
          billingDayOfMonth: d.billingDayOfMonth ?? null,
          requireApprovalForDecrease: d.requireApprovalForDecrease,
          startDate,
          endDate,
          status: finalStatus,
          originalConsentTimestamp: consentTs,
          consentEvidenceRef: d.consentEvidenceRef || docRef,
          conditions: d.conditions ?? null,
          isDemo: false,
        })
        .returning();

      await tx.insert(mandateEvents).values({
        eventUid: makeUid('EVT'),
        userId,
        mandateId: m.id,
        eventType: finalStatus === 'NEEDS_REVIEW' ? 'CONSENT_CREATED' : 'CONSENT_APPROVED',
        eventTimestamp: consentTs,
        newValue: {
          amount: d.authorizedAmount,
          billingFrequency: d.billingFrequency,
          merchantId: d.merchantId,
          merchantName: d.merchantName,
        },
        actor: 'CUSTOMER',
        customerApproved: finalStatus !== 'NEEDS_REVIEW',
        customerApprovalRef: finalStatus !== 'NEEDS_REVIEW' ? d.consentEvidenceRef || docRef : null,
        evidenceRef: d.consentEvidenceRef || docRef,
        evidenceStatus: finalStatus === 'NEEDS_REVIEW' ? 'AMBIGUOUS' : 'VERIFIED',
        metadata: { sourceDocumentId: ext.documentId, extractionId: ext.id, humanReviewed: true },
        isDemo: false,
      });

      await tx
        .update(consentDocuments)
        .set({ mandateId: m.id })
        .where(eq(consentDocuments.id, ext.documentId));

      await tx
        .update(consentExtractionResults)
        .set({
          mandateId: m.id,
          correctedJson: d,
          reviewStatus: 'REVIEWED_SAVED',
          reviewedAt: new Date(),
        })
        .where(eq(consentExtractionResults.id, ext.id));

      return m;
    });

    await logAudit(
      userId,
      'EXTRACTION_COMMITTED_TO_MANDATE',
      'mandate',
      createdMandate.id,
      { extractionId, documentId: ext.documentId, mandateCode: createdMandate.mandateCode },
      getClientIp(req)
    );

    return res.status(201).json({ mandate: createdMandate });
  } catch (error) {
    console.error('Commit extraction error:', error);
    return res.status(500).json({ error: 'Unable to save reviewed mandate.' });
  }
});

// ============================================================
// PAYMENT VERIFICATION & CONSENT DRIFT REPLAY
// ============================================================

router.get('/verifications', async (req: AuthRequest, res) => {
  try {
    const userId = req.dbUser!.id;
    const demoOnly = scopeFilter(req.query.scope);
    const cond =
      demoOnly === null
        ? eq(verificationResults.userId, userId)
        : and(eq(verificationResults.userId, userId), eq(verificationResults.isDemo, demoOnly));

    const [vers, allMandates, allAttempts, allViolations, allCases] = await Promise.all([
      db
        .select()
        .from(verificationResults)
        .where(cond)
        .orderBy(desc(verificationResults.attemptTimestamp)),
      db.select().from(mandates).where(eq(mandates.userId, userId)),
      db.select().from(paymentAttempts).where(eq(paymentAttempts.userId, userId)),
      db.select().from(violations).where(eq(violations.userId, userId)),
      db.select().from(investigationCases).where(eq(investigationCases.userId, userId)),
    ]);

    const mMap = new Map(allMandates.map((m) => [m.id, m]));
    const aMap = new Map(allAttempts.map((a) => [a.id, a]));
    const cByVer = new Map(allCases.map((c) => [c.verificationResultId, c]));
    const violByVer = new Map<number, typeof allViolations>();
    for (const v of allViolations) {
      const list = violByVer.get(v.verificationResultId) ?? [];
      list.push(v);
      violByVer.set(v.verificationResultId, list);
    }

    return res.json({
      verifications: vers.map((v) => {
        const m = mMap.get(v.mandateId);
        const a = aMap.get(v.paymentAttemptId);
        const c = cByVer.get(v.id);
        return {
          ...v,
          attemptUid: a?.attemptUid ?? `PAY-${v.paymentAttemptId}`,
          attemptedMerchantId: a?.attemptedMerchantId ?? m?.merchantId ?? '',
          attemptedMerchantName: a?.attemptedMerchantName ?? m?.merchantName ?? '',
          attemptedFrequency: a?.attemptedFrequency ?? m?.billingFrequency ?? '',
          mandateCode: m?.mandateCode ?? 'Unknown',
          mandateStatus: m?.status ?? 'UNKNOWN',
          reconstructedMandateStatus:
            (v.replaySnapshot as { reconstructedAuthorization?: { status?: string } } | null)
              ?.reconstructedAuthorization?.status ??
            m?.status ??
            'UNKNOWN',
          customerName: m?.customerName ?? 'Unknown',
          merchantName: m?.merchantName ?? 'Unknown',
          violations: violByVer.get(v.id) ?? [],
          investigationCaseId: c?.id ?? null,
          investigationCaseUid: c?.caseUid ?? null,
        };
      }),
    });
  } catch (error) {
    console.error('List verifications error:', error);
    return res.status(500).json({ error: 'Unable to load payment verifications.' });
  }
});

router.get('/verifications/:id/evidence', async (req: AuthRequest, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid verification ID.' });

    const userId = req.dbUser!.id;
    const verRows = await db
      .select()
      .from(verificationResults)
      .where(and(eq(verificationResults.id, id), eq(verificationResults.userId, userId)))
      .limit(1);
    if (verRows.length === 0) {
      return res.status(404).json({ error: 'Verification record not found.' });
    }
    const ver = verRows[0];

    const [mRows, aRows, violRows, events, docs, caseRows] = await Promise.all([
      db
        .select()
        .from(mandates)
        .where(and(eq(mandates.id, ver.mandateId), eq(mandates.userId, userId)))
        .limit(1),
      db
        .select()
        .from(paymentAttempts)
        .where(and(eq(paymentAttempts.id, ver.paymentAttemptId), eq(paymentAttempts.userId, userId)))
        .limit(1),
      db
        .select()
        .from(violations)
        .where(and(eq(violations.verificationResultId, ver.id), eq(violations.userId, userId))),
      db
        .select()
        .from(mandateEvents)
        .where(and(eq(mandateEvents.mandateId, ver.mandateId), eq(mandateEvents.userId, userId)))
        .orderBy(asc(mandateEvents.eventTimestamp), asc(mandateEvents.id)),
      db
        .select()
        .from(consentDocuments)
        .where(
          and(eq(consentDocuments.mandateId, ver.mandateId), eq(consentDocuments.userId, userId))
        )
        .orderBy(desc(consentDocuments.uploadedAt)),
      db
        .select()
        .from(investigationCases)
        .where(
          and(
            eq(investigationCases.verificationResultId, ver.id),
            eq(investigationCases.userId, userId)
          )
        )
        .limit(1),
    ]);

    const linkedCase = caseRows[0] ?? null;
    const notes = linkedCase
      ? await db
          .select()
          .from(investigationNotes)
          .where(and(eq(investigationNotes.caseId, linkedCase.id), eq(investigationNotes.userId, userId)))
          .orderBy(desc(investigationNotes.createdAt))
      : [];

    return res.json({
      verification: ver,
      mandate: mRows[0] ?? null,
      paymentAttempt: aRows[0] ?? null,
      violations: violRows,
      events,
      documents: docs,
      caseData: linkedCase,
      notes,
    });
  } catch (error) {
    console.error('Get verification evidence error:', error);
    return res.status(500).json({ error: 'Unable to load verification evidence.' });
  }
});

const simulateAttemptSchema = z.object({
  mandateId: z.number().int().positive(),
  attemptedAmount: z.number().positive(),
  currency: z.string().trim().min(3).max(6).optional(),
  attemptTimestamp: z.string().min(8),
  attemptedMerchantId: z.string().trim().min(2).max(60).optional(),
  attemptedMerchantName: z.string().trim().min(2).max(120).optional(),
  attemptedFrequency: z
    .enum(['DAILY', 'WEEKLY', 'MONTHLY', 'QUARTERLY', 'YEARLY', 'AS_PRESENTED'])
    .optional(),
  generateAiExplanation: z.boolean().optional().default(true),
});

router.post('/verifications/simulate', async (req: AuthRequest, res) => {
  try {
    const parsed = simulateAttemptSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: parsed.error.issues[0]?.message ?? 'Invalid payment attempt details.',
      });
    }

    const userId = req.dbUser!.id;
    const d = parsed.data;
    const attemptTs = new Date(d.attemptTimestamp);
    if (Number.isNaN(attemptTs.getTime())) {
      return res.status(400).json({ error: 'Invalid attempt timestamp.' });
    }

    const mRows = await db
      .select()
      .from(mandates)
      .where(and(eq(mandates.id, d.mandateId), eq(mandates.userId, userId)))
      .limit(1);
    if (mRows.length === 0) return res.status(404).json({ error: 'Mandate not found.' });
    const mandate = mRows[0];

    const [events, existingAttempts, existingVers] = await Promise.all([
      db
        .select()
        .from(mandateEvents)
        .where(and(eq(mandateEvents.mandateId, mandate.id), eq(mandateEvents.userId, userId)))
        .orderBy(asc(mandateEvents.eventTimestamp), asc(mandateEvents.id)),
      db
        .select()
        .from(paymentAttempts)
        .where(and(eq(paymentAttempts.mandateId, mandate.id), eq(paymentAttempts.userId, userId))),
      db
        .select()
        .from(verificationResults)
        .where(
          and(
            eq(verificationResults.mandateId, mandate.id),
            eq(verificationResults.userId, userId)
          )
        ),
    ]);

    const verStatusByAttemptId = new Map(existingVers.map((v) => [v.paymentAttemptId, v.status]));
    const attemptUid = makeUid('PAY');
    const currency = (d.currency ?? mandate.currency).toUpperCase();
    const attemptedMerchantId = d.attemptedMerchantId ?? mandate.merchantId;
    const attemptedMerchantName = d.attemptedMerchantName ?? mandate.merchantName;
    const attemptedFrequency = d.attemptedFrequency ?? mandate.currentMerchantFrequency;

    const engineOutput = verifyPaymentAttempt(
      mandate,
      events.map((e) => ({
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
        attemptTimestamp: attemptTs,
        attemptedAmount: d.attemptedAmount,
        currency,
        attemptedMerchantId,
        attemptedMerchantName,
        attemptedFrequency,
      },
      existingAttempts.map((pa) => ({
        attemptUid: pa.attemptUid,
        attemptTimestamp: pa.attemptTimestamp,
        attemptedAmount: pa.attemptedAmount,
        currency: pa.currency,
        status: verStatusByAttemptId.get(pa.id),
      }))
    );

    const forensic = d.generateAiExplanation
      ? await generateForensicExplanation(engineOutput, mandate.mandateCode, attemptedMerchantName)
      : {
          explanation: engineOutput.deterministicExplanation,
          provider: 'deterministic-engine',
        };

    const saved = await db.transaction(async (tx) => {
      const [attemptRow] = await tx
        .insert(paymentAttempts)
        .values({
          attemptUid,
          userId,
          mandateId: mandate.id,
          attemptTimestamp: attemptTs,
          attemptedAmount: d.attemptedAmount,
          currency,
          attemptedMerchantId,
          attemptedMerchantName,
          attemptedFrequency,
          isDemo: mandate.isDemo,
        })
        .returning();

      const [verRow] = await tx
        .insert(verificationResults)
        .values({
          userId,
          paymentAttemptId: attemptRow.id,
          mandateId: mandate.id,
          attemptTimestamp: attemptTs,
          attemptedAmount: d.attemptedAmount,
          expectedAuthorizedAmount: engineOutput.expectedAuthorizedAmount,
          currency,
          status: engineOutput.status,
          severity: engineOutput.severity,
          anomalyScore: engineOutput.anomalyScore,
          violationCategories: engineOutput.violationCategories,
          relevantEventIds: engineOutput.relevantEventIds,
          replaySnapshot: engineOutput.replay,
          deterministicExplanation: engineOutput.deterministicExplanation,
          aiExplanation: forensic.explanation,
          aiExplanationProvider: forensic.provider,
          isDemo: mandate.isDemo,
        })
        .returning();

      const savedViolations = [];
      for (const v of engineOutput.violations) {
        const [vRow] = await tx
          .insert(violations)
          .values({
            userId,
            verificationResultId: verRow.id,
            mandateId: mandate.id,
            violationType: v.violationType,
            severity: v.severity,
            classification: v.classification,
            expectedAuthorization: v.expectedAuthorization,
            actualAttempt: v.actualAttempt,
            relevantEventIds: v.relevantEventIds,
            evidenceRefs: v.evidenceRefs,
            explanation: v.explanation,
            isDemo: mandate.isDemo,
          })
          .returning();
        savedViolations.push(vRow);
      }

      // Append chronological debit event to mandate ledger (payment events are never customer consent approvals)
      await tx.insert(mandateEvents).values({
        eventUid: makeUid('EVT'),
        userId,
        mandateId: mandate.id,
        eventType: engineOutput.status === 'VERIFIED' ? 'DEBIT_PROCESSED' : 'DEBIT_REJECTED',
        eventTimestamp: attemptTs,
        newValue: {
          amount: d.attemptedAmount,
          attemptUid,
          verificationStatus: engineOutput.status,
        },
        actor: 'SYSTEM',
        customerApproved: false,
        evidenceRef: attemptUid,
        evidenceStatus: engineOutput.status === 'VERIFIED' ? 'VERIFIED' : 'NONE',
        isDemo: mandate.isDemo,
      });

      return { attempt: attemptRow, verification: verRow, violations: savedViolations };
    });

    await logAudit(
      userId,
      'PAYMENT_VERIFIED',
      'payment_attempt',
      saved.attempt.attemptUid,
      {
        mandateCode: mandate.mandateCode,
        attemptedAmount: d.attemptedAmount,
        expectedAmount: engineOutput.expectedAuthorizedAmount,
        status: engineOutput.status,
      },
      getClientIp(req)
    );

    return res.status(201).json({
      ...saved,
      engineOutput,
    });
  } catch (error) {
    console.error('Simulate payment verification error:', error);
    return res.status(500).json({ error: 'Unable to verify payment attempt.' });
  }
});

router.post('/verifications/:id/explain', aiLimiter, async (req: AuthRequest, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid verification ID.' });

    const userId = req.dbUser!.id;
    const rows = await db
      .select()
      .from(verificationResults)
      .where(and(eq(verificationResults.id, id), eq(verificationResults.userId, userId)))
      .limit(1);
    if (rows.length === 0) return res.status(404).json({ error: 'Verification record not found.' });
    const ver = rows[0];

    const [mRows, aRows, vRows] = await Promise.all([
      db.select().from(mandates).where(eq(mandates.id, ver.mandateId)).limit(1),
      db.select().from(paymentAttempts).where(eq(paymentAttempts.id, ver.paymentAttemptId)).limit(1),
      db.select().from(violations).where(eq(violations.verificationResultId, ver.id)),
    ]);

    const mandate = mRows[0];
    const attempt = aRows[0];

    const forensic = await generateForensicExplanation(
      {
        status: ver.status as any,
        severity: ver.severity as any,
        expectedAuthorizedAmount: ver.expectedAuthorizedAmount,
        attemptedAmount: ver.attemptedAmount,
        amountDelta: Number((ver.attemptedAmount - ver.expectedAuthorizedAmount).toFixed(2)),
        currency: ver.currency,
        anomalyScore: ver.anomalyScore,
        violations: vRows.map((v) => ({
          violationType: v.violationType as any,
          severity: v.severity as any,
          classification: v.classification as any,
          relevantEventIds: (v.relevantEventIds as string[]) ?? [],
          expectedAuthorization: (v.expectedAuthorization as Record<string, unknown>) ?? {},
          actualAttempt: (v.actualAttempt as Record<string, unknown>) ?? {},
          explanation: v.explanation,
          evidenceRefs: (v.evidenceRefs as string[]) ?? [],
        })),
        violationCategories: (ver.violationCategories as any) ?? [],
        relevantEventIds: (ver.relevantEventIds as string[]) ?? [],
        replay: ver.replaySnapshot as any,
        deterministicExplanation: ver.deterministicExplanation,
      },
      mandate?.mandateCode ?? 'UNKNOWN',
      attempt?.attemptedMerchantName ?? mandate?.merchantName ?? 'Merchant'
    );

    const [updated] = await db
      .update(verificationResults)
      .set({
        aiExplanation: forensic.explanation,
        aiExplanationProvider: forensic.provider,
      })
      .where(eq(verificationResults.id, ver.id))
      .returning();

    return res.json({
      verification: updated,
      explanation: forensic.explanation,
      provider: forensic.provider,
    });
  } catch (error) {
    console.error('Forensic explanation error:', error);
    return res.status(500).json({ error: 'Unable to generate forensic explanation.' });
  }
});

// Signature Feature: Dynamic Consent Drift Replay Endpoint
router.post('/replay', async (req: AuthRequest, res) => {
  try {
    const schema = z.object({
      mandateId: z.number().int().positive(),
      paymentAttemptId: z.number().int().positive().optional(),
      asOfTimestamp: z.string().optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Valid mandateId is required for replay.' });
    }

    const userId = req.dbUser!.id;
    const { mandateId, paymentAttemptId, asOfTimestamp } = parsed.data;

    const mRows = await db
      .select()
      .from(mandates)
      .where(and(eq(mandates.id, mandateId), eq(mandates.userId, userId)))
      .limit(1);
    if (mRows.length === 0) return res.status(404).json({ error: 'Mandate not found.' });
    const mandate = mRows[0];

    const [events, attempts, vers] = await Promise.all([
      db
        .select()
        .from(mandateEvents)
        .where(and(eq(mandateEvents.mandateId, mandate.id), eq(mandateEvents.userId, userId)))
        .orderBy(asc(mandateEvents.eventTimestamp), asc(mandateEvents.id)),
      db
        .select()
        .from(paymentAttempts)
        .where(and(eq(paymentAttempts.mandateId, mandate.id), eq(paymentAttempts.userId, userId)))
        .orderBy(desc(paymentAttempts.attemptTimestamp)),
      db
        .select()
        .from(verificationResults)
        .where(
          and(
            eq(verificationResults.mandateId, mandate.id),
            eq(verificationResults.userId, userId)
          )
        ),
    ]);

    const verByAttemptId = new Map(vers.map((v) => [v.paymentAttemptId, v]));
    const selectedAttempt = paymentAttemptId
      ? attempts.find((a) => a.id === paymentAttemptId) ?? null
      : null;

    const queryTs = asOfTimestamp
      ? new Date(asOfTimestamp)
      : selectedAttempt
        ? selectedAttempt.attemptTimestamp
        : new Date();

    if (Number.isNaN(queryTs.getTime())) {
      return res.status(400).json({ error: 'Invalid historical query timestamp.' });
    }

    const mappedEvents = events.map((e) => ({
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
    }));

    const replay = replayMandateAuthorization(mandate, mappedEvents, queryTs);

    let liveVerification = null;
    let storedVerification = null;

    if (selectedAttempt) {
      storedVerification = verByAttemptId.get(selectedAttempt.id) ?? null;
      const priorAttempts = attempts
        .filter((a) => a.id !== selectedAttempt.id)
        .map((a) => ({
          attemptUid: a.attemptUid,
          attemptTimestamp: a.attemptTimestamp,
          attemptedAmount: a.attemptedAmount,
          currency: a.currency,
          status: verByAttemptId.get(a.id)?.status,
        }));

      liveVerification = verifyPaymentAttempt(
        mandate,
        mappedEvents,
        {
          attemptUid: selectedAttempt.attemptUid,
          attemptTimestamp: queryTs,
          attemptedAmount: selectedAttempt.attemptedAmount,
          currency: selectedAttempt.currency,
          attemptedMerchantId: selectedAttempt.attemptedMerchantId,
          attemptedMerchantName: selectedAttempt.attemptedMerchantName,
          attemptedFrequency: selectedAttempt.attemptedFrequency,
        },
        priorAttempts
      );
    }

    return res.json({
      mandate,
      selectedAttempt,
      replay,
      liveVerification,
      storedVerification,
      availableAttempts: attempts.map((a) => ({
        ...a,
        verificationStatus: verByAttemptId.get(a.id)?.status ?? null,
        verificationId: verByAttemptId.get(a.id)?.id ?? null,
      })),
    });
  } catch (error) {
    console.error('Consent Drift Replay error:', error);
    return res.status(500).json({ error: 'Consent Drift Replay failed.' });
  }
});

// ============================================================
// INVESTIGATIONS WORKFLOW
// ============================================================

router.get('/investigations', async (req: AuthRequest, res) => {
  try {
    const userId = req.dbUser!.id;
    const demoOnly = scopeFilter(req.query.scope);
    const cond =
      demoOnly === null
        ? eq(investigationCases.userId, userId)
        : and(eq(investigationCases.userId, userId), eq(investigationCases.isDemo, demoOnly));

    const [cases, allMandates, allAttempts, allVers] = await Promise.all([
      db.select().from(investigationCases).where(cond).orderBy(desc(investigationCases.updatedAt)),
      db.select().from(mandates).where(eq(mandates.userId, userId)),
      db.select().from(paymentAttempts).where(eq(paymentAttempts.userId, userId)),
      db.select().from(verificationResults).where(eq(verificationResults.userId, userId)),
    ]);

    const mMap = new Map(allMandates.map((m) => [m.id, m]));
    const aMap = new Map(allAttempts.map((a) => [a.id, a]));
    const vMap = new Map(allVers.map((v) => [v.id, v]));

    return res.json({
      cases: cases.map((c) => {
        const m = mMap.get(c.mandateId);
        const a = aMap.get(c.paymentAttemptId);
        const v = vMap.get(c.verificationResultId);
        return {
          ...c,
          mandateCode: m?.mandateCode ?? 'Unknown',
          customerName: m?.customerName ?? 'Unknown',
          merchantName: m?.merchantName ?? 'Unknown',
          attemptUid: a?.attemptUid ?? '',
          attemptedAmount: v?.attemptedAmount ?? a?.attemptedAmount ?? 0,
          expectedAuthorizedAmount: v?.expectedAuthorizedAmount ?? m?.authorizedAmount ?? 0,
          currency: v?.currency ?? m?.currency ?? 'INR',
          verificationStatus: v?.status ?? 'FLAGGED',
          violationCategories: (v?.violationCategories as string[]) ?? [],
          decisionReason: v?.deterministicExplanation ?? '',
        };
      }),
    });
  } catch (error) {
    console.error('List investigations error:', error);
    return res.status(500).json({ error: 'Unable to load investigations.' });
  }
});

router.post('/investigations', async (req: AuthRequest, res) => {
  try {
    const schema = z.object({
      verificationResultId: z.number().int().positive(),
      title: z.string().trim().min(4).max(200).optional(),
      severity: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).optional(),
      initialNote: z.string().trim().max(1000).optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid case input' });
    }

    const userId = req.dbUser!.id;
    const verRows = await db
      .select()
      .from(verificationResults)
      .where(
        and(
          eq(verificationResults.id, parsed.data.verificationResultId),
          eq(verificationResults.userId, userId)
        )
      )
      .limit(1);
    if (verRows.length === 0) {
      return res.status(404).json({ error: 'Verification record not found.' });
    }
    const ver = verRows[0];

    const existing = await db
      .select()
      .from(investigationCases)
      .where(
        and(
          eq(investigationCases.verificationResultId, ver.id),
          eq(investigationCases.userId, userId)
        )
      )
      .limit(1);
    if (existing.length > 0) {
      return res.json({ case: existing[0], alreadyExists: true });
    }

    const mRows = await db.select().from(mandates).where(eq(mandates.id, ver.mandateId)).limit(1);
    const m = mRows[0];

    const createdCase = await db.transaction(async (tx) => {
      const [c] = await tx
        .insert(investigationCases)
        .values({
          caseUid: makeUid('INV'),
          userId,
          mandateId: ver.mandateId,
          paymentAttemptId: ver.paymentAttemptId,
          verificationResultId: ver.id,
          title:
            parsed.data.title ||
            `${ver.status} debit on ${m?.mandateCode ?? 'Mandate'} (${ver.currency} ${ver.attemptedAmount})`,
          status: 'OPEN',
          severity: parsed.data.severity ?? ver.severity,
          isDemo: ver.isDemo,
        })
        .returning();

      await tx.insert(investigationNotes).values({
        userId,
        caseId: c.id,
        authorName: req.dbUser!.fullName,
        noteType: 'STATUS_CHANGE',
        content:
          parsed.data.initialNote ||
          `Investigation opened from ${ver.status} payment attempt (${ver.currency} ${ver.attemptedAmount} vs expected ${ver.currency} ${ver.expectedAuthorizedAmount}).`,
      });

      return c;
    });

    await logAudit(
      userId,
      'INVESTIGATION_OPENED',
      'investigation_case',
      createdCase.caseUid,
      { verificationResultId: ver.id, severity: createdCase.severity },
      getClientIp(req)
    );

    return res.status(201).json({ case: createdCase });
  } catch (error) {
    console.error('Open investigation error:', error);
    return res.status(500).json({ error: 'Unable to open investigation case.' });
  }
});

router.get('/investigations/:id', async (req: AuthRequest, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid case ID.' });

    const userId = req.dbUser!.id;
    const rows = await db
      .select()
      .from(investigationCases)
      .where(and(eq(investigationCases.id, id), eq(investigationCases.userId, userId)))
      .limit(1);
    if (rows.length === 0) return res.status(404).json({ error: 'Investigation case not found.' });
    const c = rows[0];

    const [mRows, aRows, vRows, violRows, notes, events, docs] = await Promise.all([
      db.select().from(mandates).where(eq(mandates.id, c.mandateId)).limit(1),
      db.select().from(paymentAttempts).where(eq(paymentAttempts.id, c.paymentAttemptId)).limit(1),
      db
        .select()
        .from(verificationResults)
        .where(eq(verificationResults.id, c.verificationResultId))
        .limit(1),
      db.select().from(violations).where(eq(violations.verificationResultId, c.verificationResultId)),
      db
        .select()
        .from(investigationNotes)
        .where(eq(investigationNotes.caseId, c.id))
        .orderBy(desc(investigationNotes.createdAt)),
      db
        .select()
        .from(mandateEvents)
        .where(eq(mandateEvents.mandateId, c.mandateId))
        .orderBy(asc(mandateEvents.eventTimestamp), asc(mandateEvents.id)),
      db
        .select()
        .from(consentDocuments)
        .where(and(eq(consentDocuments.mandateId, c.mandateId), eq(consentDocuments.userId, userId)))
        .orderBy(desc(consentDocuments.uploadedAt)),
    ]);

    return res.json({
      case: c,
      mandate: mRows[0] ?? null,
      paymentAttempt: aRows[0] ?? null,
      verification: vRows[0] ?? null,
      violations: violRows,
      notes,
      events,
      documents: docs,
    });
  } catch (error) {
    console.error('Get investigation detail error:', error);
    return res.status(500).json({ error: 'Unable to load investigation details.' });
  }
});

router.patch('/investigations/:id', async (req: AuthRequest, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid case ID.' });

    const schema = z.object({
      status: z.enum(['OPEN', 'UNDER_REVIEW', 'CLOSED', 'REOPENED']).optional(),
      severity: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).optional(),
      decision: z
        .enum([
          'CONFIRMED_UNAUTHORIZED',
          'CUSTOMER_AUTHORIZED_VERIFIED',
          'MERCHANT_ERROR',
          'INSUFFICIENT_EVIDENCE',
          'ESCALATED',
        ])
        .nullable()
        .optional(),
      decisionSummary: z.string().trim().max(1500).nullable().optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid update' });
    }

    const userId = req.dbUser!.id;
    const rows = await db
      .select()
      .from(investigationCases)
      .where(and(eq(investigationCases.id, id), eq(investigationCases.userId, userId)))
      .limit(1);
    if (rows.length === 0) return res.status(404).json({ error: 'Investigation case not found.' });
    const existing = rows[0];
    const d = parsed.data;

    const updates: Record<string, unknown> = { updatedAt: new Date() };
    const noteMessages: Array<{ type: string; content: string }> = [];

    if (d.status && d.status !== existing.status) {
      updates.status = d.status;
      if (d.status === 'CLOSED') updates.closedAt = new Date();
      if (d.status === 'REOPENED') updates.closedAt = null;
      noteMessages.push({
        type: 'STATUS_CHANGE',
        content: `Case status changed from ${existing.status} to ${d.status}.`,
      });
    }
    if (d.severity && d.severity !== existing.severity) {
      updates.severity = d.severity;
      noteMessages.push({
        type: 'SEVERITY_CHANGE',
        content: `Case severity updated from ${existing.severity} to ${d.severity}.`,
      });
    }
    if (d.decision !== undefined) {
      updates.decision = d.decision;
      updates.decisionSummary = d.decisionSummary ?? existing.decisionSummary;
      updates.decidedAt = d.decision ? new Date() : null;
      if (d.decision) {
        noteMessages.push({
          type: 'DECISION',
          content: `Human review decision recorded: ${d.decision.replace(/_/g, ' ')}${d.decisionSummary ? ` — ${d.decisionSummary}` : ''}`,
        });
      }
    }

    const updated = await db.transaction(async (tx) => {
      const [c] = await tx
        .update(investigationCases)
        .set(updates)
        .where(and(eq(investigationCases.id, id), eq(investigationCases.userId, userId)))
        .returning();

      for (const msg of noteMessages) {
        await tx.insert(investigationNotes).values({
          userId,
          caseId: id,
          authorName: req.dbUser!.fullName,
          noteType: msg.type,
          content: msg.content,
        });
      }
      return c;
    });

    await logAudit(
      userId,
      'INVESTIGATION_UPDATED',
      'investigation_case',
      existing.caseUid,
      updates,
      getClientIp(req)
    );

    return res.json({ case: updated });
  } catch (error) {
    console.error('Update investigation error:', error);
    return res.status(500).json({ error: 'Unable to update investigation.' });
  }
});

router.post('/investigations/:id/notes', async (req: AuthRequest, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid case ID.' });

    const content = typeof req.body?.content === 'string' ? req.body.content.trim() : '';
    if (content.length < 2 || content.length > 2000) {
      return res.status(400).json({ error: 'Note must be between 2 and 2000 characters.' });
    }

    const userId = req.dbUser!.id;
    const rows = await db
      .select()
      .from(investigationCases)
      .where(and(eq(investigationCases.id, id), eq(investigationCases.userId, userId)))
      .limit(1);
    if (rows.length === 0) return res.status(404).json({ error: 'Investigation case not found.' });

    const [note] = await db
      .insert(investigationNotes)
      .values({
        userId,
        caseId: id,
        authorName: req.dbUser!.fullName,
        noteType: 'NOTE',
        content,
      })
      .returning();

    await db
      .update(investigationCases)
      .set({ updatedAt: new Date() })
      .where(eq(investigationCases.id, id));

    await logAudit(
      userId,
      'INVESTIGATION_NOTE_ADDED',
      'investigation_case',
      rows[0].caseUid,
      { noteId: note.id },
      getClientIp(req)
    );

    return res.status(201).json({ note });
  } catch (error) {
    console.error('Add investigation note error:', error);
    return res.status(500).json({ error: 'Unable to add investigation note.' });
  }
});

// ============================================================
// REPORTS, EVALUATION BENCHMARK, DEMO MODE & AUDIT LOGS
// ============================================================

router.get('/reports', async (req: AuthRequest, res) => {
  try {
    const userId = req.dbUser!.id;
    const demoOnly = scopeFilter(req.query.scope);
    const fromDate =
      typeof req.query.from === 'string' && req.query.from ? new Date(req.query.from) : null;
    const toDate =
      typeof req.query.to === 'string' && req.query.to
        ? new Date(`${req.query.to}T23:59:59.999Z`)
        : null;

    const verConds = [eq(verificationResults.userId, userId)];
    if (demoOnly !== null) verConds.push(eq(verificationResults.isDemo, demoOnly));
    if (fromDate && !Number.isNaN(fromDate.getTime())) {
      verConds.push(gte(verificationResults.attemptTimestamp, fromDate));
    }
    if (toDate && !Number.isNaN(toDate.getTime())) {
      verConds.push(lte(verificationResults.attemptTimestamp, toDate));
    }

    const mandateCond =
      demoOnly === null
        ? eq(mandates.userId, userId)
        : and(eq(mandates.userId, userId), eq(mandates.isDemo, demoOnly));
    const caseCond =
      demoOnly === null
        ? eq(investigationCases.userId, userId)
        : and(eq(investigationCases.userId, userId), eq(investigationCases.isDemo, demoOnly));

    const [vers, userMandates, userCases, userViolations, userAttempts] = await Promise.all([
      db
        .select()
        .from(verificationResults)
        .where(and(...verConds))
        .orderBy(desc(verificationResults.attemptTimestamp)),
      db.select().from(mandates).where(mandateCond),
      db.select().from(investigationCases).where(caseCond),
      db
        .select()
        .from(violations)
        .where(
          demoOnly === null
            ? eq(violations.userId, userId)
            : and(eq(violations.userId, userId), eq(violations.isDemo, demoOnly))
        ),
      db.select().from(paymentAttempts).where(eq(paymentAttempts.userId, userId)),
    ]);

    const verIds = new Set(vers.map((v) => v.id));
    const scopedViolations = userViolations.filter((v) => verIds.has(v.verificationResultId));
    const mMap = new Map(userMandates.map((m) => [m.id, m]));
    const aMap = new Map(userAttempts.map((a) => [a.id, a]));

    const statusSummary = {
      VERIFIED: 0,
      FLAGGED: 0,
      BLOCKED: 0,
      NEEDS_REVIEW: 0,
    };
    let totalAttemptedValue = 0;
    let suspiciousExposure = 0;
    let excessOverAuthorized = 0;

    for (const v of vers) {
      statusSummary[v.status as keyof typeof statusSummary] =
        (statusSummary[v.status as keyof typeof statusSummary] ?? 0) + 1;
      totalAttemptedValue += v.attemptedAmount;
      if (v.status !== 'VERIFIED') {
        suspiciousExposure += v.attemptedAmount;
        if (v.attemptedAmount > v.expectedAuthorizedAmount) {
          excessOverAuthorized += v.attemptedAmount - v.expectedAuthorizedAmount;
        }
      }
    }

    const mandateStatusCounts: Record<string, number> = {};
    for (const m of userMandates) {
      mandateStatusCounts[m.status] = (mandateStatusCounts[m.status] ?? 0) + 1;
    }

    const violationCounts = new Map<string, { category: string; count: number; exposure: number }>();
    const verById = new Map(vers.map((v) => [v.id, v]));
    for (const viol of scopedViolations) {
      const parentVer = verById.get(viol.verificationResultId);
      const entry = violationCounts.get(viol.violationType) ?? {
        category: viol.violationType,
        count: 0,
        exposure: 0,
      };
      entry.count += 1;
      entry.exposure += parentVer?.attemptedAmount ?? 0;
      violationCounts.set(viol.violationType, entry);
    }

    const caseStats = {
      total: userCases.length,
      open: userCases.filter((c) => c.status === 'OPEN' || c.status === 'REOPENED').length,
      underReview: userCases.filter((c) => c.status === 'UNDER_REVIEW').length,
      closed: userCases.filter((c) => c.status === 'CLOSED').length,
    };

    return res.json({
      generatedAt: new Date().toISOString(),
      scope: demoOnly === null ? 'all' : demoOnly ? 'demo' : 'user',
      includesDemoData: vers.some((v) => v.isDemo) || userMandates.some((m) => m.isDemo),
      summary: {
        totalMandates: userMandates.length,
        totalAttempts: vers.length,
        statusSummary,
        totalAttemptedValue: Number(totalAttemptedValue.toFixed(2)),
        suspiciousExposure: Number(suspiciousExposure.toFixed(2)),
        excessOverAuthorized: Number(excessOverAuthorized.toFixed(2)),
      },
      mandateStatusBreakdown: Object.entries(mandateStatusCounts).map(([status, count]) => ({
        status,
        count,
      })),
      violationBreakdown: Array.from(violationCounts.values()).sort((a, b) => b.count - a.count),
      investigationStats: caseStats,
      flaggedAttempts: vers
        .filter((v) => v.status !== 'VERIFIED')
        .map((v) => ({
          id: v.id,
          attemptUid: aMap.get(v.paymentAttemptId)?.attemptUid ?? `PAY-${v.paymentAttemptId}`,
          mandateCode: mMap.get(v.mandateId)?.mandateCode ?? 'Unknown',
          merchantName: mMap.get(v.mandateId)?.merchantName ?? 'Unknown',
          customerName: mMap.get(v.mandateId)?.customerName ?? 'Unknown',
          attemptTimestamp: v.attemptTimestamp.toISOString(),
          attemptedAmount: v.attemptedAmount,
          expectedAuthorizedAmount: v.expectedAuthorizedAmount,
          currency: v.currency,
          status: v.status,
          severity: v.severity,
          violationCategories: v.violationCategories,
          isDemo: v.isDemo,
        })),
    });
  } catch (error) {
    console.error('Reports generation error:', error);
    return res.status(500).json({ error: 'Unable to generate report.' });
  }
});

router.get('/evaluation/run', async (req: AuthRequest, res) => {
  try {
    const report = runRiskEvaluationBenchmark();
    await logAudit(
      req.dbUser!.id,
      'RISK_EVALUATION_RUN',
      'evaluation',
      `synthetic-${report.totalCases}`,
      { totalCases: report.totalCases, f1: report.overall.f1Score },
      getClientIp(req)
    );
    return res.json(report);
  } catch (error) {
    console.error('Risk evaluation error:', error);
    return res.status(500).json({ error: 'Evaluation benchmark failed.' });
  }
});

router.post('/demo/load', async (req: AuthRequest, res) => {
  try {
    const result = await loadDemoDataForUser(
      req.dbUser!.id,
      req.dbUser!.fullName,
      getClientIp(req)
    );
    return res.json({
      message: 'Synthetic demo dataset loaded successfully. All demo records are clearly labelled.',
      ...result,
    });
  } catch (error) {
    console.error('Load demo data error:', error);
    return res.status(500).json({ error: 'Unable to load demo data.' });
  }
});

router.post('/demo/reset', async (req: AuthRequest, res) => {
  try {
    await resetDemoDataForUser(req.dbUser!.id, getClientIp(req));
    return res.json({
      message: 'All synthetic demo records have been removed. Your own mandates remain intact.',
    });
  } catch (error) {
    console.error('Reset demo data error:', error);
    return res.status(500).json({ error: 'Unable to reset demo data.' });
  }
});

router.get('/audit-logs', async (req: AuthRequest, res) => {
  try {
    const logs = await db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.userId, req.dbUser!.id))
      .orderBy(desc(auditLogs.createdAt))
      .limit(100);
    return res.json({ logs });
  } catch (error) {
    console.error('Audit logs error:', error);
    return res.status(500).json({ error: 'Unable to load audit logs.' });
  }
});

export default router;
