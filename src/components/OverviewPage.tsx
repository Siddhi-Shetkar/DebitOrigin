import React, { useEffect, useState, useCallback } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  AlertTriangle,
  ArrowRight,
  Database,
  FilePlus2,
  FileUp,
  History,
  ShieldCheck,
} from 'lucide-react';
import { apiRequest } from '../lib/api.ts';
import { formatCurrency, formatDateTime, humanizeEnum } from '../lib/utils.ts';
import {
  Button,
  DemoMarker,
  EmptyState,
  SkeletonRows,
  StatusLabel,
  Surface,
} from './ui/Primitives.tsx';

export function OverviewPage({
  onNavigate,
  onOpenReplay,
  onOpenInvestigation,
  onTriggerCreateMandate,
  onTriggerUploadDoc,
}: {
  onNavigate: (tab: string) => void;
  onOpenReplay: (mandateId: number, paymentAttemptId?: number) => void;
  onOpenInvestigation: (caseId: number) => void;
  onTriggerCreateMandate: () => void;
  onTriggerUploadDoc: () => void;
}) {
  const [scope, setScope] = useState<'all' | 'user' | 'demo'>('all');
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [loadingDemo, setLoadingDemo] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchOverview = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiRequest(`/api/overview?scope=${scope}`);
      setData(res);
    } catch (err: any) {
      setError(err?.message || 'Unable to load dashboard overview.');
    } finally {
      setLoading(false);
    }
  }, [scope]);

  useEffect(() => {
    fetchOverview();
  }, [fetchOverview]);

  const handleLoadDemo = async () => {
    setLoadingDemo(true);
    try {
      await apiRequest('/api/demo/load', { method: 'POST' });
      await fetchOverview();
    } catch (err: any) {
      setError(err?.message || 'Failed to load demo data.');
    } finally {
      setLoadingDemo(false);
    }
  };

  const metrics = data?.metrics;
  const isEmpty = !loading && data && metrics.totalMandates === 0 && metrics.attemptsAnalyzed === 0;

  return (
    <div className="space-y-6">
      {/* Header & Scope Filter */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-slate-900">Risk Overview</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            All metrics are calculated directly from stored mandate events and payment verifications.
          </p>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
            {(
              [
                ['all', 'All Records'],
                ['user', 'My Data'],
                ['demo', 'Demo Data'],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setScope(key)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap ${
                  scope === key
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <Button size="sm" variant="outline" onClick={onTriggerUploadDoc}>
            <FileUp className="w-3.5 h-3.5" />
            Upload Consent
          </Button>
          <Button size="sm" onClick={onTriggerCreateMandate}>
            <FilePlus2 className="w-3.5 h-3.5" />
            New Mandate
          </Button>
        </div>
      </div>

      {data?.hasDemoData && scope !== 'user' && (
        <div className="px-4 py-2.5 rounded-lg bg-blue-50/70 border border-blue-200 flex flex-wrap items-center justify-between gap-2 text-xs text-blue-900">
          <div className="flex items-center gap-2">
            <DemoMarker />
            <span className="text-slate-400">·</span>
            <span>
              Synthetic demo scenarios are included in this view. Switch to &ldquo;My Data&rdquo; to
              view only your own mandates, or reset demo data in Settings.
            </span>
          </div>
          <button
            type="button"
            onClick={() => setScope('user')}
            className="text-blue-700 font-semibold hover:underline cursor-pointer whitespace-nowrap"
          >
            View My Data Only
          </button>
        </div>
      )}

      {error && (
        <div className="p-4 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">
          {error}
        </div>
      )}

      {loading ? (
        <Surface>
          <SkeletonRows rows={6} />
        </Surface>
      ) : isEmpty ? (
        <EmptyState
          icon={ShieldCheck}
          title={
            scope === 'demo'
              ? 'No synthetic demo data loaded'
              : scope === 'user'
                ? 'No mandates created in your account yet'
                : 'No mandates monitored yet'
          }
          description="DebitOrigin never displays fabricated metrics. Add your first recurring mandate manually, extract one from a consent PDF/image with Gemini, or load the isolated synthetic demo dataset."
          actions={
            <>
              <Button onClick={onTriggerCreateMandate}>Create Mandate Manually</Button>
              <Button variant="outline" onClick={onTriggerUploadDoc}>
                Upload Consent Document
              </Button>
              {!data?.hasDemoData && (
                <Button variant="outline" onClick={handleLoadDemo} disabled={loadingDemo}>
                  <Database className="w-3.5 h-3.5" />
                  {loadingDemo ? 'Loading Demo...' : 'Load Sample Demo'}
                </Button>
              )}
            </>
          }
        />
      ) : (
        <>
          {/* KPI Strip: 6 real DB-calculated metrics with exhaustive breakdowns */}
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4">
            {[
              {
                label: 'Mandates Monitored',
                value: metrics.totalMandates,
                tone: 'text-slate-900',
                sub: null,
              },
              {
                label: 'Attempts Analyzed',
                value: metrics.attemptsAnalyzed,
                tone: 'text-slate-900',
                sub: `${metrics.verifiedAttempts}V · ${metrics.flaggedAttempts}F · ${metrics.blockedAttempts}B · ${metrics.needsReviewAttempts}R`,
              },
              {
                label: 'Verified Attempts',
                value: metrics.verifiedAttempts,
                tone: 'text-emerald-700',
                sub: null,
              },
              {
                label: 'Flagged Attempts',
                value: metrics.flaggedAttempts,
                tone: 'text-amber-700',
                sub:
                  metrics.needsReviewAttempts > 0
                    ? `+ ${metrics.needsReviewAttempts} Needs Review`
                    : null,
              },
              {
                label: 'Blocked Attempts',
                value: metrics.blockedAttempts,
                tone: 'text-red-700',
                sub: null,
              },
              {
                label: 'Open Review Cases',
                value: metrics.casesRequiringReview,
                tone: 'text-blue-700',
                sub: null,
              },
            ].map((k) => (
              <Surface key={k.label} className="p-4">
                <div className="text-xs font-medium text-slate-500">{k.label}</div>
                <div className={`text-2xl font-bold font-mono tabular-nums mt-1.5 ${k.tone}`}>
                  {k.value}
                </div>
                {k.sub && (
                  <div className="text-[11px] font-mono text-slate-500 mt-1 tabular-nums">
                    {k.sub}
                  </div>
                )}
              </Surface>
            ))}
          </div>

          {/* Charts Row */}
          <div className="grid lg:grid-cols-12 gap-6">
            <Surface className="lg:col-span-7 p-5">
              <div className="flex items-center justify-between gap-2 mb-4">
                <div>
                  <h2 className="text-sm font-semibold text-slate-900">
                    Payment Verification Activity
                  </h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Monthly verification outcomes from recorded attempts
                  </p>
                </div>
                <span className="text-xs font-mono text-slate-500 tabular-nums">
                  Exposure flagged: {formatCurrency(metrics.suspiciousExposure)}
                </span>
              </div>

              {data.verificationActivity.length === 0 ? (
                <div className="h-56 flex items-center justify-center text-xs text-slate-500 bg-slate-50 rounded-lg border border-slate-100">
                  Run a payment verification to populate activity trends.
                </div>
              ) : (
                <div className="h-56 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={data.verificationActivity} barGap={2}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                      <XAxis dataKey="period" tick={{ fontSize: 11, fill: '#64748b' }} />
                      <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#64748b' }} />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: '#ffffff',
                          borderColor: '#e2e8f0',
                          borderRadius: '8px',
                          fontSize: '12px',
                        }}
                      />
                      <Bar dataKey="verified" name="Verified" fill="#16a34a" radius={[3, 3, 0, 0]} />
                      <Bar dataKey="flagged" name="Flagged" fill="#d97706" radius={[3, 3, 0, 0]} />
                      <Bar dataKey="blocked" name="Blocked" fill="#dc2626" radius={[3, 3, 0, 0]} />
                      <Bar
                        dataKey="needsReview"
                        name="Needs Review"
                        fill="#2563eb"
                        radius={[3, 3, 0, 0]}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </Surface>

            <Surface className="lg:col-span-5 p-5">
              <div className="mb-4">
                <h2 className="text-sm font-semibold text-slate-900">
                  Violation Category Distribution
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Deterministic rule triggers detected across analyzed attempts
                </p>
              </div>

              {data.violationDistribution.length === 0 ? (
                <div className="h-56 flex items-center justify-center text-xs text-slate-500 bg-slate-50 rounded-lg border border-slate-100">
                  No consent drift violations recorded in this scope.
                </div>
              ) : (
                <div className="space-y-3">
                  {data.violationDistribution.map((item: { category: string; count: number }) => {
                    const max = data.violationDistribution[0]?.count || 1;
                    const widthPct = Math.max(8, Math.round((item.count / max) * 100));
                    return (
                      <div key={item.category}>
                        <div className="flex items-center justify-between text-xs mb-1">
                          <span className="font-medium text-slate-700 truncate pr-2">
                            {humanizeEnum(item.category)}
                          </span>
                          <span className="font-mono font-semibold text-slate-900 tabular-nums">
                            {item.count}
                          </span>
                        </div>
                        <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-blue-700 rounded-full"
                            style={{ width: `${widthPct}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </Surface>
          </div>

          {/* Recent Payment Attempts Table */}
          <Surface className="overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between gap-4">
              <div>
                <h2 className="text-sm font-semibold text-slate-900">Recent Payment Attempts</h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Click Replay on any attempt to reconstruct historical authorization
                </p>
              </div>
              <Button size="sm" variant="ghost" onClick={() => onNavigate('verification')}>
                View All
                <ArrowRight className="w-3.5 h-3.5" />
              </Button>
            </div>

            {data.recentAttempts.length === 0 ? (
              <div className="p-8 text-center text-xs text-slate-500">
                No payment attempts recorded yet. Go to Payment Verification to simulate an attempt.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50/70 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                      <th className="py-2.5 px-4">Attempt / Mandate</th>
                      <th className="py-2.5 px-4">Merchant</th>
                      <th className="py-2.5 px-4 text-right">Authorized</th>
                      <th className="py-2.5 px-4 text-right">Attempted</th>
                      <th className="py-2.5 px-4">Outcome</th>
                      <th className="py-2.5 px-4">Timestamp</th>
                      <th className="py-2.5 px-4 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-xs">
                    {data.recentAttempts.map((a: any) => (
                      <tr key={a.id} className="hover:bg-slate-50/80 transition-colors">
                        <td className="py-3 px-4">
                          <div className="font-mono font-semibold text-slate-900 flex items-center gap-2">
                            {a.attemptUid}
                            {a.isDemo && <DemoMarker />}
                          </div>
                          <div className="text-slate-500 font-mono text-[11px] mt-0.5">
                            {a.mandateCode}
                          </div>
                        </td>
                        <td className="py-3 px-4">
                          <div className="font-medium text-slate-800">{a.merchantName}</div>
                          <div className="text-slate-500 text-[11px]">{a.customerName}</div>
                        </td>
                        <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-700">
                          {formatCurrency(a.expectedAuthorizedAmount, a.currency)}
                        </td>
                        <td
                          className={`py-3 px-4 text-right font-mono font-semibold tabular-nums ${
                            a.attemptedAmount > a.expectedAuthorizedAmount
                              ? 'text-red-700'
                              : 'text-slate-900'
                          }`}
                        >
                          {formatCurrency(a.attemptedAmount, a.currency)}
                        </td>
                        <td className="py-3 px-4">
                          <StatusLabel status={a.status} />
                        </td>
                        <td className="py-3 px-4 font-mono text-slate-500 tabular-nums whitespace-nowrap">
                          {formatDateTime(a.attemptTimestamp)}
                        </td>
                        <td className="py-3 px-4 text-right">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => onOpenReplay(a.mandateId, a.paymentAttemptId)}
                          >
                            <History className="w-3.5 h-3.5" />
                            Replay
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Surface>

          {/* Bottom 3-Column Operational Insights */}
          <div className="grid lg:grid-cols-3 gap-6">
            {/* Mandates Requiring Attention */}
            <Surface className="p-5">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold text-slate-900">
                  Mandates Requiring Attention
                </h2>
                <button
                  type="button"
                  onClick={() => onNavigate('mandates')}
                  className="text-xs font-medium text-blue-700 hover:underline cursor-pointer"
                >
                  All Mandates
                </button>
              </div>
              {data.mandatesRequiringAttention.length === 0 ? (
                <p className="text-xs text-slate-500 py-6 text-center">
                  All monitored mandates are aligned with customer authorization.
                </p>
              ) : (
                <div className="divide-y divide-slate-100">
                  {data.mandatesRequiringAttention.map((m: any) => (
                    <div
                      key={m.id}
                      className="py-3 flex items-start justify-between gap-3 text-xs"
                    >
                      <div className="min-w-0">
                        <div className="font-mono font-semibold text-slate-900 flex items-center gap-1.5">
                          <span className="truncate">{m.mandateCode}</span>
                          {m.isDemo && <DemoMarker />}
                        </div>
                        <div className="text-slate-500 truncate mt-0.5">{m.merchantName}</div>
                        {Math.abs(m.currentMerchantAmount - m.authorizedAmount) > 0.01 && (
                          <div className="text-red-700 font-mono text-[11px] mt-0.5 tabular-nums flex items-center gap-1">
                            <AlertTriangle className="w-3 h-3 shrink-0" />
                            Drift: {formatCurrency(m.authorizedAmount, m.currency)} →{' '}
                            {formatCurrency(m.currentMerchantAmount, m.currency)}
                          </div>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => onOpenReplay(m.id)}
                        className="text-blue-700 font-medium hover:underline shrink-0 cursor-pointer"
                      >
                        Inspect
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </Surface>

            {/* Recent Investigations */}
            <Surface className="p-5">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold text-slate-900">Recent Investigations</h2>
                <button
                  type="button"
                  onClick={() => onNavigate('investigations')}
                  className="text-xs font-medium text-blue-700 hover:underline cursor-pointer"
                >
                  All Cases
                </button>
              </div>
              {data.recentInvestigations.length === 0 ? (
                <p className="text-xs text-slate-500 py-6 text-center">
                  No investigation cases opened yet.
                </p>
              ) : (
                <div className="divide-y divide-slate-100">
                  {data.recentInvestigations.map((c: any) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => onOpenInvestigation(c.id)}
                      className="w-full text-left py-3 hover:bg-slate-50 -mx-2 px-2 rounded-md transition-colors cursor-pointer"
                    >
                      <div className="flex items-center justify-between gap-2 text-xs">
                        <span className="font-mono font-semibold text-slate-900">{c.caseUid}</span>
                        <StatusLabel status={c.status} />
                      </div>
                      <div className="text-xs text-slate-700 mt-1 line-clamp-1">{c.title}</div>
                      <div className="text-[11px] text-slate-500 mt-0.5">
                        {c.mandateCode} · Severity {c.severity}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </Surface>

            {/* Recent System Activity */}
            <Surface className="p-5">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold text-slate-900">Recent System Activity</h2>
                <button
                  type="button"
                  onClick={() => onNavigate('settings')}
                  className="text-xs font-medium text-blue-700 hover:underline cursor-pointer"
                >
                  Audit Log
                </button>
              </div>
              {data.recentActivity.length === 0 ? (
                <p className="text-xs text-slate-500 py-6 text-center">No activity logged yet.</p>
              ) : (
                <div className="divide-y divide-slate-100">
                  {data.recentActivity.slice(0, 6).map((log: any) => (
                    <div key={log.id} className="py-2.5 text-xs">
                      <div className="font-medium text-slate-800">{humanizeEnum(log.action)}</div>
                      <div className="text-[11px] text-slate-500 font-mono mt-0.5">
                        {log.entityType} #{log.entityId} · {formatDateTime(log.createdAt)}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Surface>
          </div>
        </>
      )}
    </div>
  );
}
