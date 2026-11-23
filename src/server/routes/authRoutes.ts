import { Router } from 'express';
import { z } from 'zod';
import { and, eq, gt, isNull } from 'drizzle-orm';
import { db } from '../../db/index.ts';
import { authTokens, users, userSessions } from '../../db/schema.ts';
import { adminAuth } from '../../lib/firebase-admin.ts';
import {
  getOrCreateFirebaseUser,
  requireAuth,
  SESSION_COOKIE_NAME,
  type AuthRequest,
} from '../middleware/auth.ts';
import {
  createRateLimiter,
  generateOpaqueToken,
  generateShortCode,
  getClientIp,
  hashPassword,
  hashToken,
  logAudit,
  verifyPassword,
} from '../utils/security.ts';

const router = Router();

const authLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, max: 40, keyPrefix: 'auth' });

const signupSchema = z
  .object({
    fullName: z.string().trim().min(2, 'Full name must be at least 2 characters').max(120),
    email: z.string().trim().email('Enter a valid work email address').max(180),
    organization: z.string().trim().max(120).optional(),
    password: z
      .string()
      .min(8, 'Password must be at least 8 characters')
      .max(128)
      .regex(/[A-Z]/, 'Password must include at least one uppercase letter')
      .regex(/[0-9]/, 'Password must include at least one number'),
    confirmPassword: z.string(),
    termsAccepted: z.literal(true, {
      message: 'You must accept the terms of service to create an account',
    }),
  })
  .refine((d) => d.password === d.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });

const loginSchema = z.object({
  email: z.string().trim().email('Enter a valid email address'),
  password: z.string().min(1, 'Password is required'),
  rememberMe: z.boolean().optional().default(false),
});

function setSessionCookie(res: any, token: string, rememberMe: boolean) {
  const maxAge = rememberMe ? 30 * 24 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
  res.cookie(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: true,
    sameSite: 'none',
    partitioned: true,
    maxAge,
    path: '/',
  });
}

function serializeUser(u: {
  id: number;
  uid: string;
  fullName: string;
  email: string;
  organization?: string | null;
  authProvider: string;
  emailVerified: boolean;
  onboardingCompleted: boolean;
  createdAt: Date;
}) {
  return {
    id: u.id,
    uid: u.uid,
    fullName: u.fullName,
    email: u.email,
    organization: u.organization ?? '',
    authProvider: u.authProvider,
    emailVerified: u.emailVerified,
    onboardingCompleted: u.onboardingCompleted,
    createdAt: u.createdAt.toISOString(),
  };
}

router.post('/signup', authLimiter, async (req, res) => {
  try {
    const parsed = signupSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: parsed.error.issues[0]?.message ?? 'Invalid registration details',
        fieldErrors: parsed.error.flatten().fieldErrors,
      });
    }

    const email = parsed.data.email.toLowerCase();
    const existing = await db.select().from(users).where(eq(users.email, email)).limit(1);
    if (existing.length > 0) {
      return res.status(409).json({
        error: 'An account with this work email already exists. Please sign in instead.',
      });
    }

    const uid = `local_${generateOpaqueToken(12)}`;
    const passwordHash = hashPassword(parsed.data.password);

    const [created] = await db
      .insert(users)
      .values({
        uid,
        fullName: parsed.data.fullName,
        email,
        organization: parsed.data.organization ?? '',
        passwordHash,
        authProvider: 'email',
        emailVerified: false,
        onboardingCompleted: false,
        termsAcceptedAt: new Date(),
      })
      .returning();

    // Create session
    const sessionToken = generateOpaqueToken(32);
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await db.insert(userSessions).values({
      userId: created.id,
      tokenHash: hashToken(sessionToken),
      rememberMe: false,
      userAgent: req.headers['user-agent']?.slice(0, 200) ?? null,
      expiresAt,
    });

    // Create email verification code
    const verifyCode = generateShortCode();
    await db.insert(authTokens).values({
      userId: created.id,
      type: 'EMAIL_VERIFY',
      tokenHash: hashToken(verifyCode),
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    });

    setSessionCookie(res, sessionToken, false);
    await logAudit(created.id, 'USER_SIGNUP', 'user', created.id, { email }, getClientIp(req));

    return res.status(201).json({
      token: sessionToken,
      user: serializeUser(created),
      verificationCode: verifyCode,
    });
  } catch (error) {
    console.error('Signup error:', error);
    return res.status(500).json({ error: 'Unable to create account right now. Please try again.' });
  }
});

