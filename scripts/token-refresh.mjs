// 일회성 토큰 갱신 스크립트. access token이 만료됐으면 refresh token으로 회전·저장한다.
// 토큰 원문은 출력하지 않고 만료 시각과 scope만 보고한다.
import crypto from "node:crypto";
import { Pool } from "pg";

const dbUrl = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
const key = Buffer.from(process.env.TOKEN_ENCRYPTION_KEY ?? "", "base64");
const clientId = process.env.CAFE24_CLIENT_ID;
const clientSecret = process.env.CAFE24_CLIENT_SECRET;

function decrypt(envelope) {
  const [version, iv, tag, ciphertext] = envelope.split(".");
  if (version !== "v1") throw new Error("unexpected envelope");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64")), decipher.final()]).toString("utf8");
}

function encrypt(plaintext) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64"), cipher.getAuthTag().toString("base64"), ciphertext.toString("base64")].join(".");
}

function parseKstInstant(raw) {
  if (!raw) return null;
  const withT = raw.includes("T") ? raw : raw.replace(" ", "T");
  const normalized = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(withT) ? withT : `${withT}+09:00`;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

if (!clientId || !clientSecret) {
  console.log("NO_CLIENT_CREDENTIALS");
  process.exit(0);
}

const pool = new Pool({ connectionString: dbUrl, ssl: { rejectUnauthorized: true }, max: 1 });
const { rows } = await pool.query(
  `select s.id as shop_id, s.mall_id, c.access_expires_at, c.refresh_token, c.refresh_expires_at
   from shops s join shop_credentials c on c.shop_id = s.id
   order by c.updated_at desc limit 1`,
);
if (rows.length === 0) {
  console.log("NO_CREDENTIALS");
  await pool.end();
  process.exit(0);
}
const row = rows[0];
const accessExpires = parseKstInstant(row.access_expires_at);
if (accessExpires && accessExpires.getTime() - 60_000 > Date.now()) {
  console.log("ACCESS_STILL_FRESH until", row.access_expires_at);
  await pool.end();
  process.exit(0);
}
const refreshExpires = parseKstInstant(row.refresh_expires_at);
if (refreshExpires && refreshExpires.getTime() <= Date.now()) {
  console.log("REFRESH_EXPIRED — 앱에서 재인증 필요");
  await pool.end();
  process.exit(0);
}

const refreshToken = decrypt(row.refresh_token);
const res = await fetch(`https://${row.mall_id}.cafe24api.com/api/v2/oauth/token`, {
  method: "POST",
  headers: {
    Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
    "Content-Type": "application/x-www-form-urlencoded",
  },
  body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken }).toString(),
  signal: AbortSignal.timeout(15_000),
});
const text = await res.text();
let payload = null;
try { payload = JSON.parse(text); } catch { /* ignore */ }
if (!res.ok || !payload || typeof payload.access_token !== "string") {
  console.log("REFRESH_FAILED", res.status, String(text).slice(0, 200));
  await pool.end();
  process.exit(0);
}

const scopes = Array.isArray(payload.scopes) ? payload.scopes : [];
await pool.query(
  `update shop_credentials set
     access_token = $2, refresh_token = $3, token_type = $4, scopes = $5, user_id = $6,
     access_expires_at = $7, refresh_expires_at = $8, issued_at = $9, updated_at = now()
   where shop_id = $1`,
  [
    row.shop_id,
    encrypt(payload.access_token),
    encrypt(typeof payload.refresh_token === "string" ? payload.refresh_token : refreshToken),
    typeof payload.token_type === "string" ? payload.token_type : "Bearer",
    scopes,
    typeof payload.user_id === "string" ? payload.user_id : null,
    typeof payload.expires_at === "string" ? payload.expires_at : null,
    typeof payload.refresh_token_expires_at === "string" ? payload.refresh_token_expires_at : null,
    typeof payload.issued_at === "string" ? payload.issued_at : null,
  ],
);
console.log("REFRESHED access until", payload.expires_at, "scopes:", scopes.length);
await pool.end();
