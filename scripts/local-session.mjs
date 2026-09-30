// 로컬 수동 테스트용 세션 발급 스크립트.
// 가장 최근 자격 증명이 있는 몰에 2시간짜리 세션을 만들고, 브라우저에 넣을 쿠키 값을 출력한다.
// OAuth를 거치지 않고 http://localhost:3000/imports/new 를 열기 위한 용도다. 토큰 원문은 출력하지 않는다.
import crypto from "node:crypto";
import { Pool } from "pg";

const dbUrl = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
const TTL_HOURS = Number(process.env.LOCAL_SESSION_HOURS || "2");

function parseKstInstant(raw) {
  if (!raw) return null;
  const withT = raw.includes("T") ? raw : raw.replace(" ", "T");
  const normalized = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(withT) ? withT : `${withT}+09:00`;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

const pool = new Pool({ connectionString: dbUrl, ssl: { rejectUnauthorized: true }, max: 1 });
const { rows } = await pool.query(
  `select s.id as shop_id, s.mall_id, s.shop_no, c.access_expires_at, c.refresh_expires_at
   from shops s join shop_credentials c on c.shop_id = s.id
   order by c.updated_at desc limit 1`,
);
if (rows.length === 0) {
  console.log("NO_CREDENTIALS — 앱에서 Cafe24 OAuth를 먼저 완료하세요.");
  await pool.end();
  process.exit(0);
}
const shop = rows[0];
const accessExpires = parseKstInstant(shop.access_expires_at);
const refreshExpires = parseKstInstant(shop.refresh_expires_at);
if (refreshExpires && refreshExpires.getTime() <= Date.now()) {
  console.log("REFRESH_EXPIRED — 앱에서 재인증이 필요합니다.");
  await pool.end();
  process.exit(0);
}
if (accessExpires && accessExpires.getTime() <= Date.now()) {
  console.log("ACCESS_EXPIRED — 먼저 토큰을 갱신하세요:");
  console.log("  node --env-file-if-exists=.env.local scripts/token-refresh.mjs");
  await pool.end();
  process.exit(0);
}

const token = crypto.randomBytes(32).toString("base64url");
await pool.query(
  "insert into sessions (id_hash, shop_id, expires_at) values ($1, $2, $3)",
  [crypto.createHash("sha256").update(token).digest("hex"), shop.shop_id, new Date(Date.now() + TTL_HOURS * 3600_000)],
);

console.log("mall:", shop.mall_id, "· shop_no:", shop.shop_no, `· 유효 ${TTL_HOURS}시간`);
console.log("");
console.log("1) 앱 실행:  npm run dev   (또는 npm run build && npm run start)");
console.log("2) 브라우저 개발자도구 > Application > Cookies > http://localhost:3000 에 추가:");
console.log("     Name: cafe24_session");
console.log("     Value:", token);
console.log("     Domain: localhost   Path: /");
console.log("   또는 콘솔에서:  document.cookie=\"cafe24_session=" + token + "; path=/\"");
console.log("3) http://localhost:3000/imports/new 접속");
await pool.end();
