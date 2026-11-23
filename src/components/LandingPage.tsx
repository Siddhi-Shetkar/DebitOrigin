import React, { useState } from 'react';
import {
  ArrowRight,
  CheckCircle2,
  FileSearch,
  History,
  Lock,
  Scale,
  ShieldAlert,
  ShieldCheck,
  GitBranch,
  FileText,
} from 'lucide-react';
import { Button } from './ui/Primitives.tsx';

interface LandingPageProps {
  onGetStarted: () => void;
  onLogin: () => void;
}

const PREVIEW_STEPS = [
  {
    date: 'Jan 05, 2026',
    title: 'Customer Approves Mandate',
    actor: 'Customer · UPI AutoPay OTP',
    authorized: '₹499 / month',
    merchantRecord: '₹499 / month',
    mandateStatus: 'ACTIVE',
    evidence: 'EVD-UPI-9041 (Verified)',
    note: 'Customer signs recurring authorization for ₹499/month billed on Day 5.',
    flag: 'valid' as const,
  },
  {
    date: 'Feb 05, 2026',
    title: 'First Recurring Debit Processed',
    actor: 'Payment Rail · Scheduled Billing',
    authorized: '₹499 / month',
    merchantRecord: '₹499 / month',
    mandateStatus: 'ACTIVE',
    evidence: 'Matches Jan 05 Consent',
    note: 'Attempted ₹499 aligns with reconstructed historical authorization.',
    flag: 'valid' as const,
  },
  {
    date: 'Mar 02, 2026',
    title: 'Merchant Updates Billing Amount Internally',
    actor: 'Merchant System · Silent Edit',
    authorized: '₹499 / month (Unchanged)',
    merchantRecord: '₹799 / month (+₹300)',
    mandateStatus: 'ACTIVE',
    evidence: 'No Customer Approval Evidence',
    note: 'Merchant modifies its internal price table to ₹799 without fresh customer consent. Mandate still appears ACTIVE.',
    flag: 'drift' as const,
  },
  {
    date: 'Apr 05, 2026',
    title: '₹799 Debit Attempted — Consent Drift Blocked',
    actor: 'DebitOrigin Replay Verification',
    authorized: '₹499 / month',
    merchantRecord: '₹799 / month',
    mandateStatus: 'BLOCKED (+₹300 Unauthorized)',
    evidence: 'Rule: UNAUTHORIZED_AMOUNT_INCREASE',
    note: 'Replay reconstructs valid authorization at Apr 05 as ₹499. The ₹799 debit is deterministically blocked with an evidence chain.',
    flag: 'blocked' as const,
  },
];

