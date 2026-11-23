import React, { useState } from 'react';
import { ArrowLeft, CheckCircle2, Eye, EyeOff, ShieldCheck } from 'lucide-react';
import { useAuth } from '../context/AuthContext.tsx';
import { apiRequest, ApiError } from '../lib/api.ts';
import { Button, FieldLabel, TextInput } from './ui/Primitives.tsx';

type AuthMode = 'login' | 'signup' | 'forgot';

export function AuthView({
  initialMode = 'login',
  onBackToLanding,
}: {
  initialMode?: AuthMode;
  onBackToLanding: () => void;
}) {
  const { loginWithEmail, signupWithEmail, loginWithGoogle } = useAuth();
  const [mode, setMode] = useState<AuthMode>(initialMode);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [infoMessage, setInfoMessage] = useState<string | null>(null);

  // Login state
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(true);
  const [showPassword, setShowPassword] = useState(false);

  // Signup state
  const [fullName, setFullName] = useState('');
  const [organization, setOrganization] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState(false);

  // Forgot/Reset password state
  const [resetStep, setResetStep] = useState<'request' | 'confirm'>('request');
  const [resetEmail, setResetEmail] = useState('');
  const [resetCode, setResetCode] = useState('');
  const [issuedPreviewCode, setIssuedPreviewCode] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState('');

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setInfoMessage(null);
    if (!email.trim() || !password) {
      setError('Enter both your work email and password.');
      return;
    }
    setBusy(true);
    try {
      await loginWithEmail(email.trim(), password, rememberMe);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to sign in. Please check your credentials.');
    } finally {
      setBusy(false);
    }
  };

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setInfoMessage(null);

    if (fullName.trim().length < 2) {
      setError('Please enter your full name.');
      return;
    }
    if (!email.includes('@')) {
      setError('Please enter a valid work email address.');
      return;
    }
    if (password.length < 8 || !/[A-Z]/.test(password) || !/[0-9]/.test(password)) {
      setError('Password must be at least 8 characters with one uppercase letter and one number.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    if (!termsAccepted) {
      setError('Please accept the DebitOrigin terms of service to continue.');
      return;
    }

    setBusy(true);
    try {
      await signupWithEmail({
        fullName: fullName.trim(),
        email: email.trim(),
        organization: organization.trim(),
        password,
        confirmPassword,
        termsAccepted,
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to create account.');
    } finally {
      setBusy(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setError(null);
    setBusy(true);
    try {
      await loginWithGoogle();
    } catch (err: any) {
      const msg =
        err?.code === 'auth/popup-closed-by-user'
          ? 'Google sign-in window was closed before completing authentication.'
          : err?.message || 'Google sign-in failed. Please try email sign-in or retry.';
      setError(msg);
    } finally {
      setBusy(false);
    }
  };

  const handleRequestReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setInfoMessage(null);
    setBusy(true);
    try {
      const res = await apiRequest<{ message: string; resetCode?: string }>(
        '/api/auth/forgot-password',
        { method: 'POST', body: { email: resetEmail.trim() } }
      );
      setInfoMessage(res.message);
      if (res.resetCode) {
        setIssuedPreviewCode(res.resetCode);
        setResetCode(res.resetCode);
      }
      setResetStep('confirm');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to request reset code.');
    } finally {
      setBusy(false);
    }
  };

  const handleConfirmReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setInfoMessage(null);
    setBusy(true);
    try {
      const res = await apiRequest<{ message: string }>('/api/auth/reset-password', {
        method: 'POST',
        body: { email: resetEmail.trim(), code: resetCode.trim(), newPassword },
      });
      setInfoMessage(res.message);
      setMode('login');
      setEmail(resetEmail.trim());
      setPassword('');
      setResetStep('request');
      setIssuedPreviewCode(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to reset password.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <div className="px-6 h-16 border-b border-slate-200 bg-white flex items-center justify-between">
        <button
          type="button"
          onClick={onBackToLanding}
          className="flex items-center gap-2 text-sm font-medium text-slate-600 hover:text-slate-900 cursor-pointer"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to DebitOrigin
        </button>
        <div className="flex items-center gap-2 text-base font-bold text-slate-900">
          <span className="w-6 h-6 rounded-md bg-blue-700 text-white flex items-center justify-center">
            <ShieldCheck className="w-3.5 h-3.5" />
          </span>
          DebitOrigin
        </div>
        <div className="w-24" />
      </div>

      <div className="flex-1 flex items-center justify-center p-6">
        <div className="w-full max-w-md bg-white border border-slate-200 rounded-xl shadow-xs p-7">
          {mode === 'login' && (
            <>
              <h1 className="text-xl font-bold text-slate-900">Sign in to DebitOrigin</h1>
              <p className="text-sm text-slate-500 mt-1">
                Access your isolated recurring payment verification workspace.
              </p>

              {error && (
                <div className="mt-4 p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">
                  {error}
                </div>
              )}
              {infoMessage && (
                <div className="mt-4 p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-xs text-emerald-800 flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                  {infoMessage}
                </div>
              )}

              <form onSubmit={handleLogin} className="mt-5 space-y-4">
                <div>
                  <FieldLabel htmlFor="login-email" required>
                    Work Email
                  </FieldLabel>
                  <TextInput
                    id="login-email"
                    type="email"
                    autoComplete="email"
                    placeholder="name@company.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label htmlFor="login-password" className="text-xs font-medium text-slate-700">
                      Password <span className="text-red-600">*</span>
                    </label>
                    <button
                      type="button"
                      onClick={() => {
                        setError(null);
                        setInfoMessage(null);
                        setResetEmail(email);
                        setMode('forgot');
                      }}
                      className="text-xs font-medium text-blue-700 hover:underline cursor-pointer"
                    >
                      Forgot password?
                    </button>
                  </div>
                  <div className="relative">
                    <TextInput
                      id="login-password"
                      type={showPassword ? 'text' : 'password'}
                      autoComplete="current-password"
                      placeholder="Enter your password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="pr-10"
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((v) => !v)}
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 cursor-pointer"
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <label className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={rememberMe}
                    onChange={(e) => setRememberMe(e.target.checked)}
                    className="rounded border-slate-300 text-blue-700 focus:ring-blue-600"
                  />
                  Keep me signed in on this browser (30 days)
                </label>

                <Button type="submit" className="w-full" size="lg" disabled={busy}>
                  {busy ? 'Signing in...' : 'Sign In'}
                </Button>
              </form>

              <div className="my-5 flex items-center gap-3 text-xs text-slate-400">
                <div className="flex-1 h-px bg-slate-200" />
                <span>or</span>
                <div className="flex-1 h-px bg-slate-200" />
              </div>

              <Button
                type="button"
                variant="outline"
                className="w-full"
                onClick={handleGoogleSignIn}
                disabled={busy}
              >
                Continue with Google
              </Button>

              <p className="text-xs text-slate-500 text-center mt-6">
                New to DebitOrigin?{' '}
                <button
                  type="button"
                  onClick={() => {
                    setError(null);
                    setInfoMessage(null);
                    setMode('signup');
                  }}
                  className="text-blue-700 font-semibold hover:underline cursor-pointer"
                >
                  Create an account
                </button>
              </p>
            </>
          )}

          {mode === 'signup' && (
            <>
              <h1 className="text-xl font-bold text-slate-900">Create your DebitOrigin account</h1>
              <p className="text-sm text-slate-500 mt-1">
                Start monitoring recurring mandates and running Consent Drift Replay.
              </p>

              {error && (
                <div className="mt-4 p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">
                  {error}
                </div>
              )}

              <form onSubmit={handleSignup} className="mt-5 space-y-3.5">
                <div>
                  <FieldLabel htmlFor="signup-name" required>
                    Full Name
                  </FieldLabel>
                  <TextInput
                    id="signup-name"
                    type="text"
                    placeholder="Siddhi Shetkar"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    required
                  />
                </div>

                <div>
                  <FieldLabel htmlFor="signup-email" required>
                    Work Email
                  </FieldLabel>
                  <TextInput
                    id="signup-email"
                    type="email"
                    placeholder="risk@institution.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                  />
                </div>

                <div>
                  <FieldLabel htmlFor="signup-org">Organization (Optional)</FieldLabel>
                  <TextInput
                    id="signup-org"
                    type="text"
                    placeholder="Payment Operations / Risk Team"
                    value={organization}
                    onChange={(e) => setOrganization(e.target.value)}
                  />
                </div>

                <div>
                  <FieldLabel htmlFor="signup-password" required>
                    Password
                  </FieldLabel>
                  <div className="relative">
                    <TextInput
                      id="signup-password"
                      type={showPassword ? 'text' : 'password'}
                      placeholder="Min 8 chars, 1 uppercase, 1 number"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="pr-10"
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((v) => !v)}
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 cursor-pointer"
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <div>
                  <FieldLabel htmlFor="signup-confirm" required>
                    Confirm Password
                  </FieldLabel>
                  <div className="relative">
                    <TextInput
                      id="signup-confirm"
                      type={showConfirmPassword ? 'text' : 'password'}
                      placeholder="Re-enter your password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      className="pr-10"
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowConfirmPassword((v) => !v)}
                      aria-label={showConfirmPassword ? 'Hide confirm password' : 'Show confirm password'}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 cursor-pointer"
                    >
                      {showConfirmPassword ? (
                        <EyeOff className="w-4 h-4" />
                      ) : (
                        <Eye className="w-4 h-4" />
                      )}
                    </button>
                  </div>
                </div>

                <label className="flex items-start gap-2 text-xs text-slate-600 cursor-pointer pt-1">
                  <input
                    type="checkbox"
                    checked={termsAccepted}
                    onChange={(e) => setTermsAccepted(e.target.checked)}
                    className="mt-0.5 rounded border-slate-300 text-blue-700 focus:ring-blue-600"
                    required
                  />
                  <span>
                    I agree to the DebitOrigin Terms of Service and understand this platform verifies
                    and simulates recurring mandates without executing live bank debits.
                  </span>
                </label>

                <Button type="submit" className="w-full" size="lg" disabled={busy}>
                  {busy ? 'Creating account...' : 'Create Account'}
                </Button>
              </form>

              <div className="my-4 flex items-center gap-3 text-xs text-slate-400">
                <div className="flex-1 h-px bg-slate-200" />
                <span>or</span>
                <div className="flex-1 h-px bg-slate-200" />
              </div>

              <Button
                type="button"
                variant="outline"
                className="w-full"
                onClick={handleGoogleSignIn}
                disabled={busy}
              >
                Sign up with Google
              </Button>

              <p className="text-xs text-slate-500 text-center mt-5">
                Already have an account?{' '}
                <button
                  type="button"
                  onClick={() => {
                    setError(null);
                    setMode('login');
                  }}
                  className="text-blue-700 font-semibold hover:underline cursor-pointer"
                >
                  Sign in
                </button>
              </p>
            </>
          )}

          {mode === 'forgot' && (
            <>
              <h1 className="text-xl font-bold text-slate-900">Reset your password</h1>
              <p className="text-sm text-slate-500 mt-1">
                {resetStep === 'request'
                  ? 'Enter your work email to issue a single-use password reset code.'
                  : 'Enter the verification code and choose a new password.'}
              </p>

              {error && (
                <div className="mt-4 p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">
                  {error}
                </div>
              )}
              {infoMessage && (
                <div className="mt-4 p-3 rounded-lg bg-blue-50 border border-blue-200 text-xs text-blue-900">
                  {infoMessage}
                  {issuedPreviewCode && (
                    <div className="mt-1.5 font-mono font-semibold text-blue-800">
                      Reset Code: {issuedPreviewCode}
                    </div>
                  )}
                </div>
              )}

              {resetStep === 'request' ? (
                <form onSubmit={handleRequestReset} className="mt-5 space-y-4">
                  <div>
                    <FieldLabel htmlFor="reset-email" required>
                      Work Email
                    </FieldLabel>
                    <TextInput
                      id="reset-email"
                      type="email"
                      value={resetEmail}
                      onChange={(e) => setResetEmail(e.target.value)}
                      placeholder="name@company.com"
                      required
                    />
                  </div>
                  <Button type="submit" className="w-full" size="lg" disabled={busy}>
                    {busy ? 'Issuing code...' : 'Send Reset Code'}
                  </Button>
                </form>
              ) : (
                <form onSubmit={handleConfirmReset} className="mt-5 space-y-4">
                  <div>
                    <FieldLabel htmlFor="reset-code" required>
                      Reset Code
                    </FieldLabel>
                    <TextInput
                      id="reset-code"
                      type="text"
                      value={resetCode}
                      onChange={(e) => setResetCode(e.target.value)}
                      placeholder="8-character code"
                      className="font-mono uppercase"
                      required
                    />
                  </div>
                  <div>
                    <FieldLabel htmlFor="reset-new-pw" required>
                      New Password
                    </FieldLabel>
                    <TextInput
                      id="reset-new-pw"
                      type="password"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      placeholder="Min 8 chars, 1 uppercase, 1 number"
                      required
                    />
                  </div>
                  <Button type="submit" className="w-full" size="lg" disabled={busy}>
                    {busy ? 'Updating password...' : 'Update Password'}
                  </Button>
                </form>
              )}

              <p className="text-xs text-slate-500 text-center mt-6">
                Remembered your password?{' '}
                <button
                  type="button"
                  onClick={() => {
                    setError(null);
                    setInfoMessage(null);
                    setResetStep('request');
                    setMode('login');
                  }}
                  className="text-blue-700 font-semibold hover:underline cursor-pointer"
                >
                  Back to Sign In
                </button>
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
