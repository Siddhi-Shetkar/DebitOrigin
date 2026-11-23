import type {
  EvidenceStatus,
  MandateSnapshotState,
  MandateStatus,
  ModificationRecord,
  ReplayEventInput,
  ReplayMandateInput,
  ReplayResult,
  ReplayTimelineEntry,
} from '../../shared/types.ts';

const EVENT_PRIORITY: Record<string, number> = {
  CONSENT_CREATED: 1,
  CONSENT_APPROVED: 2,
  AMOUNT_MODIFIED: 3,
  FREQUENCY_MODIFIED: 4,
  MERCHANT_MODIFIED: 5,
  MANDATE_PAUSED: 6,
  MANDATE_RESUMED: 7,
  MANDATE_REVOKED: 8,
  MANDATE_EXPIRED: 9,
  PRE_DEBIT_NOTIFICATION: 10,
  DEBIT_ATTEMPTED: 11,
  DEBIT_PROCESSED: 12,
  DEBIT_REJECTED: 13,
};

function toUtcIso(value: string | Date): string {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) {
    throw new Error(`Invalid timestamp encountered during replay: ${String(value)}`);
  }
  return d.toISOString();
}

function toUtcMs(value: string | Date): number {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) {
    throw new Error(`Invalid timestamp encountered during replay: ${String(value)}`);
  }
  return d.getTime();
}

function extractNumeric(val: Record<string, unknown> | null | undefined, keys: string[]): number | null {
  if (!val) return null;
  for (const key of keys) {
    const candidate = val[key];
    if (typeof candidate === 'number' && Number.isFinite(candidate)) {
      return candidate;
    }
    if (typeof candidate === 'string' && candidate.trim() !== '' && Number.isFinite(Number(candidate))) {
      return Number(candidate);
    }
  }
  return null;
}

function extractString(val: Record<string, unknown> | null | undefined, keys: string[]): string | null {
  if (!val) return null;
  for (const key of keys) {
    const candidate = val[key];
    if (typeof candidate === 'string' && candidate.trim() !== '') {
      return candidate.trim();
    }
  }
  return null;
}

function normalizeEvidenceStatus(raw: string | null | undefined): EvidenceStatus {
  const upper = (raw ?? 'NONE').toUpperCase();
  if (upper === 'VERIFIED' || upper === 'MISSING' || upper === 'AMBIGUOUS' || upper === 'NONE') {
    return upper;
  }
  return 'AMBIGUOUS';
}

function hasValidCustomerApproval(event: ReplayEventInput): boolean {
  const evidence = normalizeEvidenceStatus(event.evidenceStatus);
  const hasRef = Boolean(
    (event.customerApprovalRef && event.customerApprovalRef.trim().length > 0) ||
      (event.evidenceRef && event.evidenceRef.trim().length > 0)
  );
  return Boolean(event.customerApproved && evidence === 'VERIFIED' && hasRef);
}

/**
 * Deterministic Consent Drift Replay Engine.
 * Reconstructs historical customer authorization strictly from chronological events
 * up to `asOfTimestamp` without being affected by later merchant-side changes.
 */
