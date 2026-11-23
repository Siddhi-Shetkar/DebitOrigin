import type { Request, Response, NextFunction } from 'express';
import { and, eq, gt } from 'drizzle-orm';
import { db } from '../../db/index.ts';
import { users, userSessions } from '../../db/schema.ts';
import { adminAuth } from '../../lib/firebase-admin.ts';
import { hashToken, parseCookieHeader } from '../utils/security.ts';

export const SESSION_COOKIE_NAME = 'debitorigin_session';

export interface AuthenticatedUser {
  id: number;
  uid: string;
  fullName: string;
  email: string;
  organization: string;
  authProvider: string;
  emailVerified: boolean;
  onboardingCompleted: boolean;
  createdAt: Date;
}

export interface AuthRequest extends Request {
  dbUser?: AuthenticatedUser;
  sessionTokenHash?: string;
}

export async function getOrCreateFirebaseUser(params: {
  uid: string;
  email: string;
  fullName: string;
  emailVerified: boolean;
}): Promise<AuthenticatedUser> {
  try {
    const normalizedEmail = params.email.trim().toLowerCase();
    // Check if an account already exists with this email or uid
    const existingByUid = await db
      .select()
      .from(users)
      .where(eq(users.uid, params.uid))
      .limit(1);

    if (existingByUid.length > 0) {
      const u = existingByUid[0];
      return {
        id: u.id,
        uid: u.uid,
        fullName: u.fullName,
        email: u.email,
        organization: u.organization ?? '',
        authProvider: u.authProvider,
        emailVerified: u.emailVerified,
        onboardingCompleted: u.onboardingCompleted,
        createdAt: u.createdAt,
      };
    }

    const existingByEmail = await db
      .select()
      .from(users)
      .where(eq(users.email, normalizedEmail))
      .limit(1);

    if (existingByEmail.length > 0) {
      const updated = await db
        .update(users)
        .set({
          uid: params.uid,
          emailVerified: true,
          updatedAt: new Date(),
        })
        .where(eq(users.id, existingByEmail[0].id))
        .returning();
      const u = updated[0];
      return {
        id: u.id,
        uid: u.uid,
        fullName: u.fullName,
        email: u.email,
        organization: u.organization ?? '',
        authProvider: u.authProvider,
        emailVerified: u.emailVerified,
        onboardingCompleted: u.onboardingCompleted,
        createdAt: u.createdAt,
      };
    }

    const inserted = await db
      .insert(users)
      .values({
        uid: params.uid,
        email: normalizedEmail,
        fullName: params.fullName || normalizedEmail.split('@')[0],
        authProvider: 'google',
        emailVerified: params.emailVerified,
        termsAcceptedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: users.uid,
        set: {
          email: normalizedEmail,
          updatedAt: new Date(),
        },
      })
      .returning();

    const u = inserted[0];
    return {
      id: u.id,
      uid: u.uid,
      fullName: u.fullName,
      email: u.email,
      organization: u.organization ?? '',
      authProvider: u.authProvider,
      emailVerified: u.emailVerified,
      onboardingCompleted: u.onboardingCompleted,
      createdAt: u.createdAt,
    };
  } catch (error) {
    console.error('Database query failed during Firebase user sync:', error);
    throw new Error('Failed to synchronize user account.', { cause: error });
  }
}

export const requireAuth = async (req: AuthRequest, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;
  let bearerToken: string | null = null;
  let usedCookieAuth = false;

  if (authHeader && authHeader.startsWith('Bearer ')) {
    bearerToken = authHeader.slice(7).trim();
  }

  if (!bearerToken) {
    const cookies = parseCookieHeader(req.headers.cookie);
    if (cookies[SESSION_COOKIE_NAME]) {
      bearerToken = cookies[SESSION_COOKIE_NAME];
      usedCookieAuth = true;
    }
  }

  if (!bearerToken) {
    return res.status(401).json({ error: 'Authentication required. Please sign in to continue.' });
  }

  // CSRF defense for cookie-authenticated mutations
  if (usedCookieAuth && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method.toUpperCase())) {
    const xrw = req.headers['x-requested-with'];
    const origin = req.headers.origin;
    const host = (req.headers['x-forwarded-host'] || req.headers.host || '') as string;
    const originMatchesHost =
      typeof origin === 'string' &&
      host.length > 0 &&
      (() => {
        try {
          return new URL(origin).host === host;
        } catch {
          return false;
        }
      })();

    if (xrw !== 'DebitOrigin' && !originMatchesHost) {
      return res.status(403).json({ error: 'Forbidden: missing request verification header.' });
    }
  }

  try {
    // 1. Check PostgreSQL session token first (Email/Password sessions)
    const tokenHash = hashToken(bearerToken);
    const sessionRows = await db
      .select({
        sessionId: userSessions.id,
        userId: users.id,
        uid: users.uid,
        fullName: users.fullName,
        email: users.email,
        organization: users.organization,
        authProvider: users.authProvider,
        emailVerified: users.emailVerified,
        onboardingCompleted: users.onboardingCompleted,
        createdAt: users.createdAt,
      })
      .from(userSessions)
      .innerJoin(users, eq(userSessions.userId, users.id))
      .where(and(eq(userSessions.tokenHash, tokenHash), gt(userSessions.expiresAt, new Date())))
      .limit(1);

    if (sessionRows.length > 0) {
      const s = sessionRows[0];
      req.dbUser = {
        id: s.userId,
        uid: s.uid,
        fullName: s.fullName,
        email: s.email,
        organization: s.organization ?? '',
        authProvider: s.authProvider,
        emailVerified: s.emailVerified,
        onboardingCompleted: s.onboardingCompleted,
        createdAt: s.createdAt,
      };
      req.sessionTokenHash = tokenHash;
      return next();
    }

    // 2. Otherwise verify as Firebase ID Token (Google Sign-In via Firebase Auth)
    if (!usedCookieAuth && bearerToken.split('.').length === 3) {
      try {
        const decoded = await adminAuth.verifyIdToken(bearerToken);
        const synced = await getOrCreateFirebaseUser({
          uid: decoded.uid,
          email: decoded.email ?? `${decoded.uid}@users.debitorigin.local`,
          fullName: decoded.name ?? decoded.email?.split('@')[0] ?? 'DebitOrigin User',
          emailVerified: Boolean(decoded.email_verified),
        });
        req.dbUser = synced;
        return next();
      } catch {
        // Fall through to 401
      }
    }

    return res.status(401).json({ error: 'Session expired or invalid. Please sign in again.' });
  } catch (error) {
    console.error('Authentication middleware error:', error);
    return res.status(500).json({ error: 'Authentication verification failed. Please try again.' });
  }
};
