// 일회성 읽기 전용 점검 스크립트. 토큰·공급가 원문은 출력하지 않는다.
import crypto from "node:crypto";
import { Pool } from "pg";

const dbUrl = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
const key = Buffer.from(process.env.TOKEN_ENCRYPTION_KEY ?? "", "base64");
const VERSION = process.env.CAFE24_API_VERSION || "2026-09-01";

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

const pool = new Pool({ connectionString: dbUrl, ssl: { rejectUnauthorized: true }, max: 1 });
const { rows } = await pool.query(
  `select s.mall_id, s.shop_no, c.access_token, c.access_expires_at, c.refresh_expires_at, c.scopes
   from shops s join shop_credentials c on c.shop_id = s.id
   order by c.updated_at desc limit 1`,
);
if (rows.length === 0) {
  console.log("NO_CREDENTIALS");
  await pool.end();
  process.exit(0);
}
const row = rows[0];
const access = decrypt(row.access_token);
const mallId = row.mall_id;
const shopNo = row.shop_no;
const expires = parseKstInstant(row.access_expires_at);
const now = Date.now();
console.log("mall:", mallId, "shop_no:", shopNo, "scopes:", row.scopes.length);
console.log("access valid:", expires ? expires.getTime() > now : "unknown", "expires in(min):", expires ? Math.round((expires.getTime() - now) / 60000) : "-");
if (expires && expires.getTime() <= now) {
  console.log("ACCESS_EXPIRED — 재인증 또는 refresh 필요(스크립트는 refresh하지 않음)");
  await pool.end();
  process.exit(0);
}

const headers = {
  Authorization: `Bearer ${access}`,
  "Content-Type": "application/json",
  "X-Cafe24-Api-Version": VERSION,
};
const base = `https://${mallId}.cafe24api.com/api/v2/admin`;

async function getJson(url) {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(15_000) });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* ignore */ }
  return { status: res.status, ok: res.ok, json, text };
}

function listOf(json, keys) {
  if (!json || typeof json !== "object") return [];
  for (const k of keys) if (Array.isArray(json[k])) return json[k];
  return [];
}

const productUrl = new URL(`${base}/products`);
productUrl.searchParams.set("limit", "100");
productUrl.searchParams.set("offset", "0");
if (shopNo && shopNo !== "1") productUrl.searchParams.set("shop_no", shopNo);
const productsRes = await getJson(productUrl.toString());
console.log("GET /products ->", productsRes.status, "version:", VERSION);
if (!productsRes.ok) {
  console.log("products error body:", String(productsRes.text).slice(0, 300));
  await pool.end();
  process.exit(0);
}
const products = listOf(productsRes.json, ["products", "resource"]);
console.log("products:", products.length);

const listing = [];
const settingRes = await getJson(`${base}/products/setting`);
console.log("GET /products/setting ->", settingRes.status);
if (settingRes.ok) {
  const setting = settingRes.json && settingRes.json.product ? settingRes.json.product : settingRes.json;
  const keys = Object.keys(setting ?? {});
  console.log("setting keys:", keys.join(","));
  for (const key of keys) {
    if (/supply|price|margin/i.test(key)) {
      console.log(`  setting ${key} =`, JSON.stringify(setting[key]));
    }
  }
}

let productSupplySet = 0;
for (const product of products) {
  if (Object.prototype.hasOwnProperty.call(product, "supply_price")) {
    const value = product.supply_price;
    if (value !== null && value !== undefined && value !== "" && value !== "0.00") {
      productSupplySet += 1;
    }
  }
}
console.log("product-level supply_price set:", productSupplySet, "/", products.length);

let variantTotal = 0;
let supplyKeyPresent = 0;
let supplyNonNull = 0;
let supplyError = 0;
let customCodeNonNull = 0;
let optionNonEmpty = 0;
let firstKeys = null;
let sampleFormat = null;
const supplyShape = { nullValue: 0, emptyString: 0, zeroString: 0, other: 0 };

for (const product of products.slice(0, 50)) {
  const pno = product.product_no ?? product.product_code;
  if (pno === undefined || pno === null) continue;
  const vUrl = new URL(`${base}/products/${encodeURIComponent(String(pno))}/variants`);
  if (shopNo && shopNo !== "1") vUrl.searchParams.set("shop_no", shopNo);
  const vRes = await getJson(vUrl.toString());
  if (!vRes.ok) {
    console.log(`GET variants ${pno} -> ${vRes.status}`);
    continue;
  }
  const variants = listOf(vRes.json, ["variants", "resource"]);
  listing.push(`${String(pno)}: ${variants.map((v) => v.variant_code).join(", ")}`);
  for (const v of variants) {
    variantTotal += 1;
    if (firstKeys === null) firstKeys = Object.keys(v).filter((k) => k !== "supply_price");
    if (Object.prototype.hasOwnProperty.call(v, "supply_price")) {
      supplyKeyPresent += 1;
      const value = v.supply_price;
      if (value === null || value === undefined) supplyShape.nullValue += 1;
      else if (value === "") supplyShape.emptyString += 1;
      else if (value === "0.00" || value === "0") supplyShape.zeroString += 1;
      else supplyShape.other += 1;
      if (value !== null && value !== undefined && value !== "") {
        supplyNonNull += 1;
        if (sampleFormat === null) {
          sampleFormat = typeof value === "string" ? ( /^\d+\.\d{2}$/.test(value) ? "string:<int>.dd" : "string:other" ) : typeof value;
        }
      }
    } else {
      supplyError += 1;
    }
    const custom = v.custom_variant_code;
    if (typeof custom === "string" && custom.length > 0) customCodeNonNull += 1;
    if (Array.isArray(v.options) && v.options.length > 0) optionNonEmpty += 1;
  }
}

console.log("variants:", variantTotal);
console.log("supply_price key present:", supplyKeyPresent, "non-null:", supplyNonNull, "sampleFormat:", sampleFormat);
console.log("supply_price shape: null=", supplyShape.nullValue, "empty=", supplyShape.emptyString, "zero=", supplyShape.zeroString, "other=", supplyShape.other);
console.log("supply_price missing key:", supplyError);
console.log("custom_variant_code non-empty:", customCodeNonNull, "options non-empty:", optionNonEmpty);
console.log("sample variant keys (supply_price 제외):", firstKeys ? firstKeys.join(",") : "-");
console.log("품목 목록:");
for (const line of listing) console.log("  -", line);

await pool.end();
