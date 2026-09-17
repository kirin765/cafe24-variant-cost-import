import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const CAFE24_OAUTH_SCOPES = [
  "mall.read_product",
  "mall.write_product",
  "mall.read_store",
] as const;

export const CAFE24_REQUIRED_SCOPES = ["mall.read_product", "mall.write_product"] as const;

export const OAUTH_STATE_COOKIE = "cafe24_oauth_state";
export const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;
export const TOKEN_REQUEST_TIMEOUT_MS = 15_000;

const MALL_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,62}$/i;

export function isValidMallId(value: string): boolean {
  return MALL_ID_PATTERN.test(value);
}

function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

export interface OAuthState {
  mallId: string;
  nonce: string;
  expiresAt: number;
}

export type OAuthStateCheck =
  | { ok: true; state: OAuthState }
  | { ok: false; reason: "malformed" | "signature" | "expired" | "mall_id" };

export function createOAuthState(secret: string, mallId: string, now: number = Date.now()): string {
  if (!isValidMallId(mallId)) throw new Error("유효하지 않은 mall_id입니다.");
  const nonce = randomBytes(16).toString("hex");
  const expiresAt = now + OAUTH_STATE_TTL_MS;
  const payload = `${mallId}.${nonce}.${expiresAt}`;
  return `${payload}.${sign(payload, secret)}`;
}

export function verifyOAuthState(
  value: string,
  secret: string,
  now: number = Date.now(),
): OAuthStateCheck {
  const parts = value.split(".");
  if (parts.length !== 4) return { ok: false, reason: "malformed" };
  const [mallId, nonce, expiresAtRaw, signature] = parts;
  if (!isValidMallId(mallId)) return { ok: false, reason: "mall_id" };
  const payload = `${mallId}.${nonce}.${expiresAtRaw}`;
  const given = Buffer.from(signature, "hex");
  const expected = Buffer.from(sign(payload, secret), "hex");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return { ok: false, reason: "signature" };
  }
  const expiresAt = Number(expiresAtRaw);
  if (!Number.isFinite(expiresAt) || now >= expiresAt) return { ok: false, reason: "expired" };
  return { ok: true, state: { mallId, nonce, expiresAt } };
}

export interface AuthorizeUrlParams {
  mallId: string;
  clientId: string;
  redirectUri: string;
  state: string;
  scope?: readonly string[];
}

export function buildAuthorizeUrl(params: AuthorizeUrlParams): string {
  if (!isValidMallId(params.mallId)) throw new Error("유효하지 않은 mall_id입니다.");
  const url = new URL(`https://${params.mallId}.cafe24api.com/api/v2/oauth/authorize`);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", params.clientId);
  url.searchParams.set("state", params.state);
  url.searchParams.set("redirect_uri", params.redirectUri);
  url.searchParams.set("scope", (params.scope ?? CAFE24_OAUTH_SCOPES).join(" "));
  return url.toString();
}

export interface Cafe24Token {
  accessToken: string;
  expiresAt: string;
  refreshToken: string;
  refreshTokenExpiresAt: string;
  clientId: string;
  mallId: string;
  userId: string | null;
  scopes: string[];
  issuedAt: string;
  shopNo: string | null;
  tokenType: string;
}

function readString(source: Record<string, unknown>, key: string): string | null {
  const value = source[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function parseCafe24Token(raw: unknown): Cafe24Token {
  if (typeof raw !== "object" || raw === null) {
    throw new Error("토큰 응답 형식이 올바르지 않습니다.");
  }
  const source = raw as Record<string, unknown>;
  const accessToken = readString(source, "access_token");
  const refreshToken = readString(source, "refresh_token");
  if (!accessToken || !refreshToken) {
    throw new Error("토큰 응답에 필수 값이 없습니다.");
  }
  const scopes = Array.isArray(source.scopes)
    ? source.scopes.filter((scope): scope is string => typeof scope === "string")
    : [];
  return {
    accessToken,
    expiresAt: readString(source, "expires_at") ?? "",
    refreshToken,
    refreshTokenExpiresAt: readString(source, "refresh_token_expires_at") ?? "",
    clientId: readString(source, "client_id") ?? "",
    mallId: readString(source, "mall_id") ?? "",
    userId: readString(source, "user_id"),
    scopes,
    issuedAt: readString(source, "issued_at") ?? "",
    shopNo: readString(source, "shop_no"),
    tokenType: readString(source, "token_type") ?? "Bearer",
  };
}

export function missingScopes(
  granted: readonly string[],
  required: readonly string[] = CAFE24_REQUIRED_SCOPES,
): string[] {
  return required.filter((scope) => !granted.includes(scope));
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

function basicAuth(clientId: string, clientSecret: string): string {
  return `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`;
}

async function postToken(
  mallId: string,
  clientId: string,
  clientSecret: string,
  body: URLSearchParams,
  fetchImpl: FetchLike,
): Promise<Cafe24Token> {
  if (!isValidMallId(mallId)) throw new Error("유효하지 않은 mall_id입니다.");
  const response = await fetchImpl(`https://${mallId}.cafe24api.com/api/v2/oauth/token`, {
    method: "POST",
    headers: {
      Authorization: basicAuth(clientId, clientSecret),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
    signal: AbortSignal.timeout(TOKEN_REQUEST_TIMEOUT_MS),
  });
  const text = await response.text();
  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error(`토큰 응답을 해석하지 못했습니다 (HTTP ${response.status}).`);
  }
  if (!response.ok) {
    const errorCode =
      typeof payload === "object" && payload !== null && "error" in payload
        ? String((payload as Record<string, unknown>).error)
        : `HTTP ${response.status}`;
    throw new Error(`토큰 발급에 실패했습니다: ${errorCode}`);
  }
  return parseCafe24Token(payload);
}

export interface ExchangeAuthorizationCodeParams {
  mallId: string;
  clientId: string;
  clientSecret: string;
  code: string;
  redirectUri: string;
}

export function exchangeAuthorizationCode(
  params: ExchangeAuthorizationCodeParams,
  fetchImpl: FetchLike = fetch,
): Promise<Cafe24Token> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: params.code,
    redirect_uri: params.redirectUri,
  });
  return postToken(params.mallId, params.clientId, params.clientSecret, body, fetchImpl);
}

export interface RefreshAccessTokenParams {
  mallId: string;
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}

export function refreshAccessToken(
  params: RefreshAccessTokenParams,
  fetchImpl: FetchLike = fetch,
): Promise<Cafe24Token> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: params.refreshToken,
  });
  return postToken(params.mallId, params.clientId, params.clientSecret, body, fetchImpl);
}
