import { relations } from 'drizzle-orm';
import {
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  uid: text('uid').notNull().unique(),
  fullName: text('full_name').notNull(),
  email: text('email').notNull().unique(),
  organization: text('organization').default(''),
  passwordHash: text('password_hash'),
  authProvider: text('auth_provider').notNull().default('email'),
  emailVerified: boolean('email_verified').notNull().default(false),
  onboardingCompleted: boolean('onboarding_completed').notNull().default(false),
  termsAcceptedAt: timestamp('terms_accepted_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const userSessions = pgTable(
  'user_sessions',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    tokenHash: text('token_hash').notNull().unique(),
    rememberMe: boolean('remember_me').notNull().default(false),
    userAgent: text('user_agent'),
    expiresAt: timestamp('expires_at').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [index('user_sessions_user_id_idx').on(table.userId)]
);

export const authTokens = pgTable(
  'auth_tokens',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    type: text('type').notNull(), // EMAIL_VERIFY | PASSWORD_RESET
    tokenHash: text('token_hash').notNull().unique(),
    expiresAt: timestamp('expires_at').notNull(),
    usedAt: timestamp('used_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [index('auth_tokens_user_id_idx').on(table.userId)]
);

export const mandates = pgTable(
  'mandates',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    mandateCode: text('mandate_code').notNull(),
    customerId: text('customer_id').notNull(),
    customerName: text('customer_name').notNull(),
    merchantId: text('merchant_id').notNull(),
    merchantName: text('merchant_name').notNull(),
    authorizedAmount: doublePrecision('authorized_amount').notNull(),
    currentMerchantAmount: doublePrecision('current_merchant_amount').notNull(),
    currency: text('currency').notNull().default('INR'),
    billingFrequency: text('billing_frequency').notNull().default('MONTHLY'),
    currentMerchantFrequency: text('current_merchant_frequency').notNull().default('MONTHLY'),
    billingSchedule: text('billing_schedule').notNull().default('Day 5 of every month'),
    billingDayOfMonth: integer('billing_day_of_month'),
    requireApprovalForDecrease: boolean('require_approval_for_decrease').notNull().default(false),
    startDate: timestamp('start_date').notNull(),
    endDate: timestamp('end_date'),
    status: text('status').notNull().default('ACTIVE'),
    originalConsentTimestamp: timestamp('original_consent_timestamp').notNull(),
    consentEvidenceRef: text('consent_evidence_ref'),
    conditions: text('conditions'),
    isDemo: boolean('is_demo').notNull().default(false),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('mandates_user_code_uidx').on(table.userId, table.mandateCode),
    index('mandates_user_id_idx').on(table.userId),
    index('mandates_status_idx').on(table.status),
  ]
);

export const consentDocuments = pgTable(
  'consent_documents',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    mandateId: integer('mandate_id').references(() => mandates.id, { onDelete: 'set null' }),
    fileName: text('file_name').notNull(),
    mimeType: text('mime_type').notNull(),
    fileSizeBytes: integer('file_size_bytes').notNull(),
    sha256Hash: text('sha256_hash').notNull(),
    storageRef: text('storage_ref').notNull(),
    rawTextSnippet: text('raw_text_snippet'),
    isDemo: boolean('is_demo').notNull().default(false),
    uploadedAt: timestamp('uploaded_at').defaultNow().notNull(),
  },
  (table) => [index('consent_documents_user_id_idx').on(table.userId)]
);

