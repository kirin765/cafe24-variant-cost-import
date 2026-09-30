import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/cafe24/auth";
import { getPool, hasDatabaseUrl } from "@/lib/db/pool";
import { parsePromoEvent, recordPromoEvent } from "@/lib/promo-events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Fixed, authenticated recommendation events only; no arbitrary client metadata. */
export async function POST(req: NextRequest) {
  if (!hasDatabaseUrl()) return NextResponse.json({ error: "unavailable" }, { status: 503 });
  const access = await getCurrentSession();
  if (!access) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (Number(req.headers.get("content-length") ?? 0) > 1024) {
    return NextResponse.json({ error: "invalid event" }, { status: 400 });
  }
  const parsed = parsePromoEvent(await req.json().catch(() => null));
  if (!parsed) return NextResponse.json({ error: "invalid event" }, { status: 400 });
  const shopNo = Number(access.shop.shopNo);
  if (!Number.isSafeInteger(shopNo) || shopNo <= 0) {
    return NextResponse.json({ error: "invalid shop" }, { status: 400 });
  }
  await recordPromoEvent(getPool(), access.shop.mallId, shopNo, parsed.eventId, parsed.eventName);
  return new NextResponse(null, { status: 204, headers: { "Cache-Control": "no-store" } });
}
