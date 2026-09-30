// 일회성 쓰기 검증 스크립트. 공급가가 설정된 품목 1개를 대상으로
// 읽기 → 쓰기(+100) → 재조회 → 원복 → 재조회 를 수행하고 원래 값으로 되돌린다.
// 토큰·금액 원문은 출력하지 않고 기대 일치 여부만 보고한다.
import crypto from "node:crypto";
import { Pool } from "pg";

const dbUrl = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
const key = Buffer.from(process.env.TOKEN_ENCRYPTION_KEY ?? "", "base64");
const VERSION = process.env.CAFE24_API_VERSION || "2026-09-01";
const DELTA = 100;

function decrypt(envelope) {
  const [version, iv, tag, ciphertext] = envelope.split(".");
  if (version !== "v1") throw new Error("unexpected envelope");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64")), decipher.final()]).toString("utf8");
}

function parseKstInstant(raw) {
  if (!raw) return null;
  const withT = raw.includes("T") ? raw : raw.replace(" ", "T");
  const normalized = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(withT) ? withT : `${withT}+09:00`;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

function amount(value) {
  if (typeof value === "number") return Number.isSafeInteger(value) ? value : null;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  const normalized = /^(\d+)\.0+$/.exec(trimmed)?.[1] ?? trimmed;
  if (!/^\d+$/.test(normalized)) return null;
  const parsed = Number(normalized);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function listOf(json, keys) {
  if (!json || typeof json !== "object") return [];
  for (const k of keys) if (Array.isArray(json[k])) return json[k];
  return [];
}

const pool = new Pool({ connectionString: dbUrl, ssl: { rejectUnauthorized: true }, max: 1 });
const { rows } = await pool.query(
  `select s.mall_id, s.shop_no, c.access_token, c.access_expires_at
   from shops s join shop_credentials c on c.shop_id = s.id
   order by c.updated_at desc limit 1`,
);
if (rows.length === 0) {
  console.log("NO_CREDENTIALS");
  await pool.end();
  process.exit(0);
}
const { mall_id: mallId, shop_no: shopNo, access_expires_at, access_token } = rows[0];
const expires = parseKstInstant(access_expires_at);
if (expires && expires.getTime() <= Date.now()) {
  console.log("ACCESS_EXPIRED — 앱에서 재인증/재접속 후 다시 시도");
  await pool.end();
  process.exit(0);
}
const access = decrypt(access_token);
const headers = {
  Authorization: `Bearer ${access}`,
  "Content-Type": "application/json",
  "X-Cafe24-Api-Version": VERSION,
};
const base = `https://${mallId}.cafe24api.com/api/v2/admin`;

async function request(method, url, body) {
  const res = await fetch(url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* ignore */ }
  return { status: res.status, ok: res.ok, json, text };
}

// 품목 공급가가 설정돼 있으면 그 값을, 없으면 상품 단위 공급가를 기준으로 삼는다.
// 단일 상품은 품목 API로 수정할 수 없으므로 옵션(복수 품목) 상품을 우선한다.
const productUrl = new URL(`${base}/products`);
productUrl.searchParams.set("limit", "100");
if (shopNo && shopNo !== "1") productUrl.searchParams.set("shop_no", shopNo);
const productsRes = await request("GET", productUrl.toString());
if (!productsRes.ok) {
  console.log("products failed", productsRes.status, String(productsRes.text).slice(0, 200));
  await pool.end();
  process.exit(0);
}
const candidates = [];
for (const product of listOf(productsRes.json, ["products", "resource"]).slice(0, 50)) {
  const pno = product.product_no;
  if (pno === undefined || pno === null) continue;
  const productPrice = amount(product.supply_price);
  const vUrl = new URL(`${base}/products/${encodeURIComponent(String(pno))}/variants`);
  const vRes = await request("GET", vUrl.toString());
  if (!vRes.ok) continue;
  const variants = listOf(vRes.json, ["variants", "resource"]).filter(
    (v) => typeof v.variant_code === "string",
  );
  candidates.push({ productNo: String(pno), productPrice, variants });
}

let target = null;
// 1) 품목 공급가가 이미 설정된 품목
for (const candidate of candidates) {
  const hit = candidate.variants.find((v) => amount(v.supply_price) !== null);
  if (hit) {
    target = {
      productNo: candidate.productNo,
      variantCode: hit.variant_code,
      price: amount(hit.supply_price),
      from: "variant",
    };
    break;
  }
}
// 2) 옵션(복수 품목) 상품 + 상품 공급가
if (!target) {
  const option = candidates.find((c) => c.variants.length > 1 && c.productPrice !== null);
  if (option) {
    target = {
      productNo: option.productNo,
      variantCode: option.variants[0].variant_code,
      price: option.productPrice,
      from: "product(option)",
    };
  }
}
// 3) 단일 품목 상품 + 상품 공급가 (API가 거부할 수 있음)
if (!target) {
  const single = candidates.find((c) => c.variants.length === 1 && c.productPrice !== null);
  if (single) {
    target = {
      productNo: single.productNo,
      variantCode: single.variants[0].variant_code,
      price: single.productPrice,
      from: "product(single)",
    };
  }
}

if (!target) {
  console.log("NO_BASE_PRICE — 품목·상품 공급가가 모두 비어 있습니다");
  await pool.end();
  process.exit(0);
}

const { productNo, variantCode, price: original, from } = target;
const next = original + DELTA;
const single = `${base}/products/${encodeURIComponent(productNo)}/variants/${encodeURIComponent(variantCode)}`;
const body = (value) => ({ shop_no: Number(shopNo), request: { supply_price: `${value}.00` } });

async function readPrice() {
  const res = await request("GET", single);
  if (!res.ok) return { ok: false, status: res.status };
  const record = res.json && typeof res.json === "object" && res.json.variant ? res.json.variant : res.json;
  return { ok: true, status: res.status, price: amount(record?.supply_price) };
}

console.log("target variant:", variantCode, "product:", productNo, "기준값 출처:", from);
console.log("PUT body 형식:", JSON.stringify(body(next)).replace(String(next), "<new>").replace(String(original), "<base>"));

const put = await request("PUT", single, body(next));
console.log("PUT ->", put.status, put.ok ? "ok" : String(put.text).slice(0, 200));
if (!put.ok) {
  await pool.end();
  process.exit(0);
}
const afterWrite = await readPrice();
console.log("재조회 반영:", afterWrite.ok && afterWrite.price === next);

const restore = await request("PUT", single, body(original));
console.log("PUT(원복) ->", restore.status);
const afterRestore = await readPrice();
console.log("원복 확인:", afterRestore.ok && afterRestore.price === original);

await pool.end();