export const consentExtractionResults = pgTable(
  'consent_extraction_results',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    documentId: integer('document_id')
      .references(() => consentDocuments.id, { onDelete: 'cascade' })
      .notNull(),
    mandateId: integer('mandate_id').references(() => mandates.id, { onDelete: 'set null' }),
    provider: text('provider').notNull(),
    extractedJson: jsonb('extracted_json').notNull(),
    correctedJson: jsonb('corrected_json'),
    confidenceScore: doublePrecision('confidence_score').notNull(),
    missingFields: jsonb('missing_fields').notNull(),
    ambiguousFields: jsonb('ambiguous_fields').notNull(),
    reviewStatus: text('review_status').notNull().default('NEEDS_REVIEW'),
    reviewedAt: timestamp('reviewed_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [index('consent_extractions_user_id_idx').on(table.userId)]
);

export const mandateEvents = pgTable(
  'mandate_events',
  {
    id: serial('id').primaryKey(),
    eventUid: text('event_uid').notNull().unique(),
    userId: integer('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    mandateId: integer('mandate_id')
      .references(() => mandates.id, { onDelete: 'cascade' })
      .notNull(),
    eventType: text('event_type').notNull(),
    eventTimestamp: timestamp('event_timestamp').notNull(),
    previousValue: jsonb('previous_value'),
    newValue: jsonb('new_value'),
    actor: text('actor').notNull(),
    customerApproved: boolean('customer_approved').notNull().default(false),
    customerApprovalRef: text('customer_approval_ref'),
    evidenceRef: text('evidence_ref'),
    evidenceStatus: text('evidence_status').notNull().default('VERIFIED'),
    idempotencyKey: text('idempotency_key'),
    metadata: jsonb('metadata'),
    isDemo: boolean('is_demo').notNull().default(false),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('mandate_events_mandate_ts_idx').on(table.mandateId, table.eventTimestamp),
    index('mandate_events_user_id_idx').on(table.userId),
  ]
);

export const paymentAttempts = pgTable(
  'payment_attempts',
  {
    id: serial('id').primaryKey(),
    attemptUid: text('attempt_uid').notNull().unique(),
    userId: integer('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    mandateId: integer('mandate_id')
      .references(() => mandates.id, { onDelete: 'cascade' })
      .notNull(),
    attemptTimestamp: timestamp('attempt_timestamp').notNull(),
    attemptedAmount: doublePrecision('attempted_amount').notNull(),
    currency: text('currency').notNull().default('INR'),
    attemptedMerchantId: text('attempted_merchant_id').notNull(),
    attemptedMerchantName: text('attempted_merchant_name').notNull(),
    attemptedFrequency: text('attempted_frequency'),
    idempotencyKey: text('idempotency_key'),
    metadata: jsonb('metadata'),
    isDemo: boolean('is_demo').notNull().default(false),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('payment_attempts_mandate_idx').on(table.mandateId),
    index('payment_attempts_user_idx').on(table.userId),
    index('payment_attempts_ts_idx').on(table.attemptTimestamp),
  ]
);

export const verificationResults = pgTable(
  'verification_results',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    paymentAttemptId: integer('payment_attempt_id')
      .references(() => paymentAttempts.id, { onDelete: 'cascade' })
      .notNull()
      .unique(),
    mandateId: integer('mandate_id')
      .references(() => mandates.id, { onDelete: 'cascade' })
      .notNull(),
    attemptTimestamp: timestamp('attempt_timestamp').notNull(),
    attemptedAmount: doublePrecision('attempted_amount').notNull(),
    expectedAuthorizedAmount: doublePrecision('expected_authorized_amount').notNull(),
    currency: text('currency').notNull().default('INR'),
    status: text('status').notNull(), // VERIFIED | FLAGGED | BLOCKED | NEEDS_REVIEW
    severity: text('severity').notNull(), // LOW | MEDIUM | HIGH | CRITICAL
    anomalyScore: doublePrecision('anomaly_score').notNull().default(0),
    violationCategories: jsonb('violation_categories').notNull(),
    relevantEventIds: jsonb('relevant_event_ids').notNull(),
    replaySnapshot: jsonb('replay_snapshot').notNull(),
    deterministicExplanation: text('deterministic_explanation').notNull(),
    aiExplanation: text('ai_explanation'),
    aiExplanationProvider: text('ai_explanation_provider'),
    isDemo: boolean('is_demo').notNull().default(false),
    verifiedAt: timestamp('verified_at').defaultNow().notNull(),
  },
  (table) => [
    index('verification_results_user_idx').on(table.userId),
    index('verification_results_status_idx').on(table.status),
    index('verification_results_mandate_idx').on(table.mandateId),
  ]
);

export const violations = pgTable(
  'violations',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    verificationResultId: integer('verification_result_id')
      .references(() => verificationResults.id, { onDelete: 'cascade' })
      .notNull(),
    mandateId: integer('mandate_id')
      .references(() => mandates.id, { onDelete: 'cascade' })
      .notNull(),
    violationType: text('violation_type').notNull(),
    severity: text('severity').notNull(),
    classification: text('classification').notNull(), // CONFIRMED_VIOLATION | INCOMPLETE_EVIDENCE
    expectedAuthorization: jsonb('expected_authorization').notNull(),
    actualAttempt: jsonb('actual_attempt').notNull(),
    relevantEventIds: jsonb('relevant_event_ids').notNull(),
    evidenceRefs: jsonb('evidence_refs').notNull(),
    explanation: text('explanation').notNull(),
    isDemo: boolean('is_demo').notNull().default(false),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('violations_user_idx').on(table.userId),
    index('violations_verification_idx').on(table.verificationResultId),
    index('violations_type_idx').on(table.violationType),
  ]
);

export const investigationCases = pgTable(
  'investigation_cases',
  {
    id: serial('id').primaryKey(),
    caseUid: text('case_uid').notNull().unique(),
    userId: integer('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    mandateId: integer('mandate_id')
      .references(() => mandates.id, { onDelete: 'cascade' })
      .notNull(),
    paymentAttemptId: integer('payment_attempt_id')
      .references(() => paymentAttempts.id, { onDelete: 'cascade' })
      .notNull(),
    verificationResultId: integer('verification_result_id')
      .references(() => verificationResults.id, { onDelete: 'cascade' })
      .notNull(),
    title: text('title').notNull(),
    status: text('status').notNull().default('OPEN'), // OPEN | UNDER_REVIEW | CLOSED | REOPENED
    severity: text('severity').notNull().default('HIGH'),
    decision: text('decision'),
    decisionSummary: text('decision_summary'),
    decidedAt: timestamp('decided_at'),
    closedAt: timestamp('closed_at'),
    isDemo: boolean('is_demo').notNull().default(false),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    index('investigation_cases_user_idx').on(table.userId),
    index('investigation_cases_status_idx').on(table.status),
  ]
);

export const investigationNotes = pgTable(
  'investigation_notes',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    caseId: integer('case_id')
      .references(() => investigationCases.id, { onDelete: 'cascade' })
      .notNull(),
    authorName: text('author_name').notNull(),
    noteType: text('note_type').notNull().default('NOTE'),
    content: text('content').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [index('investigation_notes_case_idx').on(table.caseId)]
);

export const auditLogs = pgTable(
  'audit_logs',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    action: text('action').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id').notNull(),
    details: jsonb('details'),
    ipAddress: text('ip_address'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('audit_logs_user_idx').on(table.userId),
    index('audit_logs_created_idx').on(table.createdAt),
  ]
);

// Relations
export const usersRelations = relations(users, ({ many }) => ({
  mandates: many(mandates),
  sessions: many(userSessions),
  auditLogs: many(auditLogs),
}));

export const mandatesRelations = relations(mandates, ({ one, many }) => ({
  user: one(users, { fields: [mandates.userId], references: [users.id] }),
  events: many(mandateEvents),
  paymentAttempts: many(paymentAttempts),
  documents: many(consentDocuments),
}));

export const mandateEventsRelations = relations(mandateEvents, ({ one }) => ({
  mandate: one(mandates, { fields: [mandateEvents.mandateId], references: [mandates.id] }),
}));

export const paymentAttemptsRelations = relations(paymentAttempts, ({ one }) => ({
  mandate: one(mandates, { fields: [paymentAttempts.mandateId], references: [mandates.id] }),
  verificationResult: one(verificationResults, {
    fields: [paymentAttempts.id],
    references: [verificationResults.paymentAttemptId],
  }),
}));

export const verificationResultsRelations = relations(verificationResults, ({ one, many }) => ({
  paymentAttempt: one(paymentAttempts, {
    fields: [verificationResults.paymentAttemptId],
    references: [paymentAttempts.id],
  }),
  mandate: one(mandates, { fields: [verificationResults.mandateId], references: [mandates.id] }),
  violations: many(violations),
}));

export const investigationCasesRelations = relations(investigationCases, ({ one, many }) => ({
  mandate: one(mandates, { fields: [investigationCases.mandateId], references: [mandates.id] }),
  paymentAttempt: one(paymentAttempts, {
    fields: [investigationCases.paymentAttemptId],
    references: [paymentAttempts.id],
  }),
  verificationResult: one(verificationResults, {
    fields: [investigationCases.verificationResultId],
    references: [verificationResults.id],
  }),
  notes: many(investigationNotes),
}));
