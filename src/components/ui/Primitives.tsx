import React from 'react';
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Clock,
  ShieldAlert,
  X,
} from 'lucide-react';
import { cn, formatEventPayloadLines, humanizeEnum } from '../../lib/utils.ts';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
}

export function Button({
  variant = 'primary',
  size = 'md',
  className,
  ...props
}: ButtonProps) {
  const variants = {
    primary:
      'bg-blue-700 text-white hover:bg-blue-800 border border-blue-700 shadow-xs disabled:opacity-50',
    secondary:
      'bg-slate-900 text-white hover:bg-slate-800 border border-slate-900 shadow-xs disabled:opacity-50',
    outline:
      'bg-white text-slate-700 hover:bg-slate-50 border border-slate-300 disabled:opacity-50',
    ghost: 'bg-transparent text-slate-600 hover:bg-slate-100 hover:text-slate-900 disabled:opacity-50',
    danger:
      'bg-red-600 text-white hover:bg-red-700 border border-red-600 shadow-xs disabled:opacity-50',
  };
  const sizes = {
    sm: 'px-3 py-1.5 text-xs font-medium rounded-md gap-1.5',
    md: 'px-4 py-2 text-sm font-medium rounded-lg gap-2',
    lg: 'px-5 py-2.5 text-sm font-semibold rounded-lg gap-2',
  };
  return (
    <button
      {...props}
      className={cn(
        'inline-flex items-center justify-center whitespace-nowrap shrink-0 transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 cursor-pointer disabled:cursor-not-allowed',
        variants[variant],
        sizes[size],
        className
      )}
    />
  );
}

export function Surface({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('bg-white border border-slate-200 rounded-xl', className)}>
      {children}
    </div>
  );
}

export function FieldLabel({
  htmlFor,
  children,
  required,
}: {
  htmlFor?: string;
  children: React.ReactNode;
  required?: boolean;
}) {
  return (
    <label
      htmlFor={htmlFor}
      className="block text-xs font-medium text-slate-700 mb-1.5"
    >
      {children}
      {required && <span className="text-red-600 ml-0.5">*</span>}
    </label>
  );
}

export function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={cn(
        'w-full px-3 py-2 text-sm text-slate-900 bg-white border border-slate-300 rounded-lg placeholder:text-slate-400 focus:outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100 transition-colors disabled:bg-slate-50 disabled:text-slate-500',
        props.className
      )}
    />
  );
}

export function SelectInput(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={cn(
        'w-full px-3 py-2 text-sm text-slate-900 bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100 transition-colors disabled:bg-slate-50',
        props.className
      )}
    />
  );
}

export function TextAreaInput(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={cn(
        'w-full px-3 py-2 text-sm text-slate-900 bg-white border border-slate-300 rounded-lg placeholder:text-slate-400 focus:outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100 transition-colors',
        props.className
      )}
    />
  );
}

/**
 * Clean unboxed status indicator with explicit icon + semantic text (zero pill capsules).
 */
export function StatusLabel({ status }: { status: string }) {
  const upper = (status || '').toUpperCase();
  if (upper === 'VERIFIED' || upper === 'ACTIVE' || upper === 'CLOSED' || upper === 'READY') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700 whitespace-nowrap">
        <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
        {humanizeEnum(upper)}
      </span>
    );
  }
  if (upper === 'BLOCKED' || upper === 'REVOKED' || upper === 'CRITICAL') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-red-700 whitespace-nowrap">
        <ShieldAlert className="w-3.5 h-3.5 shrink-0" />
        {humanizeEnum(upper)}
      </span>
    );
  }
  if (upper === 'FLAGGED' || upper === 'PAUSED' || upper === 'HIGH' || upper === 'EXPIRED') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-amber-700 whitespace-nowrap">
        <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
        {humanizeEnum(upper)}
      </span>
    );
  }
  if (
    upper === 'NEEDS_REVIEW' ||
    upper === 'UNDER_REVIEW' ||
    upper === 'OPEN' ||
    upper === 'REOPENED' ||
    upper === 'MEDIUM' ||
    upper === 'PENDING_CONSENT'
  ) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-blue-700 whitespace-nowrap">
        <Clock className="w-3.5 h-3.5 shrink-0" />
        {humanizeEnum(upper)}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600 whitespace-nowrap">
      <AlertCircle className="w-3.5 h-3.5 shrink-0" />
      {humanizeEnum(upper)}
    </span>
  );
}

/**
 * Unboxed typographic marker clearly identifying synthetic demo data.
 */
export function DemoMarker({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        'text-[11px] font-mono font-semibold tracking-wide text-blue-700 uppercase whitespace-nowrap',
        className
      )}
    >
      DEMO DATA
    </span>
  );
}

