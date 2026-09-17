import { cookies } from "next/headers";
import { readCafe24Config } from "@/lib/cafe24/env";
import {
  CAFE24_REQUIRED_SCOPES,
  OAUTH_STATE_COOKIE,
  exchangeAuthorizationCode,
  missingScopes,
  verifyOAuthState,
  type Cafe24Token,
} from "@/lib/cafe24/oauth";
import { TOKEN_STORE_NOTE, saveToken } from "@/lib/cafe24/token-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function page(title: string, body: string, status: number): Response {
  const html = `<!doctype html>
<html lang="ko">
<head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head>
<body style="font-family:system-ui,sans-serif;max-width:720px;margin:40px auto;padding:0 16px;line-height:1.6">
<h1 style="font-size:20px">${escapeHtml(title)}</h1>
${body}
<p><a href="/demo">데모로 돌아가기</a></p>
</body></html>`;
  return new Response(html, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });
}

function errorPage(message: string, status: number): Response {
  return page("Cafe24 연결 실패", `<p>${escapeHtml(message)}</p>`, status);
}

function describeToken(token: Cafe24Token): string {
  const missing = missingScopes(token.scopes);
  const rows = [
    ["쇼핑몰", token.mallId || "—"],
    ["사용자", token.userId ?? "—"],
    ["shop_no", token.shopNo ?? "—"],
    ["승인 scope", token.scopes.join(", ") || "—"],
    ["Access Token 만료", token.expiresAt || "—"],
    ["Refresh Token 만료", token.refreshTokenExpiresAt || "—"],
  ]
    .map(
      ([label, value]) =>
        `<tr><th style="text-align:left;padding:4px 12px 4px 0">${escapeHtml(label)}</th><td>${escapeHtml(value)}</td></tr>`,
    )
    .join("");
  const missingWarning =
    missing.length > 0
      ? `<p style="color:#b45309"><strong>주의:</strong> 필수 scope가 부족합니다 — ${escapeHtml(missing.join(", "))}</p>`
      : `<p style="color:#047857">필수 scope ${escapeHtml(CAFE24_REQUIRED_SCOPES.join(", "))}가 모두 승인되었습니다.</p>`;
  return `<table>${rows}</table>${missingWarning}<p style="color:#525252;font-size:13px">${escapeHtml(TOKEN_STORE_NOTE)}</p><p style="color:#525252;font-size:13px">아직 공급가 쓰기는 수행하지 않습니다.</p>`;
}

export async function GET(request: Request): Promise<Response> {
  const result = readCafe24Config();
  if (!result.ok || !result.config) {
    return errorPage(
      `Cafe24 OAuth 환경변수가 설정되지 않았습니다. (${result.missing.join(", ")})`,
      500,
    );
  }
  const config = result.config;
  const url = new URL(request.url);

  const oauthError = url.searchParams.get("error");
  if (oauthError) {
    const description = url.searchParams.get("error_description") ?? "";
    return errorPage(`인증이 거부되었습니다: ${oauthError} ${description}`.trim(), 400);
  }

  const code = url.searchParams.get("code") ?? "";
  const state = url.searchParams.get("state") ?? "";
  const cookieStore = await cookies();
  const cookieState = cookieStore.get(OAUTH_STATE_COOKIE)?.value ?? "";

  if (!code || !state || !cookieState || state !== cookieState) {
    return errorPage("state 검증에 실패했습니다. OAuth를 다시 시작해 주세요.", 400);
  }
  const check = verifyOAuthState(state, config.stateSecret);
  if (!check.ok) {
    return errorPage(`state 검증에 실패했습니다 (${check.reason}).`, 400);
  }

  const redirectUri =
    config.redirectUri ?? new URL("/api/cafe24/oauth/callback", url.origin).toString();

  let token: Cafe24Token;
  try {
    token = await exchangeAuthorizationCode({
      mallId: check.state.mallId,
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      code,
      redirectUri,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "알 수 없는 오류";
    return errorPage(`토큰 교환에 실패했습니다. ${message}`, 502);
  }

  saveToken(check.state.mallId, token);
  const response = page("Cafe24 연결 완료", describeToken(token), 200);
  response.headers.append(
    "Set-Cookie",
    `${OAUTH_STATE_COOKIE}=; HttpOnly; SameSite=Lax; Path=/api/cafe24/oauth; Max-Age=0`,
  );
  return response;
}