export function LandingPage({ onGetStarted, onLogin }: LandingPageProps) {
  const [activeStep, setActiveStep] = useState(3);
  const current = PREVIEW_STEPS[activeStep];

  return (
    <div className="min-h-screen bg-white text-slate-900">
      {/* Top Bar Contract: 3 clean zones */}
      <header className="sticky top-0 z-30 bg-white/95 backdrop-blur border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between gap-8">
          <a
            href="#top"
            className="flex items-center gap-2.5 text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0"
          >
            <span className="w-7 h-7 rounded-lg bg-blue-700 text-white flex items-center justify-center">
              <ShieldCheck className="w-4 h-4" />
            </span>
            DebitOrigin
          </a>

          <nav className="hidden md:flex items-center gap-7 text-sm font-medium text-slate-600">
            <a href="#problem" className="hover:text-slate-900 transition-colors whitespace-nowrap shrink-0">
              Problem
            </a>
            <a href="#how-it-works" className="hover:text-slate-900 transition-colors whitespace-nowrap shrink-0">
              How It Works
            </a>
            <a href="#drift-replay" className="hover:text-slate-900 transition-colors whitespace-nowrap shrink-0">
              Drift Replay
            </a>
            <a href="#security" className="hover:text-slate-900 transition-colors whitespace-nowrap shrink-0">
              Security
            </a>
            <button
              type="button"
              onClick={onLogin}
              className="hover:text-slate-900 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              Login
            </button>
          </nav>

          <div className="flex items-center gap-3 shrink-0">
            <Button size="sm" onClick={onGetStarted}>
              Get Started
            </Button>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section id="top" className="border-b border-slate-200 bg-slate-50/50">
        <div className="max-w-7xl mx-auto px-6 py-16 lg:py-24 grid lg:grid-cols-12 gap-12 items-center">
          <div className="lg:col-span-6">
            <p className="text-xs font-semibold tracking-wide text-blue-700 mb-4">
              AI-Powered Recurring Payment Consent Verification · Razorpay AI Buildathon 2026
            </p>
            <h1
              className="text-4xl lg:text-5xl font-bold tracking-tight text-slate-900 leading-[1.12]"
              style={{ textWrap: 'balance' }}
            >
              Every debit must trace back to valid customer consent.
            </h1>
            <p className="text-base lg:text-lg text-slate-600 mt-5 leading-relaxed max-w-xl">
              DebitOrigin reconstructs payment authorization histories to identify recurring debits
              that no longer match what customers actually approved.
            </p>

            <div className="flex flex-wrap items-center gap-3.5 mt-8">
              <Button size="lg" onClick={onGetStarted}>
                Get Started
                <ArrowRight className="w-4 h-4" />
              </Button>
              <Button size="lg" variant="outline" onClick={onLogin}>
                Login to Workspace
              </Button>
            </div>

            <div className="mt-10 pt-6 border-t border-slate-200 flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-slate-500">
              <span>Deterministic Event-Replay Engine</span>
              <span aria-hidden="true">·</span>
              <span>Gemini Document Extraction & Forensics</span>
              <span aria-hidden="true">·</span>
              <span>PostgreSQL Audit Ledger</span>
            </div>
          </div>

          {/* Interactive Illustrative Replay Schematic */}
          <div className="lg:col-span-6">
            <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
              <div className="px-5 py-3.5 border-b border-slate-200 bg-slate-50 flex items-center justify-between gap-4">
                <div>
                  <div className="text-xs font-semibold text-slate-900">
                    Consent Drift Replay — Interactive Walkthrough
                  </div>
                  <div className="text-[11px] text-slate-500 mt-0.5">
                    Illustrative scenario · Select any point in time to inspect historical authorization
                  </div>
                </div>
                <span className="text-[11px] font-mono text-slate-500 whitespace-nowrap">
                  MND-499-799
                </span>
              </div>

              {/* Step selector bar */}
              <div className="px-5 pt-4 pb-3 border-b border-slate-100">
                <div className="grid grid-cols-4 gap-1.5 p-1 bg-slate-100 rounded-lg">
                  {PREVIEW_STEPS.map((s, idx) => (
                    <button
                      key={s.date}
                      type="button"
                      onClick={() => setActiveStep(idx)}
                      className={`px-2 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap truncate ${
                        activeStep === idx
                          ? 'bg-white text-slate-900 shadow-xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      {s.date.slice(0, 6)}
                    </button>
                  ))}
                </div>
              </div>

              <div className="p-5 space-y-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="text-xs font-mono text-slate-500">{current.date}</div>
                    <h3 className="text-sm font-semibold text-slate-900 mt-0.5">{current.title}</h3>
                    <div className="text-xs text-slate-500 mt-0.5">{current.actor}</div>
                  </div>
                  <div
                    className={`text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap ${
                      current.flag === 'blocked'
                        ? 'text-red-700'
                        : current.flag === 'drift'
                          ? 'text-amber-700'
                          : 'text-emerald-700'
                    }`}
                  >
                    {current.flag === 'blocked' ? (
                      <ShieldAlert className="w-4 h-4" />
                    ) : current.flag === 'drift' ? (
                      <History className="w-4 h-4" />
                    ) : (
                      <CheckCircle2 className="w-4 h-4" />
                    )}
                    {current.mandateStatus}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3 pt-1">
                  <div className="p-3.5 rounded-lg bg-slate-50 border border-slate-200">
                    <div className="text-[11px] text-slate-500 font-medium">
                      Reconstructed Customer Consent
                    </div>
                    <div className="text-sm font-mono font-semibold text-slate-900 mt-1 tabular-nums">
                      {current.authorized}
                    </div>
                  </div>
                  <div className="p-3.5 rounded-lg bg-slate-50 border border-slate-200">
                    <div className="text-[11px] text-slate-500 font-medium">
                      Merchant-Side Billing Record
                    </div>
                    <div
                      className={`text-sm font-mono font-semibold mt-1 tabular-nums ${
                        current.flag !== 'valid' ? 'text-red-700' : 'text-slate-900'
                      }`}
                    >
                      {current.merchantRecord}
                    </div>
                  </div>
                </div>

                <div className="pt-2 border-t border-slate-100 text-xs text-slate-600 leading-relaxed">
                  <span className="font-semibold text-slate-800">Evidence: </span>
                  {current.evidence}. {current.note}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Section 1: The Problem */}
      <section id="problem" className="max-w-7xl mx-auto px-6 py-20 border-b border-slate-200">
        <div className="max-w-2xl">
          <p className="text-xs font-semibold text-blue-700 mb-2">The Authorization Gap</p>
          <h2 className="text-2xl lg:text-3xl font-bold tracking-tight text-slate-900">
            An active mandate does not guarantee an authorized debit.
          </h2>
          <p className="text-sm lg:text-base text-slate-600 mt-3 leading-relaxed">
            Conventional payment risk checks look only at whether a mandate ID is currently active.
            They miss silent merchant-side price edits, cadence shifts, post-revocation retries, and
            missing consent trails.
          </p>
        </div>

        <div className="grid md:grid-cols-3 gap-8 mt-12">
          <div className="pt-5 border-t border-slate-200">
            <h3 className="text-base font-semibold text-slate-900">Silent Tariff Drift</h3>
            <p className="text-sm text-slate-600 mt-2 leading-relaxed">
              A merchant updates a ₹499 subscription to ₹799 internally without obtaining fresh
              customer OTP or e-Mandate consent. The mandate still reads ACTIVE on the debit date.
            </p>
          </div>
          <div className="pt-5 border-t border-slate-200">
            <h3 className="text-base font-semibold text-slate-900">Overwritten State Histories</h3>
            <p className="text-sm text-slate-600 mt-2 leading-relaxed">
              When billing tables overwrite previous values in place, compliance teams lose proof of
              what the customer actually approved at the moment a debit occurred.
            </p>
          </div>
          <div className="pt-5 border-t border-slate-200">
            <h3 className="text-base font-semibold text-slate-900">Opaque Risk Decisions</h3>
            <p className="text-sm text-slate-600 mt-2 leading-relaxed">
              Black-box fraud scores cannot distinguish between confirmed unauthorized increases and
              incomplete consent paperwork—creating false positives and indefensible chargebacks.
            </p>
          </div>
        </div>
      </section>

      {/* Section 2: How DebitOrigin Works */}
      <section id="how-it-works" className="bg-slate-50/60 border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-6 py-20">
          <div className="max-w-2xl">
            <p className="text-xs font-semibold text-blue-700 mb-2">Verification Lifecycle</p>
            <h2 className="text-2xl lg:text-3xl font-bold tracking-tight text-slate-900">
              How DebitOrigin verifies recurring payment intent
            </h2>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6 mt-12">
            {[
              {
                step: '01. Capture Consent Evidence',
                icon: FileSearch,
                body: 'Ingest mandate terms manually or extract structured fields from uploaded PDF and image consent documents with human-in-the-loop review.',
              },
              {
                step: '02. Append Immutable Events',
                icon: GitBranch,
                body: 'Every approval, merchant modification, pause, resume, revocation, and debit is stored chronologically—never overwritten.',
              },
              {
                step: '03. Replay Historical State',
                icon: History,
                body: 'At each payment attempt timestamp, replay prior events to reconstruct exact customer-approved terms independently of merchant records.',
              },
              {
                step: '04. Verify, Explain & Audit',
                icon: FileText,
                body: 'Classify every attempt deterministically as Verified, Flagged, Blocked, or Needs Review, with evidence-backed explanations and PDF case reports.',
              },
            ].map((item) => (
              <div
                key={item.step}
                className="bg-white border border-slate-200 rounded-xl p-6 flex flex-col justify-between"
              >
                <div>
                  <div className="w-9 h-9 rounded-lg bg-slate-100 text-blue-700 flex items-center justify-center mb-4">
                    <item.icon className="w-4 h-4" />
                  </div>
                  <h3 className="text-sm font-semibold text-slate-900">{item.step}</h3>
                  <p className="text-sm text-slate-600 mt-2 leading-relaxed">{item.body}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Section 3: Signature Feature — Consent Drift Replay */}
      <section id="drift-replay" className="max-w-7xl mx-auto px-6 py-20 border-b border-slate-200">
        <div className="grid lg:grid-cols-12 gap-12 items-start">
          <div className="lg:col-span-5">
            <p className="text-xs font-semibold text-blue-700 mb-2">Signature Capability</p>
            <h2 className="text-2xl lg:text-3xl font-bold tracking-tight text-slate-900">
              Consent Drift Replay
            </h2>
            <p className="text-sm lg:text-base text-slate-600 mt-3 leading-relaxed">
              Select any mandate and any payment timestamp. DebitOrigin replays the immutable event
              ledger up to that exact millisecond, isolating customer-approved modifications from
              unilateral merchant changes.
            </p>
            <ul className="mt-6 space-y-3 text-sm text-slate-700">
              <li className="flex items-start gap-2.5">
                <CheckCircle2 className="w-4 h-4 text-blue-700 shrink-0 mt-0.5" />
                Side-by-side comparison of Original Consent, Merchant Record, and Payment Attempt.
              </li>
              <li className="flex items-start gap-2.5">
                <CheckCircle2 className="w-4 h-4 text-blue-700 shrink-0 mt-0.5" />
                Historical queries remain invariant to later merchant updates or status changes.
              </li>
              <li className="flex items-start gap-2.5">
                <CheckCircle2 className="w-4 h-4 text-blue-700 shrink-0 mt-0.5" />
                Handles duplicate events, out-of-order ingestion, and missing authorization evidence.
              </li>
            </ul>
            <div className="mt-8">
              <Button onClick={onGetStarted}>
                Launch Consent Drift Replay
                <ArrowRight className="w-4 h-4" />
              </Button>
            </div>
          </div>

          <div className="lg:col-span-7 grid sm:grid-cols-2 gap-5">
            <div className="bg-white border border-slate-200 rounded-xl p-6 sm:col-span-2">
              <div className="text-xs font-semibold text-slate-500">Architecture Separation</div>
              <h3 className="text-base font-semibold text-slate-900 mt-1">
                Deterministic Verification + AI Explainability
              </h3>
              <div className="grid sm:grid-cols-2 gap-5 mt-4 pt-4 border-t border-slate-100">
                <div>
                  <div className="text-xs font-semibold text-blue-700">
                    1. Deterministic Rule Engine (Primary Decision)
                  </div>
                  <p className="text-xs text-slate-600 mt-1.5 leading-relaxed">
                    Replays chronological events to evaluate 12 explicit authorization rules:
                    unauthorized amount changes, frequency shifts, merchant mismatches, post-revocation,
                    pause windows, expiry, schedule drift, and duplicate debits.
                  </p>
                </div>
                <div>
                  <div className="text-xs font-semibold text-slate-900">
                    2. Gemini AI Layer (Extraction & Forensics)
                  </div>
                  <p className="text-xs text-slate-600 mt-1.5 leading-relaxed">
                    Extracts structured terms from PDF/image consent forms with confidence checks and
                    generates concise forensic narratives grounded strictly in engine evidence—never
                    independently authorizing payments.
                  </p>
                </div>
              </div>
            </div>

            <div className="bg-slate-50 border border-slate-200 rounded-xl p-6">
              <Scale className="w-4 h-4 text-blue-700 mb-3" />
              <h3 className="text-sm font-semibold text-slate-900">
                Violation vs. Incomplete Evidence
              </h3>
              <p className="text-xs text-slate-600 mt-1.5 leading-relaxed">
                Confirmed rule violations are blocked or flagged, while ambiguous or missing
                documentation routes to Needs Review rather than falsely accusing fraud.
              </p>
            </div>

            <div className="bg-slate-50 border border-slate-200 rounded-xl p-6">
              <FileText className="w-4 h-4 text-blue-700 mb-3" />
              <h3 className="text-sm font-semibold text-slate-900">
                Investigation & PDF Evidence Packs
              </h3>
              <p className="text-xs text-slate-600 mt-1.5 leading-relaxed">
                Escalate flagged debits into audited investigation cases with reviewer decisions,
                notes, timelines, and downloadable PDF compliance reports.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Section 4: Security & Explainability Principles */}
      <section id="security" className="bg-slate-50/50 border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-6 py-20">
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 mb-10">
            <div className="max-w-2xl">
              <p className="text-xs font-semibold text-blue-700 mb-2">Security & Governance</p>
              <h2 className="text-2xl lg:text-3xl font-bold tracking-tight text-slate-900">
                Built for financial auditability from day one
              </h2>
            </div>
            <Button variant="outline" onClick={onGetStarted}>
              Create Free Account
            </Button>
          </div>

          <div className="grid md:grid-cols-3 gap-6">
            {[
              {
                title: 'Strict User-Level Isolation',
                body: 'Every mandate, event, consent document, verification result, and investigation case is strictly scoped to the authenticated account on the server.',
              },
              {
                title: 'Append-Only Event History',
                body: 'Historical consent events are persisted chronologically in PostgreSQL with full actor, approval reference, and evidence metadata.',
              },
              {
                title: 'Server-Side AI & Zero Fabrication',
                body: 'Gemini API credentials stay strictly server-side. Every operational metric and evaluation benchmark is calculated live from real records.',
              },
            ].map((p) => (
              <div key={p.title} className="bg-white border border-slate-200 rounded-xl p-6">
                <Lock className="w-4 h-4 text-slate-700 mb-3" />
                <h3 className="text-sm font-semibold text-slate-900">{p.title}</h3>
                <p className="text-xs text-slate-600 mt-2 leading-relaxed">{p.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Quiet Footer */}
      <footer className="bg-white">
        <div className="max-w-7xl mx-auto px-6 py-10 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 text-xs text-slate-500">
          <div className="flex items-center gap-2.5 text-slate-900 font-semibold">
            <ShieldCheck className="w-4 h-4 text-blue-700" />
            <span>DebitOrigin</span>
            <span className="text-slate-300">|</span>
            <span className="font-normal text-slate-500">
              Razorpay AI Buildathon 2026 · Track: AI Risk Manager
            </span>
          </div>
          <div className="flex items-center gap-5">
            <span>Verification & Simulation Platform (Synthetic Data Only)</span>
            <button
              type="button"
              onClick={onLogin}
              className="text-slate-700 hover:text-blue-700 font-medium cursor-pointer"
            >
              Sign In
            </button>
          </div>
        </div>
      </footer>
    </div>
  );
}
