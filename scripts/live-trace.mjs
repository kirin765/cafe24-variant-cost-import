// 품목 공급가 PUT 1건을 보내고 응답 상태·X-Trace_ID·본문을 출력한다. 부작용은 없다(거부 예상).
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
const { mall_id: mallId, shop_no: shopNo, access_token } = rows[0];
const access = decrypt(access_token);
const headers = { Authorization: `Bearer ${access}`, "Content-Type": "application/json", "X-Cafe24-Api-Version": VERSION };
const base = `https://${mallId}.cafe24api.com/api/v2/admin`;

const productNo = process.env.TRACE_PRODUCT_NO || "15";
const variantCode = process.env.TRACE_VARIANT_CODE || "P000000P000A";
const price = Number(process.env.TRACE_PRICE || "4500");
const url = `${base}/products/${encodeURIComponent(productNo)}/variants/${encodeURIComponent(variantCode)}`;
const res = await fetch(url, {
  method: "PUT",
  headers,
  body: JSON.stringify({ shop_no: Number(shopNo), request: { supply_price: `${price}.00` } }),
  signal: AbortSignal.timeout(15_000),
});
console.log("PUT", url.replace(base, ""));
console.log("status:", res.status);
const trace = res.headers.get("x-trace-id") ?? res.headers.get("x-traceid") ?? "(none)";
console.log("X-Trace_ID:", trace);
console.log("trace headers:", JSON.stringify([...res.headers.entries()].filter(([k]) => /trace|correlation|request-id/i.test(k))));
console.log("body:", (await res.text()).slice(0, 300));
await pool.end();
