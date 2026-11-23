import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { jsPDF } from 'jspdf';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(amount: number, currency = 'INR'): string {
  const safeAmount = Number.isFinite(amount) ? amount : 0;
  const code = (currency || 'INR').toUpperCase();
  const symbol = code === 'INR' ? '₹' : code === 'USD' ? '$' : code === 'EUR' ? '€' : `${code} `;
  return `${symbol}${safeAmount.toLocaleString('en-IN', {
    minimumFractionDigits: safeAmount % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
}

export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-IN', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

export function formatShortDate(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-IN', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
  });
}

export function humanizeEnum(val: string | null | undefined): string {
  if (!val) return '—';
  return val
    .toLowerCase()
    .split('_')
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : ''))
    .join(' ');
}

export function exportToCsv(filename: string, rows: Array<Record<string, unknown>>) {
  if (!rows.length) return;
  const headers = Object.keys(rows[0]);
  const escapeCell = (val: unknown) => {
    const s = val === null || val === undefined ? '' : String(val);
    if (/[",\n]/.test(s)) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };
  const csv = [
    headers.join(','),
    ...rows.map((r) => headers.map((h) => escapeCell(r[h])).join(',')),
  ].join('\n');

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function isPaymentLifecycleEvent(eventType: string | null | undefined): boolean {
  const t = (eventType || '').toUpperCase();
  return (
    t === 'DEBIT_PROCESSED' ||
    t === 'DEBIT_ATTEMPTED' ||
    t === 'DEBIT_REJECTED' ||
    t === 'PRE_DEBIT_NOTIFICATION'
  );
}

export interface FormattedPayloadLine {
  label: string;
  value: string;
}

function formatFieldValue(key: string, val: unknown, currency = 'INR'): string {
  if (val === null || val === undefined || val === '') return '—';
  const k = key.toLowerCase();
  if (
    (k === 'amount' || k === 'attemptedamount' || k === 'authorizedamount') &&
    typeof val === 'number'
  ) {
    return formatCurrency(val, currency);
  }
  if (k === 'billingfrequency' || k === 'frequency' || k === 'status' || k === 'verificationstatus') {
    return humanizeEnum(String(val));
  }
  if (typeof val === 'boolean') return val ? 'Yes' : 'No';
  if (typeof val === 'object') return JSON.stringify(val);
  return String(val);
}

const KEY_LABELS: Record<string, string> = {
  amount: 'Amount',
  attemptedAmount: 'Attempted Amount',
  authorizedAmount: 'Authorized Amount',
  billingFrequency: 'Frequency',
  frequency: 'Frequency',
  merchantId: 'Merchant ID',
  merchantName: 'Merchant',
  status: 'Status',
  attemptUid: 'Attempt Ref',
  verificationStatus: 'Verification Outcome',
  note: 'Note',
  reason: 'Reason',
  channel: 'Channel',
  mandateCode: 'Mandate ID',
};

export function formatEventPayloadLines(
  eventType: string | null | undefined,
  previousValue: Record<string, unknown> | null | undefined,
  newValue: Record<string, unknown> | null | undefined,
  currency = 'INR'
): FormattedPayloadLine[] {
  const prev = previousValue && typeof previousValue === 'object' ? previousValue : {};
  const next = newValue && typeof newValue === 'object' ? newValue : {};
  const allKeys = Array.from(new Set([...Object.keys(prev), ...Object.keys(next)]));
  const lines: FormattedPayloadLine[] = [];

  for (const key of allKeys) {
    const hasPrev = prev[key] !== undefined && prev[key] !== null;
    const hasNext = next[key] !== undefined && next[key] !== null;
    const label =
      key === 'amount' && isPaymentLifecycleEvent(eventType)
        ? 'Debit Amount'
        : KEY_LABELS[key] || humanizeEnum(key.replace(/([A-Z])/g, '_$1'));

    if (hasPrev && hasNext && String(prev[key]) !== String(next[key])) {
      lines.push({
        label,
        value: `${formatFieldValue(key, prev[key], currency)} → ${formatFieldValue(key, next[key], currency)}`,
      });
    } else if (hasNext) {
      lines.push({
        label,
        value: formatFieldValue(key, next[key], currency),
      });
    } else if (hasPrev) {
      lines.push({
        label: `Previous ${label}`,
        value: formatFieldValue(key, prev[key], currency),
      });
    }
  }

  return lines;
}

export interface ForensicEvidencePdfInput {
  reportTitle?: string;
  fileName: string;
  caseData?: any | null;
  mandate: any | null;
  paymentAttempt: any | null;
  verification: any | null;
  violations: any[];
  events: any[];
  documents?: any[];
  notes?: any[];
}

export function buildForensicEvidencePdf(data: ForensicEvidencePdfInput): jsPDF {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const marginX = 44;
  const maxWidth = 507;
  let y = 48;

  const ensureSpace = (needed = 40) => {
    if (y + needed > 790) {
      doc.addPage();
      y = 48;
    }
  };

  const addHeading = (text: string) => {
    ensureSpace(34);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(15, 23, 42);
    doc.text(text, marginX, y);
    y += 6;
    doc.setDrawColor(226, 232, 240);
    doc.line(marginX, y, marginX + maxWidth, y);
    y += 14;
  };

  const addParagraph = (
    text: string,
    bold = false,
    color: [number, number, number] = [51, 65, 85]
  ) => {
    doc.setFont('helvetica', bold ? 'bold' : 'normal');
    doc.setFontSize(9.5);
    doc.setTextColor(color[0], color[1], color[2]);
    // jsPDF standard Helvetica font does not include the ₹ glyph cleanly, replace with INR
    const pdfSafeText = text.replace(/₹/g, 'INR ').replace(/→/g, '->');
    const lines = doc.splitTextToSize(pdfSafeText, maxWidth);
    ensureSpace(lines.length * 13 + 6);
    doc.text(lines, marginX, y);
    y += lines.length * 13 + 6;
  };

  const cur = (data.verification?.currency || data.mandate?.currency || 'INR').toUpperCase();
  const isDemo = Boolean(
    data.caseData?.isDemo || data.verification?.isDemo || data.mandate?.isDemo
  );
  const headerRef = data.caseData?.caseUid
    ? `Case ${data.caseData.caseUid}`
    : `Attempt ${data.paymentAttempt?.attemptUid || data.verification?.id || 'N/A'}`;

  // Header
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.setTextColor(15, 23, 42);
  doc.text(data.reportTitle || 'DebitOrigin — Forensic Consent Evidence Report', marginX, y);
  y += 18;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(100, 116, 139);
  doc.text(
    `${headerRef}  |  Generated ${new Date().toISOString().slice(0, 19).replace('T', ' ')} UTC${isDemo ? '  |  SYNTHETIC DEMO DATA' : ''}`,
    marginX,
    y
  );
  y += 22;

  // Section 1: Mandate & Original Consent Terms
  addHeading('1. Mandate Details & Original Consent Terms');
  if (data.mandate) {
    addParagraph(
      `Mandate ID: ${data.mandate.mandateCode}  |  Mandate Status: ${humanizeEnum(data.mandate.status)}`,
      true
    );
    addParagraph(
      `Customer: ${data.mandate.customerName} (${data.mandate.customerId})  |  Merchant: ${data.mandate.merchantName} (${data.mandate.merchantId})`
    );
    addParagraph(
      `Original Authorized Amount: ${cur} ${data.mandate.authorizedAmount}  |  Billing Frequency: ${humanizeEnum(data.mandate.billingFrequency)}  |  Schedule: ${data.mandate.billingSchedule || 'Not specified'}`
    );
    addParagraph(
      `Validity Period: ${formatShortDate(data.mandate.startDate)} to ${data.mandate.endDate ? formatShortDate(data.mandate.endDate) : 'Open-ended'}  |  Original Consent Timestamp: ${formatDateTime(data.mandate.originalConsentTimestamp)}`
    );
    addParagraph(
      `Consent Evidence Reference: ${data.mandate.consentEvidenceRef || 'MISSING — No primary customer consent evidence artifact linked'}`
    );
    if (data.mandate.conditions) {
      addParagraph(`Consent Conditions / Caps: ${data.mandate.conditions}`);
    }
  } else {
    addParagraph('Mandate record unavailable for this report.', false, [180, 83, 9]);
  }

  // Section 2: Payment Attempt vs Reconstructed Authorization
  addHeading('2. Payment Attempt vs Reconstructed Authorization');
  if (data.verification) {
    const replay = data.verification.replaySnapshot as any;
    const recon = replay?.reconstructedAuthorization;
    const merch = replay?.merchantSideRecord;
    const delta = Number(
      (data.verification.attemptedAmount - data.verification.expectedAuthorizedAmount).toFixed(2)
    );
    addParagraph(
      `Attempt Reference: ${data.paymentAttempt?.attemptUid || `PAY-${data.verification.paymentAttemptId}`}  |  Attempt Timestamp: ${formatDateTime(data.verification.attemptTimestamp)}`
    );
    addParagraph(
      `Attempted Debit: ${cur} ${data.verification.attemptedAmount} (${humanizeEnum(data.paymentAttempt?.attemptedFrequency || data.mandate?.billingFrequency)})  |  Reconstructed Authorized: ${cur} ${data.verification.expectedAuthorizedAmount} (${humanizeEnum(recon?.billingFrequency || data.mandate?.billingFrequency)})`,
      true
    );
    addParagraph(
      `Variance: ${delta >= 0 ? '+' : ''}${cur} ${delta}  |  Reconstructed Status at Attempt: ${humanizeEnum(recon?.status || data.mandate?.status)}  |  Merchant Record: ${cur} ${merch?.amount ?? data.mandate?.currentMerchantAmount ?? 'N/A'}`
    );
    addParagraph(
      `Verification Result: ${data.verification.status}  |  Severity: ${data.verification.severity}  |  Anomaly Score: ${data.verification.anomalyScore}/100`,
      true
    );
    addParagraph(
      `Decision Explanation: ${data.verification.aiExplanation || data.verification.deterministicExplanation || 'No explanation recorded.'}`
    );

    const approvedMods = Array.isArray(replay?.approvedModifications)
      ? replay.approvedModifications
      : [];
    const unsupportedMods = Array.isArray(replay?.unsupportedModifications)
      ? replay.unsupportedModifications
      : [];
    addParagraph(
      `Approved Consent Modifications: ${approvedMods.length}  |  Unsupported Merchant-Side Modifications: ${unsupportedMods.length}`
    );
    for (const mod of unsupportedMods) {
      addParagraph(
        `  - [Unsupported ${mod.field}] ${formatDateTime(mod.eventTimestamp)}: ${String(mod.previousValue)} -> ${String(mod.newValue)} (${mod.reason})`,
        false,
        [185, 28, 28]
      );
    }
    for (const mod of approvedMods) {
      addParagraph(
        `  - [Approved ${mod.field}] ${formatDateTime(mod.eventTimestamp)}: ${String(mod.previousValue)} -> ${String(mod.newValue)} (Ref: ${mod.customerApprovalRef || mod.evidenceRef || 'Verified'})`,
        false,
        [4, 120, 87]
      );
    }
  } else {
    addParagraph('Payment verification details unavailable for this report.', false, [180, 83, 9]);
  }

  // Section 3: Detected Violations
  addHeading('3. Detected Consent Drift Violations');
  if (!data.violations || data.violations.length === 0) {
    addParagraph('No deterministic rule violations recorded for this payment attempt.');
  } else {
    for (const v of data.violations) {
      const refs =
        Array.isArray(v.evidenceRefs) && v.evidenceRefs.length > 0
          ? ` | Evidence Refs: ${v.evidenceRefs.join(', ')}`
          : '';
      addParagraph(
        `[${v.severity} · ${humanizeEnum(v.classification)}] ${humanizeEnum(v.violationType)}: ${v.explanation}${refs}`
      );
    }
  }

  // Section 4: Supporting Consent Evidence Documents
  addHeading('4. Supporting Consent Evidence Artifacts');
  const docs = data.documents ?? [];
  if (docs.length === 0) {
    if (data.mandate?.consentEvidenceRef) {
      addParagraph(
        `Primary mandate consent reference recorded (${data.mandate.consentEvidenceRef}), with no separate uploaded document attachment on file.`
      );
    } else {
      addParagraph(
        'No uploaded consent document or primary consent evidence artifact is linked to this mandate.',
        false,
        [180, 83, 9]
      );
    }
  } else {
    for (const d of docs) {
      addParagraph(
        `${d.fileName} (${d.storageRef})  |  Uploaded: ${formatDateTime(d.uploadedAt)}  |  SHA-256: ${String(d.sha256Hash || '').slice(0, 16)}...`
      );
    }
  }

  // Section 5: Chronological Event History
  addHeading('5. Chronological Mandate Event History');
  if (!data.events || data.events.length === 0) {
    addParagraph('No chronological mandate events recorded.');
  } else {
    for (const ev of data.events.slice(0, 30)) {
      const isPay = isPaymentLifecycleEvent(ev.eventType);
      const approval = isPay
        ? 'Payment Event (Non-Modification)'
        : ev.customerApproved
          ? `Customer Approved (${ev.customerApprovalRef || ev.evidenceRef || 'Verified'})`
          : 'No Customer Approval';
      const detailLines = formatEventPayloadLines(
        ev.eventType,
        ev.previousValue,
        ev.newValue,
        cur
      );
      const changeSummary =
        detailLines.length > 0
          ? ` | ${detailLines.map((l) => `${l.label}: ${l.value}`).join(', ')}`
          : '';
      addParagraph(
        `${formatDateTime(ev.eventTimestamp)}  |  ${humanizeEnum(ev.eventType)}  |  Actor: ${ev.actor}  |  ${approval}  |  Evidence: ${ev.evidenceStatus}${changeSummary}`
      );
    }
  }

  // Section 6: Investigation Case & Audit Notes (when applicable)
  if (data.caseData || (data.notes && data.notes.length > 0)) {
    addHeading('6. Investigation Case, Review Decision & Audit Notes');
    if (data.caseData) {
      addParagraph(`Case ${data.caseData.caseUid}: ${data.caseData.title}`, true);
      addParagraph(
        `Case Status: ${humanizeEnum(data.caseData.status)}  |  Severity: ${data.caseData.severity}  |  Human Decision: ${data.caseData.decision ? humanizeEnum(data.caseData.decision) : 'Pending Review'}`
      );
      if (data.caseData.decisionSummary) {
        addParagraph(`Decision Summary: ${data.caseData.decisionSummary}`, true);
      }
    }
    if (!data.notes || data.notes.length === 0) {
      addParagraph('No analyst investigation notes recorded yet.');
    } else {
      for (const n of data.notes) {
        addParagraph(
          `${formatDateTime(n.createdAt)} — ${n.authorName} [${n.noteType}]: ${n.content}`
        );
      }
    }
  }

  return doc;
}

export function downloadInvestigationPdf(data: {
  caseData: any;
  mandate: any;
  paymentAttempt: any;
  verification: any;
  violations: any[];
  notes: any[];
  events: any[];
  documents?: any[];
}) {
  const fileName = `${data.caseData.caseUid}_Evidence_Report.pdf`;
  const doc = buildForensicEvidencePdf({
    reportTitle: 'DebitOrigin — Investigation Forensic Evidence Report',
    fileName,
    caseData: data.caseData,
    mandate: data.mandate,
    paymentAttempt: data.paymentAttempt,
    verification: data.verification,
    violations: data.violations,
    events: data.events,
    documents: data.documents ?? [],
    notes: data.notes ?? [],
  });
  doc.save(fileName);
}

export function downloadVerificationEvidencePdf(data: {
  verification: any;
  mandate: any;
  paymentAttempt: any;
  violations: any[];
  events: any[];
  documents?: any[];
  caseData?: any | null;
  notes?: any[];
}) {
  const attemptRef =
    data.paymentAttempt?.attemptUid || `VER-${data.verification?.id || 'REPORT'}`;
  const fileName = `${attemptRef}_Consent_Evidence.pdf`;
  const doc = buildForensicEvidencePdf({
    reportTitle: 'DebitOrigin — Payment Verification Evidence Report',
    fileName,
    caseData: data.caseData ?? null,
    mandate: data.mandate,
    paymentAttempt: data.paymentAttempt,
    verification: data.verification,
    violations: data.violations,
    events: data.events,
    documents: data.documents ?? [],
    notes: data.notes ?? [],
  });
  doc.save(fileName);
}

export function downloadOperationalReportPdf(report: any) {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const marginX = 44;
  const maxWidth = 507;
  let y = 48;

  const ensureSpace = (needed = 40) => {
    if (y + needed > 790) {
      doc.addPage();
      y = 48;
    }
  };

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(17);
  doc.setTextColor(15, 23, 42);
  doc.text('DebitOrigin — Consent Verification Summary Report', marginX, y);
  y += 18;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(100, 116, 139);
  doc.text(
    `Generated: ${formatDateTime(report.generatedAt)}  |  Scope: ${report.scope.toUpperCase()}${report.includesDemoData ? '  |  INCLUDES SYNTHETIC DEMO DATA' : ''}`,
    marginX,
    y
  );
  y += 24;

  const addLine = (text: string, bold = false) => {
    doc.setFont('helvetica', bold ? 'bold' : 'normal');
    doc.setFontSize(10);
    doc.setTextColor(30, 41, 59);
    const lines = doc.splitTextToSize(text, maxWidth);
    ensureSpace(lines.length * 14 + 6);
    doc.text(lines, marginX, y);
    y += lines.length * 14 + 6;
  };

  addLine('Operational Summary (Computed from Database Records)', true);
  addLine(
    `Mandates Monitored: ${report.summary.totalMandates}  |  Payment Attempts Analyzed: ${report.summary.totalAttempts}`
  );
  addLine(
    `Verified: ${report.summary.statusSummary.VERIFIED}  |  Flagged: ${report.summary.statusSummary.FLAGGED}  |  Blocked: ${report.summary.statusSummary.BLOCKED}  |  Needs Review: ${report.summary.statusSummary.NEEDS_REVIEW}`
  );
  addLine(
    `Suspicious Payment Exposure Identified: INR ${report.summary.suspiciousExposure.toLocaleString('en-IN')}  |  Excess Over Authorized: INR ${report.summary.excessOverAuthorized.toLocaleString('en-IN')}`
  );
  y += 10;

  addLine('Violation Category Breakdown', true);
  if (!report.violationBreakdown?.length) {
    addLine('No violations recorded in selected scope/range.');
  } else {
    for (const v of report.violationBreakdown) {
      addLine(
        `- ${humanizeEnum(v.category)}: ${v.count} occurrence(s) (Exposure: INR ${Number(v.exposure).toLocaleString('en-IN')})`
      );
    }
  }
  y += 10;

  addLine('Flagged / Blocked / Review Payment Attempts', true);
  for (const a of (report.flaggedAttempts || []).slice(0, 25)) {
    addLine(
      `${a.attemptUid} | ${a.mandateCode} | ${a.merchantName} | Attempted ${a.currency} ${a.attemptedAmount} vs Authorized ${a.currency} ${a.expectedAuthorizedAmount} | ${a.status}${a.isDemo ? ' [DEMO]' : ''}`
    );
  }

  doc.save(`DebitOrigin_Operational_Report_${new Date().toISOString().slice(0, 10)}.pdf`);
}
