import { NextResponse } from "next/server";
import { readCafe24Config } from "@/lib/cafe24/env";
import { verifyLaunchHmac } from "@/lib/cafe24/launch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: Request): NextResponse {
  const url = new URL(request.url);
  const mallId = (url.searchParams.get("mall_id") ?? "").trim();
  const hmac = url.searchParams.get("hmac");

  if (hmac) {
    const result = readCafe24Config();
    if (!result.ok || !result.config) {
      return NextResponse.json(
        { error: "Cafe24 환경변수가 설정되지 않았습니다.", missing: result.missing },
        { status: 500 },
      );
    }
    if (!verifyLaunchHmac(url.search, hmac, result.config.clientSecret)) {
      return NextResponse.json({ error: "launch hmac 검증에 실패했습니다." }, { status: 403 });
    }
  } else if (!mallId) {
    return NextResponse.json({ error: "mall_id가 필요합니다." }, { status: 400 });
  }

  const start = new URL("/api/cafe24/oauth/start", url.origin);
  for (const key of ["mall_id", "shop_no"] as const) {
    const value = url.searchParams.get(key);
    if (value) start.searchParams.set(key, value);
  }
  return NextResponse.redirect(start, 302);
}