router.post('/login', authLimiter, async (req, res) => {
  try {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid credentials' });
    }

    const email = parsed.data.email.toLowerCase();
    const found = await db.select().from(users).where(eq(users.email, email)).limit(1);
    if (found.length === 0) {
      return res.status(401).json({ error: 'Invalid email address or password.' });
    }

    const u = found[0];
    if (!u.passwordHash) {
      return res.status(401).json({
        error: 'This account uses Google Sign-In. Please continue with Google.',
      });
    }

    if (!verifyPassword(parsed.data.password, u.passwordHash)) {
      return res.status(401).json({ error: 'Invalid email address or password.' });
    }

    const sessionToken = generateOpaqueToken(32);
    const ttlMs = parsed.data.rememberMe ? 30 * 24 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
    await db.insert(userSessions).values({
      userId: u.id,
      tokenHash: hashToken(sessionToken),
      rememberMe: parsed.data.rememberMe,
      userAgent: req.headers['user-agent']?.slice(0, 200) ?? null,
      expiresAt: new Date(Date.now() + ttlMs),
    });

    setSessionCookie(res, sessionToken, parsed.data.rememberMe);
    await logAudit(u.id, 'USER_LOGIN', 'user', u.id, { rememberMe: parsed.data.rememberMe }, getClientIp(req));

    return res.json({
      token: sessionToken,
      user: serializeUser(u),
    });
  } catch (error) {
    console.error('Login error:', error);
    return res.status(500).json({ error: 'Sign-in failed. Please try again.' });
  }
});

router.post('/google', authLimiter, async (req, res) => {
  try {
    const { idToken } = req.body ?? {};
    if (typeof idToken !== 'string' || idToken.trim().length < 20) {
      return res.status(400).json({ error: 'Missing Google authentication token.' });
    }

    const decoded = await adminAuth.verifyIdToken(idToken);
    const user = await getOrCreateFirebaseUser({
      uid: decoded.uid,
      email: decoded.email ?? `${decoded.uid}@users.debitorigin.local`,
      fullName: decoded.name ?? decoded.email?.split('@')[0] ?? 'DebitOrigin User',
      emailVerified: Boolean(decoded.email_verified),
    });

    // Also mint a DB session cookie so reload persistence works seamlessly in iframe
    const sessionToken = generateOpaqueToken(32);
    await db.insert(userSessions).values({
      userId: user.id,
      tokenHash: hashToken(sessionToken),
      rememberMe: true,
      userAgent: req.headers['user-agent']?.slice(0, 200) ?? null,
      expiresAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
    });
    setSessionCookie(res, sessionToken, true);
    await logAudit(user.id, 'USER_GOOGLE_LOGIN', 'user', user.id, {}, getClientIp(req));

    return res.json({
      token: sessionToken,
      user: serializeUser(user),
    });
  } catch (error) {
    console.error('Google auth verification error:', error);
    return res.status(401).json({ error: 'Google sign-in verification failed. Please try again.' });
  }
});

router.get('/me', requireAuth, async (req: AuthRequest, res) => {
  return res.json({ user: serializeUser(req.dbUser!) });
});

router.post('/logout', requireAuth, async (req: AuthRequest, res) => {
  try {
    if (req.sessionTokenHash) {
      await db.delete(userSessions).where(eq(userSessions.tokenHash, req.sessionTokenHash));
    }
    res.clearCookie(SESSION_COOKIE_NAME, {
      httpOnly: true,
      secure: true,
      sameSite: 'none',
      partitioned: true,
      path: '/',
    });
    await logAudit(req.dbUser!.id, 'USER_LOGOUT', 'user', req.dbUser!.id, {}, getClientIp(req));
    return res.json({ ok: true });
  } catch (error) {
    console.error('Logout error:', error);
    return res.status(500).json({ error: 'Logout failed.' });
  }
});

