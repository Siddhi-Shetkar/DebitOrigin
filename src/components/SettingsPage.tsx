import React, { useEffect, useState, useCallback } from 'react';
import {
  CheckCircle2,
  Database,
  KeyRound,
  MailCheck,
  RotateCcw,
  Shield,
  User,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext.tsx';
import { apiRequest, ApiError } from '../lib/api.ts';
import { formatDateTime, humanizeEnum } from '../lib/utils.ts';
import {
  Button,
  ConfirmDialog,
  EventPayloadViewer,
  FieldLabel,
  SkeletonRows,
  Surface,
  TextInput,
} from './ui/Primitives.tsx';

export function SettingsPage({
  onReopenOnboarding,
}: {
  onReopenOnboarding: () => void;
}) {
  const { user, refreshUser, updateProfile } = useAuth();
  const [fullName, setFullName] = useState(user?.fullName || '');
  const [organization, setOrganization] = useState(user?.organization || '');
  const [savingProfile, setSavingProfile] = useState(false);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [changingPw, setChangingPw] = useState(false);

  const [verifyCode, setVerifyCode] = useState('');
  const [issuedCode, setIssuedCode] = useState<string | null>(null);
  const [verifyingEmail, setVerifyingEmail] = useState(false);

  const [demoBusy, setDemoBusy] = useState(false);
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);

  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [loadingLogs, setLoadingLogs] = useState(true);

  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadAuditLogs = useCallback(async () => {
    setLoadingLogs(true);
    try {
      const res = await apiRequest<{ logs: any[] }>('/api/audit-logs');
      setAuditLogs(res.logs);
    } catch {
      // ignore
    } finally {
      setLoadingLogs(false);
    }
  }, []);

  useEffect(() => {
    loadAuditLogs();
  }, [loadAuditLogs]);

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingProfile(true);
    setError(null);
    setMessage(null);
    try {
      await updateProfile({ fullName: fullName.trim(), organization: organization.trim() });
      setMessage('Account profile saved.');
      await loadAuditLogs();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to save profile.');
    } finally {
      setSavingProfile(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setChangingPw(true);
    setError(null);
    setMessage(null);
    try {
      const res = await apiRequest<{ message: string }>('/api/auth/change-password', {
        method: 'POST',
        body: { currentPassword, newPassword },
      });
      setCurrentPassword('');
      setNewPassword('');
      setMessage(res.message);
      await loadAuditLogs();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to change password.');
    } finally {
      setChangingPw(false);
    }
  };

  const handleResendCode = async () => {
    setError(null);
    try {
      const res = await apiRequest<{ message: string; verificationCode?: string }>(
        '/api/auth/resend-verification',
        { method: 'POST' }
      );
      if (res.verificationCode) {
        setIssuedCode(res.verificationCode);
        setVerifyCode(res.verificationCode);
      }
      setMessage(res.message);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not issue verification code.');
    }
  };

  const handleVerifyEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    setVerifyingEmail(true);
    setError(null);
    try {
      await apiRequest('/api/auth/verify-email', {
        method: 'POST',
        body: { code: verifyCode.trim() },
      });
      setIssuedCode(null);
      setVerifyCode('');
      await refreshUser();
      setMessage('Email address verified.');
      await loadAuditLogs();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Invalid verification code.');
    } finally {
      setVerifyingEmail(false);
    }
  };

  const handleLoadDemo = async () => {
    setDemoBusy(true);
    setError(null);
    setMessage(null);
    try {
      const res = await apiRequest<{ message: string }>('/api/demo/load', { method: 'POST' });
      setMessage(res.message);
      await loadAuditLogs();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to load demo data.');
    } finally {
      setDemoBusy(false);
    }
  };

  const handleResetDemo = async () => {
    setDemoBusy(true);
    setError(null);
    setMessage(null);
    try {
      const res = await apiRequest<{ message: string }>('/api/demo/reset', { method: 'POST' });
      setResetConfirmOpen(false);
      setMessage(res.message);
      await loadAuditLogs();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to reset demo data.');
    } finally {
      setDemoBusy(false);
    }
  };

  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <h1 className="text-xl font-bold tracking-tight text-slate-900">Settings & Audit Trail</h1>
        <p className="text-xs text-slate-500 mt-0.5">
          Manage your profile, account security, isolated synthetic demo data, and personal audit
          history.
        </p>
      </div>

      {message && (
        <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-xs text-emerald-800 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          {message}
        </div>
      )}
      {error && (
        <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">
          {error}
        </div>
      )}

      <div className="grid md:grid-cols-2 gap-6">
        {/* Profile Settings */}
        <Surface className="p-5 space-y-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
            <User className="w-4 h-4 text-blue-700" />
            Account Profile
          </div>
          <form onSubmit={handleSaveProfile} className="space-y-3.5">
            <div>
              <FieldLabel required>Full Name</FieldLabel>
              <TextInput
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                required
              />
            </div>
            <div>
              <FieldLabel>Work Email</FieldLabel>
              <TextInput value={user?.email || ''} disabled />
            </div>
            <div>
              <FieldLabel>Organization / Team</FieldLabel>
              <TextInput
                value={organization}
                onChange={(e) => setOrganization(e.target.value)}
                placeholder="Risk & Payment Operations"
              />
            </div>
            <div className="flex items-center justify-between pt-2">
              <span className="text-xs text-slate-500">
                Provider: <strong className="text-slate-700">{user?.authProvider}</strong> ·{' '}
                {user?.emailVerified ? (
                  <span className="text-emerald-700 font-semibold">Email Verified</span>
                ) : (
                  <span className="text-amber-700 font-semibold">Email Unverified</span>
                )}
              </span>
              <Button type="submit" size="sm" disabled={savingProfile}>
                {savingProfile ? 'Saving...' : 'Save Profile'}
              </Button>
            </div>
          </form>

          {user && !user.emailVerified && (
            <div className="pt-4 border-t border-slate-100 space-y-2.5">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-slate-800 flex items-center gap-1.5">
                  <MailCheck className="w-3.5 h-3.5 text-blue-700" />
                  Verify Work Email
                </span>
                <button
                  type="button"
                  onClick={handleResendCode}
                  className="text-blue-700 font-medium hover:underline cursor-pointer"
                >
                  Generate Verification Code
                </button>
              </div>
              {issuedCode && (
                <div className="text-xs font-mono text-blue-800 bg-blue-50 px-3 py-1.5 rounded border border-blue-200">
                  Preview Code: {issuedCode}
                </div>
              )}
              <form onSubmit={handleVerifyEmail} className="flex gap-2">
                <TextInput
                  value={verifyCode}
                  onChange={(e) => setVerifyCode(e.target.value)}
                  placeholder="Enter code"
                  className="font-mono uppercase text-xs"
                />
                <Button type="submit" size="sm" variant="outline" disabled={verifyingEmail || !verifyCode}>
                  Verify
                </Button>
              </form>
            </div>
          )}
        </Surface>

        {/* Security & Password */}
        <Surface className="p-5 space-y-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
            <KeyRound className="w-4 h-4 text-blue-700" />
            Security & Password
          </div>
          {user?.authProvider === 'google' ? (
            <p className="text-xs text-slate-600 leading-relaxed">
              Your account is authenticated via Google Sign-In (Firebase Authentication). Password
              management is handled securely through your Google account.
            </p>
          ) : (
            <form onSubmit={handleChangePassword} className="space-y-3.5">
              <div>
                <FieldLabel required>Current Password</FieldLabel>
                <TextInput
                  type="password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  required
                />
              </div>
              <div>
                <FieldLabel required>New Password</FieldLabel>
                <TextInput
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Min 8 chars, 1 uppercase, 1 number"
                  required
                />
              </div>
              <div className="flex justify-end pt-2">
                <Button type="submit" size="sm" variant="outline" disabled={changingPw}>
                  {changingPw ? 'Updating...' : 'Update Password'}
                </Button>
              </div>
            </form>
          )}

          {/* Demo Data Controls */}
          <div className="pt-4 border-t border-slate-100 space-y-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
              <Database className="w-4 h-4 text-blue-700" />
              Synthetic Demo Mode Controls
            </div>
            <p className="text-xs text-slate-600 leading-relaxed">
              Load or reset the 7 synthetic demo scenarios without affecting your own mandates,
              uploaded documents, or investigations.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={handleLoadDemo} disabled={demoBusy}>
                Load / Refresh Demo Data
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setResetConfirmOpen(true)}
                disabled={demoBusy}
              >
                <RotateCcw className="w-3.5 h-3.5" />
                Reset Demo Data
              </Button>
              <Button size="sm" variant="ghost" onClick={onReopenOnboarding}>
                Re-open Onboarding Guide
              </Button>
            </div>
          </div>
        </Surface>
      </div>

      {/* Audit Log */}
      <Surface className="overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Shield className="w-4 h-4 text-slate-700" />
            <h2 className="text-sm font-semibold text-slate-900">Account Security & Audit Log</h2>
          </div>
          <span className="text-xs text-slate-500">Latest 100 operations</span>
        </div>

        {loadingLogs ? (
          <SkeletonRows rows={5} />
        ) : auditLogs.length === 0 ? (
          <p className="p-6 text-xs text-slate-500">No audit events recorded yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/70 text-[11px] font-semibold text-slate-500 uppercase">
                  <th className="py-2.5 px-4">Timestamp</th>
                  <th className="py-2.5 px-4">Action</th>
                  <th className="py-2.5 px-4">Entity</th>
                  <th className="py-2.5 px-4">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {auditLogs.map((log) => (
                  <tr key={log.id}>
                    <td className="py-2.5 px-4 font-mono text-slate-500 whitespace-nowrap tabular-nums">
                      {formatDateTime(log.createdAt)}
                    </td>
                    <td className="py-2.5 px-4 font-semibold text-slate-900">
                      {humanizeEnum(log.action)}
                    </td>
                    <td className="py-2.5 px-4 font-mono text-slate-600">
                      {log.entityType} #{log.entityId}
                    </td>
                    <td className="py-2.5 px-4 max-w-md">
                      {log.details && typeof log.details === 'object' ? (
                        <EventPayloadViewer newValue={log.details} />
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Surface>

      <ConfirmDialog
        open={resetConfirmOpen}
        onClose={() => setResetConfirmOpen(false)}
        onConfirm={handleResetDemo}
        title="Reset Synthetic Demo Data?"
        description="This removes all records labelled DEMO DATA from your workspace. Your own mandates, uploaded consent documents, and investigations will remain completely untouched."
        confirmLabel="Remove Demo Data"
        danger
        loading={demoBusy}
      />
    </div>
  );
}
