import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { signInWithPopup, signOut as firebaseSignOut } from 'firebase/auth';
import { auth, googleAuthProvider } from '../lib/firebase.ts';
import { apiRequest, setMemoryAuthToken } from '../lib/api.ts';
import type { UserProfile } from '../shared/types.ts';

interface AuthContextValue {
  user: UserProfile | null;
  loading: boolean;
  pendingVerificationCode: string | null;
  clearPendingVerificationCode: () => void;
  loginWithEmail: (email: string, password: string, rememberMe: boolean) => Promise<void>;
  signupWithEmail: (payload: {
    fullName: string;
    email: string;
    organization?: string;
    password: string;
    confirmPassword: string;
    termsAccepted: boolean;
  }) => Promise<{ verificationCode?: string }>;
  loginWithGoogle: () => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
  updateProfile: (updates: {
    fullName?: string;
    organization?: string;
    onboardingCompleted?: boolean;
  }) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [pendingVerificationCode, setPendingVerificationCode] = useState<string | null>(null);

  const refreshUser = useCallback(async () => {
    try {
      const data = await apiRequest<{ user: UserProfile }>('/api/auth/me');
      setUser(data.user);
    } catch {
      setUser(null);
      setMemoryAuthToken(null);
    }
  }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const data = await apiRequest<{ user: UserProfile }>('/api/auth/me');
        if (active) setUser(data.user);
      } catch {
        if (active) setUser(null);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const loginWithEmail = async (email: string, password: string, rememberMe: boolean) => {
    const data = await apiRequest<{ token: string; user: UserProfile }>('/api/auth/login', {
      method: 'POST',
      body: { email, password, rememberMe },
    });
    setMemoryAuthToken(data.token);
    setUser(data.user);
  };

  const signupWithEmail = async (payload: {
    fullName: string;
    email: string;
    organization?: string;
    password: string;
    confirmPassword: string;
    termsAccepted: boolean;
  }) => {
    const data = await apiRequest<{
      token: string;
      user: UserProfile;
      verificationCode?: string;
    }>('/api/auth/signup', {
      method: 'POST',
      body: payload,
    });
    setMemoryAuthToken(data.token);
    setUser(data.user);
    if (data.verificationCode) {
      setPendingVerificationCode(data.verificationCode);
    }
    return { verificationCode: data.verificationCode };
  };

  const loginWithGoogle = async () => {
    const cred = await signInWithPopup(auth, googleAuthProvider);
    const idToken = await cred.user.getIdToken();
    const data = await apiRequest<{ token: string; user: UserProfile }>('/api/auth/google', {
      method: 'POST',
      body: { idToken },
    });
    setMemoryAuthToken(data.token);
    setUser(data.user);
  };

  const logout = async () => {
    try {
      await apiRequest('/api/auth/logout', { method: 'POST' });
    } catch {
      // ignore
    }
    try {
      await firebaseSignOut(auth);
    } catch {
      // ignore
    }
    setMemoryAuthToken(null);
    setPendingVerificationCode(null);
    setUser(null);
  };

  const updateProfile = async (updates: {
    fullName?: string;
    organization?: string;
    onboardingCompleted?: boolean;
  }) => {
    const data = await apiRequest<{ user: UserProfile }>('/api/auth/profile', {
      method: 'PATCH',
      body: updates,
    });
    setUser(data.user);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        pendingVerificationCode,
        clearPendingVerificationCode: () => setPendingVerificationCode(null),
        loginWithEmail,
        signupWithEmail,
        loginWithGoogle,
        logout,
        refreshUser,
        updateProfile,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
