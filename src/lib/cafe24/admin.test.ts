import { describe, expect, it, vi } from "vitest";
import { listAdminProducts, parseAdminProducts } from "@/lib/cafe24/admin";

describe("parseAdminProducts", () => {
  it("products 배열을 상품으로 바꾸고 공급가를 정규화한다", () => {
    const products = parseAdminProducts({
      products: [
        { product_no: 128, product_name: "샘플상품 1", supply_price: "4500.00" },
        { product_no: "P000000J", product_name: "샘플상품 2", supply_price: 9000 },
      ],
    });
    expect(products).toEqual([
      { productNo: "128", productName: "샘플상품 1", supplyPrice: 4500 },
      { productNo: "P000000J", productName: "샘플상품 2", supplyPrice: 9000 },
    ]);
  });

  it("resource 배열도 받는다", () => {
    expect(parseAdminProducts({ resource: [{ product_no: 1, product_name: "a" }] })).toEqual([
      { productNo: "1", productName: "a", supplyPrice: null },
    ]);
  });

  it("공급가가 정수가 아니거나 없으면 null로 둔다", () => {
    const products = parseAdminProducts({
      products: [
        { product_no: 1, supply_price: "4500.50" },
        { product_no: 2, supply_price: "1,000" },
        { product_no: 3 },
      ],
    });
    expect(products.map((entry) => entry.supplyPrice)).toEqual([null, null, null]);
  });

  it("product_no가 없으면 건너뛰고, 알 수 없는 응답은 빈 배열", () => {
    expect(parseAdminProducts({ products: [{ product_name: "x" }] })).toEqual([]);
    expect(parseAdminProducts(null)).toEqual([]);
    expect(parseAdminProducts({})).toEqual([]);
  });
});

describe("listAdminProducts", () => {
  it("Bearer 토큰과 limit/offset/shop_no/version으로 조회한다", async () => {
    const fetchImpl = vi.fn(async (input: string, init?: RequestInit) => {
      const url = new URL(input);
      expect(url.origin).toBe("https://demo.cafe24api.com");
      expect(url.pathname).toBe("/api/v2/admin/products");
      expect(url.searchParams.get("limit")).toBe("50");
      expect(url.searchParams.get("offset")).toBe("0");
      expect(url.searchParams.get("shop_no")).toBe("2");
      expect(url.searchParams.get("version")).toBe("2026-09-01");
      const headers = init?.headers as Record<string, string>;
      expect(headers.Authorization).toBe("Bearer access-1");
      return new Response(JSON.stringify({ products: [{ product_no: 1, supply_price: "1000.00" }] }), {
        status: 200,
      });
    });

    const products = await listAdminProducts({
      mallId: "demo",
      accessToken: "access-1",
      shopNo: "2",
      limit: 50,
      apiVersion: "2026-09-01",
      fetchImpl,
    });
    expect(products[0]).toEqual({ productNo: "1", productName: "", supplyPrice: 1000 });
  });

  it("오류 응답이면 예외를 던진다", async () => {
    const fetchImpl = async () => new Response("nope", { status: 401 });
    await expect(
      listAdminProducts({ mallId: "demo", accessToken: "bad", fetchImpl }),
    ).rejects.toThrow(/401/);
  });

  it("잘못된 mall_id는 요청하지 않는다", async () => {
    const fetchImpl = vi.fn();
    await expect(
      listAdminProducts({ mallId: "demo.evil.com", accessToken: "a", fetchImpl }),
    ).rejects.toThrow();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
