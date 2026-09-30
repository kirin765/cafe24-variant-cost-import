import { describe, expect, it } from "vitest";
import type { FetchLike } from "@/lib/cafe24/oauth";
import {
  Cafe24ApiError,
  listProductSummaries,
  listProductVariants,
  parseProductSummaries,
  parseVariantSummaries,
  updateVariantSupplyPrice,
} from "@/lib/cafe24/variants";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function recorder(responses: Response[]): { fetchImpl: FetchLike; urls: string[]; headers: Headers[] } {
  const urls: string[] = [];
  const headers: Headers[] = [];
  let index = 0;
  const fetchImpl: FetchLike = async (input, init) => {
    urls.push(input);
    headers.push(new Headers(init?.headers));
    const response = responses[Math.min(index, responses.length - 1)];
    index += 1;
    return response;
  };
  return { fetchImpl, urls, headers };
}

describe("parseProductSummaries", () => {
  it("products와 resource 배열을 읽고 잘못된 행을 건너뛴다", () => {
    expect(
      parseProductSummaries({
        products: [
          { product_no: 1, product_name: "상품1" },
          { product_name: "번호없음" },
          { product_no: "2", product_name: "상품2" },
        ],
      }),
    ).toEqual([
      { productNo: "1", productName: "상품1" },
      { productNo: "2", productName: "상품2" },
    ]);
    expect(parseProductSummaries({ resource: [{ product_no: "9" }] })).toEqual([
      { productNo: "9", productName: "" },
    ]);
    expect(parseProductSummaries(null)).toEqual([]);
  });
});

describe("parseVariantSummaries", () => {
  const product = { productNo: "20", productName: "티셔츠" };

  it("옵션명을 합치고 공급가를 정규화한다", () => {
    const result = parseVariantSummaries(
      {
        variants: [
          {
            variant_code: "P000000R000A",
            custom_variant_code: "MY-CODE",
            supply_price: "4500.00",
            options: [
              { name: "Color", value: "Blue" },
              { name: "Size", value: "S" },
            ],
          },
        ],
      },
      product,
    );
    expect(result).toEqual([
      {
        productNo: "20",
        productName: "티셔츠",
        variantCode: "P000000R000A",
        customVariantCode: "MY-CODE",
        optionName: "Color: Blue / Size: S",
        supplyPrice: 4500,
      },
    ]);
  });

  it("공급가가 없거나 음수·비정수면 null, 빈 자체코드는 null", () => {
    const result = parseVariantSummaries(
      {
        variants: [
          { variant_code: "A1", custom_variant_code: "", supply_price: "" },
          { variant_code: "A2", supply_price: "-1000.00" },
          { variant_code: "A3", supply_price: "4500.50" },
          { variant_code: "A4" },
        ],
      },
      product,
    );
    expect(result.map((entry) => entry.supplyPrice)).toEqual([null, null, null, null]);
    expect(result[0].customVariantCode).toBeNull();
    expect(result[0].optionName).toBe("");
  });

  it("variant_code가 없으면 건너뛴다", () => {
    expect(parseVariantSummaries({ variants: [{ supply_price: "1" }] }, product)).toEqual([]);
  });
});

