import React, { useEffect, useState, useCallback, useMemo } from 'react';
import {
  AlertTriangle,
  ArrowUpDown,
  Briefcase,
  CheckCircle2,
  Database,
  Download,
  History,
  Play,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { apiRequest, ApiError } from '../lib/api.ts';
import {
  downloadVerificationEvidencePdf,
  formatCurrency,
  formatDateTime,
  humanizeEnum,
} from '../lib/utils.ts';
import {
  Button,
  DemoMarker,
  EmptyState,
  FieldLabel,
  Modal,
  SelectInput,
  SkeletonRows,
  StatusLabel,
  Surface,
  TextInput,
} from './ui/Primitives.tsx';

export function PaymentVerificationPage({
  onOpenReplay,
  onOpenInvestigation,
}: {
  onOpenReplay: (mandateId: number, paymentAttemptId?: number) => void;
  onOpenInvestigation: (caseId: number) => void;
}) {
  const [verifications, setVerifications] = useState<any[]>([]);
  const [mandates, setMandates] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);

  // Filters
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [scope, setScope] = useState<'all' | 'user' | 'demo'>('all');
  const [sortBy, setSortBy] = useState<'attemptTimestamp' | 'attemptedAmount'>('attemptTimestamp');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  // Selected verification detail modal
  const [selectedVer, setSelectedVer] = useState<any>(null);
  const [explainingId, setExplainingId] = useState<number | null>(null);
  const [openingCaseId, setOpeningCaseId] = useState<number | null>(null);
  const [exportingPdfId, setExportingPdfId] = useState<number | null>(null);
  const [loadingDemo, setLoadingDemo] = useState(false);

  // Simulate payment modal
  const [simOpen, setSimOpen] = useState(false);
  const [simBusy, setSimBusy] = useState(false);
  const [simForm, setSimForm] = useState({
    mandateId: '',
    attemptedAmount: '',
    currency: 'INR',
    attemptTimestamp: new Date().toISOString().slice(0, 16),
    attemptedMerchantId: '',
    attemptedMerchantName: '',
    attemptedFrequency: 'MONTHLY',
    generateAiExplanation: true,
  });

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [verRes, mRes] = await Promise.all([
        apiRequest<{ verifications: any[] }>(`/api/verifications?scope=${scope}`),
        apiRequest<{ mandates: any[] }>('/api/mandates?scope=all'),
      ]);
      setVerifications(verRes.verifications);
      setMandates(mRes.mandates);
    } catch (err: any) {
      setError(err?.message || 'Unable to load payment verifications.');
    } finally {
      setLoading(false);
    }
  }, [scope]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const handleMandateSelect = (mandateIdStr: string) => {
    const m = mandates.find((x) => String(x.id) === mandateIdStr);
    if (!m) {
      setSimForm((f) => ({ ...f, mandateId: mandateIdStr }));
      return;
    }
    setSimForm((f) => ({
      ...f,
      mandateId: mandateIdStr,
      attemptedAmount: String(m.currentMerchantAmount),
      currency: m.currency,
      attemptedMerchantId: m.merchantId,
      attemptedMerchantName: m.merchantName,
      attemptedFrequency: m.currentMerchantFrequency,
    }));
  };

  const handleSimulate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!simForm.mandateId) return;
    setSimBusy(true);
    setError(null);
    try {
      const res = await apiRequest('/api/verifications/simulate', {
        method: 'POST',
        body: {
          mandateId: Number(simForm.mandateId),
          attemptedAmount: Number(simForm.attemptedAmount),
          currency: simForm.currency,
          attemptTimestamp: new Date(simForm.attemptTimestamp).toISOString(),
          attemptedMerchantId: simForm.attemptedMerchantId.trim(),
          attemptedMerchantName: simForm.attemptedMerchantName.trim(),
          attemptedFrequency: simForm.attemptedFrequency,
          generateAiExplanation: simForm.generateAiExplanation,
        },
      });
      setSimOpen(false);
      setBanner(
        `Payment attempt ${res.attempt.attemptUid} verified: outcome ${res.verification.status} (Expected ${res.verification.currency} ${res.verification.expectedAuthorizedAmount} vs Attempted ${res.verification.currency} ${res.verification.attemptedAmount}).`
      );
      await loadAll();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to verify payment attempt.');
    } finally {
      setSimBusy(false);
    }
  };

  const handleRegenerateExplanation = async (verId: number) => {
    setExplainingId(verId);
    setError(null);
    try {
      const res = await apiRequest(`/api/verifications/${verId}/explain`, { method: 'POST' });
      setVerifications((prev) =>
        prev.map((v) =>
          v.id === verId
            ? {
                ...v,
                aiExplanation: res.explanation,
                aiExplanationProvider: res.provider,
              }
            : v
        )
      );
      if (selectedVer?.id === verId) {
        setSelectedVer((prev: any) => ({
          ...prev,
          aiExplanation: res.explanation,
          aiExplanationProvider: res.provider,
        }));
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to generate forensic explanation.');
    } finally {
      setExplainingId(null);
    }
  };

  const handleOpenCase = async (ver: any) => {
    if (ver.investigationCaseId) {
      onOpenInvestigation(ver.investigationCaseId);
      return;
    }
    setOpeningCaseId(ver.id);
    setError(null);
    try {
      const res = await apiRequest<{ case: any }>('/api/investigations', {
        method: 'POST',
        body: {
          verificationResultId: ver.id,
          severity: ver.severity,
        },
      });
      await loadAll();
      onOpenInvestigation(res.case.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to open investigation case.');
    } finally {
      setOpeningCaseId(null);
    }
  };

  const handleLoadDemo = async () => {
    setLoadingDemo(true);
    setError(null);
    try {
      await apiRequest('/api/demo/load', { method: 'POST' });
      setScope('all');
      setBanner('Synthetic demo dataset loaded with verified and suspicious payment examples.');
      await loadAll();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to load sample demo data.');
    } finally {
      setLoadingDemo(false);
    }
  };

  const handleExportPdf = async (verId: number) => {
    setExportingPdfId(verId);
    setError(null);
    try {
      const evidence = await apiRequest<any>(`/api/verifications/${verId}/evidence`);
      downloadVerificationEvidencePdf(evidence);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to export PDF evidence report.');
    } finally {
      setExportingPdfId(null);
    }
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return verifications
      .filter((v) => {
        if (statusFilter !== 'ALL' && v.status !== statusFilter) return false;
        if (!q) return true;
        return (
          v.attemptUid.toLowerCase().includes(q) ||
          v.mandateCode.toLowerCase().includes(q) ||
          v.merchantName.toLowerCase().includes(q) ||
          v.customerName.toLowerCase().includes(q)
        );
      })
      .sort((a, b) => {
        const mult = sortDir === 'asc' ? 1 : -1;
        if (sortBy === 'attemptedAmount') return (a.attemptedAmount - b.attemptedAmount) * mult;
        return (
          (new Date(a.attemptTimestamp).getTime() - new Date(b.attemptTimestamp).getTime()) * mult
        );
      });
  }, [verifications, search, statusFilter, sortBy, sortDir]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-slate-900">Payment Verification</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Every simulated recurring debit is verified deterministically against reconstructed
            historical customer authorization.
          </p>
        </div>
        <Button
          size="sm"
          onClick={() => {
            if (mandates.length > 0 && !simForm.mandateId) {
              handleMandateSelect(String(mandates[0].id));
            }
            setSimOpen(true);
          }}
          disabled={mandates.length === 0}
        >
          <Play className="w-3.5 h-3.5" />
          Verify Payment Attempt
        </Button>
      </div>

      {banner && (
        <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-xs text-emerald-800 flex items-center justify-between gap-3">
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

      {/* Search & Filters */}
      <Surface className="p-4 flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <TextInput
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by attempt ID, mandate code, customer, or merchant..."
            className="pl-9 py-1.5 text-xs"
          />
        </div>

        <div className="flex items-center gap-2.5 flex-wrap">
          <SelectInput
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="w-40 py-1.5 text-xs"
            aria-label="Filter verification status"
          >
            <option value="ALL">All Outcomes</option>
            <option value="VERIFIED">Verified</option>
            <option value="FLAGGED">Flagged</option>
            <option value="BLOCKED">Blocked</option>
            <option value="NEEDS_REVIEW">Needs Review</option>
          </SelectInput>

          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
            {(
              [
                ['all', 'All'],
                ['user', 'My Data'],
                ['demo', 'Demo'],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                type="button"
                onClick={() => setScope(k)}
                className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors cursor-pointer ${
                  scope === k
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </Surface>

      {/* Verification Table */}
      <Surface className="overflow-hidden">
        {loading ? (
          <SkeletonRows rows={6} />
        ) : filtered.length === 0 ? (
          <div className="p-6">
            <EmptyState
              icon={ShieldCheck}
              title="No payment verification records"
              description="Simulate a recurring payment attempt against any monitored mandate, or load the synthetic demo dataset to inspect verified and unauthorized payment examples."
              actions={
                <>
                  {mandates.length > 0 && (
                    <Button
                      size="sm"
                      onClick={() => {
                        handleMandateSelect(String(mandates[0].id));
                        setSimOpen(true);
                      }}
                    >
                      Simulate Payment Attempt
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant={mandates.length > 0 ? 'outline' : 'primary'}
                    onClick={handleLoadDemo}
                    disabled={loadingDemo}
                  >
                    <Database className="w-3.5 h-3.5" />
                    {loadingDemo ? 'Loading Demo...' : 'Load Sample Demo Data'}
                  </Button>
                </>
              }
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/70 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                  <th className="py-2.5 px-4">Attempt / Mandate</th>
                  <th className="py-2.5 px-4">Merchant / Customer</th>
                  <th className="py-2.5 px-4 text-right">Authorized</th>
                  <th className="py-2.5 px-4 text-right">
                    <button
                      type="button"
                      onClick={() => {
                        if (sortBy === 'attemptedAmount') setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
                        else {
                          setSortBy('attemptedAmount');
                          setSortDir('desc');
                        }
                      }}
                      className="inline-flex items-center gap-1 hover:text-slate-900 cursor-pointer"
                    >
                      Attempted
                      <ArrowUpDown className="w-3 h-3" />
                    </button>
                  </th>
                  <th className="py-2.5 px-4">Outcome</th>
                  <th className="py-2.5 px-4">
                    <button
                      type="button"
                      onClick={() => {
                        if (sortBy === 'attemptTimestamp') setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
                        else {
                          setSortBy('attemptTimestamp');
                          setSortDir('desc');
                        }
                      }}
                      className="inline-flex items-center gap-1 hover:text-slate-900 cursor-pointer"
                    >
                      Timestamp
                      <ArrowUpDown className="w-3 h-3" />
                    </button>
                  </th>
                  <th className="py-2.5 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {filtered.map((v) => {
                  const delta = Number((v.attemptedAmount - v.expectedAuthorizedAmount).toFixed(2));
                  return (
                    <tr key={v.id} className="hover:bg-slate-50/70 transition-colors">
                      <td className="py-3 px-4">
                        <button
                          type="button"
                          onClick={() => setSelectedVer(v)}
                          className="font-mono font-semibold text-blue-700 hover:underline text-left cursor-pointer flex items-center gap-2"
                        >
                          {v.attemptUid}
                          {v.isDemo && <DemoMarker />}
                        </button>
                        <div className="font-mono text-[11px] text-slate-500 mt-0.5 flex items-center gap-1.5 flex-wrap">
                          <span>{v.mandateCode}</span>
                          <span className="text-slate-300">·</span>
                          <span>Mandate: {humanizeEnum(v.reconstructedMandateStatus || v.mandateStatus)}</span>
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        <div className="font-medium text-slate-900">{v.attemptedMerchantName}</div>
                        <div className="text-[11px] text-slate-500">{v.customerName}</div>
                      </td>
                      <td className="py-3 px-4 text-right font-mono text-slate-700 tabular-nums">
                        {formatCurrency(v.expectedAuthorizedAmount, v.currency)}
                      </td>
                      <td className="py-3 px-4 text-right font-mono tabular-nums">
                        <div
                          className={
                            delta > 0 ? 'font-semibold text-red-700' : 'font-semibold text-slate-900'
                          }
                        >
                          {formatCurrency(v.attemptedAmount, v.currency)}
                        </div>
                        {delta !== 0 && (
                          <div className="text-[11px] text-red-600">
                            {delta > 0 ? '+' : ''}
                            {formatCurrency(delta, v.currency)}
                          </div>
                        )}
                      </td>
                      <td className="py-3 px-4 max-w-[230px]">
                        <StatusLabel status={v.status} />
                        <div className="text-[11px] text-slate-600 mt-0.5 line-clamp-1">
                          {Array.isArray(v.violationCategories) && v.violationCategories.length > 0
                            ? v.violationCategories.map((c: string) => humanizeEnum(c)).join(', ')
                            : 'Matches reconstructed customer consent'}
                        </div>
                        <div className="text-[10px] text-slate-400 mt-0.5">
                          Severity {v.severity} · Signal {v.anomalyScore}/100
                        </div>
                      </td>
                      <td className="py-3 px-4 font-mono text-slate-500 whitespace-nowrap tabular-nums">
                        {formatDateTime(v.attemptTimestamp)}
                      </td>
                      <td className="py-3 px-4 text-right">
                        <div className="inline-flex items-center gap-1.5">
                          <Button size="sm" variant="outline" onClick={() => setSelectedVer(v)}>
                            Evidence
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={exportingPdfId === v.id}
                            onClick={() => handleExportPdf(v.id)}
                            title="Export PDF Evidence Report"
                          >
                            <Download className="w-3.5 h-3.5" />
                            {exportingPdfId === v.id ? '...' : 'PDF'}
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => onOpenReplay(v.mandateId, v.paymentAttemptId)}
                          >
                            <History className="w-3.5 h-3.5" />
                            Replay
                          </Button>
                          {v.status !== 'VERIFIED' && (
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={openingCaseId === v.id}
                              onClick={() => handleOpenCase(v)}
                            >
                              <Briefcase className="w-3.5 h-3.5" />
                              {v.investigationCaseUid ? v.investigationCaseUid : 'Investigate'}
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Surface>

      {/* Simulate Payment Attempt Modal */}
      <Modal
        open={simOpen}
        onClose={() => setSimOpen(false)}
        title="Verify Recurring Payment Attempt"
        subtitle="Simulation platform: verifies authorization deterministically without executing live bank debits."
      >
        <form onSubmit={handleSimulate} className="space-y-4">
          <div>
            <FieldLabel required>Select Mandate</FieldLabel>
            <SelectInput
              value={simForm.mandateId}
              onChange={(e) => handleMandateSelect(e.target.value)}
              required
            >
              <option value="">Choose a mandate...</option>
              {mandates.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.mandateCode} — {m.merchantName} ({formatCurrency(m.authorizedAmount, m.currency)}
                  {m.isDemo ? ' · DEMO' : ''})
                </option>
              ))}
            </SelectInput>
          </div>

          <div className="grid sm:grid-cols-2 gap-3.5">
            <div>
              <FieldLabel required>Attempted Amount</FieldLabel>
              <TextInput
                type="number"
                step="0.01"
                min="1"
                value={simForm.attemptedAmount}
                onChange={(e) => setSimForm({ ...simForm, attemptedAmount: e.target.value })}
                required
              />
            </div>
            <div>
              <FieldLabel required>Currency</FieldLabel>
              <SelectInput
                value={simForm.currency}
                onChange={(e) => setSimForm({ ...simForm, currency: e.target.value })}
              >
                <option value="INR">INR (₹)</option>
                <option value="USD">USD ($)</option>
                <option value="EUR">EUR (€)</option>
              </SelectInput>
            </div>
            <div>
              <FieldLabel required>Attempt Timestamp</FieldLabel>
              <TextInput
                type="datetime-local"
                value={simForm.attemptTimestamp}
                onChange={(e) => setSimForm({ ...simForm, attemptTimestamp: e.target.value })}
                required
              />
            </div>
            <div>
              <FieldLabel required>Attempted Billing Frequency</FieldLabel>
              <SelectInput
                value={simForm.attemptedFrequency}
                onChange={(e) => setSimForm({ ...simForm, attemptedFrequency: e.target.value })}
              >
                <option value="MONTHLY">Monthly</option>
                <option value="WEEKLY">Weekly</option>
                <option value="DAILY">Daily</option>
                <option value="QUARTERLY">Quarterly</option>
                <option value="YEARLY">Yearly</option>
                <option value="AS_PRESENTED">As Presented</option>
              </SelectInput>
            </div>
            <div>
              <FieldLabel required>Attempted Merchant ID</FieldLabel>
              <TextInput
                value={simForm.attemptedMerchantId}
                onChange={(e) => setSimForm({ ...simForm, attemptedMerchantId: e.target.value })}
                required
              />
            </div>
            <div>
              <FieldLabel required>Attempted Merchant Name</FieldLabel>
              <TextInput
                value={simForm.attemptedMerchantName}
                onChange={(e) => setSimForm({ ...simForm, attemptedMerchantName: e.target.value })}
                required
              />
            </div>
          </div>

          <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
            <input
              type="checkbox"
              checked={simForm.generateAiExplanation}
              onChange={(e) => setSimForm({ ...simForm, generateAiExplanation: e.target.checked })}
              className="rounded border-slate-300 text-blue-700"
            />
            Generate Gemini AI forensic narrative strictly from deterministic verification evidence
          </label>

          <div className="flex justify-end gap-3 pt-3 border-t border-slate-100">
            <Button type="button" variant="outline" onClick={() => setSimOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={simBusy || !simForm.mandateId}>
              {simBusy ? 'Verifying...' : 'Run Deterministic Verification'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Evidence & Forensic Explanation Modal */}
      <Modal
        open={Boolean(selectedVer)}
        onClose={() => setSelectedVer(null)}
        title={selectedVer ? `Verification Evidence — ${selectedVer.attemptUid}` : ''}
        subtitle={
          selectedVer
            ? `${selectedVer.mandateCode} · ${selectedVer.attemptedMerchantName} · ${formatDateTime(selectedVer.attemptTimestamp)}`
            : ''
        }
        wide
      >
        {selectedVer && (
          <div className="space-y-5 text-xs">
            <div className="grid sm:grid-cols-3 gap-3">
              <div className="p-3.5 rounded-lg bg-slate-50 border border-slate-200">
                <div className="text-slate-500">Verification Outcome</div>
                <div className="mt-1.5">
                  <StatusLabel status={selectedVer.status} />
                </div>
                <div className="text-[11px] text-slate-500 mt-1">
                  Severity {selectedVer.severity} · Secondary Anomaly Signal {selectedVer.anomalyScore}/100
                </div>
              </div>
              <div className="p-3.5 rounded-lg bg-slate-50 border border-slate-200">
                <div className="text-slate-500">Reconstructed Authorization</div>
                <div className="text-base font-mono font-bold text-slate-900 mt-1 tabular-nums">
                  {formatCurrency(selectedVer.expectedAuthorizedAmount, selectedVer.currency)}
                </div>
              </div>
              <div className="p-3.5 rounded-lg bg-slate-50 border border-slate-200">
                <div className="text-slate-500">Attempted Payment</div>
                <div
                  className={`text-base font-mono font-bold mt-1 tabular-nums ${
                    selectedVer.attemptedAmount > selectedVer.expectedAuthorizedAmount
                      ? 'text-red-700'
                      : 'text-slate-900'
                  }`}
                >
                  {formatCurrency(selectedVer.attemptedAmount, selectedVer.currency)}
                </div>
              </div>
            </div>

            {/* AI Forensic Explanation */}
            <div className="p-4 rounded-lg bg-blue-50/50 border border-blue-200 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold text-slate-900 flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-blue-700" />
                  Forensic Evidence Explanation
                </span>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[11px] text-slate-500">
                    {selectedVer.aiExplanationProvider || 'deterministic-engine'}
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={explainingId === selectedVer.id}
                    onClick={() => handleRegenerateExplanation(selectedVer.id)}
                  >
                    <RefreshCw className="w-3 h-3" />
                    {explainingId === selectedVer.id ? 'Explaining...' : 'Refresh with Gemini'}
                  </Button>
                </div>
              </div>
              <p className="text-slate-700 leading-relaxed text-xs">
                {selectedVer.aiExplanation || selectedVer.deterministicExplanation}
              </p>
            </div>

            {/* Violations */}
            <div>
              <h3 className="font-semibold text-slate-900 mb-2">
                Detected Rules ({selectedVer.violations?.length || 0})
              </h3>
              {!selectedVer.violations?.length ? (
                <p className="text-slate-500 p-3 rounded-lg bg-slate-50 border border-slate-200">
                  No authorization rule violations were detected at the attempt timestamp.
                </p>
              ) : (
                <div className="space-y-2.5">
                  {selectedVer.violations.map((viol: any) => (
                    <div
                      key={viol.id}
                      className="p-3.5 rounded-lg border border-slate-200 bg-white space-y-1.5"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold text-slate-900 flex items-center gap-1.5">
                          <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
                          {humanizeEnum(viol.violationType)}
                        </span>
                        <span className="font-mono text-[11px] text-slate-500">
                          {viol.severity} · {humanizeEnum(viol.classification)}
                        </span>
                      </div>
                      <p className="text-slate-600 leading-relaxed">{viol.explanation}</p>
                      {viol.relevantEventIds?.length > 0 && (
                        <div className="font-mono text-[11px] text-slate-500">
                          Relevant Events: {viol.relevantEventIds.join(', ')}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-center justify-end gap-2.5 pt-3 border-t border-slate-100">
              <Button
                variant="outline"
                disabled={exportingPdfId === selectedVer.id}
                onClick={() => handleExportPdf(selectedVer.id)}
              >
                <Download className="w-3.5 h-3.5" />
                {exportingPdfId === selectedVer.id ? 'Generating PDF...' : 'Export PDF Evidence'}
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  const mId = selectedVer.mandateId;
                  const aId = selectedVer.paymentAttemptId;
                  setSelectedVer(null);
                  onOpenReplay(mId, aId);
                }}
              >
                <History className="w-3.5 h-3.5" />
                Open in Consent Drift Replay
              </Button>
              {selectedVer.status !== 'VERIFIED' && (
                <Button onClick={() => handleOpenCase(selectedVer)}>
                  <Briefcase className="w-3.5 h-3.5" />
                  {selectedVer.investigationCaseUid ? 'View Investigation' : 'Open Investigation Case'}
                </Button>
              )}
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
