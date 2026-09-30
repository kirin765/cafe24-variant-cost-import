import { parseCafe24Amount } from "./amount";
import { isValidMallId, isValidShopNo, type FetchLike } from "./oauth";

export interface Cafe24ProductSummary {
  productNo: string;
  productName: string;
}

export interface Cafe24VariantSummary {
  productNo: string;
  productName: string;
  variantCode: string;
  customVariantCode: string | null;
  optionName: string;
  supplyPrice: number | null;
}

export class Cafe24ApiError extends Error {
  readonly status: number;
  readonly apiCode: string | null;
  readonly apiMessage: string | null;

  constructor(
    status: number,
    message: string,
    apiCode: string | null = null,
    apiMessage: string | null = null,
  ) {
    super(message);
    this.name = "Cafe24ApiError";
    this.status = status;
    this.apiCode = apiCode;
    this.apiMessage = apiMessage;
  }
}

function firstArray(source: Record<string, unknown>, keys: string[]): unknown[] {
  for (const key of keys) {
    if (Array.isArray(source[key])) return source[key] as unknown[];
  }
  return [];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

function optionNameOf(options: unknown): string {
  if (!Array.isArray(options)) return "";
  return options
    .map((entry) => {
      const record = asRecord(entry);
      if (!record) return "";
      const name = typeof record.name === "string" ? record.name : "";
      const value = typeof record.value === "string" ? record.value : "";
      if (name && value) return `${name}: ${value}`;
      return value || name;
    })
    .filter((text) => text.length > 0)
    .join(" / ");
}

export function parseProductSummaries(raw: unknown): Cafe24ProductSummary[] {
  const source = asRecord(raw);
  if (!source) return [];
  const products: Cafe24ProductSummary[] = [];
  for (const entry of firstArray(source, ["products", "resource"])) {
    const record = asRecord(entry);
    if (!record) continue;
    const productNo = record.product_no;
    if (typeof productNo !== "string" && typeof productNo !== "number") continue;
    products.push({
      productNo: String(productNo),
      productName: typeof record.product_name === "string" ? record.product_name : "",
    });
  }
  return products;
}

export function mapVariant(
  record: Record<string, unknown>,
  product: Cafe24ProductSummary,
): Cafe24VariantSummary | null {
  const variantCode = record.variant_code;
  if (typeof variantCode !== "string" || variantCode.length === 0) return null;
  const custom = record.custom_variant_code;
  return {
    productNo: product.productNo,
    productName: product.productName,
    variantCode,
    customVariantCode: typeof custom === "string" && custom.length > 0 ? custom : null,
    optionName: optionNameOf(record.options),
    supplyPrice: parseCafe24Amount(record.supply_price),
  };
}

export function parseVariantSummaries(
  raw: unknown,
  product: Cafe24ProductSummary,
): Cafe24VariantSummary[] {
  const source = asRecord(raw);
  if (!source) return [];
  const variants: Cafe24VariantSummary[] = [];
  for (const entry of firstArray(source, ["variants", "resource"])) {
    const record = asRecord(entry);
    if (!record) continue;
    const variant = mapVariant(record, product);
    if (variant) variants.push(variant);
  }
  return variants;
}

export function parseVariant(
  raw: unknown,
  product: Cafe24ProductSummary,
): Cafe24VariantSummary | null {
  const source = asRecord(raw);
  if (!source) return null;
  const record = asRecord(source.variant) ?? source;
  return mapVariant(record, product);
}

interface RequestConfig {
  mallId: string;
  accessToken: string;
  shopNo?: string | null;
  apiVersion?: string | null;
  fetchImpl?: FetchLike;
}

function buildHeaders(accessToken: string, apiVersion: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
  };
  if (apiVersion) headers["X-Cafe24-Api-Version"] = apiVersion;
  return headers;
}

