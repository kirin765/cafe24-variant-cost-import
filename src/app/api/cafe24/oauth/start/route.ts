import { NextResponse } from "next/server";
import { readCafe24Config } from "@/lib/cafe24/env";
import {
  CAFE24_OAUTH_SCOPES,
  OAUTH_STATE_COOKIE,
  OAUTH_STATE_TTL_MS,
  buildAuthorizeUrl,
  createOAuthState,
  isValidMallId,
} from "@/lib/cafe24/oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: Request): NextResponse {
  const result = readCafe24Config();
  if (!result.ok || !result.config) {
    return NextResponse.json(
      {
        error: "Cafe24 OAuth 환경변수가 설정되지 않았습니다.",
        missing: result.missing,
      },
      { status: 500 },
    );
  }
  const config = result.config;
  const url = new URL(request.url);
  const requestedMallId = (url.searchParams.get("mall_id") ?? "").trim();
  const mallId = requestedMallId || (config.mallId ?? "");
  if (!isValidMallId(mallId)) {
    return NextResponse.json({ error: "유효한 mall_id가 필요합니다." }, { status: 400 });
  }

  const redirectUri =
    config.redirectUri ?? new URL("/api/cafe24/oauth/callback", url.origin).toString();
  const state = createOAuthState(config.stateSecret, mallId);
  const authorizeUrl = buildAuthorizeUrl({
    mallId,
    clientId: config.clientId,
    redirectUri,
    state,
    scope: CAFE24_OAUTH_SCOPES,
  });

  const response = NextResponse.redirect(authorizeUrl, 302);
  response.cookies.set({
    name: OAUTH_STATE_COOKIE,
    value: state,
    httpOnly: true,
    sameSite: "lax",
    secure: url.protocol === "https:",
    path: "/api/cafe24/oauth",
    maxAge: OAUTH_STATE_TTL_MS / 1000,
  });
  return response;
}
