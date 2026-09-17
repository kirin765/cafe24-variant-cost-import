import { isValidMallId, type FetchLike } from "./oauth";

export interface AdminProduct {
  productNo: string;
  productName: string;
  supplyPrice: number | null;
}

function toAmount(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isSafeInteger(value) ? value : null;
  }
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  const normalized = /^(\d+)\.0+$/.exec(trimmed)?.[1] ?? trimmed;
  if (!/^\d+$/.test(normalized)) return null;
  const parsed = Number(normalized);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function readProducts(raw: unknown): unknown[] {
  if (typeof raw !== "object" || raw === null) return [];
  const source = raw as Record<string, unknown>;
  if (Array.isArray(source.products)) return source.products;
  if (Array.isArray(source.resource)) return source.resource;
  return [];
}

export function parseAdminProducts(raw: unknown): AdminProduct[] {
  const products: AdminProduct[] = [];
  for (const entry of readProducts(raw)) {
    if (typeof entry !== "object" || entry === null) continue;
    const record = entry as Record<string, unknown>;
    const productNo = record.product_no;
    if (typeof productNo !== "string" && typeof productNo !== "number") continue;
    const productName = typeof record.product_name === "string" ? record.product_name : "";
    products.push({
      productNo: String(productNo),
      productName,
      supplyPrice: toAmount(record.supply_price),
    });
  }
  return products;
}

export interface ListAdminProductsParams {
  mallId: string;
  accessToken: string;
  shopNo?: string | null;
  limit?: number;
  offset?: number;
  apiVersion?: string | null;
  fetchImpl?: FetchLike;
}

export async function listAdminProducts(params: ListAdminProductsParams): Promise<AdminProduct[]> {
  if (!isValidMallId(params.mallId)) throw new Error("유효하지 않은 mall_id입니다.");
  const fetchImpl = params.fetchImpl ?? fetch;
  const url = new URL(`https://${params.mallId}.cafe24api.com/api/v2/admin/products`);
  url.searchParams.set("limit", String(params.limit ?? 100));
  url.searchParams.set("offset", String(params.offset ?? 0));
  if (params.shopNo) url.searchParams.set("shop_no", params.shopNo);
  if (params.apiVersion) url.searchParams.set("version", params.apiVersion);

  const response = await fetchImpl(url.toString(), {
    method: "GET",
    headers: {
      Authorization: `Bearer ${params.accessToken}`,
      "Content-Type": "application/json",
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    throw new Error(`상품 조회에 실패했습니다 (HTTP ${response.status}).`);
  }
  let payload: unknown;
  try {
    payload = JSON.parse(await response.text());
  } catch {
    throw new Error("상품 응답을 해석하지 못했습니다.");
  }
  return parseAdminProducts(payload);
}
