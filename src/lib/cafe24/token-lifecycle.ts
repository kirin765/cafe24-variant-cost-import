const EXPLICIT_TIMEZONE = /(?:Z|[+-]\d{2}:?\d{2})$/i;
const DEFAULT_OFFSET = "+09:00";

export type TokenFreshness = "fresh" | "refresh" | "reauth" | "unknown";

export const DEFAULT_REFRESH_MARGIN_MS = 60_000;

export function parseCafe24Instant(raw: string | null | undefined): Date | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  const withT = trimmed.includes("T") ? trimmed : trimmed.replace(" ", "T");
  const normalized = EXPLICIT_TIMEZONE.test(withT) ? withT : `${withT}${DEFAULT_OFFSET}`;
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function isRefreshTokenUsable(
  refreshExpiresAt: string | null | undefined,
  now: number = Date.now(),
  marginMs: number = DEFAULT_REFRESH_MARGIN_MS,
): boolean {
  const refresh = parseCafe24Instant(refreshExpiresAt);
  if (!refresh) return true;
  return refresh.getTime() - marginMs > now;
}

export function classifyAccessToken(
  accessExpiresAt: string | null | undefined,
  refreshExpiresAt: string | null | undefined,
  now: number = Date.now(),
  marginMs: number = DEFAULT_REFRESH_MARGIN_MS,
): TokenFreshness {
  const access = parseCafe24Instant(accessExpiresAt);
  if (!access) {
    return isRefreshTokenUsable(refreshExpiresAt, now, marginMs) ? "unknown" : "reauth";
  }
  if (access.getTime() - marginMs > now) return "fresh";
  return isRefreshTokenUsable(refreshExpiresAt, now, marginMs) ? "refresh" : "reauth";
}
