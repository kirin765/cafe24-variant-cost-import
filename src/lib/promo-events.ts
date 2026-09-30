import type { Pool } from "pg";

/**
 * Small app-local collector for the fixed reviewisa recommendation events.
 * Campaign/source stay in code; clients send only an event id and name.
 */
export const PROMO_EVENT_NAMES = [
  "reviewisa_promo_view",
  "reviewisa_promo_click",
  "reviewisa_promo_dismiss",
] as const;
export type PromoEventName = (typeof PROMO_EVENT_NAMES)[number];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function parsePromoEvent(body: unknown): { eventId: string; eventName: PromoEventName } | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const input = body as Record<string, unknown>;
  if (Object.keys(input).some((key) => key !== "eventId" && key !== "eventName")) return null;
  if (typeof input.eventId !== "string" || !UUID.test(input.eventId)) return null;
  if (!PROMO_EVENT_NAMES.includes(input.eventName as PromoEventName)) return null;
  return { eventId: input.eventId, eventName: input.eventName as PromoEventName };
}

/** Storage failure stays silent and never blocks the link or the page. */
export async function recordPromoEvent(
  pool: Pool,
  mallId: string,
  shopNo: number,
  eventId: string,
  eventName: PromoEventName,
): Promise<void> {
  try {
    await pool.query(
      `insert into promo_events (id, mall_id, shop_no, event_name)
       values ($1, $2, $3, $4) on conflict (id) do nothing`,
      [eventId, mallId, shopNo, eventName],
    );
  } catch {
    console.warn("[promo] event storage unavailable");
  }
}
