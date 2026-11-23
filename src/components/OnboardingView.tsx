import React, { useState } from 'react';
import {
  ArrowRight,
  CheckCircle2,
  Database,
  FilePlus2,
  FileUp,
  MailCheck,
  ShieldCheck,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext.tsx';
import { apiRequest, ApiError } from '../lib/api.ts';
import { Button, TextInput } from './ui/Primitives.tsx';

export function OnboardingView({
  onSelectUpload,
  onSelectManual,
  onDemoLoaded,
  onSkip,
}: {
  onSelectUpload: () => void;
  onSelectManual: () => void;
  onDemoLoaded: () => void;
  onSkip: () => void;
}) {
  const { user, pendingVerificationCode, clearPendingVerificationCode, refreshUser, updateProfile } =
    useAuth();
  const [loadingDemo, setLoadingDemo] = useState(false);
  const [verifyCode, setVerifyCode] = useState(pendingVerificationCode ?? '');
  const [verifying, setVerifying] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleVerifyEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setVerifying(true);
    try {
      await apiRequest('/api/auth/verify-email', {
        method: 'POST',
        body: { code: verifyCode.trim() },
      });
      clearPendingVerificationCode();
      await refreshUser();
      setMessage('Work email verified successfully.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Verification failed.');
    } finally {
      setVerifying(false);
    }
  };

  const handleExploreDemo = async () => {
    setError(null);
    setLoadingDemo(true);
    try {
      await apiRequest('/api/demo/load', { method: 'POST' });
      await updateProfile({ onboardingCompleted: true });
      onDemoLoaded();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to load sample demo.');
    } finally {
      setLoadingDemo(false);
    }
  };

  const handleSkip = async () => {
    try {
      await updateProfile({ onboardingCompleted: true });
    } catch {
      // continue even if update retries later
    }
    onSkip();
  };

  return (
    <div className="max-w-4xl mx-auto py-10 px-6">
      <div className="flex items-center justify-between gap-4 mb-8">
        <div className="flex items-center gap-2.5 text-sm font-semibold text-blue-700">
          <ShieldCheck className="w-4 h-4" />
          First-Time Setup
        </div>
        <button
          type="button"
          onClick={handleSkip}
          className="text-xs font-medium text-slate-500 hover:text-slate-900 cursor-pointer"
        >
          Skip onboarding for now
        </button>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl p-8">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">
          Welcome to DebitOrigin.
        </h1>
        <p className="text-sm text-slate-600 mt-2 max-w-2xl leading-relaxed">
          Start monitoring recurring payments by adding your first mandate. All metrics on your
          dashboard are calculated exclusively from your stored records—no placeholder numbers are
          fabricated.
        </p>

        {/* Optional inline email verification prompt */}
        {user && !user.emailVerified && (
          <div className="mt-6 p-4 rounded-lg bg-slate-50 border border-slate-200">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-start gap-2.5">
                <MailCheck className="w-4 h-4 text-blue-700 mt-0.5 shrink-0" />
                <div className="text-xs text-slate-700">
                  <div className="font-semibold text-slate-900">Verify your work email ({user.email})</div>
                  {pendingVerificationCode ? (
                    <div className="mt-0.5 text-slate-600">
                      Preview verification code:{' '}
                      <span className="font-mono font-semibold text-blue-700">
                        {pendingVerificationCode}
                      </span>
                    </div>
                  ) : (
                    <div className="mt-0.5 text-slate-500">
                      Enter the verification code issued at sign-up, or verify later in Settings.
                    </div>
                  )}
                </div>
              </div>
              <form onSubmit={handleVerifyEmail} className="flex items-center gap-2 shrink-0">
                <TextInput
                  value={verifyCode}
                  onChange={(e) => setVerifyCode(e.target.value)}
                  placeholder="Code"
                  className="w-28 py-1.5 text-xs font-mono uppercase"
                />
                <Button type="submit" size="sm" variant="outline" disabled={verifying || !verifyCode.trim()}>
                  {verifying ? 'Checking...' : 'Verify'}
                </Button>
              </form>
            </div>
          </div>
        )}

        {message && (
          <div className="mt-4 p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-xs text-emerald-800 flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            {message}
          </div>
        )}

        {error && (
          <div className="mt-4 p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">
            {error}
          </div>
        )}

        <div className="grid md:grid-cols-3 gap-5 mt-8">
          <div className="border border-slate-200 rounded-xl p-5 flex flex-col justify-between hover:border-blue-300 transition-colors">
            <div>
              <div className="w-9 h-9 rounded-lg bg-blue-50 text-blue-700 flex items-center justify-center mb-4">
                <FileUp className="w-4 h-4" />
              </div>
              <h2 className="text-sm font-semibold text-slate-900">Upload Consent Document</h2>
              <p className="text-xs text-slate-600 mt-2 leading-relaxed">
                Upload a PDF or image of a customer e-Mandate or UPI AutoPay authorization. Gemini AI
                extracts structured fields for your human review before saving.
              </p>
            </div>
            <Button
              className="w-full mt-5"
              variant="outline"
              onClick={async () => {
                await updateProfile({ onboardingCompleted: true }).catch(() => {});
                onSelectUpload();
              }}
            >
              Upload Document
              <ArrowRight className="w-3.5 h-3.5" />
            </Button>
          </div>

          <div className="border border-slate-200 rounded-xl p-5 flex flex-col justify-between hover:border-blue-300 transition-colors">
            <div>
              <div className="w-9 h-9 rounded-lg bg-slate-100 text-slate-700 flex items-center justify-center mb-4">
                <FilePlus2 className="w-4 h-4" />
              </div>
              <h2 className="text-sm font-semibold text-slate-900">Create Mandate Manually</h2>
              <p className="text-xs text-slate-600 mt-2 leading-relaxed">
                Enter customer authorization terms, authorized amount, billing cadence, and evidence
                reference directly to begin tracking its chronological event history.
              </p>
            </div>
            <Button
              className="w-full mt-5"
              variant="outline"
              onClick={async () => {
                await updateProfile({ onboardingCompleted: true }).catch(() => {});
                onSelectManual();
              }}
            >
              Create Manually
              <ArrowRight className="w-3.5 h-3.5" />
            </Button>
          </div>

          <div className="border border-blue-200 bg-blue-50/30 rounded-xl p-5 flex flex-col justify-between">
            <div>
              <div className="w-9 h-9 rounded-lg bg-blue-700 text-white flex items-center justify-center mb-4">
                <Database className="w-4 h-4" />
              </div>
              <h2 className="text-sm font-semibold text-slate-900">Explore Sample Demo</h2>
              <p className="text-xs text-slate-600 mt-2 leading-relaxed">
                Load 7 clearly labelled synthetic scenarios—including the ₹499 → ₹799 silent drift,
                post-revocation debit, paused mandate, and duplicate billing—to test Consent Drift
                Replay immediately.
              </p>
            </div>
            <Button className="w-full mt-5" onClick={handleExploreDemo} disabled={loadingDemo}>
              {loadingDemo ? 'Loading Demo Dataset...' : 'Load Sample Demo'}
              <ArrowRight className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
