import crypto from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import { db } from '../../db/index.ts';
import { auditLogs } from '../../db/schema.ts';

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  const parts = storedHash.split(':');
  if (parts.length !== 2) return false;
  const [salt, keyHex] = parts;
  const derived = crypto.scryptSync(password, salt, 64);
  const keyBuf = Buffer.from(keyHex, 'hex');
  if (derived.length !== keyBuf.length) return false;
  return crypto.timingSafeEqual(derived, keyBuf);
}

export function generateOpaqueToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('hex');
}

export function generateShortCode(): string {
  return crypto.randomBytes(4).toString('hex').toUpperCase();
}

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function makeUid(prefix: string): string {
  const rand = crypto.randomBytes(4).toString('hex').toUpperCase();
  const ts = Date.now().toString(36).toUpperCase().slice(-4);
  return `${prefix}-${ts}${rand}`;
}

export function sha256Buffer(buffer: Buffer): string {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/webp',
  'text/plain',
]);

export function validateUploadedFile(
  buffer: Buffer,
  mimeType: string,
  maxBytes = 10 * 1024 * 1024
): { valid: boolean; error?: string } {
  if (!ALLOWED_MIME_TYPES.has(mimeType)) {
    return {
      valid: false,
      error: 'Unsupported file type. Upload a PDF, PNG, JPEG, WebP, or plain text consent document.',
    };
  }
  if (buffer.length === 0) {
    return { valid: false, error: 'Uploaded file is empty.' };
  }
  if (buffer.length > maxBytes) {
    return { valid: false, error: 'File exceeds the 10 MB security limit.' };
  }

  // Magic-byte validation to block spoofed file extensions
  if (mimeType === 'application/pdf') {
    if (buffer.subarray(0, 4).toString('ascii') !== '%PDF') {
      return { valid: false, error: 'File header does not match a valid PDF document.' };
    }
  } else if (mimeType === 'image/png') {
    const pngSig = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    if (!buffer.subarray(0, 4).equals(pngSig)) {
      return { valid: false, error: 'File header does not match a valid PNG image.' };
    }
  } else if (mimeType === 'image/jpeg') {
    if (!(buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff)) {
      return { valid: false, error: 'File header does not match a valid JPEG image.' };
    }
  } else if (mimeType === 'image/webp') {
    const riff = buffer.subarray(0, 4).toString('ascii');
    const webp = buffer.subarray(8, 12).toString('ascii');
    if (riff !== 'RIFF' || webp !== 'WEBP') {
      return { valid: false, error: 'File header does not match a valid WebP image.' };
    }
  }

  return { valid: true };
}

export function getClientIp(req: Request): string {
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.length > 0) {
    return xff.split(',')[0].trim();
  }
  return req.socket.remoteAddress ?? 'unknown';
}

export async function logAudit(
  userId: number,
  action: string,
  entityType: string,
  entityId: string | number,
  details?: Record<string, unknown>,
  ipAddress?: string
): Promise<void> {
  try {
    await db.insert(auditLogs).values({
      userId,
      action,
      entityType,
      entityId: String(entityId),
      details: details ?? null,
      ipAddress: ipAddress ?? null,
    });
  } catch (err) {
    console.error('Audit log insert failed:', err);
  }
}

export function parseCookieHeader(header: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (!header) return cookies;
  for (const part of header.split(';')) {
    const eqIdx = part.indexOf('=');
    if (eqIdx === -1) continue;
    const key = part.slice(0, eqIdx).trim();
    const val = part.slice(eqIdx + 1).trim();
    if (key) {
      cookies[key] = decodeURIComponent(val);
    }
  }
  return cookies;
}

export function createRateLimiter(options: { windowMs: number; max: number; keyPrefix: string }) {
  const store = new Map<string, { count: number; resetAt: number }>();

  return (req: Request, res: Response, next: NextFunction) => {
    const now = Date.now();
    const key = `${options.keyPrefix}:${getClientIp(req)}`;
    const existing = store.get(key);

    if (!existing || existing.resetAt <= now) {
      store.set(key, { count: 1, resetAt: now + options.windowMs });
      return next();
    }

    if (existing.count >= options.max) {
      const retrySec = Math.ceil((existing.resetAt - now) / 1000);
      res.setHeader('Retry-After', String(retrySec));
      return res.status(429).json({
        error: 'Too many requests. Please wait briefly before trying again.',
      });
    }

    existing.count += 1;
    return next();
  };
}
