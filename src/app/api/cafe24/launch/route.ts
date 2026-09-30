import { NextResponse } from "next/server";
import { getCurrentSession, sessionMatchesShop } from "@/lib/cafe24/auth";
import { readCafe24Config } from "@/lib/cafe24/env";
import { verifyLaunchHmac } from "@/lib/cafe24/launch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);
  const mallId = (url.searchParams.get("mall_id") ?? "").trim();
  const shopNo = (url.searchParams.get("shop_no") ?? "").trim();
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

  // 이미 연결된 몰이면 재인증 없이 작업 화면으로 보낸다. 세션의 몰과 요청 몰이 같을 때만 허용한다.
  const access = await getCurrentSession();
  if (access && sessionMatchesShop(access, mallId, shopNo || null)) {
    return NextResponse.redirect(new URL("/imports/new", url.origin), 303);
  }

  const start = new URL("/api/cafe24/oauth/start", url.origin);
  for (const key of ["mall_id", "shop_no"] as const) {
    const value = url.searchParams.get(key);
    if (value) start.searchParams.set(key, value);
  }
  return NextResponse.redirect(start, 302);
}
