import { createHash, randomBytes } from "node:crypto";

export const SESSION_COOKIE = "cafe24_session";
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const SESSION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function generateSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function isWellFormedSessionToken(token: string): boolean {
  return SESSION_TOKEN_PATTERN.test(token);
}

export function sessionExpiresAt(now: number = Date.now(), ttlMs: number = SESSION_TTL_MS): Date {
  return new Date(now + ttlMs);
}

export function isSessionActive(
  expiresAt: Date,
  revokedAt: Date | null,
  now: number = Date.now(),
): boolean {
  return revokedAt === null && expiresAt.getTime() > now;
}
