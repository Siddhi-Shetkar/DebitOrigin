import React, { useEffect, useState, useCallback, useMemo } from 'react';
import {
  AlertTriangle,
  Briefcase,
  CheckCircle2,
  Database,
  Download,
  FileText,
  History,
  MessageSquarePlus,
  Search,
} from 'lucide-react';
import { apiRequest, ApiError } from '../lib/api.ts';
import {
  downloadInvestigationPdf,
  formatCurrency,
  formatDateTime,
  humanizeEnum,
} from '../lib/utils.ts';
import {
  Button,
  DemoMarker,
  EmptyState,
  FieldLabel,
  SelectInput,
  SkeletonRows,
  StatusLabel,
  Surface,
  TextAreaInput,
  TextInput,
} from './ui/Primitives.tsx';

export function InvestigationsPage({
  initialCaseId,
  onClearInitialCaseId,
  onOpenReplay,
  onNavigate,
}: {
  initialCaseId?: number | null;
  onClearInitialCaseId?: () => void;
  onOpenReplay: (mandateId: number, paymentAttemptId?: number) => void;
  onNavigate?: (tab: string) => void;
}) {
  const [cases, setCases] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingDemo, setLoadingDemo] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [selectedCaseId, setSelectedCaseId] = useState<number | null>(initialCaseId ?? null);
  const [detail, setDetail] = useState<any>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  // Case update form
  const [statusVal, setStatusVal] = useState('UNDER_REVIEW');
  const [severityVal, setSeverityVal] = useState('HIGH');
  const [decisionVal, setDecisionVal] = useState('');
  const [decisionSummary, setDecisionSummary] = useState('');
  const [updating, setUpdating] = useState(false);

  // Note form
  const [noteContent, setNoteContent] = useState('');
  const [addingNote, setAddingNote] = useState(false);

  const loadCases = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiRequest<{ cases: any[] }>('/api/investigations?scope=all');
      setCases(res.cases);
    } catch (err: any) {
      setError(err?.message || 'Unable to load investigation cases.');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadDetail = useCallback(async (id: number) => {
    setSelectedCaseId(id);
    setDetailLoading(true);
    setError(null);
    try {
      const res = await apiRequest(`/api/investigations/${id}`);
      setDetail(res);
      setStatusVal(res.case.status);
      setSeverityVal(res.case.severity);
      setDecisionVal(res.case.decision || '');
      setDecisionSummary(res.case.decisionSummary || '');
    } catch (err: any) {
      setError(err?.message || 'Unable to load case details.');
    } finally {
      setDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    loadCases();
  }, [loadCases]);

  useEffect(() => {
    if (initialCaseId) {
      loadDetail(initialCaseId);
      onClearInitialCaseId?.();
    } else if (!selectedCaseId && cases.length > 0) {
      loadDetail(cases[0].id);
    }
  }, [initialCaseId, cases, selectedCaseId, loadDetail, onClearInitialCaseId]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return cases.filter((c) => {
      if (statusFilter !== 'ALL' && c.status !== statusFilter) return false;
      if (!q) return true;
      return (
        c.caseUid.toLowerCase().includes(q) ||
        c.title.toLowerCase().includes(q) ||
        c.mandateCode.toLowerCase().includes(q) ||
        c.merchantName.toLowerCase().includes(q)
      );
    });
  }, [cases, search, statusFilter]);

  const handleSaveCase = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCaseId) return;
    setUpdating(true);
    setError(null);
    try {
      await apiRequest(`/api/investigations/${selectedCaseId}`, {
        method: 'PATCH',
        body: {
          status: statusVal,
          severity: severityVal,
          decision: decisionVal || null,
          decisionSummary: decisionSummary.trim() || null,
        },
      });
      setBanner('Investigation case updated and recorded in audit trail.');
      await Promise.all([loadDetail(selectedCaseId), loadCases()]);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to update investigation case.');
    } finally {
      setUpdating(false);
    }
  };

  const handleAddNote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCaseId || !noteContent.trim()) return;
    setAddingNote(true);
    setError(null);
    try {
      await apiRequest(`/api/investigations/${selectedCaseId}/notes`, {
        method: 'POST',
        body: { content: noteContent.trim() },
      });
      setNoteContent('');
      await loadDetail(selectedCaseId);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to add note.');
    } finally {
      setAddingNote(false);
    }
  };

  const handleLoadDemo = async () => {
    setLoadingDemo(true);
    setError(null);
    try {
      await apiRequest('/api/demo/load', { method: 'POST' });
      setBanner('Synthetic demo dataset loaded with linked investigation cases.');
      await loadCases();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to load sample demo data.');
    } finally {
      setLoadingDemo(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-slate-900">Investigations</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Review flagged payment attempts, document human compliance decisions, and export PDF
            evidence reports.
          </p>
        </div>
      </div>

      {banner && (
        <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-xs text-emerald-800 flex items-center justify-between">
          <span className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            {banner}
          </span>
          <button
            type="button"
            onClick={() => setBanner(null)}
            className="text-emerald-700 font-semibold hover:underline cursor-pointer"
          >
            Dismiss
          </button>
        </div>
      )}

      {error && (
        <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">
          {error}
        </div>
      )}

      {loading ? (
        <Surface>
          <SkeletonRows rows={5} />
        </Surface>
      ) : cases.length === 0 ? (
        <EmptyState
          icon={Briefcase}
          title="No investigation cases opened yet"
          description="Open a case from any Flagged, Blocked, or Needs Review payment attempt in Payment Verification, or load the synthetic demo dataset to explore linked investigations."
          actions={
            <>
              <Button size="sm" onClick={handleLoadDemo} disabled={loadingDemo}>
                <Database className="w-3.5 h-3.5" />
                {loadingDemo ? 'Loading Demo...' : 'Load Sample Demo Data'}
              </Button>
              {onNavigate && (
                <Button size="sm" variant="outline" onClick={() => onNavigate('verification')}>
                  Go to Payment Verification
                </Button>
              )}
            </>
          }
        />
      ) : (
        <div className="grid lg:grid-cols-12 gap-6 items-start">
          {/* Left Case Queue */}
          <Surface className="lg:col-span-4 overflow-hidden">
            <div className="p-3.5 border-b border-slate-200 space-y-2.5">
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <TextInput
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search cases..."
                  className="pl-8 py-1.5 text-xs"
                />
              </div>
              <SelectInput
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="py-1.5 text-xs"
              >
                <option value="ALL">All Statuses</option>
                <option value="OPEN">Open</option>
                <option value="UNDER_REVIEW">Under Review</option>
                <option value="CLOSED">Closed</option>
                <option value="REOPENED">Reopened</option>
              </SelectInput>
            </div>

            <div className="divide-y divide-slate-100 max-h-[640px] overflow-y-auto">
              {filtered.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => loadDetail(c.id)}
                  className={`w-full text-left p-4 transition-colors cursor-pointer ${
                    selectedCaseId === c.id ? 'bg-blue-50/60' : 'hover:bg-slate-50'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="font-mono font-semibold text-slate-900 flex items-center gap-1.5">
                      {c.caseUid}
                      {c.isDemo && <DemoMarker />}
                    </span>
                    <StatusLabel status={c.status} />
                  </div>
                  <div className="text-xs font-medium text-slate-800 mt-1 line-clamp-2">
                    {c.title}
                  </div>
                  <div className="text-[11px] text-slate-500 mt-1 font-mono tabular-nums">
                    {c.mandateCode} · {formatCurrency(c.attemptedAmount, c.currency)} · {c.severity}
                  </div>
                  {Array.isArray(c.violationCategories) && c.violationCategories.length > 0 && (
                    <div className="text-[11px] text-red-700 mt-1 line-clamp-1">
                      {c.violationCategories.map((v: string) => humanizeEnum(v)).join(', ')}
                    </div>
                  )}
                </button>
              ))}
            </div>
          </Surface>

          {/* Right Case Workspace */}
          <Surface className="lg:col-span-8 p-6 space-y-6">
            {detailLoading || !detail ? (
              <SkeletonRows rows={6} />
            ) : (
              <>
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 pb-5 border-b border-slate-200">
                  <div>
                    <div className="flex items-center gap-2.5 flex-wrap">
                      <span className="font-mono text-sm font-bold text-slate-900">
                        {detail.case.caseUid}
                      </span>
                      <StatusLabel status={detail.case.status} />
                      <StatusLabel status={detail.case.severity} />
                      {detail.case.isDemo && <DemoMarker />}
                    </div>
                    <h2 className="text-base font-semibold text-slate-900 mt-1.5">
                      {detail.case.title}
                    </h2>
                    <p className="text-xs text-slate-500 mt-0.5">
                      {detail.mandate?.mandateCode} · {detail.mandate?.merchantName} · Customer:{' '}
                      {detail.mandate?.customerName}
                    </p>
                  </div>

                  <div className="flex items-center gap-2 shrink-0 flex-wrap">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        onOpenReplay(detail.case.mandateId, detail.case.paymentAttemptId)
                      }
                    >
                      <History className="w-3.5 h-3.5" />
                      Drift Replay
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() =>
                        downloadInvestigationPdf({
                          caseData: detail.case,
                          mandate: detail.mandate,
                          paymentAttempt: detail.paymentAttempt,
                          verification: detail.verification,
                          violations: detail.violations,
                          notes: detail.notes,
                          events: detail.events,
                          documents: detail.documents ?? [],
                        })
                      }
                    >
                      <Download className="w-3.5 h-3.5" />
                      Export PDF Evidence
                    </Button>
                  </div>
                </div>

                {/* Evidence Summary */}
                {detail.verification && (
                  <div className="p-4 rounded-lg bg-slate-50 border border-slate-200 space-y-2.5 text-xs">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-semibold text-slate-900">
                        Verification Evidence ({detail.paymentAttempt?.attemptUid})
                      </span>
                      <span className="font-mono text-slate-700 tabular-nums">
                        Attempted{' '}
                        <strong className="text-red-700">
                          {formatCurrency(
                            detail.verification.attemptedAmount,
                            detail.verification.currency
                          )}
                        </strong>{' '}
                        vs Authorized{' '}
                        <strong>
                          {formatCurrency(
                            detail.verification.expectedAuthorizedAmount,
                            detail.verification.currency
                          )}
                        </strong>
                      </span>
                    </div>
                    <p className="text-slate-700 leading-relaxed">
                      {detail.verification.aiExplanation ||
                        detail.verification.deterministicExplanation}
                    </p>
                  </div>
                )}

                {/* Detected Violations & Consent Evidence Artifacts */}
                <div className="grid md:grid-cols-2 gap-4 text-xs">
                  <div className="p-4 rounded-lg border border-slate-200 space-y-2.5">
                    <div className="font-semibold text-slate-900 flex items-center gap-1.5">
                      <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
                      Detected Violations ({detail.violations?.length || 0})
                    </div>
                    {!detail.violations?.length ? (
                      <p className="text-slate-500">No deterministic rule violations recorded.</p>
                    ) : (
                      <div className="space-y-2">
                        {detail.violations.map((viol: any) => (
                          <div
                            key={viol.id}
                            className="p-2.5 rounded-md bg-slate-50 border border-slate-200 space-y-1"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-semibold text-slate-900">
                                {humanizeEnum(viol.violationType)}
                              </span>
                              <span className="font-mono text-[10px] text-slate-500">
                                {viol.severity}
                              </span>
                            </div>
                            <p className="text-slate-600 leading-relaxed">{viol.explanation}</p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="p-4 rounded-lg border border-slate-200 space-y-2.5">
                    <div className="font-semibold text-slate-900 flex items-center gap-1.5">
                      <FileText className="w-3.5 h-3.5 text-blue-700" />
                      Available Consent Evidence
                    </div>
                    <div className="p-2.5 rounded-md bg-slate-50 border border-slate-200 space-y-1">
                      <div className="text-[11px] text-slate-500">Primary Consent Reference</div>
                      <div className="font-mono font-semibold text-slate-900">
                        {detail.mandate?.consentEvidenceRef || 'Missing / Unverified'}
                      </div>
                      <div className="text-[11px] text-slate-500">
                        Original Consent:{' '}
                        {detail.mandate
                          ? `${formatCurrency(detail.mandate.authorizedAmount, detail.mandate.currency)} · ${humanizeEnum(detail.mandate.billingFrequency)}`
                          : 'Unavailable'}
                      </div>
                    </div>
                    {detail.documents && detail.documents.length > 0 ? (
                      <div className="space-y-1.5">
                        {detail.documents.map((doc: any) => (
                          <div
                            key={doc.id}
                            className="p-2.5 rounded-md bg-white border border-slate-200 flex items-center justify-between gap-2"
                          >
                            <div className="min-w-0">
                              <div className="font-medium text-slate-900 truncate">
                                {doc.fileName}
                              </div>
                              <div className="font-mono text-[10px] text-slate-500">
                                {doc.storageRef} · {formatDateTime(doc.uploadedAt)}
                              </div>
                            </div>
                            {doc.isDemo && <DemoMarker />}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-slate-500">
                        No uploaded consent document file attached to this mandate.
                      </p>
                    )}
                  </div>
                </div>

                {/* Human Decision & Case Controls */}
                <form
                  onSubmit={handleSaveCase}
                  className="p-4 rounded-lg border border-slate-200 space-y-4"
                >
                  <h3 className="text-sm font-semibold text-slate-900">
                    Case Disposition & Human Review Decision
                  </h3>
                  <div className="grid sm:grid-cols-3 gap-3.5">
                    <div>
                      <FieldLabel>Status</FieldLabel>
                      <SelectInput value={statusVal} onChange={(e) => setStatusVal(e.target.value)}>
                        <option value="OPEN">Open</option>
                        <option value="UNDER_REVIEW">Under Review</option>
                        <option value="CLOSED">Closed</option>
                        <option value="REOPENED">Reopened</option>
                      </SelectInput>
                    </div>
                    <div>
                      <FieldLabel>Severity</FieldLabel>
                      <SelectInput
                        value={severityVal}
                        onChange={(e) => setSeverityVal(e.target.value)}
                      >
                        <option value="LOW">Low</option>
                        <option value="MEDIUM">Medium</option>
                        <option value="HIGH">High</option>
                        <option value="CRITICAL">Critical</option>
                      </SelectInput>
                    </div>
                    <div>
                      <FieldLabel>Reviewer Decision</FieldLabel>
                      <SelectInput
                        value={decisionVal}
                        onChange={(e) => setDecisionVal(e.target.value)}
                      >
                        <option value="">Pending Decision</option>
                        <option value="CONFIRMED_UNAUTHORIZED">Confirmed Unauthorized</option>
                        <option value="CUSTOMER_AUTHORIZED_VERIFIED">
                          Customer Authorized (Verified)
                        </option>
                        <option value="MERCHANT_ERROR">Merchant Configuration Error</option>
                        <option value="INSUFFICIENT_EVIDENCE">Insufficient Evidence</option>
                        <option value="ESCALATED">Escalated to Compliance</option>
                      </SelectInput>
                    </div>
                  </div>
                  <div>
                    <FieldLabel>Decision Rationale</FieldLabel>
                    <TextAreaInput
                      rows={2}
                      placeholder="Summarize supporting evidence and action taken..."
                      value={decisionSummary}
                      onChange={(e) => setDecisionSummary(e.target.value)}
                    />
                  </div>
                  <div className="flex justify-end">
                    <Button type="submit" size="sm" disabled={updating}>
                      {updating ? 'Saving...' : 'Save Disposition'}
                    </Button>
                  </div>
                </form>

                {/* Investigation Notes & History */}
                <div className="space-y-3">
                  <h3 className="text-sm font-semibold text-slate-900">
                    Case Notes & Audit History ({detail.notes.length})
                  </h3>

                  <form onSubmit={handleAddNote} className="flex gap-2">
                    <TextInput
                      value={noteContent}
                      onChange={(e) => setNoteContent(e.target.value)}
                      placeholder="Add an analyst investigation note..."
                      className="text-xs"
                    />
                    <Button type="submit" size="sm" variant="outline" disabled={addingNote || !noteContent.trim()}>
                      <MessageSquarePlus className="w-3.5 h-3.5" />
                      Add Note
                    </Button>
                  </form>

                  <div className="divide-y divide-slate-100 border border-slate-200 rounded-lg">
                    {detail.notes.map((n: any) => (
                      <div key={n.id} className="p-3.5 text-xs">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-semibold text-slate-900">
                            {n.authorName}{' '}
                            <span className="font-normal text-slate-500">
                              · {humanizeEnum(n.noteType)}
                            </span>
                          </span>
                          <span className="font-mono text-[11px] text-slate-400">
                            {formatDateTime(n.createdAt)}
                          </span>
                        </div>
                        <p className="text-slate-700 mt-1 leading-relaxed">{n.content}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}
          </Surface>
        </div>
      )}
    </div>
  );
}