describe("listProductSummaries", () => {
  it("limit/offset으로 페이지를 넘기고 짧은 페이지에서 멈춘다", async () => {
    const { fetchImpl, urls, headers } = recorder([
      json({ products: [{ product_no: "1" }, { product_no: "2" }] }),
      json({ products: [{ product_no: "3" }] }),
    ]);
    const result = await listProductSummaries({
      mallId: "demo",
      accessToken: "token",
      apiVersion: "2026-09-01",
      limit: 2,
      fetchImpl,
    });
    expect(result.products.map((entry) => entry.productNo)).toEqual(["1", "2", "3"]);
    expect(result.truncated).toBe(false);
    expect(urls).toHaveLength(2);
    expect(new URL(urls[0]).searchParams.get("offset")).toBe("0");
    expect(new URL(urls[1]).searchParams.get("offset")).toBe("2");
    expect(headers[0].get("X-Cafe24-Api-Version")).toBe("2026-09-01");
    expect(headers[0].get("Authorization")).toBe("Bearer token");
  });

  it("maxProducts에 도달하면 truncated로 표시하고 멈춘다", async () => {
    const { fetchImpl, urls } = recorder([
      json({ products: [{ product_no: "1" }, { product_no: "2" }] }),
      json({ products: [{ product_no: "3" }, { product_no: "4" }] }),
    ]);
    const result = await listProductSummaries({
      mallId: "demo",
      accessToken: "token",
      limit: 2,
      maxProducts: 3,
      fetchImpl,
    });
    expect(result.products).toHaveLength(3);
    expect(result.truncated).toBe(true);
    expect(urls).toHaveLength(2);
  });

  it("shop_no가 1이 아니면 쿼리에 넣는다", async () => {
    const { fetchImpl, urls } = recorder([json({ products: [] })]);
    await listProductSummaries({ mallId: "demo", accessToken: "t", shopNo: "2", fetchImpl });
    expect(new URL(urls[0]).searchParams.get("shop_no")).toBe("2");
  });

  it("오류 응답을 상태 코드와 함께 던진다", async () => {
    const { fetchImpl } = recorder([new Response("no", { status: 401 })]);
    await expect(
      listProductSummaries({ mallId: "demo", accessToken: "t", fetchImpl }),
    ).rejects.toMatchObject({ status: 401 });
  });

  it("잘못된 mall_id를 거부한다", async () => {
    await expect(
      listProductSummaries({ mallId: "evil.example.com", accessToken: "t" }),
    ).rejects.toThrow();
  });
});

describe("listProductVariants", () => {
  it("상품 경로로 품목을 조회한다", async () => {
    const { fetchImpl, urls } = recorder([
      json({ variants: [{ variant_code: "P000000R000A", supply_price: "1000.00" }] }),
    ]);
    const result = await listProductVariants({
      mallId: "demo",
      accessToken: "token",
      apiVersion: "2026-09-01",
      product: { productNo: "20", productName: "티셔츠" },
      fetchImpl,
    });
    expect(urls[0]).toContain("/api/v2/admin/products/20/variants");
    expect(result[0].variantCode).toBe("P000000R000A");
    expect(result[0].supplyPrice).toBe(1000);
  });

  it("403을 Cafe24ApiError로 던진다", async () => {
    const { fetchImpl } = recorder([new Response("forbidden", { status: 403 })]);
    await expect(
      listProductVariants({
        mallId: "demo",
        accessToken: "t",
        product: { productNo: "1", productName: "" },
        fetchImpl,
      }),
    ).rejects.toBeInstanceOf(Cafe24ApiError);
  });
});

describe("updateVariantSupplyPrice", () => {
  it("공급가만 담아 품목 경로로 PUT한다", async () => {
    const { fetchImpl, urls } = recorder([json({ variant: {} }, 200)]);
    await updateVariantSupplyPrice({
      mallId: "demo",
      accessToken: "token",
      apiVersion: "2026-09-01",
      productNo: "20",
      variantCode: "P000000R000A",
      supplyPrice: 4500,
      fetchImpl,
    });
    expect(urls[0]).toContain("/api/v2/admin/products/20/variants/P000000R000A");
  });

  it("422의 API 코드와 메시지를 담아 던진다", async () => {
    const { fetchImpl } = recorder([
      json(
        { error: { code: 422, message: "Supply price by item cannot be modified." } },
        422,
      ),
    ]);
    await expect(
      updateVariantSupplyPrice({
        mallId: "demo",
        accessToken: "t",
        productNo: "20",
        variantCode: "P000000R000A",
        supplyPrice: 4500,
        fetchImpl,
      }),
    ).rejects.toMatchObject({
      status: 422,
      apiCode: "422",
      apiMessage: "Supply price by item cannot be modified.",
    });
  });
});