async function getJson(url: URL, config: RequestConfig): Promise<unknown> {
  const fetchImpl = config.fetchImpl ?? fetch;
  const response = await fetchImpl(url.toString(), {
    method: "GET",
    headers: buildHeaders(config.accessToken, config.apiVersion ?? null),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    throw new Cafe24ApiError(response.status, `Cafe24 API 요청에 실패했습니다 (HTTP ${response.status}).`);
  }
  try {
    return JSON.parse(await response.text());
  } catch {
    throw new Error("Cafe24 응답을 해석하지 못했습니다.");
  }
}

function adminUrl(mallId: string, path: string): URL {
  if (!isValidMallId(mallId)) throw new Error("유효하지 않은 mall_id입니다.");
  return new URL(`https://${mallId}.cafe24api.com/api/v2/admin${path}`);
}

function withShopNo(url: URL, shopNo: string | null | undefined): URL {
  if (shopNo && isValidShopNo(shopNo) && shopNo !== "1") url.searchParams.set("shop_no", shopNo);
  return url;
}

export interface ListProductSummariesParams extends RequestConfig {
  limit?: number;
  maxProducts?: number;
}

export interface ProductSummariesResult {
  products: Cafe24ProductSummary[];
  truncated: boolean;
}

export async function listProductSummaries(
  params: ListProductSummariesParams,
): Promise<ProductSummariesResult> {
  const perPage = Math.min(Math.max(params.limit ?? 100, 1), 100);
  const maxProducts = Math.max(params.maxProducts ?? 500, 1);
  const products: Cafe24ProductSummary[] = [];
  let offset = 0;
  let truncated = false;

  for (;;) {
    const url = withShopNo(adminUrl(params.mallId, "/products"), params.shopNo);
    url.searchParams.set("limit", String(perPage));
    url.searchParams.set("offset", String(offset));
    const page = parseProductSummaries(await getJson(url, params));
    if (page.length === 0) break;
    for (const product of page) {
      if (products.length >= maxProducts) {
        truncated = true;
        break;
      }
      products.push(product);
    }
    if (truncated || page.length < perPage) break;
    offset += page.length;
  }

  return { products, truncated };
}

export interface ListProductVariantsParams extends RequestConfig {
  product: Cafe24ProductSummary;
}

export async function listProductVariants(
  params: ListProductVariantsParams,
): Promise<Cafe24VariantSummary[]> {
  const url = withShopNo(
    adminUrl(params.mallId, `/products/${encodeURIComponent(params.product.productNo)}/variants`),
    params.shopNo,
  );
  return parseVariantSummaries(await getJson(url, params), params.product);
}

export function formatCafe24Amount(value: number): string {
  return `${value}.00`;
}

export function buildVariantSupplyPriceBody(
  shopNo: string | null | undefined,
  supplyPrice: number,
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    request: { supply_price: formatCafe24Amount(supplyPrice) },
  };
  if (shopNo && isValidShopNo(shopNo)) body.shop_no = Number(shopNo);
  return body;
}

export interface GetVariantParams extends RequestConfig {
  product: Cafe24ProductSummary;
  variantCode: string;
}

export async function getVariant(
  params: GetVariantParams,
): Promise<Cafe24VariantSummary | null> {
  const url = withShopNo(
    adminUrl(
      params.mallId,
      `/products/${encodeURIComponent(params.product.productNo)}/variants/${encodeURIComponent(params.variantCode)}`,
    ),
    params.shopNo,
  );
  return parseVariant(await getJson(url, params), params.product);
}

export interface UpdateVariantSupplyPriceParams extends RequestConfig {
  productNo: string;
  variantCode: string;
  supplyPrice: number;
}

interface ApiErrorInfo {
  code: string | null;
  message: string | null;
}

async function readApiErrorInfo(response: Response): Promise<ApiErrorInfo> {
  try {
    const body = (await response.json()) as unknown;
    const record = asRecord(body);
    const error = record ? asRecord(record.error) : null;
    const code = error?.code;
    const message = error?.message;
    return {
      code:
        typeof code === "string" && code.length > 0
          ? code
          : typeof code === "number" && Number.isFinite(code)
            ? String(code)
            : null,
      message: typeof message === "string" && message.length > 0 ? message : null,
    };
  } catch {
    return { code: null, message: null };
  }
}

export async function updateVariantSupplyPrice(
  params: UpdateVariantSupplyPriceParams,
): Promise<void> {
  const url = withShopNo(
    adminUrl(
      params.mallId,
      `/products/${encodeURIComponent(params.productNo)}/variants/${encodeURIComponent(params.variantCode)}`,
    ),
    params.shopNo,
  );
  const fetchImpl = params.fetchImpl ?? fetch;
  const response = await fetchImpl(url.toString(), {
    method: "PUT",
    headers: buildHeaders(params.accessToken, params.apiVersion ?? null),
    body: JSON.stringify(buildVariantSupplyPriceBody(params.shopNo, params.supplyPrice)),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    const info = await readApiErrorInfo(response);
    throw new Cafe24ApiError(
      response.status,
      `품목 수정에 실패했습니다 (HTTP ${response.status}${info.code ? `, ${info.code}` : ""}).`,
      info.code,
      info.message,
    );
  }
}

export function isTransientApiError(error: unknown): boolean {
  if (error instanceof Cafe24ApiError) return error.status === 429 || error.status >= 500;
  return true;
}
