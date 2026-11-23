import React, { useEffect, useState, useCallback } from 'react';
import {
  AlertTriangle,
  Briefcase,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Database,
  Download,
  History,
  Play,
  RefreshCw,
  RotateCcw,
  ShieldAlert,
  Sparkles,
} from 'lucide-react';
import { apiRequest, ApiError } from '../lib/api.ts';
import {
  downloadVerificationEvidencePdf,
  formatCurrency,
  formatDateTime,
  humanizeEnum,
  isPaymentLifecycleEvent,
} from '../lib/utils.ts';
import {
  Button,
  DemoMarker,
  EmptyState,
  EventPayloadViewer,
  FieldLabel,
  SelectInput,
  SkeletonRows,
  StatusLabel,
  Surface,
  TextInput,
} from './ui/Primitives.tsx';

export function ConsentDriftReplayPage({
  initialMandateId,
  initialAttemptId,
  onOpenInvestigation,
  onNavigate,
}: {
  initialMandateId?: number | null;
  initialAttemptId?: number | null;
  onOpenInvestigation: (caseId: number) => void;
  onNavigate: (tab: string) => void;
}) {
  const [mandates, setMandates] = useState<any[]>([]);
  const [selectedMandateId, setSelectedMandateId] = useState<number | null>(
    initialMandateId ?? null
  );
  const [selectedAttemptId, setSelectedAttemptId] = useState<number | null>(
    initialAttemptId ?? null
  );
  const [customTimestamp, setCustomTimestamp] = useState<string>('');
  const [replayData, setReplayData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [replaying, setReplaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stepIndex, setStepIndex] = useState<number | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [explaining, setExplaining] = useState(false);
  const [openingCase, setOpeningCase] = useState(false);
  const [loadingDemo, setLoadingDemo] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);

  const runReplay = useCallback(
    async (mandateId: number, paymentAttemptId?: number | null, asOfTs?: string) => {
      setReplaying(true);
      setError(null);
      try {
        const body: Record<string, unknown> = { mandateId };
        if (paymentAttemptId) body.paymentAttemptId = paymentAttemptId;
        if (asOfTs) body.asOfTimestamp = new Date(asOfTs).toISOString();
        const res = await apiRequest('/api/replay', { method: 'POST', body });
        setReplayData(res);
        setStepIndex(null);
        setIsPlaying(false);
        if (!paymentAttemptId && res.availableAttempts?.length > 0 && !asOfTs) {
          // Auto-select latest attempt on initial mandate selection for immediate richness
          const latest = res.availableAttempts[0];
          setSelectedAttemptId(latest.id);
          const withAttempt = await apiRequest('/api/replay', {
            method: 'POST',
            body: { mandateId, paymentAttemptId: latest.id },
          });
          setReplayData(withAttempt);
        }
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'Consent Drift Replay failed.');
      } finally {
        setReplaying(false);
      }
    },
    []
  );

  // Initial mandate list load
  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      try {
        const res = await apiRequest<{ mandates: any[] }>('/api/mandates?scope=all');
        if (!active) return;
        setMandates(res.mandates);
        if (res.mandates.length > 0) {
          const targetMandateId =
            initialMandateId && res.mandates.some((m) => m.id === initialMandateId)
              ? initialMandateId
              : res.mandates[0].id;
          setSelectedMandateId(targetMandateId);
          setSelectedAttemptId(initialAttemptId ?? null);
          await runReplay(targetMandateId, initialAttemptId ?? null);
        }
      } catch (err: any) {
        if (active) setError(err?.message || 'Unable to load mandates for replay.');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [initialMandateId, initialAttemptId, runReplay]);

  // Step-through animation playback
  useEffect(() => {
    if (!isPlaying || !replayData?.replay?.timeline?.length) return;
    const includedTimeline = replayData.replay.timeline.filter((e: any) => e.includedInReplay);
    if (includedTimeline.length === 0) {
      setIsPlaying(false);
      return;
    }
    const timer = setInterval(() => {
      setStepIndex((prev) => {
        const next = prev === null ? 0 : prev + 1;
        if (next >= includedTimeline.length - 1) {
          setIsPlaying(false);
          return includedTimeline.length - 1;
        }
        return next;
      });
    }, 900);
    return () => clearInterval(timer);
  }, [isPlaying, replayData]);

  const handleMandateChange = async (idStr: string) => {
    const id = Number(idStr);
    if (!id) return;
    setSelectedMandateId(id);
    setSelectedAttemptId(null);
    setCustomTimestamp('');
    await runReplay(id, null);
  };

  const handleAttemptChange = async (idStr: string) => {
    if (!selectedMandateId) return;
    const id = idStr ? Number(idStr) : null;
    setSelectedAttemptId(id);
    setCustomTimestamp('');
    await runReplay(selectedMandateId, id);
  };

  const handleCustomTimeQuery = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedMandateId || !customTimestamp) return;
    await runReplay(selectedMandateId, selectedAttemptId, customTimestamp);
  };

  const handleExplainWithGemini = async () => {
    const verId = replayData?.storedVerification?.id;
    if (!verId) return;
    setExplaining(true);
    setError(null);
    try {
      const res = await apiRequest(`/api/verifications/${verId}/explain`, { method: 'POST' });
      setReplayData((prev: any) => ({
        ...prev,
        storedVerification: {
          ...prev.storedVerification,
          aiExplanation: res.explanation,
          aiExplanationProvider: res.provider,
        },
      }));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to generate explanation.');
    } finally {
      setExplaining(false);
    }
  };

  const handleOpenInvestigation = async () => {
    const verId = replayData?.storedVerification?.id;
    if (!verId) return;
    setOpeningCase(true);
    try {
      const res = await apiRequest<{ case: any }>('/api/investigations', {
        method: 'POST',
        body: { verificationResultId: verId },
      });
      onOpenInvestigation(res.case.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to open investigation.');
    } finally {
      setOpeningCase(false);
    }
  };

  const handleLoadDemo = async () => {
    setLoadingDemo(true);
    setError(null);
    try {
      await apiRequest('/api/demo/load', { method: 'POST' });
      const res = await apiRequest<{ mandates: any[] }>('/api/mandates?scope=all');
      setMandates(res.mandates);
      if (res.mandates.length > 0) {
        const target = res.mandates[0].id;
        setSelectedMandateId(target);
        setSelectedAttemptId(null);
        await runReplay(target, null);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to load sample demo data.');
    } finally {
      setLoadingDemo(false);
    }
  };

  const handleExportPdf = async () => {
    const verId = replayData?.storedVerification?.id;
    setExportingPdf(true);
    setError(null);
    try {
      if (verId) {
        const evidence = await apiRequest<any>(`/api/verifications/${verId}/evidence`);
        downloadVerificationEvidencePdf(evidence);
      } else if (replayData?.mandate) {
        downloadVerificationEvidencePdf({
          verification: replayData.liveVerification
            ? {
                ...replayData.liveVerification,
                attemptTimestamp: replayData.replay?.asOfTimestamp,
                replaySnapshot: replayData.replay,
              }
            : null,
          mandate: replayData.mandate,
          paymentAttempt: replayData.selectedAttempt ?? null,
          violations: replayData.liveVerification?.violations ?? [],
          events: replayData.replay?.timeline ?? [],
          documents: [],
        });
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to export PDF evidence.');
    } finally {
      setExportingPdf(false);
    }
  };

  if (loading) {
    return (
      <Surface>
        <SkeletonRows rows={6} />
      </Surface>
    );
  }

  if (mandates.length === 0) {
    return (
      <EmptyState
        icon={History}
        title="No mandates available for Consent Drift Replay"
        description="Add a mandate or load the isolated synthetic demo dataset to replay historical authorization timelines and detect unauthorized changes."
        actions={
          <>
            <Button onClick={handleLoadDemo} disabled={loadingDemo}>
              <Database className="w-3.5 h-3.5" />
              {loadingDemo ? 'Loading Demo...' : 'Load Sample Demo Data'}
            </Button>
            <Button variant="outline" onClick={() => onNavigate('mandates')}>
              Go to Mandates
            </Button>
          </>
        }
      />
    );
  }

  const replay = replayData?.replay;
  const mandate = replayData?.mandate;
  const attempt = replayData?.selectedAttempt;
  const verification = replayData?.liveVerification;
  const storedVer = replayData?.storedVerification;
  const includedEvents = (replay?.timeline || []).filter((e: any) => e.includedInReplay);

  const visibleStepCount =
    stepIndex !== null ? Math.min(includedEvents.length, stepIndex + 1) : includedEvents.length;

  return (
    <div className="space-y-6">
      {/* Title & Replay Query Controls */}
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold text-blue-700">Signature Engine</p>
          <h1 className="text-xl font-bold tracking-tight text-slate-900 mt-0.5">
            Consent Drift Replay
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Reconstruct the exact customer authorization valid at any payment timestamp—independent
            of later merchant-side edits.
          </p>
        </div>

        {mandate?.isDemo && (
          <div className="flex items-center gap-2 text-xs text-slate-600">
            <DemoMarker />
            <span>· Synthetic demonstration mandate</span>
          </div>
        )}
      </div>

      {error && (
        <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">
          {error}
        </div>
      )}

      {/* Control Bar: Mandate Selector, Payment Attempt Selector, Custom Timestamp Query */}
      <Surface className="p-5">
        <div className="grid md:grid-cols-12 gap-4 items-end">
          <div className="md:col-span-4">
            <FieldLabel>1. Select Mandate</FieldLabel>
            <SelectInput
              value={selectedMandateId ?? ''}
              onChange={(e) => handleMandateChange(e.target.value)}
            >
              {mandates.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.mandateCode} — {m.merchantName} {m.isDemo ? '(DEMO)' : ''}
                </option>
              ))}
            </SelectInput>
          </div>

          <div className="md:col-span-4">
            <FieldLabel>2. Select Payment Attempt</FieldLabel>
            <SelectInput
              value={selectedAttemptId ?? ''}
              onChange={(e) => handleAttemptChange(e.target.value)}
            >
              <option value="">Latest state / custom timestamp only</option>
              {(replayData?.availableAttempts || []).map((a: any) => (
                <option key={a.id} value={a.id}>
                  {a.attemptUid} · {formatCurrency(a.attemptedAmount, a.currency)} ·{' '}
                  {formatDateTime(a.attemptTimestamp)} ({a.verificationStatus || 'UNVERIFIED'})
                </option>
              ))}
            </SelectInput>
          </div>

          <form onSubmit={handleCustomTimeQuery} className="md:col-span-4 flex items-end gap-2">
            <div className="flex-1">
              <FieldLabel>3. Or Query Historical Timestamp</FieldLabel>
              <TextInput
                type="datetime-local"
                value={customTimestamp}
                onChange={(e) => setCustomTimestamp(e.target.value)}
                className="text-xs"
              />
            </div>
            <Button type="submit" variant="outline" size="md" disabled={!customTimestamp || replaying}>
              Replay As-Of
            </Button>
          </form>
        </div>

        {/* Interactive Step-Through Playback Controls */}
        {replay && (
          <div className="mt-4 pt-4 border-t border-slate-100 flex flex-wrap items-center justify-between gap-3 text-xs">
            <div className="flex items-center gap-2 text-slate-600 font-mono">
              <Clock className="w-3.5 h-3.5 text-blue-700" />
              <span>Replay Timestamp:</span>
              <span className="font-semibold text-slate-900">
                {formatDateTime(replay.asOfTimestamp)}
              </span>
              <span className="text-slate-300">|</span>
              <span>
                {visibleStepCount} / {includedEvents.length} historical events replayed
              </span>
              {replay.deduplicatedEventCount > 0 && (
                <span className="text-slate-500">
                  ({replay.deduplicatedEventCount} duplicate event ignored)
                </span>
              )}
            </div>

            <div className="flex items-center gap-1.5">
              <Button
                size="sm"
                variant="outline"
                disabled={includedEvents.length === 0}
                onClick={() => {
                  setStepIndex(0);
                  setIsPlaying(true);
                }}
              >
                <Play className="w-3 h-3" />
                Step Replay
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={includedEvents.length === 0}
                onClick={() => {
                  setIsPlaying(false);
                  setStepIndex((prev) => {
                    const cur = prev === null ? includedEvents.length - 1 : prev;
                    return Math.max(0, cur - 1);
                  });
                }}
                aria-label="Previous event"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={includedEvents.length === 0}
                onClick={() => {
                  setIsPlaying(false);
                  setStepIndex((prev) => {
                    if (prev === null) return includedEvents.length - 1;
                    return Math.min(includedEvents.length - 1, prev + 1);
                  });
                }}
                aria-label="Next event"
              >
                <ChevronRight className="w-3.5 h-3.5" />
              </Button>
              {stepIndex !== null && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setIsPlaying(false);
                    setStepIndex(null);
                  }}
                >
                  <RotateCcw className="w-3 h-3" />
                  Full State
                </Button>
              )}
            </div>
          </div>
        )}
      </Surface>

      {replaying || !replay ? (
        <Surface>
          <SkeletonRows rows={5} />
        </Surface>
      ) : (
        <>
          {/* B. THREE-PANEL AUTHORIZATION COMPARISON */}
          <div className="grid lg:grid-cols-3 gap-5">
            {/* Panel 1: Original Customer Consent */}
            <Surface className="p-5">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                01. Original Customer Consent
              </div>
              <div className="text-2xl font-mono font-bold text-slate-900 mt-2 tabular-nums">
                {formatCurrency(replay.originalConsent.amount, replay.originalConsent.currency)}
              </div>
              <div className="text-xs text-slate-600 mt-1">
                {humanizeEnum(replay.originalConsent.billingFrequency)} ·{' '}
                {replay.originalConsent.billingSchedule}
              </div>
              <dl className="mt-4 pt-3.5 border-t border-slate-100 space-y-2 text-xs">
                <div className="flex justify-between gap-2">
                  <dt className="text-slate-500">Merchant</dt>
                  <dd className="font-medium text-slate-900 text-right truncate">
                    {replay.originalConsent.merchantName}
                  </dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-slate-500">Consent Timestamp</dt>
                  <dd className="font-mono text-slate-700 tabular-nums">
                    {formatDateTime(replay.originalConsent.effectiveTimestamp)}
                  </dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-slate-500">Evidence Status</dt>
                  <dd className="font-mono text-slate-700">
                    {replay.originalConsent.consentEvidenceStatus}
                    {replay.originalConsent.consentEvidenceRef
                      ? ` (${replay.originalConsent.consentEvidenceRef})`
                      : ''}
                  </dd>
                </div>
              </dl>
            </Surface>

            {/* Panel 2: Current Merchant-Side Record */}
            <Surface className="p-5">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                02. Merchant-Side Record (At Replay Time)
              </div>
              <div
                className={`text-2xl font-mono font-bold mt-2 tabular-nums ${
                  Math.abs(
                    replay.merchantSideRecord.amount - replay.reconstructedAuthorization.amount
                  ) > 0.01
                    ? 'text-amber-700'
                    : 'text-slate-900'
                }`}
              >
                {formatCurrency(replay.merchantSideRecord.amount, replay.merchantSideRecord.currency)}
              </div>
              <div className="text-xs text-slate-600 mt-1">
                {humanizeEnum(replay.merchantSideRecord.billingFrequency)} · Mandate Record Status:{' '}
                <span className="font-semibold text-slate-900">{mandate.status}</span>
              </div>
              <dl className="mt-4 pt-3.5 border-t border-slate-100 space-y-2 text-xs">
                <div className="flex justify-between gap-2">
                  <dt className="text-slate-500">Merchant ID</dt>
                  <dd className="font-mono text-slate-900">{replay.merchantSideRecord.merchantId}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-slate-500">Approved Modifications</dt>
                  <dd className="font-mono font-semibold text-emerald-700">
                    {replay.approvedModifications.length}
                  </dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-slate-500">Unsupported Changes</dt>
                  <dd
                    className={`font-mono font-semibold ${
                      replay.unsupportedModifications.length > 0 ? 'text-red-700' : 'text-slate-700'
                    }`}
                  >
                    {replay.unsupportedModifications.length}
                  </dd>
                </div>
              </dl>
            </Surface>

            {/* Panel 3: Actual Payment Attempt */}
            <Surface
              className={`p-5 ${
                verification?.status === 'BLOCKED'
                  ? 'border-red-300 bg-red-50/20'
                  : verification?.status === 'FLAGGED'
                    ? 'border-amber-300 bg-amber-50/20'
                    : verification?.status === 'VERIFIED'
                      ? 'border-emerald-300 bg-emerald-50/20'
                      : ''
              }`}
            >
              <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                03. Actual Payment Attempt
              </div>
              {attempt && verification ? (
                <>
                  <div className="flex items-baseline justify-between gap-2 mt-2">
                    <div
                      className={`text-2xl font-mono font-bold tabular-nums ${
                        verification.amountDelta > 0 ? 'text-red-700' : 'text-slate-900'
                      }`}
                    >
                      {formatCurrency(attempt.attemptedAmount, attempt.currency)}
                    </div>
                    <StatusLabel status={verification.status} />
                  </div>
                  <div className="text-xs text-slate-600 mt-1">
                    {attempt.attemptUid} · {formatDateTime(attempt.attemptTimestamp)}
                  </div>
                  <dl className="mt-4 pt-3.5 border-t border-slate-200/70 space-y-2 text-xs">
                    <div className="flex justify-between gap-2">
                      <dt className="text-slate-500">Valid Auth at Timestamp</dt>
                      <dd className="font-mono font-semibold text-slate-900 tabular-nums">
                        {formatCurrency(
                          replay.reconstructedAuthorization.amount,
                          replay.reconstructedAuthorization.currency
                        )}{' '}
                        ({replay.reconstructedAuthorization.status})
                      </dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt className="text-slate-500">Amount Mismatch</dt>
                      <dd
                        className={`font-mono font-semibold tabular-nums ${
                          verification.amountDelta !== 0 ? 'text-red-700' : 'text-emerald-700'
                        }`}
                      >
                        {verification.amountDelta > 0 ? '+' : ''}
                        {formatCurrency(verification.amountDelta, attempt.currency)}
                      </dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt className="text-slate-500">Attempted Merchant</dt>
                      <dd className="font-mono text-slate-800 truncate">
                        {attempt.attemptedMerchantId}
                      </dd>
                    </div>
                  </dl>
                </>
              ) : (
                <div className="mt-4 text-xs text-slate-500 leading-relaxed">
                  No payment attempt selected. Reconstructed valid customer authorization at{' '}
                  <span className="font-mono text-slate-800">
                    {formatDateTime(replay.asOfTimestamp)}
                  </span>{' '}
                  is{' '}
                  <span className="font-mono font-semibold text-slate-900">
                    {formatCurrency(
                      replay.reconstructedAuthorization.amount,
                      replay.reconstructedAuthorization.currency
                    )}
                  </span>{' '}
                  ({replay.reconstructedAuthorization.status}).
                </div>
              )}
            </Surface>
          </div>

          {/* C & D: REPLAY RESULT + EVIDENCE PANEL */}
          <div className="grid lg:grid-cols-12 gap-6">
            {/* A. Chronological Historical Timeline */}
            <Surface className="lg:col-span-7 p-5">
              <div className="flex items-center justify-between gap-3 mb-4">
                <div>
                  <h2 className="text-sm font-semibold text-slate-900">
                    Historical Mandate Timeline
                  </h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Chronological event replay up to {formatDateTime(replay.asOfTimestamp)}
                  </p>
                </div>
                <span className="text-xs font-mono text-slate-500">
                  {replay.timeline.length} total event(s)
                </span>
              </div>

              <div className="space-y-3">
                {replay.timeline.map((ev: any, idx: number) => {
                  const isExcludedByTime = !ev.includedInReplay;
                  const isBeyondStep =
                    stepIndex !== null && ev.includedInReplay && idx > stepIndex;
                  const isDrift = ev.driftFlag === 'UNSUPPORTED_CHANGE';
                  const isBlocker = ev.driftFlag === 'STATE_BLOCKER';
                  const isMissing =
                    ev.driftFlag === 'MISSING_EVIDENCE' || ev.driftFlag === 'AMBIGUOUS_EVIDENCE';

                  return (
                    <div
                      key={`${ev.eventUid}-${idx}`}
                      className={`p-3.5 rounded-lg border text-xs transition-opacity ${
                        isExcludedByTime || isBeyondStep
                          ? 'opacity-45 bg-slate-50 border-slate-200 border-dashed'
                          : isDrift || isBlocker
                            ? 'bg-red-50/40 border-red-200'
                            : isMissing
                              ? 'bg-amber-50/40 border-amber-200'
                              : 'bg-white border-slate-200'
                      }`}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-[11px] text-slate-500 tabular-nums">
                            {formatDateTime(ev.eventTimestamp)}
                          </span>
                          <span className="text-slate-300">·</span>
                          <span className="font-semibold text-slate-900">
                            {humanizeEnum(ev.eventType)}
                          </span>
                        </div>
                        <span className="font-mono text-[11px] text-slate-500">
                          {ev.actor} · {ev.eventUid}
                        </span>
                      </div>

                      <p className="text-slate-700 mt-1.5 leading-relaxed">{ev.summary}</p>

                      <div className="mt-2 pt-2 border-t border-slate-100 space-y-2 text-[11px] text-slate-500">
                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                          {isPaymentLifecycleEvent(ev.eventType) ? (
                            <span>
                              Event Class:{' '}
                              <strong className="text-slate-700">
                                Payment Event (Non-Modification)
                              </strong>
                            </span>
                          ) : (
                            <span>
                              Consent:{' '}
                              <strong
                                className={
                                  ev.customerApproved ? 'text-emerald-700' : 'text-slate-700'
                                }
                              >
                                {ev.customerApproved ? 'Customer Approved' : 'Not Customer-Approved'}
                              </strong>
                            </span>
                          )}
                          <span>
                            Evidence: <strong className="font-mono">{ev.evidenceStatus}</strong>
                            {ev.evidenceRef ? ` (${ev.evidenceRef})` : ''}
                          </span>
                        </div>
                        {(ev.previousValue || ev.newValue) && (
                          <EventPayloadViewer
                            eventType={ev.eventType}
                            previousValue={ev.previousValue}
                            newValue={ev.newValue}
                            currency={mandate?.currency}
                          />
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </Surface>

            {/* C + D: Replay Decision & Evidence Panel */}
            <div className="lg:col-span-5 space-y-5">
              {/* Reconstructed Authorization Summary */}
              <Surface className="p-5 space-y-4">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="text-sm font-semibold text-slate-900">Replay Verdict & Evidence</h2>
                  {verification && <StatusLabel status={verification.status} />}
                </div>

                {/* Forensic Explanation */}
                <div className="p-3.5 rounded-lg bg-slate-50 border border-slate-200 space-y-2 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-slate-900 flex items-center gap-1.5">
                      <Sparkles className="w-3.5 h-3.5 text-blue-700" />
                      Forensic Explanation
                    </span>
                    {storedVer && (
                      <button
                        type="button"
                        disabled={explaining}
                        onClick={handleExplainWithGemini}
                        className="text-blue-700 font-medium hover:underline inline-flex items-center gap-1 cursor-pointer disabled:opacity-50"
                      >
                        <RefreshCw className="w-3 h-3" />
                        {explaining ? 'Generating...' : 'Explain with Gemini'}
                      </button>
                    )}
                  </div>
                  <p className="text-slate-700 leading-relaxed">
                    {storedVer?.aiExplanation ||
                      verification?.deterministicExplanation ||
                      `At ${formatDateTime(replay.asOfTimestamp)}, valid customer authorization was ${formatCurrency(replay.reconstructedAuthorization.amount, replay.reconstructedAuthorization.currency)} (${replay.reconstructedAuthorization.billingFrequency}) with status ${replay.reconstructedAuthorization.status}.`}
                  </p>
                </div>

                {/* Approved vs Unsupported Modifications */}
                <div className="space-y-2.5 text-xs">
                  <div className="font-semibold text-slate-900">
                    Approved Modifications ({replay.approvedModifications.length})
                  </div>
                  {replay.approvedModifications.length === 0 ? (
                    <p className="text-slate-500">No customer-approved modifications before timestamp.</p>
                  ) : (
                    replay.approvedModifications.map((m: any) => (
                      <div
                        key={m.eventUid}
                        className="p-2.5 rounded-md bg-emerald-50/60 border border-emerald-200 text-emerald-900"
                      >
                        <div className="font-medium flex items-center gap-1.5">
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-700 shrink-0" />
                          {m.reason}
                        </div>
                        <div className="font-mono text-[11px] text-emerald-800 mt-1">
                          {m.eventUid} · Ref {m.customerApprovalRef || m.evidenceRef}
                        </div>
                      </div>
                    ))
                  )}
                </div>

                <div className="space-y-2.5 text-xs pt-2 border-t border-slate-100">
                  <div className="font-semibold text-slate-900">
                    Unsupported Merchant Modifications ({replay.unsupportedModifications.length})
                  </div>
                  {replay.unsupportedModifications.length === 0 ? (
                    <p className="text-slate-500">No unsupported merchant-side changes detected.</p>
                  ) : (
                    replay.unsupportedModifications.map((m: any) => (
                      <div
                        key={m.eventUid}
                        className="p-2.5 rounded-md bg-red-50/60 border border-red-200 text-red-900"
                      >
                        <div className="font-medium flex items-center gap-1.5">
                          <ShieldAlert className="w-3.5 h-3.5 text-red-700 shrink-0" />
                          {m.reason}
                        </div>
                        <div className="font-mono text-[11px] text-red-800 mt-1">
                          {m.eventUid} · {formatDateTime(m.eventTimestamp)} · Evidence: {m.evidenceStatus}
                        </div>
                      </div>
                    ))
                  )}
                </div>

                {/* Rule Violations */}
                {verification && verification.violations.length > 0 && (
                  <div className="space-y-2.5 text-xs pt-2 border-t border-slate-100">
                    <div className="font-semibold text-slate-900">
                      Rule Violations ({verification.violations.length})
                    </div>
                    {verification.violations.map((v: any, idx: number) => (
                      <div
                        key={`${v.violationType}-${idx}`}
                        className="p-3 rounded-lg border border-slate-200 bg-white space-y-1"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-semibold text-slate-900 flex items-center gap-1.5">
                            <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
                            {humanizeEnum(v.violationType)}
                          </span>
                          <span className="font-mono text-[11px] text-slate-500">
                            {v.severity} · {humanizeEnum(v.classification)}
                          </span>
                        </div>
                        <p className="text-slate-600 leading-relaxed">{v.explanation}</p>
                      </div>
                    ))}
                  </div>
                )}

                <div className="pt-3 border-t border-slate-100 space-y-2">
                  <Button
                    className="w-full"
                    variant="outline"
                    disabled={exportingPdf}
                    onClick={handleExportPdf}
                  >
                    <Download className="w-3.5 h-3.5" />
                    {exportingPdf ? 'Generating PDF...' : 'Export PDF Evidence Report'}
                  </Button>
                  {storedVer && storedVer.status !== 'VERIFIED' && (
                    <Button
                      className="w-full"
                      variant="secondary"
                      disabled={openingCase}
                      onClick={handleOpenInvestigation}
                    >
                      <Briefcase className="w-3.5 h-3.5" />
                      {openingCase ? 'Opening Investigation...' : 'Open / View Investigation Case'}
                    </Button>
                  )}
                </div>
              </Surface>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
