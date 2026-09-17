import { describe, expect, it } from "vitest";
import { SHOPS } from "@/fixtures/supply-price-import";
import { buildPlatformSnapshot } from "./platform-snapshot";

const shop = SHOPS[0];
const header = "상품코드,자체 상품코드,상품명,소비자가,공급가,판매가";

describe("buildPlatformSnapshot", () => {
  it("Cafe24 상품목록을 매칭용 품목으로 바꾼다", () => {
    const snapshot = buildPlatformSnapshot({
      shop,
      text: `${header}\nP000000I,,샘플상품 1,5000.00,4500.00,5000.00\nP000000J,,샘플상품 2,10000.00,9000.00,10000.00\n`,
    });
    expect(snapshot.format).toBe("cafe24-product");
    expect(snapshot.fileIssues).toEqual([]);
    expect(snapshot.skipped).toEqual([]);
    expect(snapshot.variants).toEqual([
      {
        tenantId: shop.tenantId,
        mallId: shop.mallId,
        productNo: "P000000I",
        productName: "샘플상품 1",
        variantCode: "P000000I",
        optionName: "기본",
        supplyPrice: 4500,
        currency: shop.currency,
      },
      {
        tenantId: shop.tenantId,
        mallId: shop.mallId,
        productNo: "P000000J",
        productName: "샘플상품 2",
        variantCode: "P000000J",
        optionName: "기본",
        supplyPrice: 9000,
        currency: shop.currency,
      },
    ]);
  });

  it("공급가를 읽지 못한 행은 건너뛰고 사유를 남긴다", () => {
    const snapshot = buildPlatformSnapshot({
      shop,
      text: `${header}\nA,,정상,0,4500.00,0\nB,,소수,"",4500.50,0\n,,"코드없음",0,1000.00,0\n`,
    });
    expect(snapshot.variants).toHaveLength(1);
    expect(snapshot.variants[0].variantCode).toBe("A");
    expect(snapshot.skipped.map((entry) => entry.variantCode)).toEqual(["B", ""]);
  });

  it("단순 형식도 받는다", () => {
    const snapshot = buildPlatformSnapshot({ shop, text: "variant_code,supply_price\nSKU-1,1200\n" });
    expect(snapshot.format).toBe("simple");
    expect(snapshot.variants[0]).toMatchObject({ variantCode: "SKU-1", supplyPrice: 1200 });
  });

  it("지원하지 않는 형식은 품목 없이 파일 오류를 남긴다", () => {
    const snapshot = buildPlatformSnapshot({ shop, text: "그룹상품번호,상품명\n1,테스트\n" });
    expect(snapshot.format).toBeNull();
    expect(snapshot.variants).toEqual([]);
    expect(snapshot.fileIssues[0]?.code).toBe("file_header");
  });
});
