import { describe, expect, it } from "vitest";
import type { ShopRef } from "@/features/imports/model";
import { SHOPS, VARIANTS } from "@/fixtures/supply-price-import";
import type { FetchLike } from "./oauth";
import { Cafe24VariantGateway, FixtureVariantGateway, loadShopVariants } from "./gateway";

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

describe("Cafe24VariantGateway", () => {
  const shop: ShopRef = {
    tenantId: "demo",
    mallId: "demo",
    shopNumber: "1",
    name: "데모몰",
    currency: "KRW",
  };

  function json(body: unknown): Response {
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  it("상품 목록을 돌고 품목을 PlatformVariant로 변환한다", async () => {
    const responses = [
      json({ products: [{ product_no: "20", product_name: "티셔츠" }] }),
      json({
        variants: [
          {
            variant_code: "P000000R000A",
            supply_price: "4500.00",
            options: [{ name: "Size", value: "M" }],
          },
        ],
      }),
    ];
    let index = 0;
    const fetchImpl: FetchLike = async () => responses[index++];
    const result = await loadShopVariants(shop, {
      accessToken: "token",
      currency: "KRW",
      fetchImpl,
      maxProducts: 10,
    });
    expect(result.productCount).toBe(1);
    expect(result.productsWithoutVariants).toBe(0);
    expect(result.truncated).toBe(false);
    expect(result.variants).toEqual([
      {
        tenantId: "demo",
        mallId: "demo",
        productNo: "20",
        productName: "티셔츠",
        variantCode: "P000000R000A",
        optionName: "Size: M",
        supplyPrice: 4500,
        currency: "KRW",
      },
    ]);
  });

  it("품목이 없는 상품을 세고 공급가 없는 품목은 null로 남긴다", async () => {
    const responses = [
      json({
        products: [
          { product_no: "1", product_name: "A" },
          { product_no: "2", product_name: "B" },
        ],
      }),
      json({ variants: [{ variant_code: "V1" }] }),
      json({ variants: [] }),
    ];
    let index = 0;
    const fetchImpl: FetchLike = async () => responses[index++];
    const result = await loadShopVariants(shop, { accessToken: "token", fetchImpl, maxProducts: 10 });
    expect(result.productsWithoutVariants).toBe(1);
    expect(result.variants[0].supplyPrice).toBeNull();
  });

  it("gateway 인터페이스로 같은 결과를 돌려준다", async () => {
    const responses = [
      json({ products: [{ product_no: "1", product_name: "A" }] }),
      json({ variants: [{ variant_code: "V1", supply_price: "100.00" }] }),
    ];
    let index = 0;
    const fetchImpl: FetchLike = async () => responses[index++];
    const gateway = new Cafe24VariantGateway({ accessToken: "token", fetchImpl, maxProducts: 10 });
    const variants = await gateway.listVariants(shop);
    expect(variants).toHaveLength(1);
    expect(variants[0].supplyPrice).toBe(100);
  });
});
