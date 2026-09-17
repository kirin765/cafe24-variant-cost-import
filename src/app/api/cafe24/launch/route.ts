import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: Request): NextResponse {
  const url = new URL(request.url);
  const start = new URL("/api/cafe24/oauth/start", url.origin);
  for (const key of ["mall_id", "shop_no"] as const) {
    const value = url.searchParams.get(key);
    if (value) start.searchParams.set(key, value);
  }
  return NextResponse.redirect(start, 302);
}