export function Modal({
  open,
  onClose,
  title,
  subtitle,
  children,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  wide?: boolean;
}) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-[1px] p-4 overflow-y-auto"
      role="dialog"
      aria-modal="true"
    >
      <div
        className={cn(
          'bg-white border border-slate-200 rounded-xl shadow-xl w-full my-8 overflow-hidden',
          wide ? 'max-w-3xl' : 'max-w-xl'
        )}
      >
        <div className="flex items-start justify-between gap-4 px-6 py-4 border-b border-slate-200">
          <div>
            <h2 className="text-base font-semibold text-slate-900">{title}</h2>
            {subtitle && <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close modal"
            className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-md transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-6 max-h-[78vh] overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel = 'Confirm',
  danger = false,
  loading = false,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  description: string;
  confirmLabel?: string;
  danger?: boolean;
  loading?: boolean;
}) {
  return (
    <Modal open={open} onClose={onClose} title={title}>
      <p className="text-sm text-slate-600 leading-relaxed">{description}</p>
      <div className="flex items-center justify-end gap-3 mt-6 pt-4 border-t border-slate-100">
        <Button variant="outline" onClick={onClose} disabled={loading}>
          Cancel
        </Button>
        <Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm} disabled={loading}>
          {loading ? 'Processing...' : confirmLabel}
        </Button>
      </div>
    </Modal>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  actions,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="bg-slate-50/70 border border-slate-200 rounded-xl p-10 text-center flex flex-col items-center">
      <div className="w-11 h-11 rounded-lg bg-white border border-slate-200 flex items-center justify-center text-slate-600 mb-4">
        <Icon className="w-5 h-5" />
      </div>
      <h3 className="text-base font-semibold text-slate-900">{title}</h3>
      <p className="text-sm text-slate-500 mt-1.5 max-w-md leading-relaxed">{description}</p>
      {actions && <div className="flex flex-wrap items-center justify-center gap-3 mt-5">{actions}</div>}
    </div>
  );
}

export function SkeletonRows({ rows = 5 }: { rows?: number }) {
  return (
    <div className="divide-y divide-slate-100">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="px-5 py-3.5 flex items-center gap-4">
          <div className="h-4 bg-slate-100 rounded w-28" />
          <div className="h-4 bg-slate-100 rounded w-40" />
          <div className="h-4 bg-slate-100 rounded w-24 ml-auto" />
          <div className="h-4 bg-slate-100 rounded w-20" />
        </div>
      ))}
    </div>
  );
}

/**
 * Renders structured human-readable event payload lines (e.g. "Amount: ₹499 → ₹799")
 * alongside an expandable raw JSON disclosure for technical inspection.
 */
export function EventPayloadViewer({
  eventType,
  previousValue,
  newValue,
  metadata,
  currency = 'INR',
}: {
  eventType?: string | null;
  previousValue?: Record<string, unknown> | null;
  newValue?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
  currency?: string;
}) {
  const lines = formatEventPayloadLines(eventType, previousValue, newValue, currency);
  const rawPayload: Record<string, unknown> = {};
  if (previousValue && Object.keys(previousValue).length > 0) {
    rawPayload.previousValue = previousValue;
  }
  if (newValue && Object.keys(newValue).length > 0) {
    rawPayload.newValue = newValue;
  }
  if (metadata && Object.keys(metadata).length > 0) {
    rawPayload.metadata = metadata;
  }
  const hasRaw = Object.keys(rawPayload).length > 0;

  if (lines.length === 0 && !hasRaw) {
    return <span className="text-xs text-slate-400">No payload changes</span>;
  }

  return (
    <div className="space-y-1">
      {lines.length > 0 ? (
        <div className="space-y-0.5">
          {lines.map((line, idx) => (
            <div key={idx} className="text-xs text-slate-700 leading-snug">
              <span className="text-slate-500">{line.label}:</span>{' '}
              <span className="font-medium text-slate-900 tabular-nums">{line.value}</span>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-xs text-slate-500">Metadata recorded</div>
      )}
      {hasRaw && (
        <details className="group">
          <summary className="text-[11px] font-medium text-blue-700 hover:text-blue-800 cursor-pointer select-none list-none inline-flex items-center gap-1">
            <span className="group-open:hidden">View raw JSON</span>
            <span className="hidden group-open:inline">Hide raw JSON</span>
          </summary>
          <pre className="mt-1.5 p-2 bg-slate-50 border border-slate-200 rounded-md text-[11px] font-mono text-slate-700 overflow-x-auto max-w-sm whitespace-pre-wrap break-all">
            {JSON.stringify(rawPayload, null, 2)}
          </pre>
        </details>
      )}
    </div>
  );
}
