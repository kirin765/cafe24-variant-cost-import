import { describe, expect, it } from "vitest";
import { PROMO_EVENT_NAMES, parsePromoEvent } from "@/lib/promo-events";

const eventId = "25c6c6a5-9e0b-4dc1-9235-fc2d886b9f32";

describe("parsePromoEvent", () => {
  it("accepts only the fixed event names with a UUID id", () => {
    for (const eventName of PROMO_EVENT_NAMES) {
      expect(parsePromoEvent({ eventId, eventName })).toEqual({ eventId, eventName });
    }
  });

  it("rejects unknown names, malformed ids and extra client metadata", () => {
    expect(parsePromoEvent({ eventId, eventName: "reviewisa_promo_other" })).toBeNull();
    expect(parsePromoEvent({ eventId, eventName: "import_completed" })).toBeNull();
    expect(parsePromoEvent({ eventId, eventName: "reviewisa_promo_view", mallId: "mall" })).toBeNull();
    expect(parsePromoEvent({ eventId, eventName: "reviewisa_promo_view", productNo: 1 })).toBeNull();
    expect(parsePromoEvent({ eventId: "nope", eventName: "reviewisa_promo_view" })).toBeNull();
    expect(parsePromoEvent("reviewisa_promo_view")).toBeNull();
    expect(parsePromoEvent(null)).toBeNull();
    expect(parsePromoEvent([{ eventId, eventName: "reviewisa_promo_view" }])).toBeNull();
  });
});
