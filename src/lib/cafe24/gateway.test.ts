import { describe, expect, it } from "vitest";
import { SHOPS, VARIANTS } from "@/fixtures/supply-price-import";
import { FixtureVariantGateway } from "./gateway";

describe("FixtureVariantGateway", () => {
  const gateway = new FixtureVariantGateway(VARIANTS);

  it("몰의 품목만 돌려준다", async () => {
    const alpha = await gateway.listVariants(SHOPS[0]);
    expect(alpha.length).toBe(10);
    expect(alpha.every((variant) => variant.tenantId === SHOPS[0].tenantId)).toBe(true);
  });

  it("품목이 없는 몰은 빈 목록이다", async () => {
    expect(await gateway.listVariants(SHOPS[2])).toEqual([]);
  });
});