router.post('/verify-email', requireAuth, async (req: AuthRequest, res) => {
  try {
    const code = typeof req.body?.code === 'string' ? req.body.code.trim().toUpperCase() : '';
    if (!code) {
      return res.status(400).json({ error: 'Verification code is required.' });
    }

    const tokenRow = await db
      .select()
      .from(authTokens)
      .where(
        and(
          eq(authTokens.userId, req.dbUser!.id),
          eq(authTokens.type, 'EMAIL_VERIFY'),
          eq(authTokens.tokenHash, hashToken(code)),
          isNull(authTokens.usedAt),
          gt(authTokens.expiresAt, new Date())
        )
      )
      .limit(1);

    if (tokenRow.length === 0) {
      return res.status(400).json({ error: 'Invalid or expired verification code.' });
    }

    await db
      .update(authTokens)
      .set({ usedAt: new Date() })
      .where(eq(authTokens.id, tokenRow[0].id));

    const [updated] = await db
      .update(users)
      .set({ emailVerified: true, updatedAt: new Date() })
      .where(eq(users.id, req.dbUser!.id))
      .returning();

    await logAudit(req.dbUser!.id, 'EMAIL_VERIFIED', 'user', req.dbUser!.id, {}, getClientIp(req));
    return res.json({ user: serializeUser(updated) });
  } catch (error) {
    console.error('Verify email error:', error);
    return res.status(500).json({ error: 'Email verification failed.' });
  }
});

router.post('/resend-verification', requireAuth, authLimiter, async (req: AuthRequest, res) => {
  try {
    const verifyCode = generateShortCode();
    await db.insert(authTokens).values({
      userId: req.dbUser!.id,
      type: 'EMAIL_VERIFY',
      tokenHash: hashToken(verifyCode),
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    });

    return res.json({
      message: 'A new verification code has been generated.',
      verificationCode: verifyCode,
    });
  } catch (error) {
    console.error('Resend verification error:', error);
    return res.status(500).json({ error: 'Could not issue verification code.' });
  }
});

router.post('/forgot-password', authLimiter, async (req, res) => {
  try {
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    if (!email || !email.includes('@')) {
      return res.status(400).json({ error: 'Please enter a valid work email address.' });
    }

    const found = await db.select().from(users).where(eq(users.email, email)).limit(1);
    if (found.length === 0) {
      // Do not leak account existence while keeping UX clear
      return res.json({
        message: 'If an account matches this email, a password reset code has been issued.',
      });
    }

    const resetCode = generateShortCode();
    await db.insert(authTokens).values({
      userId: found[0].id,
      type: 'PASSWORD_RESET',
      tokenHash: hashToken(resetCode),
      expiresAt: new Date(Date.now() + 30 * 60 * 1000),
    });

    await logAudit(found[0].id, 'PASSWORD_RESET_REQUESTED', 'user', found[0].id, {}, getClientIp(req));

    return res.json({
      message: 'Password reset code generated. Enter the code below with your new password.',
      resetCode,
    });
  } catch (error) {
    console.error('Forgot password error:', error);
    return res.status(500).json({ error: 'Unable to initiate password reset.' });
  }
});

