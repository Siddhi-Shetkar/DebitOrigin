import React, { useEffect, useState, useCallback } from 'react';
import {
  BarChart3,
  Database,
  Download,
  FileSpreadsheet,
  FlaskConical,
  Play,
} from 'lucide-react';
import { apiRequest } from '../lib/api.ts';
import {
  downloadOperationalReportPdf,
  exportToCsv,
  formatCurrency,
  formatDateTime,
  humanizeEnum,
} from '../lib/utils.ts';
import type { EvaluationReport } from '../shared/types.ts';
import {
  Button,
  DemoMarker,
  EmptyState,
  FieldLabel,
  SkeletonRows,
  StatusLabel,
  Surface,
  TextInput,
} from './ui/Primitives.tsx';

export function ReportsPage() {
  const [activeTab, setActiveTab] = useState<'operational' | 'evaluation'>('operational');

  // Operational report state
  const [scope, setScope] = useState<'all' | 'user' | 'demo'>('all');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [report, setReport] = useState<any>(null);
  const [loadingReport, setLoadingReport] = useState(true);

  // Benchmark evaluation state
  const [evalReport, setEvalReport] = useState<EvaluationReport | null>(null);
  const [runningEval, setRunningEval] = useState(false);
  const [loadingDemo, setLoadingDemo] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadReport = useCallback(async () => {
    setLoadingReport(true);
    setError(null);
    try {
      const qs = new URLSearchParams({ scope });
      if (fromDate) qs.set('from', fromDate);
      if (toDate) qs.set('to', toDate);
      const res = await apiRequest(`/api/reports?${qs.toString()}`);
      setReport(res);
    } catch (err: any) {
      setError(err?.message || 'Unable to generate report.');
    } finally {
      setLoadingReport(false);
    }
  }, [scope, fromDate, toDate]);

  useEffect(() => {
    loadReport();
  }, [loadReport]);

  const handleRunEvaluation = async () => {
    setRunningEval(true);
    setError(null);
    try {
      const res = await apiRequest<EvaluationReport>('/api/evaluation/run');
      setEvalReport(res);
    } catch (err: any) {
      setError(err?.message || 'Failed to execute evaluation benchmark.');
    } finally {
      setRunningEval(false);
    }
  };

  const handleLoadDemo = async () => {
    setLoadingDemo(true);
    setError(null);
    try {
      await apiRequest('/api/demo/load', { method: 'POST' });
      setScope('all');
      await loadReport();
    } catch (err: any) {
      setError(err?.message || 'Unable to load sample demo data.');
    } finally {
      setLoadingDemo(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'evaluation' && !evalReport && !runningEval) {
      handleRunEvaluation();
    }
  }, [activeTab, evalReport, runningEval]);

  const handleExportCsv = () => {
    if (!report?.flaggedAttempts?.length) return;
    exportToCsv(
      `DebitOrigin_Flagged_Attempts_${new Date().toISOString().slice(0, 10)}.csv`,
      report.flaggedAttempts.map((a: any) => ({
        AttemptID: a.attemptUid,
        MandateID: a.mandateCode,
        Merchant: a.merchantName,
        Customer: a.customerName,
        Timestamp: a.attemptTimestamp,
        Currency: a.currency,
        AuthorizedAmount: a.expectedAuthorizedAmount,
        AttemptedAmount: a.attemptedAmount,
        Status: a.status,
        Severity: a.severity,
        Violations: (a.violationCategories || []).join('; '),
        DataSource: a.isDemo ? 'SYNTHETIC_DEMO' : 'USER_DATA',
      }))
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-slate-900">
            Reports & Risk Evaluation
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Database-backed compliance analytics and live deterministic engine evaluation benchmark.
          </p>
        </div>

        <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg self-start">
          <button
            type="button"
            onClick={() => setActiveTab('operational')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer ${
              activeTab === 'operational'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Operational Reports
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('evaluation')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer ${
              activeTab === 'evaluation'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            {evalReport
              ? `Risk Evaluation Benchmark (${evalReport.totalCases} Cases)`
              : 'Risk Evaluation Benchmark'}
          </button>
        </div>
      </div>

      {error && (
        <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">
          {error}
        </div>
      )}

      {activeTab === 'operational' ? (
        <>
          {/* Filter Bar */}
          <Surface className="p-4 flex flex-col lg:flex-row lg:items-end justify-between gap-4">
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <FieldLabel>From Date</FieldLabel>
                <TextInput
                  type="date"
                  value={fromDate}
                  onChange={(e) => setFromDate(e.target.value)}
                  className="py-1.5 text-xs w-40"
                />
              </div>
              <div>
                <FieldLabel>To Date</FieldLabel>
                <TextInput
                  type="date"
                  value={toDate}
                  onChange={(e) => setToDate(e.target.value)}
                  className="py-1.5 text-xs w-40"
                />
              </div>
              <div>
                <FieldLabel>Record Scope</FieldLabel>
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
            </div>

            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={!report?.flaggedAttempts?.length}
                onClick={handleExportCsv}
              >
                <FileSpreadsheet className="w-3.5 h-3.5" />
                Export CSV
              </Button>
              <Button
                size="sm"
                variant="secondary"
                disabled={!report || report.summary.totalAttempts === 0}
                onClick={() => downloadOperationalReportPdf(report)}
              >
                <Download className="w-3.5 h-3.5" />
                Export PDF Report
              </Button>
            </div>
          </Surface>

          {loadingReport ? (
            <Surface>
              <SkeletonRows rows={6} />
            </Surface>
          ) : !report || (report.summary.totalMandates === 0 && report.summary.totalAttempts === 0) ? (
            <EmptyState
              icon={BarChart3}
              title="Insufficient records for operational reporting"
              description="DebitOrigin never invents financial figures. Add mandates and verify payment attempts, adjust your filters, or load the synthetic demo dataset to generate evidence-backed reports."
              actions={
                <Button size="sm" onClick={handleLoadDemo} disabled={loadingDemo}>
                  <Database className="w-3.5 h-3.5" />
                  {loadingDemo ? 'Loading Demo...' : 'Load Sample Demo Data'}
                </Button>
              }
            />
          ) : (
            <>
              {report.includesDemoData && (
                <div className="px-4 py-2.5 rounded-lg bg-blue-50/70 border border-blue-200 text-xs text-blue-900 flex items-center gap-2">
                  <DemoMarker />
                  <span className="text-slate-400">·</span>
                  <span>
                    This report includes synthetic demo records clearly separated from live user
                    mandates.
                  </span>
                </div>
              )}

              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <Surface className="p-4">
                  <div className="text-xs text-slate-500">Attempts Analyzed</div>
                  <div className="text-2xl font-mono font-bold text-slate-900 mt-1 tabular-nums">
                    {report.summary.totalAttempts}
                  </div>
                  <div className="text-[11px] text-slate-500 mt-1">
                    Verified {report.summary.statusSummary.VERIFIED} · Blocked{' '}
                    {report.summary.statusSummary.BLOCKED}
                  </div>
                </Surface>
                <Surface className="p-4">
                  <div className="text-xs text-slate-500">Suspicious Exposure Identified</div>
                  <div className="text-2xl font-mono font-bold text-red-700 mt-1 tabular-nums">
                    {formatCurrency(report.summary.suspiciousExposure)}
                  </div>
                  <div className="text-[11px] text-slate-500 mt-1">
                    Excess over authorized: {formatCurrency(report.summary.excessOverAuthorized)}
                  </div>
                </Surface>
                <Surface className="p-4">
                  <div className="text-xs text-slate-500">Mandates in Scope</div>
                  <div className="text-2xl font-mono font-bold text-slate-900 mt-1 tabular-nums">
                    {report.summary.totalMandates}
                  </div>
                  <div className="text-[11px] text-slate-500 mt-1">
                    Flagged {report.summary.statusSummary.FLAGGED} · Review{' '}
                    {report.summary.statusSummary.NEEDS_REVIEW}
                  </div>
                </Surface>
                <Surface className="p-4">
                  <div className="text-xs text-slate-500">Investigation Cases</div>
                  <div className="text-2xl font-mono font-bold text-blue-700 mt-1 tabular-nums">
                    {report.investigationStats.total}
                  </div>
                  <div className="text-[11px] text-slate-500 mt-1">
                    Open {report.investigationStats.open} · Under Review{' '}
                    {report.investigationStats.underReview} · Closed{' '}
                    {report.investigationStats.closed}
                  </div>
                </Surface>
              </div>

              {/* Violation Breakdown */}
              <Surface className="p-5">
                <h2 className="text-sm font-semibold text-slate-900 mb-3">
                  Violation Category Breakdown
                </h2>
                {report.violationBreakdown.length === 0 ? (
                  <p className="text-xs text-slate-500">No violations recorded in this scope.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead>
                        <tr className="border-b border-slate-200 text-[11px] font-semibold text-slate-500 uppercase">
                          <th className="py-2 pr-4">Violation Category</th>
                          <th className="py-2 px-4 text-right">Occurrences</th>
                          <th className="py-2 pl-4 text-right">Associated Attempt Value</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {report.violationBreakdown.map((row: any) => (
                          <tr key={row.category}>
                            <td className="py-2.5 pr-4 font-medium text-slate-900">
                              {humanizeEnum(row.category)}
                            </td>
                            <td className="py-2.5 px-4 text-right font-mono tabular-nums text-slate-700">
                              {row.count}
                            </td>
                            <td className="py-2.5 pl-4 text-right font-mono tabular-nums font-semibold text-slate-900">
                              {formatCurrency(row.exposure)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Surface>

              {/* Flagged Payment Attempts */}
              <Surface className="overflow-hidden">
                <div className="px-5 py-4 border-b border-slate-200">
                  <h2 className="text-sm font-semibold text-slate-900">
                    Flagged, Blocked & Review Attempts ({report.flaggedAttempts.length})
                  </h2>
                </div>
                {report.flaggedAttempts.length === 0 ? (
                  <p className="p-6 text-xs text-slate-500">
                    All analyzed payment attempts in this range were verified.
                  </p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead>
                        <tr className="border-b border-slate-200 bg-slate-50/70 text-[11px] font-semibold text-slate-500 uppercase">
                          <th className="py-2.5 px-4">Attempt / Mandate</th>
                          <th className="py-2.5 px-4">Merchant</th>
                          <th className="py-2.5 px-4 text-right">Authorized</th>
                          <th className="py-2.5 px-4 text-right">Attempted</th>
                          <th className="py-2.5 px-4">Status</th>
                          <th className="py-2.5 px-4">Timestamp</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {report.flaggedAttempts.map((a: any) => (
                          <tr key={a.id}>
                            <td className="py-2.5 px-4 font-mono">
                              <span className="font-semibold text-slate-900">{a.attemptUid}</span>{' '}
                              {a.isDemo && <DemoMarker />}
                              <div className="text-[11px] text-slate-500">{a.mandateCode}</div>
                            </td>
                            <td className="py-2.5 px-4 text-slate-800">{a.merchantName}</td>
                            <td className="py-2.5 px-4 text-right font-mono tabular-nums">
                              {formatCurrency(a.expectedAuthorizedAmount, a.currency)}
                            </td>
                            <td className="py-2.5 px-4 text-right font-mono font-semibold text-red-700 tabular-nums">
                              {formatCurrency(a.attemptedAmount, a.currency)}
                            </td>
                            <td className="py-2.5 px-4">
                              <StatusLabel status={a.status} />
                            </td>
                            <td className="py-2.5 px-4 font-mono text-slate-500 whitespace-nowrap">
                              {formatDateTime(a.attemptTimestamp)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Surface>
            </>
          )}
        </>
      ) : (
        /* Tab 2: Risk Evaluation Benchmark (Dynamically Computed) */
        <div className="space-y-6">
          <Surface className="p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 text-xs font-semibold text-blue-700">
                <FlaskConical className="w-4 h-4" />
                Live Deterministic Verification Benchmark
                <span className="text-slate-300">·</span>
                <DemoMarker />
              </div>
              <p className="text-xs text-slate-600 mt-1 max-w-2xl">
                Executes DebitOrigin&apos;s real deterministic Consent Drift Replay &amp; Verification
                Engine across {evalReport ? evalReport.totalCases : 'all'} customer-isolated synthetic
                mandate histories spanning {evalReport ? evalReport.byScenario.length : 12} legitimate
                and suspicious scenarios. Zero hardcoded metrics.
              </p>
            </div>
            <Button size="sm" onClick={handleRunEvaluation} disabled={runningEval}>
              <Play className="w-3.5 h-3.5" />
              {runningEval ? 'Running Benchmark...' : 'Re-Run Evaluation'}
            </Button>
          </Surface>

          {runningEval || !evalReport ? (
            <Surface>
              <SkeletonRows rows={6} />
            </Surface>
          ) : (
            <>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                {[
                  {
                    label: 'Precision (Holdout)',
                    val: `${(evalReport.holdout.precision * 100).toFixed(1)}%`,
                    sub: `Overall ${(evalReport.overall.precision * 100).toFixed(1)}%`,
                  },
                  {
                    label: 'Recall (Holdout)',
                    val: `${(evalReport.holdout.recall * 100).toFixed(1)}%`,
                    sub: `Overall ${(evalReport.overall.recall * 100).toFixed(1)}%`,
                  },
                  {
                    label: 'F1-Score (Holdout)',
                    val: `${(evalReport.holdout.f1Score * 100).toFixed(1)}%`,
                    sub: `Overall ${(evalReport.overall.f1Score * 100).toFixed(1)}%`,
                  },
                  {
                    label: 'False-Positive Rate',
                    val: `${(evalReport.holdout.falsePositiveRate * 100).toFixed(1)}%`,
                    sub: `Holdout n=${evalReport.holdoutTestCases}`,
                  },
                  {
                    label: 'Suspicious Exposure Caught',
                    val: formatCurrency(evalReport.overall.suspiciousExposureIdentified),
                    sub: `${(evalReport.overall.exposureCaptureRate * 100).toFixed(1)}% of ${formatCurrency(evalReport.overall.totalSuspiciousExposure)}`,
                  },
                ].map((m) => (
                  <Surface key={m.label} className="p-4">
                    <div className="text-xs text-slate-500">{m.label}</div>
                    <div className="text-2xl font-mono font-bold text-slate-900 mt-1 tabular-nums">
                      {m.val}
                    </div>
                    <div className="text-[11px] text-slate-500 mt-1 font-mono">{m.sub}</div>
                  </Surface>
                ))}
              </div>

              <div className="grid lg:grid-cols-12 gap-6">
                {/* Confusion Matrix */}
                <Surface className="lg:col-span-5 p-5 space-y-4">
                  <div>
                    <h2 className="text-sm font-semibold text-slate-900">
                      Confusion Matrix (Overall n={evalReport.totalCases})
                    </h2>
                    <p className="text-xs text-slate-500 mt-0.5">{evalReport.splitStrategy}</p>
                  </div>

                  <div className="grid grid-cols-2 gap-3 text-center">
                    <div className="p-4 rounded-lg bg-emerald-50 border border-emerald-200">
                      <div className="text-[11px] font-semibold text-emerald-800">
                        True Positives (Suspicious Caught)
                      </div>
                      <div className="text-2xl font-mono font-bold text-emerald-900 mt-1 tabular-nums">
                        {evalReport.overall.confusionMatrix.truePositives}
                      </div>
                    </div>
                    <div className="p-4 rounded-lg bg-slate-50 border border-slate-200">
                      <div className="text-[11px] font-semibold text-slate-600">
                        False Positives
                      </div>
                      <div className="text-2xl font-mono font-bold text-slate-900 mt-1 tabular-nums">
                        {evalReport.overall.confusionMatrix.falsePositives}
                      </div>
                    </div>
                    <div className="p-4 rounded-lg bg-slate-50 border border-slate-200">
                      <div className="text-[11px] font-semibold text-slate-600">
                        False Negatives
                      </div>
                      <div className="text-2xl font-mono font-bold text-slate-900 mt-1 tabular-nums">
                        {evalReport.overall.confusionMatrix.falseNegatives}
                      </div>
                    </div>
                    <div className="p-4 rounded-lg bg-blue-50 border border-blue-200">
                      <div className="text-[11px] font-semibold text-blue-800">
                        True Negatives (Legitimate Verified)
                      </div>
                      <div className="text-2xl font-mono font-bold text-blue-900 mt-1 tabular-nums">
                        {evalReport.overall.confusionMatrix.trueNegatives}
                      </div>
                    </div>
                  </div>
                  <div className="pt-2 border-t border-slate-100 text-[11px] font-mono text-slate-600 flex items-center justify-between">
                    <span>
                      Suspicious:{' '}
                      {evalReport.overall.confusionMatrix.truePositives +
                        evalReport.overall.confusionMatrix.falseNegatives}{' '}
                      + Legitimate:{' '}
                      {evalReport.overall.confusionMatrix.trueNegatives +
                        evalReport.overall.confusionMatrix.falsePositives}
                    </span>
                    <span className="font-semibold text-slate-900">
                      Total: {evalReport.totalCases}
                    </span>
                  </div>
                </Surface>

                {/* Per-Scenario Accuracy */}
                <Surface className="lg:col-span-7 p-5">
                  <h2 className="text-sm font-semibold text-slate-900 mb-3">
                    Scenario Coverage &amp; Exact Outcome Match ({evalReport.byScenario.length}{' '}
                    Scenarios)
                  </h2>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead>
                        <tr className="border-b border-slate-200 text-[11px] font-semibold text-slate-500 uppercase">
                          <th className="py-2 pr-3">Scenario</th>
                          <th className="py-2 px-3">Class</th>
                          <th className="py-2 px-3 text-right">Cases</th>
                          <th className="py-2 pl-3 text-right">Exact Match</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {evalReport.byScenario.map((s) => (
                          <tr key={s.scenario}>
                            <td className="py-2 pr-3 font-medium text-slate-900">{s.scenario}</td>
                            <td className="py-2 px-3 text-slate-500">
                              {s.expectedFlagged ? 'Suspicious / Review' : 'Legitimate'}
                            </td>
                            <td className="py-2 px-3 text-right font-mono tabular-nums">
                              {s.total}
                            </td>
                            <td className="py-2 pl-3 text-right font-mono font-semibold text-emerald-700 tabular-nums">
                              {s.correct}/{s.total} ({(s.accuracy * 100).toFixed(0)}%)
                            </td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr className="border-t-2 border-slate-200 bg-slate-50/70 font-semibold text-slate-900">
                          <td className="py-2.5 pr-3" colSpan={2}>
                            Total Evaluated Cases
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono tabular-nums">
                            {evalReport.byScenario.reduce((sum, s) => sum + s.total, 0)}
                          </td>
                          <td className="py-2.5 pl-3 text-right font-mono text-emerald-700 tabular-nums">
                            {evalReport.byScenario.reduce((sum, s) => sum + s.correct, 0)}/
                            {evalReport.byScenario.reduce((sum, s) => sum + s.total, 0)}
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </Surface>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