export function replayMandateAuthorization(
  mandate: ReplayMandateInput,
  rawEvents: ReplayEventInput[],
  asOfTimestampInput: string | Date
): ReplayResult {
  const asOfMs = toUtcMs(asOfTimestampInput);
  const asOfIso = toUtcIso(asOfTimestampInput);

  // 1. Canonical sort (handles out-of-order ingestion and timezone differences)
  const normalizedEvents = rawEvents.map((e, idx) => ({
    ...e,
    _ms: toUtcMs(e.eventTimestamp),
    _iso: toUtcIso(e.eventTimestamp),
    _orderIdx: idx,
    _priority: EVENT_PRIORITY[e.eventType] ?? 99,
  }));

  normalizedEvents.sort((a, b) => {
    if (a._ms !== b._ms) return a._ms - b._ms;
    if (a._priority !== b._priority) return a._priority - b._priority;
    if (a.id !== undefined && b.id !== undefined && a.id !== b.id) return a.id - b.id;
    return a.eventUid.localeCompare(b.eventUid);
  });

  // 2. Deduplicate identical events safely
  const seenKeys = new Set<string>();
  const dedupedEvents: typeof normalizedEvents = [];
  let deduplicatedEventCount = 0;

  for (const ev of normalizedEvents) {
    const signature = ev.idempotencyKey
      ? `idem:${ev.idempotencyKey}`
      : `sig:${ev.eventType}|${ev._iso}|${ev.actor}|${JSON.stringify(ev.newValue ?? {})}|${ev.customerApprovalRef ?? ''}`;
    if (seenKeys.has(signature)) {
      deduplicatedEventCount += 1;
      continue;
    }
    seenKeys.add(signature);
    dedupedEvents.push(ev);
  }

  // 3. Establish initial Original Customer Consent state
  const consentApprovedEv = dedupedEvents.find((e) => e.eventType === 'CONSENT_APPROVED');
  const consentCreatedEv = dedupedEvents.find((e) => e.eventType === 'CONSENT_CREATED');
  const seedEvent = consentApprovedEv ?? consentCreatedEv;

  const initialAmount =
    extractNumeric(seedEvent?.newValue, ['amount', 'authorizedAmount']) ?? mandate.authorizedAmount;
  const initialFrequency =
    extractString(seedEvent?.newValue, ['billingFrequency', 'frequency']) ?? mandate.billingFrequency;
  const initialMerchantId =
    extractString(seedEvent?.newValue, ['merchantId']) ?? mandate.merchantId;
  const initialMerchantName =
    extractString(seedEvent?.newValue, ['merchantName']) ?? mandate.merchantName;
  const initialEvidenceStatus: EvidenceStatus = seedEvent
    ? normalizeEvidenceStatus(seedEvent.evidenceStatus)
    : mandate.consentEvidenceRef
      ? 'VERIFIED'
      : 'MISSING';
  const initialEvidenceRef = seedEvent?.evidenceRef ?? mandate.consentEvidenceRef ?? null;

  const initialStatus: MandateStatus =
    initialEvidenceStatus === 'MISSING' || initialEvidenceStatus === 'AMBIGUOUS'
      ? 'NEEDS_REVIEW'
      : mandate.status === 'NEEDS_REVIEW' || mandate.status === 'PENDING_CONSENT'
        ? (mandate.status as MandateStatus)
        : 'ACTIVE';

  const originalConsent: MandateSnapshotState = {
    amount: initialAmount,
    currency: mandate.currency,
    billingFrequency: initialFrequency,
    merchantId: initialMerchantId,
    merchantName: initialMerchantName,
    billingSchedule: mandate.billingSchedule,
    billingDayOfMonth: mandate.billingDayOfMonth ?? null,
    status: initialStatus,
    consentEvidenceStatus: initialEvidenceStatus,
    consentEvidenceRef: initialEvidenceRef,
    effectiveTimestamp: seedEvent ? seedEvent._iso : toUtcIso(mandate.originalConsentTimestamp),
  };

  // Clone for chronological replay
  const reconstructedAuthorization: MandateSnapshotState = { ...originalConsent };
  const merchantSideRecord: MandateSnapshotState = { ...originalConsent };

  const approvedModifications: ModificationRecord[] = [];
  const unsupportedModifications: ModificationRecord[] = [];
  const ambiguousOrMissingEvidenceEvents: ModificationRecord[] = [];
  const timeline: ReplayTimelineEntry[] = [];
  const relevantEventIds: string[] = [];

  let hadConsentApproval = Boolean(
    consentApprovedEv && consentApprovedEv._ms <= asOfMs && normalizeEvidenceStatus(consentApprovedEv.evidenceStatus) === 'VERIFIED'
  );

  // If no explicit event stream exists at all, fall back to mandate's original consent record
  if (dedupedEvents.length === 0 && mandate.consentEvidenceRef && mandate.status !== 'PENDING_CONSENT') {
    hadConsentApproval = toUtcMs(mandate.originalConsentTimestamp) <= asOfMs;
  }

  for (const ev of dedupedEvents) {
    const includedInReplay = ev._ms <= asOfMs;
    let appliedToAuthorizedTerms = false;
    let driftFlag: ReplayTimelineEntry['driftFlag'] = 'NONE';
    let summary = `${ev.eventType.replace(/_/g, ' ')} recorded by ${ev.actor}`;
    const evStatus = normalizeEvidenceStatus(ev.evidenceStatus);

    if (includedInReplay) {
      switch (ev.eventType) {
        case 'CONSENT_CREATED': {
          relevantEventIds.push(ev.eventUid);
          const amt = extractNumeric(ev.newValue, ['amount', 'authorizedAmount']);
          const freq = extractString(ev.newValue, ['billingFrequency', 'frequency']);
          if (amt !== null) {
            merchantSideRecord.amount = amt;
          }
          if (freq) {
            merchantSideRecord.billingFrequency = freq;
          }
          if (evStatus === 'MISSING' || evStatus === 'AMBIGUOUS') {
            driftFlag = evStatus === 'MISSING' ? 'MISSING_EVIDENCE' : 'AMBIGUOUS_EVIDENCE';
            reconstructedAuthorization.consentEvidenceStatus = evStatus;
            reconstructedAuthorization.status = 'NEEDS_REVIEW';
            ambiguousOrMissingEvidenceEvents.push({
              eventUid: ev.eventUid,
              eventType: ev.eventType,
              eventTimestamp: ev._iso,
              actor: ev.actor,
              field: 'consent',
              previousValue: ev.previousValue ?? null,
              newValue: ev.newValue ?? null,
              customerApproved: ev.customerApproved,
              customerApprovalRef: ev.customerApprovalRef ?? null,
              evidenceRef: ev.evidenceRef ?? null,
              evidenceStatus: evStatus,
              reason: `Initial consent creation has ${evStatus.toLowerCase()} supporting evidence.`,
            });
          } else if (hasValidCustomerApproval(ev)) {
            hadConsentApproval = true;
            appliedToAuthorizedTerms = true;
            reconstructedAuthorization.status = 'ACTIVE';
            reconstructedAuthorization.consentEvidenceStatus = 'VERIFIED';
            reconstructedAuthorization.consentEvidenceRef = ev.evidenceRef ?? ev.customerApprovalRef ?? null;
          }
          summary = `Consent initiated for ${mandate.currency} ${amt ?? originalConsent.amount} (${freq ?? originalConsent.billingFrequency}).`;
          break;
        }

        case 'CONSENT_APPROVED': {
          relevantEventIds.push(ev.eventUid);
          const amt = extractNumeric(ev.newValue, ['amount', 'authorizedAmount']);
          const freq = extractString(ev.newValue, ['billingFrequency', 'frequency']);
          const mId = extractString(ev.newValue, ['merchantId']);
          const mName = extractString(ev.newValue, ['merchantName']);

          if (evStatus === 'VERIFIED' && ev.customerApproved) {
            hadConsentApproval = true;
            appliedToAuthorizedTerms = true;
            if (amt !== null) {
              reconstructedAuthorization.amount = amt;
              merchantSideRecord.amount = amt;
            }
            if (freq) {
              reconstructedAuthorization.billingFrequency = freq;
              merchantSideRecord.billingFrequency = freq;
            }
            if (mId) {
              reconstructedAuthorization.merchantId = mId;
              merchantSideRecord.merchantId = mId;
            }
            if (mName) {
              reconstructedAuthorization.merchantName = mName;
              merchantSideRecord.merchantName = mName;
            }
            reconstructedAuthorization.status = 'ACTIVE';
            merchantSideRecord.status = 'ACTIVE';
            reconstructedAuthorization.consentEvidenceStatus = 'VERIFIED';
            reconstructedAuthorization.consentEvidenceRef =
              ev.evidenceRef ?? ev.customerApprovalRef ?? reconstructedAuthorization.consentEvidenceRef;
            reconstructedAuthorization.effectiveTimestamp = ev._iso;
            summary = `Customer explicitly approved mandate for ${mandate.currency} ${reconstructedAuthorization.amount} (${reconstructedAuthorization.billingFrequency}).`;
          } else {
            driftFlag = evStatus === 'MISSING' ? 'MISSING_EVIDENCE' : 'AMBIGUOUS_EVIDENCE';
            reconstructedAuthorization.consentEvidenceStatus = evStatus === 'NONE' ? 'MISSING' : evStatus;
            reconstructedAuthorization.status = 'NEEDS_REVIEW';
            ambiguousOrMissingEvidenceEvents.push({
              eventUid: ev.eventUid,
              eventType: ev.eventType,
              eventTimestamp: ev._iso,
              actor: ev.actor,
              field: 'consent_approval',
              previousValue: ev.previousValue ?? null,
              newValue: ev.newValue ?? null,
              customerApproved: ev.customerApproved,
              customerApprovalRef: ev.customerApprovalRef ?? null,
              evidenceRef: ev.evidenceRef ?? null,
              evidenceStatus: evStatus,
              reason: `Consent approval event lacks verified customer evidence (${evStatus}).`,
            });
            summary = `Consent approval recorded with ${evStatus.toLowerCase()} evidence; requires human review.`;
          }
          break;
        }

        case 'AMOUNT_MODIFIED': {
          relevantEventIds.push(ev.eventUid);
          const prevAuthAmt = reconstructedAuthorization.amount;
          const prevMerchantAmt =
            extractNumeric(ev.previousValue, ['amount', 'authorizedAmount']) ??
            merchantSideRecord.amount;
          const nextAmt = extractNumeric(ev.newValue, ['amount', 'authorizedAmount']);

          if (nextAmt !== null) {
            const changedFromAuth = Math.abs(nextAmt - prevAuthAmt) >= 0.009;
            const changedFromMerchant = Math.abs(nextAmt - prevMerchantAmt) >= 0.009;

            // Ignore no-op amount modification events (e.g. ₹499 -> ₹499)
            if (!changedFromAuth && !changedFromMerchant) {
              summary = `Amount modification event recorded with no net change (${mandate.currency} ${nextAmt}); authorized terms unchanged.`;
              break;
            }

            // Merchant-side record reflects the merchant update
            merchantSideRecord.amount = nextAmt;
            merchantSideRecord.effectiveTimestamp = ev._iso;

            if (hasValidCustomerApproval(ev)) {
              if (changedFromAuth) {
                reconstructedAuthorization.amount = nextAmt;
                reconstructedAuthorization.effectiveTimestamp = ev._iso;
                appliedToAuthorizedTerms = true;
                approvedModifications.push({
                  eventUid: ev.eventUid,
                  eventType: ev.eventType,
                  eventTimestamp: ev._iso,
                  actor: ev.actor,
                  field: 'amount',
                  previousValue: prevAuthAmt,
                  newValue: nextAmt,
                  customerApproved: true,
                  customerApprovalRef: ev.customerApprovalRef ?? null,
                  evidenceRef: ev.evidenceRef ?? null,
                  evidenceStatus: evStatus,
                  reason: `Customer approved amount change from ${mandate.currency} ${prevAuthAmt} to ${mandate.currency} ${nextAmt}.`,
                });
                summary = `Customer-approved amount update from ${mandate.currency} ${prevAuthAmt} to ${mandate.currency} ${nextAmt}.`;
              } else {
                summary = `Customer confirmed existing authorized amount of ${mandate.currency} ${nextAmt}; no amount change applied.`;
              }
            } else if (ev.customerApproved && (evStatus === 'MISSING' || evStatus === 'AMBIGUOUS')) {
              driftFlag = evStatus === 'MISSING' ? 'MISSING_EVIDENCE' : 'AMBIGUOUS_EVIDENCE';
              ambiguousOrMissingEvidenceEvents.push({
                eventUid: ev.eventUid,
                eventType: ev.eventType,
                eventTimestamp: ev._iso,
                actor: ev.actor,
                field: 'amount',
                previousValue: prevMerchantAmt,
                newValue: nextAmt,
                customerApproved: ev.customerApproved,
                customerApprovalRef: ev.customerApprovalRef ?? null,
                evidenceRef: ev.evidenceRef ?? null,
                evidenceStatus: evStatus,
                reason: `Amount modification from ${mandate.currency} ${prevMerchantAmt} to ${mandate.currency} ${nextAmt} claims customer approval but supporting evidence is ${evStatus.toLowerCase()}.`,
              });
              summary = `Amount updated to ${mandate.currency} ${nextAmt} with ${evStatus.toLowerCase()} approval evidence; original authorization (${mandate.currency} ${reconstructedAuthorization.amount}) retained.`;
            } else {
              driftFlag = 'UNSUPPORTED_CHANGE';
              unsupportedModifications.push({
                eventUid: ev.eventUid,
                eventType: ev.eventType,
                eventTimestamp: ev._iso,
                actor: ev.actor,
                field: 'amount',
                previousValue: prevMerchantAmt,
                newValue: nextAmt,
                customerApproved: false,
                customerApprovalRef: ev.customerApprovalRef ?? null,
                evidenceRef: ev.evidenceRef ?? null,
                evidenceStatus: evStatus,
                reason: `Merchant-side amount changed from ${mandate.currency} ${prevMerchantAmt} to ${mandate.currency} ${nextAmt} without customer-approved consent.`,
              });
              summary = `Merchant-side amount changed from ${mandate.currency} ${prevMerchantAmt} to ${mandate.currency} ${nextAmt} without customer consent.`;
            }
          }
          break;
        }

        case 'FREQUENCY_MODIFIED': {
          relevantEventIds.push(ev.eventUid);
          const prevAuthFreq = reconstructedAuthorization.billingFrequency;
          const prevFreq =
            extractString(ev.previousValue, ['billingFrequency', 'frequency']) ??
            merchantSideRecord.billingFrequency;
          const nextFreq = extractString(ev.newValue, ['billingFrequency', 'frequency']);

          if (nextFreq) {
            const changedFromAuth = nextFreq.toUpperCase() !== prevAuthFreq.toUpperCase();
            const changedFromMerchant = nextFreq.toUpperCase() !== prevFreq.toUpperCase();

            if (!changedFromAuth && !changedFromMerchant) {
              summary = `Frequency event recorded with no net change (${nextFreq}); authorized cadence unchanged.`;
              break;
            }

            merchantSideRecord.billingFrequency = nextFreq;
            merchantSideRecord.effectiveTimestamp = ev._iso;

            if (hasValidCustomerApproval(ev)) {
              if (changedFromAuth) {
                reconstructedAuthorization.billingFrequency = nextFreq;
                reconstructedAuthorization.effectiveTimestamp = ev._iso;
                appliedToAuthorizedTerms = true;
                approvedModifications.push({
                  eventUid: ev.eventUid,
                  eventType: ev.eventType,
                  eventTimestamp: ev._iso,
                  actor: ev.actor,
                  field: 'billingFrequency',
                  previousValue: prevAuthFreq,
                  newValue: nextFreq,
                  customerApproved: true,
                  customerApprovalRef: ev.customerApprovalRef ?? null,
                  evidenceRef: ev.evidenceRef ?? null,
                  evidenceStatus: evStatus,
                  reason: `Customer approved frequency change from ${prevAuthFreq} to ${nextFreq}.`,
                });
                summary = `Customer-approved billing frequency update from ${prevAuthFreq} to ${nextFreq}.`;
              } else {
                summary = `Customer confirmed existing billing frequency (${nextFreq}); no change applied.`;
              }
            } else {
              driftFlag =
                ev.customerApproved && (evStatus === 'MISSING' || evStatus === 'AMBIGUOUS')
                  ? evStatus === 'MISSING'
                    ? 'MISSING_EVIDENCE'
                    : 'AMBIGUOUS_EVIDENCE'
                  : 'UNSUPPORTED_CHANGE';
              const record: ModificationRecord = {
                eventUid: ev.eventUid,
                eventType: ev.eventType,
                eventTimestamp: ev._iso,
                actor: ev.actor,
                field: 'billingFrequency',
                previousValue: prevFreq,
                newValue: nextFreq,
                customerApproved: ev.customerApproved,
                customerApprovalRef: ev.customerApprovalRef ?? null,
                evidenceRef: ev.evidenceRef ?? null,
                evidenceStatus: evStatus,
                reason: `Billing frequency changed from ${prevFreq} to ${nextFreq} without verified customer approval.`,
              };
              if (driftFlag === 'UNSUPPORTED_CHANGE') {
                unsupportedModifications.push(record);
              } else {
                ambiguousOrMissingEvidenceEvents.push(record);
              }
              summary = `Merchant-side frequency changed from ${prevFreq} to ${nextFreq} without verified customer consent.`;
            }
          }
          break;
        }

        case 'MERCHANT_MODIFIED': {
          relevantEventIds.push(ev.eventUid);
          const prevAuthMId = reconstructedAuthorization.merchantId;
          const prevMId = extractString(ev.previousValue, ['merchantId']) ?? merchantSideRecord.merchantId;
          const nextMId = extractString(ev.newValue, ['merchantId']);
          const nextMName = extractString(ev.newValue, ['merchantName']) ?? merchantSideRecord.merchantName;

          if (nextMId) {
            const changedFromAuth = nextMId.toLowerCase() !== prevAuthMId.toLowerCase();
            const changedFromMerchant = nextMId.toLowerCase() !== prevMId.toLowerCase();

            if (!changedFromAuth && !changedFromMerchant) {
              summary = `Merchant event recorded with no net change (${nextMId}); authorized merchant unchanged.`;
              break;
            }

            merchantSideRecord.merchantId = nextMId;
            merchantSideRecord.merchantName = nextMName;
            merchantSideRecord.effectiveTimestamp = ev._iso;

            if (hasValidCustomerApproval(ev)) {
              if (changedFromAuth) {
                reconstructedAuthorization.merchantId = nextMId;
                reconstructedAuthorization.merchantName = nextMName;
                reconstructedAuthorization.effectiveTimestamp = ev._iso;
                appliedToAuthorizedTerms = true;
                approvedModifications.push({
                  eventUid: ev.eventUid,
                  eventType: ev.eventType,
                  eventTimestamp: ev._iso,
                  actor: ev.actor,
                  field: 'merchant',
                  previousValue: prevAuthMId,
                  newValue: nextMId,
                  customerApproved: true,
                  customerApprovalRef: ev.customerApprovalRef ?? null,
                  evidenceRef: ev.evidenceRef ?? null,
                  evidenceStatus: evStatus,
                  reason: `Customer approved merchant reassignment to ${nextMName} (${nextMId}).`,
                });
                summary = `Customer-approved merchant change to ${nextMName} (${nextMId}).`;
              } else {
                summary = `Customer confirmed existing merchant (${nextMId}); no change applied.`;
              }
            } else {
              driftFlag = 'UNSUPPORTED_CHANGE';
              unsupportedModifications.push({
                eventUid: ev.eventUid,
                eventType: ev.eventType,
                eventTimestamp: ev._iso,
                actor: ev.actor,
                field: 'merchant',
                previousValue: prevMId,
                newValue: nextMId,
                customerApproved: false,
                customerApprovalRef: ev.customerApprovalRef ?? null,
                evidenceRef: ev.evidenceRef ?? null,
                evidenceStatus: evStatus,
                reason: `Merchant identifier changed from ${prevMId} to ${nextMId} without customer authorization.`,
              });
              summary = `Merchant record reassigned to ${nextMName} (${nextMId}) without customer consent.`;
            }
          }
          break;
        }

        case 'MANDATE_PAUSED': {
          relevantEventIds.push(ev.eventUid);
          if (reconstructedAuthorization.status !== 'REVOKED' && reconstructedAuthorization.status !== 'EXPIRED') {
            reconstructedAuthorization.status = 'PAUSED';
            merchantSideRecord.status = 'PAUSED';
            appliedToAuthorizedTerms = true;
            driftFlag = 'STATE_BLOCKER';
          }
          summary = `Mandate paused by ${ev.actor}; recurring debits suspended during pause window.`;
          break;
        }

        case 'MANDATE_RESUMED': {
          relevantEventIds.push(ev.eventUid);
          if (reconstructedAuthorization.status === 'PAUSED') {
            if (ev.actor === 'CUSTOMER' || hasValidCustomerApproval(ev)) {
              reconstructedAuthorization.status = 'ACTIVE';
              merchantSideRecord.status = 'ACTIVE';
              appliedToAuthorizedTerms = true;
              summary = `Mandate resumed with valid authorization.`;
            } else {
              merchantSideRecord.status = 'ACTIVE';
              driftFlag = 'UNSUPPORTED_CHANGE';
              unsupportedModifications.push({
                eventUid: ev.eventUid,
                eventType: ev.eventType,
                eventTimestamp: ev._iso,
                actor: ev.actor,
                field: 'status',
                previousValue: 'PAUSED',
                newValue: 'ACTIVE',
                customerApproved: false,
                customerApprovalRef: ev.customerApprovalRef ?? null,
                evidenceRef: ev.evidenceRef ?? null,
                evidenceStatus: evStatus,
                reason: `Merchant resumed paused mandate without customer confirmation.`,
              });
              summary = `Merchant marked mandate active without customer resume confirmation.`;
            }
          }
          break;
        }

        case 'MANDATE_REVOKED': {
          relevantEventIds.push(ev.eventUid);
          reconstructedAuthorization.status = 'REVOKED';
          reconstructedAuthorization.effectiveTimestamp = ev._iso;
          appliedToAuthorizedTerms = true;
          driftFlag = 'STATE_BLOCKER';
          summary = `Customer mandate revoked by ${ev.actor}; all subsequent debits are unauthorized.`;
          break;
        }

        case 'MANDATE_EXPIRED': {
          relevantEventIds.push(ev.eventUid);
          reconstructedAuthorization.status = 'EXPIRED';
          merchantSideRecord.status = 'EXPIRED';
          reconstructedAuthorization.effectiveTimestamp = ev._iso;
          appliedToAuthorizedTerms = true;
          driftFlag = 'STATE_BLOCKER';
          summary = `Mandate reached expiry; authorization ended.`;
          break;
        }

        case 'PRE_DEBIT_NOTIFICATION': {
          // Notification events never alter authorized terms or enter modification lists.
          appliedToAuthorizedTerms = false;
          summary = `Pre-debit notification issued by ${ev.actor} (does not alter authorized terms).`;
          break;
        }

        case 'DEBIT_ATTEMPTED':
        case 'DEBIT_PROCESSED':
        case 'DEBIT_REJECTED': {
          // Payment lifecycle events must never be interpreted as mandate modifications
          // or appended to approvedModifications / unsupportedModifications.
          appliedToAuthorizedTerms = false;
          const amt = extractNumeric(ev.newValue, ['amount', 'attemptedAmount']);
          summary = `${ev.eventType.replace(/_/g, ' ')} for ${mandate.currency} ${amt ?? 'N/A'} (payment event — does not alter authorized terms).`;
          break;
        }

        default:
          break;
      }
    } else {
      summary = `Event occurred after replay timestamp (${asOfIso}) and is excluded from historical reconstruction.`;
    }

    timeline.push({
      eventUid: ev.eventUid,
      eventType: ev.eventType,
      eventTimestamp: ev._iso,
      actor: ev.actor,
      previousValue: ev.previousValue ?? null,
      newValue: ev.newValue ?? null,
      customerApproved: ev.customerApproved,
      customerApprovalRef: ev.customerApprovalRef ?? null,
      evidenceRef: ev.evidenceRef ?? null,
      evidenceStatus: evStatus,
      includedInReplay,
      appliedToAuthorizedTerms,
      driftFlag,
      summary,
    });
  }

  // 4. Evaluate mandate endDate expiry at asOfTimestamp
  let isExpiredAtTimestamp = reconstructedAuthorization.status === 'EXPIRED';
  if (mandate.endDate && toUtcMs(mandate.endDate) < asOfMs) {
    isExpiredAtTimestamp = true;
    if (reconstructedAuthorization.status !== 'REVOKED') {
      reconstructedAuthorization.status = 'EXPIRED';
    }
  }

  // If no explicit merchant modification event existed in timeline, reflect current merchant record only if no later events exist
  const hasLaterEvents = dedupedEvents.some((e) => e._ms > asOfMs);
  if (!hasLaterEvents && unsupportedModifications.length === 0 && approvedModifications.length === 0) {
    merchantSideRecord.amount = mandate.currentMerchantAmount;
    merchantSideRecord.billingFrequency = mandate.currentMerchantFrequency;
  }

  return {
    asOfTimestamp: asOfIso,
    mandateCode: mandate.mandateCode,
    originalConsent,
    reconstructedAuthorization,
    merchantSideRecord,
    approvedModifications,
    unsupportedModifications,
    ambiguousOrMissingEvidenceEvents,
    timeline,
    relevantEventIds: Array.from(new Set(relevantEventIds)),
    deduplicatedEventCount,
    hadConsentApproval,
    isExpiredAtTimestamp,
  };
}