router.post('/reset-password', authLimiter, async (req, res) => {
  try {
    const schema = z.object({
      email: z.string().trim().email(),
      code: z.string().trim().min(4),
      newPassword: z
        .string()
        .min(8, 'Password must be at least 8 characters')
        .regex(/[A-Z]/, 'Password must contain an uppercase letter')
        .regex(/[0-9]/, 'Password must contain a number'),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid reset request' });
    }

    const foundUser = await db
      .select()
      .from(users)
      .where(eq(users.email, parsed.data.email.toLowerCase()))
      .limit(1);

    if (foundUser.length === 0) {
      return res.status(400).json({ error: 'Invalid or expired reset code.' });
    }

    const tokenRow = await db
      .select()
      .from(authTokens)
      .where(
        and(
          eq(authTokens.userId, foundUser[0].id),
          eq(authTokens.type, 'PASSWORD_RESET'),
          eq(authTokens.tokenHash, hashToken(parsed.data.code.toUpperCase())),
          isNull(authTokens.usedAt),
          gt(authTokens.expiresAt, new Date())
        )
      )
      .limit(1);

    if (tokenRow.length === 0) {
      return res.status(400).json({ error: 'Invalid or expired reset code.' });
    }

    const newHash = hashPassword(parsed.data.newPassword);
    await db
      .update(authTokens)
      .set({ usedAt: new Date() })
      .where(eq(authTokens.id, tokenRow[0].id));

    await db
      .update(users)
      .set({ passwordHash: newHash, authProvider: 'email', updatedAt: new Date() })
      .where(eq(users.id, foundUser[0].id));

    // Revoke active sessions after password reset
    await db.delete(userSessions).where(eq(userSessions.userId, foundUser[0].id));
    await logAudit(foundUser[0].id, 'PASSWORD_RESET_COMPLETED', 'user', foundUser[0].id, {}, getClientIp(req));

    return res.json({ message: 'Password updated successfully. You may now sign in.' });
  } catch (error) {
    console.error('Reset password error:', error);
    return res.status(500).json({ error: 'Password reset failed.' });
  }
});

router.patch('/profile', requireAuth, async (req: AuthRequest, res) => {
  try {
    const schema = z.object({
      fullName: z.string().trim().min(2).max(120).optional(),
      organization: z.string().trim().max(120).optional(),
      onboardingCompleted: z.boolean().optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid profile update' });
    }

    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (parsed.data.fullName !== undefined) updates.fullName = parsed.data.fullName;
    if (parsed.data.organization !== undefined) updates.organization = parsed.data.organization;
    if (parsed.data.onboardingCompleted !== undefined) {
      updates.onboardingCompleted = parsed.data.onboardingCompleted;
    }

    const [updated] = await db
      .update(users)
      .set(updates)
      .where(eq(users.id, req.dbUser!.id))
      .returning();

    await logAudit(req.dbUser!.id, 'PROFILE_UPDATED', 'user', req.dbUser!.id, updates, getClientIp(req));
    return res.json({ user: serializeUser(updated) });
  } catch (error) {
    console.error('Profile update error:', error);
    return res.status(500).json({ error: 'Failed to update profile.' });
  }
});

router.post('/change-password', requireAuth, authLimiter, async (req: AuthRequest, res) => {
  try {
    const schema = z.object({
      currentPassword: z.string().min(1),
      newPassword: z
        .string()
        .min(8, 'New password must be at least 8 characters')
        .regex(/[A-Z]/, 'New password must include an uppercase letter')
        .regex(/[0-9]/, 'New password must include a number'),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid password input' });
    }

    const found = await db.select().from(users).where(eq(users.id, req.dbUser!.id)).limit(1);
    if (found.length === 0 || !found[0].passwordHash) {
      return res.status(400).json({
        error: 'Password change is only available for email/password accounts.',
      });
    }

    if (!verifyPassword(parsed.data.currentPassword, found[0].passwordHash)) {
      return res.status(401).json({ error: 'Current password is incorrect.' });
    }

    await db
      .update(users)
      .set({ passwordHash: hashPassword(parsed.data.newPassword), updatedAt: new Date() })
      .where(eq(users.id, req.dbUser!.id));

    await logAudit(req.dbUser!.id, 'PASSWORD_CHANGED', 'user', req.dbUser!.id, {}, getClientIp(req));
    return res.json({ message: 'Password updated successfully.' });
  } catch (error) {
    console.error('Change password error:', error);
    return res.status(500).json({ error: 'Unable to update password.' });
  }
});

export default router;
