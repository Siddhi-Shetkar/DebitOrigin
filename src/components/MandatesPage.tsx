import React, { useEffect, useState, useCallback, useMemo } from 'react';
import {
  AlertTriangle,
  ArrowUpDown,
  CheckCircle2,
  Database,
  FilePlus2,
  FileText,
  FileUp,
  History,
  Plus,
  Search,
  Trash2,
} from 'lucide-react';
import { apiRequest, ApiError } from '../lib/api.ts';
import {
  formatCurrency,
  formatDateTime,
  formatShortDate,
  humanizeEnum,
  isPaymentLifecycleEvent,
} from '../lib/utils.ts';
import {
  Button,
  ConfirmDialog,
  DemoMarker,
  EmptyState,
  EventPayloadViewer,
  FieldLabel,
  Modal,
  SelectInput,
  SkeletonRows,
  StatusLabel,
  Surface,
  TextAreaInput,
  TextInput,
} from './ui/Primitives.tsx';

export function MandatesPage({
  initialModal,
  onClearInitialModal,
  onOpenReplay,
}: {
  initialModal?: 'create' | 'upload' | null;
  onClearInitialModal?: () => void;
  onOpenReplay: (mandateId: number) => void;
}) {
  const [mandates, setMandates] = useState<any[]>([]);
  const [documents, setDocuments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingDemo, setLoadingDemo] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);

  // Filters & sorting
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [scope, setScope] = useState<'all' | 'user' | 'demo'>('all');
  const [sortBy, setSortBy] = useState<'createdAt' | 'authorizedAmount' | 'mandateCode'>('createdAt');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  // Modals
  const [createOpen, setCreateOpen] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [detailMandateId, setDetailMandateId] = useState<number | null>(null);
  const [detailData, setDetailData] = useState<any>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<any>(null);
  const [deleting, setDeleting] = useState(false);

  // Create mandate form
  const [form, setForm] = useState({
    mandateCode: '',
    customerId: '',
    customerName: '',
    merchantId: '',
    merchantName: '',
    authorizedAmount: '499',
    currency: 'INR',
    billingFrequency: 'MONTHLY',
    billingSchedule: 'Day 5 of every month',
    billingDayOfMonth: '5',
    requireApprovalForDecrease: false,
    startDate: new Date().toISOString().slice(0, 10),
    endDate: '',
    consentEvidenceRef: '',
    conditions: '',
  });
  const [saving, setSaving] = useState(false);

  // Upload & Gemini extraction state
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [extractionRes, setExtractionRes] = useState<any>(null);
  const [reviewForm, setReviewForm] = useState<any>(null);
  const [committing, setCommitting] = useState(false);

  // Append event form inside detail view
  const [eventModalOpen, setEventModalOpen] = useState(false);
  const [eventForm, setEventForm] = useState({
    eventType: 'AMOUNT_MODIFIED',
    eventTimestamp: new Date().toISOString().slice(0, 16),
    actor: 'MERCHANT',
    newAmount: '',
    newFrequency: 'MONTHLY',
    newMerchantId: '',
    newMerchantName: '',
    customerApproved: false,
    customerApprovalRef: '',
    evidenceRef: '',
    evidenceStatus: 'NONE',
    notes: '',
  });
  const [appendingEvent, setAppendingEvent] = useState(false);

  // Edit permitted metadata state
  const [metaModalOpen, setMetaModalOpen] = useState(false);
  const [metaForm, setMetaForm] = useState({
    customerName: '',
    billingSchedule: '',
    billingDayOfMonth: '',
    conditions: '',
    endDate: '',
  });

  useEffect(() => {
    if (initialModal === 'create') {
      setCreateOpen(true);
      onClearInitialModal?.();
    } else if (initialModal === 'upload') {
      setUploadOpen(true);
      onClearInitialModal?.();
    }
  }, [initialModal, onClearInitialModal]);

  const loadMandates = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [res, docRes] = await Promise.all([
        apiRequest<{ mandates: any[] }>(`/api/mandates?scope=${scope}`),
        apiRequest<{ documents: any[] }>('/api/documents'),
      ]);
      setMandates(res.mandates);
      setDocuments(
        scope === 'all'
          ? docRes.documents
          : docRes.documents.filter((d) => (scope === 'demo' ? d.isDemo : !d.isDemo))
      );
    } catch (err: any) {
      setError(err?.message || 'Unable to fetch mandates.');
    } finally {
      setLoading(false);
    }
  }, [scope]);

  useEffect(() => {
    loadMandates();
  }, [loadMandates]);

  const handleLoadDemo = async () => {
    setLoadingDemo(true);
    setError(null);
    try {
      await apiRequest('/api/demo/load', { method: 'POST' });
      setScope('all');
      setBanner('Synthetic demo dataset loaded across mandates, consent documents, and verifications.');
      await loadMandates();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to load sample demo data.');
    } finally {
      setLoadingDemo(false);
    }
  };

  const openDetail = useCallback(async (id: number) => {
    setDetailMandateId(id);
    setDetailLoading(true);
    try {
      const res = await apiRequest(`/api/mandates/${id}`);
      setDetailData(res);
      setMetaForm({
        customerName: res.mandate.customerName || '',
        billingSchedule: res.mandate.billingSchedule || '',
        billingDayOfMonth: res.mandate.billingDayOfMonth ? String(res.mandate.billingDayOfMonth) : '',
        conditions: res.mandate.conditions || '',
        endDate: res.mandate.endDate ? res.mandate.endDate.slice(0, 10) : '',
      });
    } catch (err: any) {
      setError(err?.message || 'Unable to load mandate details.');
    } finally {
      setDetailLoading(false);
    }
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return mandates
      .filter((m) => {
        if (statusFilter !== 'ALL' && m.status !== statusFilter) return false;
        if (!q) return true;
        return (
          m.mandateCode.toLowerCase().includes(q) ||
          m.customerName.toLowerCase().includes(q) ||
          m.customerId.toLowerCase().includes(q) ||
          m.merchantName.toLowerCase().includes(q)
        );
      })
      .sort((a, b) => {
        const mult = sortDir === 'asc' ? 1 : -1;
        if (sortBy === 'authorizedAmount') return (a.authorizedAmount - b.authorizedAmount) * mult;
        if (sortBy === 'mandateCode') return a.mandateCode.localeCompare(b.mandateCode) * mult;
        return (new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()) * mult;
      });
  }, [mandates, search, statusFilter, sortBy, sortDir]);

  const toggleSort = (col: typeof sortBy) => {
    if (sortBy === col) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSortBy(col);
      setSortDir('asc');
    }
  };

  const handleCreateMandate = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const res = await apiRequest<{ mandate: any }>('/api/mandates', {
        method: 'POST',
        body: {
          mandateCode: form.mandateCode.trim(),
          customerId: form.customerId.trim(),
          customerName: form.customerName.trim(),
          merchantId: form.merchantId.trim(),
          merchantName: form.merchantName.trim(),
          authorizedAmount: Number(form.authorizedAmount),
          currency: form.currency,
          billingFrequency: form.billingFrequency,
          billingSchedule: form.billingSchedule.trim(),
          billingDayOfMonth: form.billingDayOfMonth ? Number(form.billingDayOfMonth) : null,
          requireApprovalForDecrease: form.requireApprovalForDecrease,
          startDate: new Date(`${form.startDate}T00:00:00.000Z`).toISOString(),
          endDate: form.endDate ? new Date(`${form.endDate}T23:59:59.000Z`).toISOString() : null,
          consentEvidenceRef: form.consentEvidenceRef.trim() || null,
          conditions: form.conditions.trim() || null,
        },
      });
      setCreateOpen(false);
      setBanner(`Mandate ${res.mandate.mandateCode} created with initial consent event.`);
      await loadMandates();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to create mandate.');
    } finally {
      setSaving(false);
    }
  };

  const handleExtractDocument = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!uploadFile) return;
    setExtracting(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append('file', uploadFile);
      const res = await apiRequest('/api/documents/extract', {
        method: 'POST',
        body: fd,
        isFormData: true,
      });
      setExtractionRes(res);
      const ex = res.extracted;
      setReviewForm({
        mandateCode: ex.mandateCode || `MND-${Date.now().toString().slice(-6)}`,
        customerId: ex.customerId || `CUST-${Date.now().toString().slice(-4)}`,
        customerName: ex.customerName || '',
        merchantId: ex.merchantId || `MRC-${Date.now().toString().slice(-4)}`,
        merchantName: ex.merchantName || '',
        authorizedAmount: ex.authorizedAmount != null ? String(ex.authorizedAmount) : '',
        currency: ex.currency || 'INR',
        billingFrequency: ex.billingFrequency || 'MONTHLY',
        billingSchedule: ex.billingSchedule || 'Day 5 of every month',
        billingDayOfMonth: ex.billingDayOfMonth != null ? String(ex.billingDayOfMonth) : '5',
        startDate: ex.startDate ? String(ex.startDate).slice(0, 10) : new Date().toISOString().slice(0, 10),
        endDate: ex.endDate ? String(ex.endDate).slice(0, 10) : '',
        consentEvidenceRef: res.document?.storageRef || '',
        conditions: ex.conditions || '',
        status: res.reviewStatus === 'NEEDS_REVIEW' ? 'NEEDS_REVIEW' : 'ACTIVE',
      });
      await loadMandates();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Consent document extraction failed.');
    } finally {
      setExtracting(false);
    }
  };

  const handleCommitExtraction = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!extractionRes || !reviewForm) return;
    setCommitting(true);
    setError(null);
    try {
      const res = await apiRequest<{ mandate: any }>(
        `/api/documents/extractions/${extractionRes.extraction.id}/commit`,
        {
          method: 'POST',
          body: {
            mandateCode: reviewForm.mandateCode.trim(),
            customerId: reviewForm.customerId.trim(),
            customerName: reviewForm.customerName.trim(),
            merchantId: reviewForm.merchantId.trim(),
            merchantName: reviewForm.merchantName.trim(),
            authorizedAmount: Number(reviewForm.authorizedAmount),
            currency: reviewForm.currency,
            billingFrequency: reviewForm.billingFrequency,
            billingSchedule: reviewForm.billingSchedule.trim(),
            billingDayOfMonth: reviewForm.billingDayOfMonth ? Number(reviewForm.billingDayOfMonth) : null,
            startDate: new Date(`${reviewForm.startDate}T00:00:00.000Z`).toISOString(),
            endDate: reviewForm.endDate
              ? new Date(`${reviewForm.endDate}T23:59:59.000Z`).toISOString()
              : null,
            consentEvidenceRef: reviewForm.consentEvidenceRef.trim() || null,
            conditions: reviewForm.conditions.trim() || null,
            status: reviewForm.status,
          },
        }
      );
      setUploadOpen(false);
      setExtractionRes(null);
      setReviewForm(null);
      setUploadFile(null);
      setBanner(
        `Mandate ${res.mandate.mandateCode} saved from reviewed consent document (${res.mandate.status}).`
      );
      await loadMandates();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to save reviewed extraction.');
    } finally {
      setCommitting(false);
    }
  };

  const handleAppendEvent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!detailMandateId) return;
    setAppendingEvent(true);
    setError(null);
    try {
      await apiRequest(`/api/mandates/${detailMandateId}/events`, {
        method: 'POST',
        body: {
          eventType: eventForm.eventType,
          eventTimestamp: new Date(eventForm.eventTimestamp).toISOString(),
          actor: eventForm.actor,
          newAmount:
            eventForm.eventType === 'AMOUNT_MODIFIED' || eventForm.eventType === 'CONSENT_APPROVED'
              ? eventForm.newAmount
                ? Number(eventForm.newAmount)
                : undefined
              : undefined,
          newFrequency:
            eventForm.eventType === 'FREQUENCY_MODIFIED' ? eventForm.newFrequency : undefined,
          newMerchantId:
            eventForm.eventType === 'MERCHANT_MODIFIED' ? eventForm.newMerchantId.trim() : undefined,
          newMerchantName:
            eventForm.eventType === 'MERCHANT_MODIFIED'
              ? eventForm.newMerchantName.trim()
              : undefined,
          customerApproved: eventForm.customerApproved,
          customerApprovalRef: eventForm.customerApprovalRef.trim() || null,
          evidenceRef: eventForm.evidenceRef.trim() || null,
          evidenceStatus: eventForm.evidenceStatus,
          notes: eventForm.notes.trim() || undefined,
        },
      });
      setEventModalOpen(false);
      setBanner(`Chronological event ${humanizeEnum(eventForm.eventType)} appended to mandate ledger.`);
      await Promise.all([openDetail(detailMandateId), loadMandates()]);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to record event.');
    } finally {
      setAppendingEvent(false);
    }
  };

  const handleUpdateMetadata = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!detailMandateId) return;
    setSaving(true);
    setError(null);
    try {
      await apiRequest(`/api/mandates/${detailMandateId}/metadata`, {
        method: 'PATCH',
        body: {
          customerName: metaForm.customerName.trim(),
          billingSchedule: metaForm.billingSchedule.trim(),
          billingDayOfMonth: metaForm.billingDayOfMonth ? Number(metaForm.billingDayOfMonth) : null,
          conditions: metaForm.conditions.trim() || null,
          endDate: metaForm.endDate ? new Date(`${metaForm.endDate}T23:59:59.000Z`).toISOString() : null,
        },
      });
      setMetaModalOpen(false);
      setBanner('Permitted mandate metadata updated (customer-authorized terms unchanged).');
      await Promise.all([openDetail(detailMandateId), loadMandates()]);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to update metadata.');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteMandate = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await apiRequest(`/api/mandates/${deleteTarget.id}`, { method: 'DELETE' });
      if (detailMandateId === deleteTarget.id) {
        setDetailMandateId(null);
        setDetailData(null);
      }
      setDeleteTarget(null);
      setBanner(`Mandate ${deleteTarget.mandateCode} deleted.`);
      await loadMandates();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to delete mandate.');
    } finally {
      setDeleting(false);
    }
  };

  const missingSet = new Set<string>(extractionRes?.extracted?.missingFields || []);
  const ambiguousSet = new Set<string>(extractionRes?.extracted?.ambiguousFields || []);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-slate-900">Mandates</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Track original customer consent separately from merchant-side billing records with an
            append-only event ledger.
          </p>
        </div>
        <div className="flex items-center gap-2.5 flex-wrap">
          <Button variant="outline" size="sm" onClick={() => setUploadOpen(true)}>
            <FileUp className="w-3.5 h-3.5" />
            Upload Consent Document
          </Button>
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <FilePlus2 className="w-3.5 h-3.5" />
            Create Mandate
          </Button>
        </div>
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

      {/* Search & Filter Toolbar */}
      <Surface className="p-4 flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <TextInput
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by mandate ID, customer, or merchant..."
            className="pl-9 py-1.5 text-xs"
          />
        </div>

        <div className="flex items-center gap-2.5 flex-wrap">
          <SelectInput
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="w-40 py-1.5 text-xs"
            aria-label="Filter by status"
          >
            <option value="ALL">All Statuses</option>
            <option value="ACTIVE">Active</option>
            <option value="PAUSED">Paused</option>
            <option value="REVOKED">Revoked</option>
            <option value="EXPIRED">Expired</option>
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
                  scope === k ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </Surface>

      {/* Mandates Table */}
      <Surface className="overflow-hidden">
        {loading ? (
          <SkeletonRows rows={6} />
        ) : filtered.length === 0 ? (
          <div className="p-6">
            <EmptyState
              icon={FileText}
              title="No mandates match your filters"
              description="Create a mandate manually, upload a customer consent PDF/image to extract authorization terms with Gemini AI, or load the synthetic demo dataset."
              actions={
                <>
                  <Button size="sm" onClick={() => setCreateOpen(true)}>
                    Create Mandate Manually
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setUploadOpen(true)}>
                    Upload Consent Document
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
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
                  <th className="py-2.5 px-4">
                    <button
                      type="button"
                      onClick={() => toggleSort('mandateCode')}
                      className="inline-flex items-center gap-1 hover:text-slate-900 cursor-pointer"
                    >
                      Mandate ID
                      <ArrowUpDown className="w-3 h-3" />
                    </button>
                  </th>
                  <th className="py-2.5 px-4">Customer / Merchant</th>
                  <th className="py-2.5 px-4 text-right">
                    <button
                      type="button"
                      onClick={() => toggleSort('authorizedAmount')}
                      className="inline-flex items-center gap-1 hover:text-slate-900 cursor-pointer"
                    >
                      Original Consent
                      <ArrowUpDown className="w-3 h-3" />
                    </button>
                  </th>
                  <th className="py-2.5 px-4 text-right">Merchant Record</th>
                  <th className="py-2.5 px-4">Status</th>
                  <th className="py-2.5 px-4 text-right">Events</th>
                  <th className="py-2.5 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {filtered.map((m) => (
                  <tr key={m.id} className="hover:bg-slate-50/70 transition-colors">
                    <td className="py-3 px-4">
                      <button
                        type="button"
                        onClick={() => openDetail(m.id)}
                        className="font-mono font-semibold text-blue-700 hover:underline text-left cursor-pointer"
                      >
                        {m.mandateCode}
                      </button>
                      <div className="flex items-center gap-2 mt-0.5 text-[11px] text-slate-500">
                        <span>{humanizeEnum(m.billingFrequency)}</span>
                        {m.isDemo && (
                          <>
                            <span>·</span>
                            <DemoMarker />
                          </>
                        )}
                      </div>
                    </td>
                    <td className="py-3 px-4">
                      <div className="font-medium text-slate-900">{m.merchantName}</div>
                      <div className="text-slate-500 text-[11px]">
                        {m.customerName} ({m.customerId})
                      </div>
                    </td>
                    <td className="py-3 px-4 text-right font-mono font-medium text-slate-900 tabular-nums">
                      {formatCurrency(m.authorizedAmount, m.currency)}
                    </td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums">
                      <span
                        className={
                          m.hasMerchantDrift ? 'font-semibold text-red-700' : 'text-slate-700'
                        }
                      >
                        {formatCurrency(m.currentMerchantAmount, m.currency)}
                      </span>
                      {m.hasMerchantDrift && (
                        <div className="text-[11px] text-red-600 font-sans">Drift detected</div>
                      )}
                    </td>
                    <td className="py-3 px-4">
                      <StatusLabel status={m.status} />
                    </td>
                    <td className="py-3 px-4 text-right font-mono text-slate-600 tabular-nums">
                      {m.eventCount}
                    </td>
                    <td className="py-3 px-4 text-right">
                      <div className="inline-flex items-center gap-1.5">
                        <Button size="sm" variant="outline" onClick={() => openDetail(m.id)}>
                          Inspect
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => onOpenReplay(m.id)}>
                          <History className="w-3.5 h-3.5" />
                          Replay
                        </Button>
                        <button
                          type="button"
                          onClick={() => setDeleteTarget(m)}
                          aria-label={`Delete mandate ${m.mandateCode}`}
                          className="p-1.5 text-slate-400 hover:text-red-600 rounded-md transition-colors cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Surface>

      {/* Consent Documents & AI Extraction History */}
      <Surface className="overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">
              Consent Documents &amp; AI Extraction Records ({documents.length})
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Uploaded customer authorization files with structured extraction confidence, missing
              field flags, and linked mandates.
            </p>
          </div>
          <Button size="sm" variant="outline" onClick={() => setUploadOpen(true)}>
            <FileUp className="w-3.5 h-3.5" />
            Upload &amp; Extract Document
          </Button>
        </div>
        {loading ? (
          <SkeletonRows rows={3} />
        ) : documents.length === 0 ? (
          <div className="p-6 text-center text-xs text-slate-500">
            No consent documents uploaded in this scope yet. Click &ldquo;Upload &amp; Extract
            Document&rdquo; to parse a PDF, image, or text mandate with Gemini AI.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/70 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                  <th className="py-2.5 px-4">Document / Ref</th>
                  <th className="py-2.5 px-4">Linked Mandate</th>
                  <th className="py-2.5 px-4">Extracted Terms</th>
                  <th className="py-2.5 px-4">Extraction Review</th>
                  <th className="py-2.5 px-4">Uploaded</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {documents.map((doc) => {
                  const ext = doc.extraction;
                  const exJson = ext?.extractedJson || {};
                  const missing = Array.isArray(ext?.missingFields) ? ext.missingFields : [];
                  const ambiguous = Array.isArray(ext?.ambiguousFields) ? ext.ambiguousFields : [];
                  return (
                    <tr key={doc.id} className="hover:bg-slate-50/70">
                      <td className="py-3 px-4">
                        <div className="font-medium text-slate-900 flex items-center gap-2">
                          <span className="truncate max-w-[220px]">{doc.fileName}</span>
                          {doc.isDemo && <DemoMarker />}
                        </div>
                        <div className="font-mono text-[11px] text-slate-500 mt-0.5">
                          {doc.storageRef} · {doc.mimeType}
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        {doc.mandateCode ? (
                          <button
                            type="button"
                            onClick={() => doc.mandateId && openDetail(doc.mandateId)}
                            className="font-mono font-semibold text-blue-700 hover:underline cursor-pointer"
                          >
                            {doc.mandateCode}
                          </button>
                        ) : (
                          <span className="text-slate-400">Pending Commit</span>
                        )}
                        {doc.merchantName && (
                          <div className="text-[11px] text-slate-500">{doc.merchantName}</div>
                        )}
                      </td>
                      <td className="py-3 px-4">
                        <div className="font-mono font-medium text-slate-900 tabular-nums">
                          {exJson.authorizedAmount != null
                            ? formatCurrency(exJson.authorizedAmount, exJson.currency || 'INR')
                            : 'Amount missing'}{' '}
                          {exJson.billingFrequency ? `· ${humanizeEnum(exJson.billingFrequency)}` : ''}
                        </div>
                        <div className="text-[11px] text-slate-500 truncate max-w-[240px]">
                          {exJson.billingSchedule || exJson.conditions || 'No schedule extracted'}
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        {ext ? (
                          <div className="space-y-0.5">
                            <div className="flex items-center gap-2">
                              <StatusLabel status={ext.reviewStatus} />
                              <span className="font-mono text-[11px] text-slate-600">
                                {Math.round((ext.confidenceScore || 0) * 100)}%
                              </span>
                            </div>
                            <div className="text-[11px] text-slate-500 font-mono">
                              {ext.provider}
                            </div>
                            {(missing.length > 0 || ambiguous.length > 0) && (
                              <div className="text-[11px] text-amber-700">
                                {missing.length > 0 ? `Missing: ${missing.join(', ')}` : ''}
                                {missing.length > 0 && ambiguous.length > 0 ? ' · ' : ''}
                                {ambiguous.length > 0 ? `Ambiguous: ${ambiguous.join(', ')}` : ''}
                              </div>
                            )}
                          </div>
                        ) : (
                          <span className="text-slate-400">No extraction record</span>
                        )}
                      </td>
                      <td className="py-3 px-4 font-mono text-slate-500 whitespace-nowrap tabular-nums">
                        {formatDateTime(doc.uploadedAt)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Surface>

      {/* Mandate Detail Panel */}
      {detailMandateId && (
        <Surface className="p-6 space-y-6">
          {detailLoading || !detailData ? (
            <SkeletonRows rows={4} />
          ) : (
            <>
              <div className="flex flex-col md:flex-row md:items-start justify-between gap-4 pb-5 border-b border-slate-200">
                <div>
                  <div className="flex items-center gap-2.5 flex-wrap">
                    <h2 className="text-lg font-bold font-mono text-slate-900">
                      {detailData.mandate.mandateCode}
                    </h2>
                    <StatusLabel status={detailData.mandate.status} />
                    {detailData.mandate.isDemo && <DemoMarker />}
                  </div>
                  <p className="text-xs text-slate-500 mt-1">
                    {detailData.mandate.merchantName} ({detailData.mandate.merchantId}) · Customer:{' '}
                    {detailData.mandate.customerName} ({detailData.mandate.customerId})
                  </p>
                </div>

                <div className="flex items-center gap-2 flex-wrap">
                  <Button size="sm" variant="outline" onClick={() => setMetaModalOpen(true)}>
                    Edit Metadata
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setEventForm((f) => ({
                        ...f,
                        newAmount: String(detailData.mandate.currentMerchantAmount),
                        newMerchantId: detailData.mandate.merchantId,
                        newMerchantName: detailData.mandate.merchantName,
                        eventTimestamp: new Date().toISOString().slice(0, 16),
                      }));
                      setEventModalOpen(true);
                    }}
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Record Event
                  </Button>
                  <Button size="sm" onClick={() => onOpenReplay(detailData.mandate.id)}>
                    <History className="w-3.5 h-3.5" />
                    Open in Drift Replay
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setDetailMandateId(null);
                      setDetailData(null);
                    }}
                  >
                    Close
                  </Button>
                </div>
              </div>

              <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 text-xs">
                <div className="p-3.5 rounded-lg bg-slate-50 border border-slate-200">
                  <div className="text-slate-500">Original Customer Consent</div>
                  <div className="text-base font-mono font-bold text-slate-900 mt-1 tabular-nums">
                    {formatCurrency(detailData.mandate.authorizedAmount, detailData.mandate.currency)}
                  </div>
                  <div className="text-[11px] text-slate-500 mt-0.5">
                    {humanizeEnum(detailData.mandate.billingFrequency)} ·{' '}
                    {detailData.mandate.billingSchedule}
                  </div>
                </div>

                <div className="p-3.5 rounded-lg bg-slate-50 border border-slate-200">
                  <div className="text-slate-500">Current Merchant-Side Record</div>
                  <div
                    className={`text-base font-mono font-bold mt-1 tabular-nums ${
                      Math.abs(
                        detailData.mandate.currentMerchantAmount -
                          detailData.mandate.authorizedAmount
                      ) > 0.01
                        ? 'text-red-700'
                        : 'text-slate-900'
                    }`}
                  >
                    {formatCurrency(
                      detailData.mandate.currentMerchantAmount,
                      detailData.mandate.currency
                    )}
                  </div>
                  <div className="text-[11px] text-slate-500 mt-0.5">
                    {humanizeEnum(detailData.mandate.currentMerchantFrequency)}
                  </div>
                </div>

                <div className="p-3.5 rounded-lg bg-slate-50 border border-slate-200">
                  <div className="text-slate-500">Validity Window</div>
                  <div className="font-mono font-semibold text-slate-900 mt-1">
                    {formatShortDate(detailData.mandate.startDate)} →{' '}
                    {detailData.mandate.endDate
                      ? formatShortDate(detailData.mandate.endDate)
                      : 'Open-ended'}
                  </div>
                  <div className="text-[11px] text-slate-500 mt-0.5">
                    Consent: {formatDateTime(detailData.mandate.originalConsentTimestamp)}
                  </div>
                </div>

                <div className="p-3.5 rounded-lg bg-slate-50 border border-slate-200">
                  <div className="text-slate-500">Evidence Reference</div>
                  <div className="font-mono font-semibold text-slate-900 mt-1 truncate">
                    {detailData.mandate.consentEvidenceRef || 'Missing Evidence'}
                  </div>
                  <div className="text-[11px] text-slate-500 mt-0.5 truncate">
                    {detailData.mandate.conditions || 'Standard recurring terms'}
                  </div>
                </div>
              </div>

              {/* Append-Only Event History Table */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-900">
                      Append-Only Mandate Event Ledger
                    </h3>
                    <p className="text-xs text-slate-500">
                      Historical events are preserved chronologically and never overwritten.
                    </p>
                  </div>
                </div>
                <div className="overflow-x-auto border border-slate-200 rounded-lg">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-semibold text-slate-500 uppercase">
                        <th className="py-2 px-3">Timestamp</th>
                        <th className="py-2 px-3">Event</th>
                        <th className="py-2 px-3">Actor</th>
                        <th className="py-2 px-3">Change</th>
                        <th className="py-2 px-3">Customer Approval</th>
                        <th className="py-2 px-3">Evidence</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {detailData.events.map((ev: any) => (
                        <tr key={ev.id}>
                          <td className="py-2.5 px-3 font-mono text-slate-600 whitespace-nowrap tabular-nums">
                            {formatDateTime(ev.eventTimestamp)}
                          </td>
                          <td className="py-2.5 px-3 font-semibold text-slate-900">
                            {humanizeEnum(ev.eventType)}
                            <div className="text-[11px] font-mono font-normal text-slate-400">
                              {ev.eventUid}
                            </div>
                          </td>
                          <td className="py-2.5 px-3 text-slate-700">{ev.actor}</td>
                          <td className="py-2.5 px-3">
                            <EventPayloadViewer
                              eventType={ev.eventType}
                              previousValue={ev.previousValue}
                              newValue={ev.newValue}
                              currency={detailData.mandate.currency}
                            />
                          </td>
                          <td className="py-2.5 px-3">
                            {isPaymentLifecycleEvent(ev.eventType) ? (
                              <span className="text-slate-600 font-medium">
                                Payment Event (Non-Modification)
                              </span>
                            ) : ev.customerApproved ? (
                              <span className="text-emerald-700 font-semibold">
                                Approved {ev.customerApprovalRef ? `(${ev.customerApprovalRef})` : ''}
                              </span>
                            ) : (
                              <span className="text-slate-500">Not Customer-Approved</span>
                            )}
                          </td>
                          <td className="py-2.5 px-3 font-mono text-[11px] text-slate-600">
                            {ev.evidenceStatus}
                            {ev.evidenceRef ? ` · ${ev.evidenceRef}` : ''}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </Surface>
      )}

      {/* Modal 1: Create Mandate Manually */}
      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Create Mandate Manually"
        subtitle="Creates the mandate and appends the initial immutable consent event."
        wide
      >
        <form onSubmit={handleCreateMandate} className="space-y-4">
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <FieldLabel required>Mandate ID</FieldLabel>
              <TextInput
                placeholder="MND-2026-101"
                value={form.mandateCode}
                onChange={(e) => setForm({ ...form, mandateCode: e.target.value })}
                required
              />
            </div>
            <div>
              <FieldLabel>Consent Evidence Reference</FieldLabel>
              <TextInput
                placeholder="EVD-UPI-OTP-1234 (leave blank if missing)"
                value={form.consentEvidenceRef}
                onChange={(e) => setForm({ ...form, consentEvidenceRef: e.target.value })}
              />
            </div>
            <div>
              <FieldLabel required>Customer Name</FieldLabel>
              <TextInput
                placeholder="Priya Deshpande"
                value={form.customerName}
                onChange={(e) => setForm({ ...form, customerName: e.target.value })}
                required
              />
            </div>
            <div>
              <FieldLabel required>Customer ID</FieldLabel>
              <TextInput
                placeholder="CUST-5001"
                value={form.customerId}
                onChange={(e) => setForm({ ...form, customerId: e.target.value })}
                required
              />
            </div>
            <div>
              <FieldLabel required>Merchant Name</FieldLabel>
              <TextInput
                placeholder="StreamPulse Media Pvt Ltd"
                value={form.merchantName}
                onChange={(e) => setForm({ ...form, merchantName: e.target.value })}
                required
              />
            </div>
            <div>
              <FieldLabel required>Merchant ID</FieldLabel>
              <TextInput
                placeholder="MRC-STREAM-01"
                value={form.merchantId}
                onChange={(e) => setForm({ ...form, merchantId: e.target.value })}
                required
              />
            </div>
            <div>
              <FieldLabel required>Authorized Amount</FieldLabel>
              <TextInput
                type="number"
                step="0.01"
                min="1"
                value={form.authorizedAmount}
                onChange={(e) => setForm({ ...form, authorizedAmount: e.target.value })}
                required
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <FieldLabel required>Currency</FieldLabel>
                <SelectInput
                  value={form.currency}
                  onChange={(e) => setForm({ ...form, currency: e.target.value })}
                >
                  <option value="INR">INR (₹)</option>
                  <option value="USD">USD ($)</option>
                  <option value="EUR">EUR (€)</option>
                </SelectInput>
              </div>
              <div>
                <FieldLabel required>Frequency</FieldLabel>
                <SelectInput
                  value={form.billingFrequency}
                  onChange={(e) => setForm({ ...form, billingFrequency: e.target.value })}
                >
                  <option value="MONTHLY">Monthly</option>
                  <option value="WEEKLY">Weekly</option>
                  <option value="QUARTERLY">Quarterly</option>
                  <option value="YEARLY">Yearly</option>
                  <option value="DAILY">Daily</option>
                  <option value="AS_PRESENTED">As Presented</option>
                </SelectInput>
              </div>
            </div>
            <div>
              <FieldLabel required>Billing Schedule</FieldLabel>
              <TextInput
                value={form.billingSchedule}
                onChange={(e) => setForm({ ...form, billingSchedule: e.target.value })}
                required
              />
            </div>
            <div>
              <FieldLabel>Authorized Billing Day (1–31)</FieldLabel>
              <TextInput
                type="number"
                min="1"
                max="31"
                value={form.billingDayOfMonth}
                onChange={(e) => setForm({ ...form, billingDayOfMonth: e.target.value })}
              />
            </div>
            <div>
              <FieldLabel required>Start Date</FieldLabel>
              <TextInput
                type="date"
                value={form.startDate}
                onChange={(e) => setForm({ ...form, startDate: e.target.value })}
                required
              />
            </div>
            <div>
              <FieldLabel>End Date (Optional)</FieldLabel>
              <TextInput
                type="date"
                value={form.endDate}
                onChange={(e) => setForm({ ...form, endDate: e.target.value })}
              />
            </div>
          </div>

          <div>
            <FieldLabel>Conditions & Restrictions</FieldLabel>
            <TextAreaInput
              rows={2}
              placeholder="e.g., Fixed monthly ceiling; any tariff change requires fresh customer OTP consent."
              value={form.conditions}
              onChange={(e) => setForm({ ...form, conditions: e.target.value })}
            />
          </div>

          <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
            <input
              type="checkbox"
              checked={form.requireApprovalForDecrease}
              onChange={(e) => setForm({ ...form, requireApprovalForDecrease: e.target.checked })}
              className="rounded border-slate-300 text-blue-700"
            />
            Require explicit customer approval even for amount decreases
          </label>

          <div className="flex justify-end gap-3 pt-4 border-t border-slate-100">
            <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? 'Saving Mandate...' : 'Create Mandate'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Modal 2: Upload Consent Document + AI Gemini Extraction & Human Review */}
      <Modal
        open={uploadOpen}
        onClose={() => {
          setUploadOpen(false);
          setExtractionRes(null);
          setReviewForm(null);
        }}
        title="AI-Powered Consent Document Extraction"
        subtitle="Upload a PDF, PNG, JPEG, WebP, or text mandate document. Review and correct all extracted fields before saving."
        wide
      >
        {!extractionRes ? (
          <form onSubmit={handleExtractDocument} className="space-y-4">
            <div className="border-2 border-dashed border-slate-300 rounded-xl p-8 text-center bg-slate-50/50">
              <FileUp className="w-7 h-7 text-blue-700 mx-auto mb-3" />
              <div className="text-sm font-medium text-slate-900">
                Select a customer consent document
              </div>
              <p className="text-xs text-slate-500 mt-1">
                PDF, PNG, JPEG, WebP, or plain text · Maximum 10 MB · Validated server-side
              </p>
              <input
                type="file"
                accept=".pdf,.png,.jpg,.jpeg,.webp,.txt,application/pdf,image/png,image/jpeg,image/webp,text/plain"
                onChange={(e) => setUploadFile(e.target.files?.[0] ?? null)}
                className="mt-4 text-xs text-slate-700 file:mr-3 file:py-1.5 file:px-3 file:rounded-md file:border file:border-slate-300 file:bg-white file:text-xs file:font-medium hover:file:bg-slate-50 cursor-pointer"
                required
              />
              {uploadFile && (
                <div className="mt-3 text-xs font-mono text-slate-700">
                  Selected: {uploadFile.name} ({Math.round(uploadFile.size / 1024)} KB)
                </div>
              )}
            </div>

            <div className="p-3.5 rounded-lg bg-slate-50 border border-slate-200 text-xs text-slate-600">
              <span className="font-semibold text-slate-900">Human-in-the-loop safeguard: </span>
              AI extraction never independently approves a mandate or payment. Missing or low-confidence
              fields are automatically highlighted and flagged as NEEDS_REVIEW.
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <Button type="button" variant="outline" onClick={() => setUploadOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={!uploadFile || extracting}>
                {extracting ? 'Extracting with Gemini...' : 'Extract Consent Fields'}
              </Button>
            </div>
          </form>
        ) : (
          <form onSubmit={handleCommitExtraction} className="space-y-4">
            <div className="p-3.5 rounded-lg bg-slate-50 border border-slate-200 flex flex-wrap items-center justify-between gap-2 text-xs">
              <div>
                <span className="font-semibold text-slate-900">
                  Extraction Confidence:{' '}
                  <span className="font-mono">
                    {Math.round((extractionRes.extracted.confidenceScore || 0) * 100)}%
                  </span>
                </span>
                <span className="mx-2 text-slate-300">·</span>
                <span className="text-slate-600">Engine: {extractionRes.provider}</span>
                <span className="mx-2 text-slate-300">·</span>
                <StatusLabel status={extractionRes.reviewStatus} />
              </div>
              <span className="font-mono text-[11px] text-slate-500">
                Ref: {extractionRes.document?.storageRef}
              </span>
            </div>

            {extractionRes.warningMessage && (
              <div
                className={`p-3 rounded-lg border text-xs flex items-start gap-2 ${
                  extractionRes.extractionStatus === 'FAILED'
                    ? 'bg-red-50 border-red-200 text-red-800'
                    : 'bg-amber-50 border-amber-200 text-amber-900'
                }`}
              >
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                <div>
                  <div className="font-semibold">
                    {extractionRes.extractionStatus === 'FAILED'
                      ? 'Automatic AI Extraction Failed — Manual Entry Required'
                      : 'Deterministic Text Fallback Used — Please Verify All Fields'}
                  </div>
                  <div className="mt-0.5 leading-relaxed">{extractionRes.warningMessage}</div>
                </div>
              </div>
            )}

            {(missingSet.size > 0 || ambiguousSet.size > 0) && (
              <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-900 flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-amber-700" />
                <div>
                  <div className="font-semibold">Human review required before saving</div>
                  {missingSet.size > 0 && (
                    <div className="mt-0.5">
                      Missing fields: {Array.from(missingSet).join(', ')}
                    </div>
                  )}
                  {ambiguousSet.size > 0 && (
                    <div className="mt-0.5">
                      Ambiguous fields: {Array.from(ambiguousSet).join(', ')}
                    </div>
                  )}
                </div>
              </div>
            )}

            <div className="grid sm:grid-cols-2 gap-3.5">
              <div>
                <FieldLabel required>Mandate ID</FieldLabel>
                <TextInput
                  value={reviewForm.mandateCode}
                  onChange={(e) => setReviewForm({ ...reviewForm, mandateCode: e.target.value })}
                  required
                />
              </div>
              <div>
                <FieldLabel required>Consent Status After Review</FieldLabel>
                <SelectInput
                  value={reviewForm.status}
                  onChange={(e) => setReviewForm({ ...reviewForm, status: e.target.value })}
                >
                  <option value="ACTIVE">Active (Human Verified)</option>
                  <option value="NEEDS_REVIEW">Needs Review (Incomplete / Ambiguous)</option>
                  <option value="PENDING_CONSENT">Pending Consent</option>
                </SelectInput>
              </div>
              <div>
                <FieldLabel required>
                  Customer Name {missingSet.has('customerName') && '(Missing)'}
                </FieldLabel>
                <TextInput
                  value={reviewForm.customerName}
                  onChange={(e) => setReviewForm({ ...reviewForm, customerName: e.target.value })}
                  className={missingSet.has('customerName') ? 'border-amber-400 bg-amber-50/40' : ''}
                  required
                />
              </div>
              <div>
                <FieldLabel required>Customer ID</FieldLabel>
                <TextInput
                  value={reviewForm.customerId}
                  onChange={(e) => setReviewForm({ ...reviewForm, customerId: e.target.value })}
                  required
                />
              </div>
              <div>
                <FieldLabel required>
                  Merchant Name {missingSet.has('merchantName') && '(Missing)'}
                </FieldLabel>
                <TextInput
                  value={reviewForm.merchantName}
                  onChange={(e) => setReviewForm({ ...reviewForm, merchantName: e.target.value })}
                  className={missingSet.has('merchantName') ? 'border-amber-400 bg-amber-50/40' : ''}
                  required
                />
              </div>
              <div>
                <FieldLabel required>Merchant ID</FieldLabel>
                <TextInput
                  value={reviewForm.merchantId}
                  onChange={(e) => setReviewForm({ ...reviewForm, merchantId: e.target.value })}
                  required
                />
              </div>
              <div>
                <FieldLabel required>
                  Authorized Amount {missingSet.has('authorizedAmount') && '(Missing)'}
                </FieldLabel>
                <TextInput
                  type="number"
                  step="0.01"
                  min="1"
                  value={reviewForm.authorizedAmount}
                  onChange={(e) =>
                    setReviewForm({ ...reviewForm, authorizedAmount: e.target.value })
                  }
                  className={
                    missingSet.has('authorizedAmount') ? 'border-amber-400 bg-amber-50/40' : ''
                  }
                  required
                />
              </div>
              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <FieldLabel required>Currency</FieldLabel>
                  <TextInput
                    value={reviewForm.currency}
                    onChange={(e) => setReviewForm({ ...reviewForm, currency: e.target.value })}
                    required
                  />
                </div>
                <div>
                  <FieldLabel required>Frequency</FieldLabel>
                  <SelectInput
                    value={reviewForm.billingFrequency}
                    onChange={(e) =>
                      setReviewForm({ ...reviewForm, billingFrequency: e.target.value })
                    }
                  >
                    <option value="MONTHLY">Monthly</option>
                    <option value="WEEKLY">Weekly</option>
                    <option value="QUARTERLY">Quarterly</option>
                    <option value="YEARLY">Yearly</option>
                    <option value="DAILY">Daily</option>
                    <option value="AS_PRESENTED">As Presented</option>
                  </SelectInput>
                </div>
              </div>
              <div>
                <FieldLabel required>Billing Schedule</FieldLabel>
                <TextInput
                  value={reviewForm.billingSchedule}
                  onChange={(e) => setReviewForm({ ...reviewForm, billingSchedule: e.target.value })}
                  required
                />
              </div>
              <div>
                <FieldLabel>Authorized Billing Day (1–31)</FieldLabel>
                <TextInput
                  type="number"
                  min="1"
                  max="31"
                  value={reviewForm.billingDayOfMonth}
                  onChange={(e) =>
                    setReviewForm({ ...reviewForm, billingDayOfMonth: e.target.value })
                  }
                />
              </div>
              <div>
                <FieldLabel required>Start Date</FieldLabel>
                <TextInput
                  type="date"
                  value={reviewForm.startDate}
                  onChange={(e) => setReviewForm({ ...reviewForm, startDate: e.target.value })}
                  required
                />
              </div>
              <div>
                <FieldLabel>End Date</FieldLabel>
                <TextInput
                  type="date"
                  value={reviewForm.endDate}
                  onChange={(e) => setReviewForm({ ...reviewForm, endDate: e.target.value })}
                />
              </div>
            </div>

            <div>
              <FieldLabel>Extracted Conditions & Notes</FieldLabel>
              <TextAreaInput
                rows={2}
                value={reviewForm.conditions}
                onChange={(e) => setReviewForm({ ...reviewForm, conditions: e.target.value })}
              />
            </div>

            <div className="flex justify-between items-center pt-3 border-t border-slate-100">
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setExtractionRes(null);
                  setReviewForm(null);
                }}
              >
                Upload Different File
              </Button>
              <div className="flex gap-2.5">
                <Button type="button" variant="outline" onClick={() => setUploadOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={committing}>
                  {committing ? 'Saving...' : 'Confirm & Save Mandate'}
                </Button>
              </div>
            </div>
          </form>
        )}
      </Modal>

      {/* Modal 3: Append Chronological Mandate Event */}
      <Modal
        open={eventModalOpen}
        onClose={() => setEventModalOpen(false)}
        title="Append Mandate Event"
        subtitle="Merchant-side modifications never alter customer-authorized terms unless explicit verified customer consent evidence is supplied."
      >
        <form onSubmit={handleAppendEvent} className="space-y-4">
          <div className="grid sm:grid-cols-2 gap-3.5">
            <div>
              <FieldLabel required>Event Type</FieldLabel>
              <SelectInput
                value={eventForm.eventType}
                onChange={(e) => setEventForm({ ...eventForm, eventType: e.target.value })}
              >
                <option value="AMOUNT_MODIFIED">Amount Modified</option>
                <option value="FREQUENCY_MODIFIED">Frequency Modified</option>
                <option value="MERCHANT_MODIFIED">Merchant Modified</option>
                <option value="MANDATE_PAUSED">Mandate Paused</option>
                <option value="MANDATE_RESUMED">Mandate Resumed</option>
                <option value="MANDATE_REVOKED">Mandate Revoked</option>
                <option value="MANDATE_EXPIRED">Mandate Expired</option>
                <option value="CONSENT_APPROVED">Fresh Consent Approved</option>
                <option value="PRE_DEBIT_NOTIFICATION">Pre-Debit Notification</option>
              </SelectInput>
            </div>
            <div>
              <FieldLabel required>Actor / Source</FieldLabel>
              <SelectInput
                value={eventForm.actor}
                onChange={(e) => setEventForm({ ...eventForm, actor: e.target.value })}
              >
                <option value="MERCHANT">Merchant</option>
                <option value="CUSTOMER">Customer</option>
                <option value="BANK_NPCI">Bank / NPCI</option>
                <option value="SYSTEM">System</option>
                <option value="ANALYST">Analyst</option>
              </SelectInput>
            </div>
          </div>

          <div>
            <FieldLabel required>Event Timestamp</FieldLabel>
            <TextInput
              type="datetime-local"
              value={eventForm.eventTimestamp}
              onChange={(e) => setEventForm({ ...eventForm, eventTimestamp: e.target.value })}
              required
            />
          </div>

          {(eventForm.eventType === 'AMOUNT_MODIFIED' ||
            eventForm.eventType === 'CONSENT_APPROVED') && (
            <div>
              <FieldLabel required>New Amount</FieldLabel>
              <TextInput
                type="number"
                step="0.01"
                min="1"
                value={eventForm.newAmount}
                onChange={(e) => setEventForm({ ...eventForm, newAmount: e.target.value })}
                required
              />
            </div>
          )}

          {eventForm.eventType === 'FREQUENCY_MODIFIED' && (
            <div>
              <FieldLabel required>New Billing Frequency</FieldLabel>
              <SelectInput
                value={eventForm.newFrequency}
                onChange={(e) => setEventForm({ ...eventForm, newFrequency: e.target.value })}
              >
                <option value="DAILY">Daily</option>
                <option value="WEEKLY">Weekly</option>
                <option value="MONTHLY">Monthly</option>
                <option value="QUARTERLY">Quarterly</option>
                <option value="YEARLY">Yearly</option>
              </SelectInput>
            </div>
          )}

          {eventForm.eventType === 'MERCHANT_MODIFIED' && (
            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <FieldLabel required>New Merchant ID</FieldLabel>
                <TextInput
                  value={eventForm.newMerchantId}
                  onChange={(e) => setEventForm({ ...eventForm, newMerchantId: e.target.value })}
                  required
                />
              </div>
              <div>
                <FieldLabel>New Merchant Name</FieldLabel>
                <TextInput
                  value={eventForm.newMerchantName}
                  onChange={(e) => setEventForm({ ...eventForm, newMerchantName: e.target.value })}
                />
              </div>
            </div>
          )}

          <div className="p-3.5 rounded-lg bg-slate-50 border border-slate-200 space-y-3">
            <label className="flex items-center gap-2 text-xs font-medium text-slate-800 cursor-pointer">
              <input
                type="checkbox"
                checked={eventForm.customerApproved}
                onChange={(e) =>
                  setEventForm({
                    ...eventForm,
                    customerApproved: e.target.checked,
                    evidenceStatus: e.target.checked ? 'VERIFIED' : 'NONE',
                  })
                }
                className="rounded border-slate-300 text-blue-700"
              />
              Explicit Customer-Approved Consent Obtained
            </label>

            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <FieldLabel>Evidence Status</FieldLabel>
                <SelectInput
                  value={eventForm.evidenceStatus}
                  onChange={(e) => setEventForm({ ...eventForm, evidenceStatus: e.target.value })}
                >
                  <option value="NONE">None</option>
                  <option value="VERIFIED">Verified</option>
                  <option value="MISSING">Missing</option>
                  <option value="AMBIGUOUS">Ambiguous</option>
                </SelectInput>
              </div>
              <div>
                <FieldLabel>Approval / Evidence Reference</FieldLabel>
                <TextInput
                  placeholder="e.g. OTP-MAR-7821"
                  value={eventForm.customerApprovalRef}
                  onChange={(e) =>
                    setEventForm({
                      ...eventForm,
                      customerApprovalRef: e.target.value,
                      evidenceRef: e.target.value,
                    })
                  }
                />
              </div>
            </div>
          </div>

          <div>
            <FieldLabel>Audit Notes</FieldLabel>
            <TextInput
              placeholder="Optional context for this event"
              value={eventForm.notes}
              onChange={(e) => setEventForm({ ...eventForm, notes: e.target.value })}
            />
          </div>

          <div className="flex justify-end gap-3 pt-3 border-t border-slate-100">
            <Button type="button" variant="outline" onClick={() => setEventModalOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={appendingEvent}>
              {appendingEvent ? 'Recording Event...' : 'Append Event'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Modal 4: Edit Permitted Metadata */}
      <Modal
        open={metaModalOpen}
        onClose={() => setMetaModalOpen(false)}
        title="Edit Permitted Mandate Metadata"
        subtitle="Customer-authorized amount and frequency are protected and can only change via verified consent events."
      >
        <form onSubmit={handleUpdateMetadata} className="space-y-4">
          <div>
            <FieldLabel required>Customer Name</FieldLabel>
            <TextInput
              value={metaForm.customerName}
              onChange={(e) => setMetaForm({ ...metaForm, customerName: e.target.value })}
              required
            />
          </div>
          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <FieldLabel required>Billing Schedule Label</FieldLabel>
              <TextInput
                value={metaForm.billingSchedule}
                onChange={(e) => setMetaForm({ ...metaForm, billingSchedule: e.target.value })}
                required
              />
            </div>
            <div>
              <FieldLabel>Billing Day of Month</FieldLabel>
              <TextInput
                type="number"
                min="1"
                max="31"
                value={metaForm.billingDayOfMonth}
                onChange={(e) => setMetaForm({ ...metaForm, billingDayOfMonth: e.target.value })}
              />
            </div>
          </div>
          <div>
            <FieldLabel>End Date</FieldLabel>
            <TextInput
              type="date"
              value={metaForm.endDate}
              onChange={(e) => setMetaForm({ ...metaForm, endDate: e.target.value })}
            />
          </div>
          <div>
            <FieldLabel>Conditions</FieldLabel>
            <TextAreaInput
              rows={2}
              value={metaForm.conditions}
              onChange={(e) => setMetaForm({ ...metaForm, conditions: e.target.value })}
            />
          </div>
          <div className="flex justify-end gap-3 pt-3 border-t border-slate-100">
            <Button type="button" variant="outline" onClick={() => setMetaModalOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? 'Updating...' : 'Save Metadata'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Destructive Action Confirmation Dialog */}
      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDeleteMandate}
        title="Delete Mandate?"
        description={`This permanently removes mandate ${deleteTarget?.mandateCode} and its associated simulated attempts from your workspace. This action cannot be undone.`}
        confirmLabel="Delete Mandate"
        danger
        loading={deleting}
      />
    </div>
  );
}
