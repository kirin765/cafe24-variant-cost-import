// 품목별 공급가를 목록 API와 단건 API로 각각 읽어 비교한다(읽기 전용).
import crypto from "node:crypto";
import { Pool } from "pg";

const dbUrl = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
const key = Buffer.from(process.env.TOKEN_ENCRYPTION_KEY ?? "", "base64");
const VERSION = process.env.CAFE24_API_VERSION || "2026-09-01";

function decrypt(envelope) {
  const [, iv, tag, ciphertext] = envelope.split(".");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64")), decipher.final()]).toString("utf8");
}

const pool = new Pool({ connectionString: dbUrl, ssl: { rejectUnauthorized: true }, max: 1 });
const { rows } = await pool.query(
  `select s.mall_id, s.shop_no, c.access_token from shops s join shop_credentials c on c.shop_id = s.id order by c.updated_at desc limit 1`,
);
const { mall_id: mallId, access_token } = rows[0];
const access = decrypt(access_token);
const headers = { Authorization: `Bearer ${access}`, "X-Cafe24-Api-Version": VERSION };
const base = `https://${mallId}.cafe24api.com/api/v2/admin`;

async function getJson(url) {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(15_000) });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* ignore */ }
  return { status: res.status, json, text };
}

const productsRes = await getJson(`${base}/products?limit=100`);
const products = productsRes.json?.products ?? [];
for (const product of products) {
  const pno = product.product_no;
  const vRes = await getJson(`${base}/products/${encodeURIComponent(pno)}/variants`);
  const variants = vRes.json?.variants ?? [];
  console.log(`product ${pno} "${product.product_name}" product_supply=${JSON.stringify(product.supply_price)}`);
  for (const v of variants) {
    const sRes = await getJson(`${base}/products/${encodeURIComponent(pno)}/variants/${encodeURIComponent(v.variant_code)}`);
    const sv = sRes.json?.variant ?? sRes.json;
    console.log(`  ${v.variant_code} list=${JSON.stringify(v.supply_price)} single=${JSON.stringify(sv?.supply_price)} status=${sRes.status}`);
  }
}
await pool.end();
