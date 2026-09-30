import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import type { Pool } from "pg";
import { getEncryptionKey } from "@/lib/crypto/key";
import { getPool } from "@/lib/db/pool";
import { readCafe24Config } from "@/lib/cafe24/env";
import {
  OAUTH_STATE_COOKIE,
  exchangeAuthorizationCode,
  isValidShopNo,
  verifyOAuthState,
  type Cafe24Token,
} from "@/lib/cafe24/oauth";
import { connectShop, createSession } from "@/lib/cafe24/shop-store";
import { sessionCookieOptions } from "@/lib/cafe24/auth";

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

function clearStateCookie(response: NextResponse): NextResponse {
  response.cookies.set({
    name: OAUTH_STATE_COOKIE,
    value: "",
    path: "/api/cafe24/oauth",
    maxAge: 0,
  });
  return response;
}

function page(title: string, body: string, status: number): NextResponse {
  const html = `<!doctype html>
<html lang="ko">
<head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head>
<body style="font-family:system-ui,sans-serif;max-width:720px;margin:40px auto;padding:0 16px;line-height:1.6">
<h1 style="font-size:20px">${escapeHtml(title)}</h1>
${body}
<p><a href="/demo">데모로 돌아가기</a></p>
</body></html>`;
  return clearStateCookie(
    new NextResponse(html, {
      status,
      headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
    }),
  );
}

function errorPage(message: string, status: number): NextResponse {
  return page("Cafe24 연결 실패", `<p>${escapeHtml(message)}</p>`, status);
}

export async function GET(request: Request): Promise<NextResponse> {
  const result = readCafe24Config();
  if (!result.ok || !result.config) {
    return errorPage(
      `Cafe24 OAuth 환경변수가 설정되지 않았습니다. (${result.missing.join(", ")})`,
      500,
    );
  }
  const config = result.config;
  const url = new URL(request.url);
  const secure = url.protocol === "https:";

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

  let pool: Pool;
  let encryptionKey: Buffer;
  try {
    pool = getPool();
    encryptionKey = getEncryptionKey();
  } catch (error) {
    const message = error instanceof Error ? error.message : "알 수 없는 오류";
    return errorPage(`저장소 설정이 올바르지 않습니다. ${message}`, 500);
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

  const mallId = check.state.mallId;
  const shopNo = token.shopNo && isValidShopNo(token.shopNo) ? token.shopNo : "1";

  let sessionToken: string;
  try {
    const shop = await connectShop(pool, {
      shop: { tenantId: mallId, mallId, shopNo, name: mallId, currency: "KRW" },
      token,
      encryptionKey,
    });
    const session = await createSession(pool, shop.id);
    sessionToken = session.token;
  } catch (error) {
    const message = error instanceof Error ? error.message : "알 수 없는 오류";
    return errorPage(`연결 정보를 저장하지 못했습니다. ${message}`, 500);
  }

  const response = NextResponse.redirect(new URL("/imports/new", url.origin), 303);
  response.cookies.set({ ...sessionCookieOptions(secure), value: sessionToken });
  return clearStateCookie(response);
}
