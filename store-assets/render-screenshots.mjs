// store-assets/render-screenshots.mjs
// 카페24 스토어 등록 폼의 스크린샷 규격에 맞춘 이미지를 만든다.
//   PC     : 1920x1080 (1MB 이하, 3장 이상 권장)  ← 1280x720 뷰포트 @1.5x
//   Mobile : 360x640  (1MB 이하, 3장 이상 권장)   ← 360x640 뷰포트 @1x
//
// 실제 앱 화면(/imports/*)을 앱 전용 Postgres에 합성 데이터를 심어 촬영한다.
// 실제 몰 정보·토큰·원가 원본은 들어가지 않는다(시드는 스크립트가 만들고 끝나면 지운다).
//
//   1) npm run db:migrate
//   2) npm run build && IMPORT_WRITE_ENABLED=true npx next start -p 3999
//   3) BASE_URL=http://127.0.0.1:3999 node store-assets/render-screenshots.mjs
import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const { chromium } = await import("playwright-core");
const { Pool } = await import("pg");

const here = fileURLToPath(new URL(".", import.meta.url));
const root = path.resolve(here, "..");
const outDir = path.join(here, "screenshots");
mkdirSync(outDir, { recursive: true });

const BASE = (process.env.BASE_URL ?? "http://127.0.0.1:3999").replace(/\/+$/, "");
const CHROMIUM = process.env.CHROMIUM_PATH ?? "/usr/bin/chromium";

function readEnvFile(file) {
  const values = {};
  if (!existsSync(file)) return values;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (!match) continue;
    const quoted = /^(['"])(.*)\1$/.exec(match[2]);
    values[match[1]] = quoted ? quoted[2] : match[2];
  }
  return values;
}

const env = { ...readEnvFile(path.join(root, ".env.local")), ...process.env };
const connectionString = env.DATABASE_URL_UNPOOLED ?? env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL(또는 DATABASE_URL_UNPOOLED)이 없습니다. .env.local을 확인하세요.");
  process.exit(1);
}

const pool = new Pool({ connectionString, max: 2 });
const tenantIds = [];

async function seedShopAndSession(mallId) {
  const tenantId = `shot-${randomUUID()}`;
  const shop = await pool.query(
    `insert into shops (tenant_id, mall_id, shop_no, name, currency)
     values ($1, $2, '1', $3, 'KRW') returning id`,
    [tenantId, mallId, mallId],
  );
  tenantIds.push(tenantId);
  const shopId = shop.rows[0].id;
  await pool.query(
    `insert into shop_credentials
       (shop_id, access_token, refresh_token, token_type, scopes, user_id,
        access_expires_at, refresh_expires_at, issued_at)
     values ($1, 'v1.seed.seed.seed', 'v1.seed.seed.seed', 'Bearer', $2, $3, $4, $5, $6)`,
    [
      shopId,
      ["mall.read_product", "mall.write_product", "mall.read_store"],
      mallId,
      "2027-01-01 00:00:00",
      "2027-06-01 00:00:00",
      "2026-09-21 10:00:00",
    ],
  );
  const token = randomBytes(32).toString("base64url");
  await pool.query("insert into sessions (id_hash, shop_id, expires_at) values ($1, $2, $3)", [
    createHash("sha256").update(token).digest("hex"),
    shopId,
    new Date(Date.now() + 3_600_000),
  ]);
  return { shopId, token };
}

async function seedJob(shopId, input) {
  const counts = input.counts ?? {
    total: 0,
    matched: 0,
    changed: 0,
    unchanged: 0,
    errors: 0,
    warnings: 0,
  };
  const job = await pool.query(
    `insert into import_jobs (
       shop_id, status, file_name, file_format, file_hash, preview_version,
       counts, file_issues, blocked, block_reasons
     ) values ($1, $2, $3, $4, $5, 1, $6, '[]'::jsonb, $7, $8)
     returning id`,
    [
      shopId,
      input.status ?? "preview",
      input.fileName,
      input.format ?? "simple",
      "hash-" + randomUUID(),
      JSON.stringify(counts),
      input.blocked ?? false,
      JSON.stringify(input.blockReasons ?? []),
    ],
  );
  const jobId = job.rows[0].id;
  for (const row of input.rows ?? []) {
    await pool.query(
      `insert into import_rows (
         job_id, line, variant_code, product_no, product_name, option_name,
         before_price, after_price, verdict, issues, status, result_message
       ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        jobId,
        row.line,
        row.variantCode,
        row.productNo ?? null,
        row.productName ?? null,
        row.optionName ?? null,
        row.beforePrice ?? null,
        row.afterPrice ?? null,
        row.verdict,
        JSON.stringify(row.issues ?? []),
        row.status ?? "pending",
        row.resultMessage ?? null,
      ],
    );
  }
  return jobId;
}

async function seedRestoreJob(sourceJobId, shopId) {
  const sourceRows = await pool.query(
    `select id, variant_code, product_no, before_price, after_price
     from import_rows where job_id = $1 order by line`,
    [sourceJobId],
  );
  const job = await pool.query(
    "insert into restore_jobs (source_job_id, shop_id, status) values ($1, $2, 'preview') returning id",
    [sourceJobId, shopId],
  );
  const restoreJobId = job.rows[0].id;
  const rows = [
    { row: sourceRows.rows[0], current: sourceRows.rows[0].after_price, verdict: "restorable" },
    { row: sourceRows.rows[1], current: 5600, verdict: "conflict" },
    { row: sourceRows.rows[2], current: sourceRows.rows[2].after_price, verdict: "restorable" },
  ];
  for (const entry of rows) {
    const issues =
      entry.verdict === "conflict"
        ? [
            {
              code: "restore_conflict",
              severity: "warning",
              message: "현재 값이 작업 목표값과 달라 자동 복원하지 않습니다.",
            },
          ]
        : [];
    await pool.query(
      `insert into restore_rows (
         restore_job_id, source_row_id, variant_code, product_no,
         before_price, target_price, restore_price, current_price, verdict, issues, result
       ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'pending')`,
      [
        restoreJobId,
        entry.row.id,
        entry.row.variant_code,
        entry.row.product_no,
        entry.row.before_price,
        entry.row.after_price,
        entry.row.before_price,
        entry.current,
        entry.verdict,
        JSON.stringify(issues),
      ],
    );
  }
  return restoreJobId;
}

const TEE = { productNo: "101", productName: "베이직 라운드 티셔츠" };
const SOCK = { productNo: "310", productName: "골지 크루 삭스" };

async function main() {
  const migrated = await pool.query("select to_regclass('public.shops') as t");
  if (!migrated.rows[0].t) {
    throw new Error("DB 스키마가 없습니다. 먼저 `npm run db:migrate`를 실행하세요.");
  }

  const seed = await seedShopAndSession("onnurimun");

  const jobPreview = await seedJob(seed.shopId, {
    fileName: "supplier-cost-2026-09.csv",
    counts: { total: 6, matched: 6, changed: 3, unchanged: 3, errors: 0, warnings: 1 },
    rows: [
      { line: 2, variantCode: "P0000ABC000A", ...TEE, optionName: "Size: M / Color: 화이트", beforePrice: 4500, afterPrice: 5200, verdict: "changed" },
      { line: 3, variantCode: "P0000ABC000B", ...TEE, optionName: "Size: L / Color: 화이트", beforePrice: 4500, afterPrice: 5200, verdict: "changed" },
      { line: 4, variantCode: "P0000DEF000A", productNo: "205", productName: "오버핏 후드 집업", optionName: "Color: 네이비", beforePrice: 8200, afterPrice: 8900, verdict: "changed" },
      { line: 5, variantCode: "P0000GHI000A", ...SOCK, optionName: "FREE", beforePrice: 1200, afterPrice: 1200, verdict: "unchanged" },
      { line: 6, variantCode: "P0000GHI000B", ...SOCK, optionName: "250", beforePrice: 1200, afterPrice: 1200, verdict: "unchanged" },
      { line: 7, variantCode: "P0000JKL000A", productNo: "405", productName: "레더 키링", optionName: "기본", beforePrice: 0, afterPrice: 0, verdict: "unchanged", issues: [{ code: "zero_price", severity: "warning", message: "공급가 0원이 명시적으로 입력되었습니다." }] },
    ],
  });

  const jobErrors = await seedJob(seed.shopId, {
    fileName: "supplier-cost-errors.csv",
    counts: { total: 5, matched: 2, changed: 1, unchanged: 1, errors: 3, warnings: 0 },
    blocked: true,
    blockReasons: ["오류 행이 3개 있어 전체 확정을 막습니다."],
    rows: [
      { line: 2, variantCode: "P0000ABC000A", ...TEE, optionName: "Size: M", beforePrice: 4500, afterPrice: 5200, verdict: "changed" },
      { line: 3, variantCode: "P0000GHI000A", ...SOCK, optionName: "FREE", beforePrice: 1200, afterPrice: 1200, verdict: "unchanged" },
      { line: 4, variantCode: "GHOST-404", verdict: "error", issues: [{ code: "unmatched_code", severity: "error", message: "품목 코드 GHOST-404를 찾지 못했습니다." }] },
      { line: 5, variantCode: "", verdict: "error", issues: [{ code: "empty_code", severity: "error", message: "variant_code가 비어 있습니다." }] },
      { line: 6, variantCode: "P0000ABC000A", verdict: "error", issues: [{ code: "duplicate_code", severity: "error", message: "같은 variant_code가 두 번 이상 있습니다." }] },
    ],
  });

  const jobRun = await seedJob(seed.shopId, {
    fileName: "supplier-cost-2026-09.csv",
    status: "partial_failure",
    counts: { total: 5, matched: 5, changed: 5, unchanged: 0, errors: 0, warnings: 0 },
    rows: [
      { line: 2, variantCode: "P0000ABC000A", ...TEE, optionName: "Size: M", beforePrice: 4500, afterPrice: 5200, verdict: "changed", status: "success", resultMessage: "반영 확인됨" },
      { line: 3, variantCode: "P0000ABC000B", ...TEE, optionName: "Size: L", beforePrice: 4500, afterPrice: 5200, verdict: "changed", status: "success", resultMessage: "반영 확인됨" },
      { line: 4, variantCode: "P0000DEF000A", productNo: "205", productName: "오버핏 후드 집업", optionName: "Color: 네이비", beforePrice: 8200, afterPrice: 8900, verdict: "changed", status: "success", resultMessage: "반영 확인됨" },
      { line: 5, variantCode: "P0000GHI000A", ...SOCK, optionName: "FREE", beforePrice: 1200, afterPrice: 1500, verdict: "changed", status: "conflict", resultMessage: "현재 값이 1,350원이라 쓰지 않음" },
      { line: 6, variantCode: "P0000JKL000A", productNo: "405", productName: "레더 키링", optionName: "기본", beforePrice: 3000, afterPrice: 3500, verdict: "changed", status: "unknown", resultMessage: "응답 유실, 재조회로 판단 필요" },
    ],
  });

  const sourceJob = await seedJob(seed.shopId, {
    fileName: "supplier-cost-2026-09.csv",
    status: "completed",
    counts: { total: 3, matched: 3, changed: 3, unchanged: 0, errors: 0, warnings: 0 },
    rows: [
      { line: 2, variantCode: "P0000ABC000A", ...TEE, optionName: "Size: M", beforePrice: 4500, afterPrice: 5200, verdict: "changed", status: "success", resultMessage: "반영 확인됨" },
      { line: 3, variantCode: "P0000ABC000B", ...TEE, optionName: "Size: L", beforePrice: 4500, afterPrice: 5200, verdict: "changed", status: "success", resultMessage: "반영 확인됨" },
      { line: 4, variantCode: "P0000DEF000A", productNo: "205", productName: "오버핏 후드 집업", optionName: "Color: 네이비", beforePrice: 8200, afterPrice: 8900, verdict: "changed", status: "success", resultMessage: "반영 확인됨" },
    ],
  });
  const restoreJobId = await seedRestoreJob(sourceJob, seed.shopId);

  const browser = await chromium.launch({ executablePath: CHROMIUM, headless: true });
  try {
    const shoot = async (page, name) => {
      const file = path.join(outDir, name);
      await page.screenshot({ path: file });
      const kb = statSync(file).size / 1024;
      console.log(`${name}  ${kb.toFixed(0)}KB${kb > 1024 ? "  ⚠ 1MB 초과" : ""}`);
    };

    const shot = async (context, pathname, name, scrollTo) => {
      const page = await context.newPage();
      await page.goto(`${BASE}${pathname}`, { waitUntil: "networkidle" });
      if (scrollTo) {
        const target = page.locator(scrollTo).first();
        await target.waitFor({ state: "attached" });
        await target.evaluate((element) => {
          const top = element.getBoundingClientRect().top + window.scrollY;
          window.scrollTo(0, Math.max(0, top - 14));
        });
      }
      await page.waitForTimeout(300);
      await shoot(page, name);
      await page.close();
    };

    const cookie = { name: "cafe24_session", value: seed.token, url: BASE };

    // ── PC 1920×1080 (1280×720 @1.5x) ─────────────────────────
    const pc = await browser.newContext({
      viewport: { width: 1280, height: 720 },
      deviceScaleFactor: 1.5,
      locale: "ko-KR",
    });
    await pc.addCookies([cookie]);
    await shot(pc, "/imports/new", "pc-01-new.png");
    await shot(pc, `/imports/${jobPreview}/preview`, "pc-02-preview.png");
    await shot(pc, `/imports/${jobErrors}/preview`, "pc-03-errors.png");
    await shot(pc, `/imports/${jobRun}`, "pc-04-run.png");
    await shot(pc, `/imports/${sourceJob}/restore?rid=${restoreJobId}`, "pc-05-restore.png");
    await pc.close();

    // ── Mobile 360×640 (1x) ───────────────────────────────────
    const mobile = await browser.newContext({
      viewport: { width: 360, height: 640 },
      locale: "ko-KR",
    });
    await mobile.addCookies([cookie]);
    await shot(mobile, `/imports/${jobPreview}/preview`, "mobile-01-preview.png");
    await shot(mobile, `/imports/${jobErrors}/preview`, "mobile-02-errors.png", "h2:has-text('확정할 수 없습니다')");
    await shot(mobile, "/imports/new", "mobile-03-new.png");
    await shot(mobile, `/imports/${jobRun}`, "mobile-04-run.png");
    await mobile.close();
  } finally {
    await browser.close();
  }
}

try {
  await main();
  console.log("done");
} finally {
  for (const tenantId of tenantIds.splice(0)) {
    await pool.query("delete from shops where tenant_id = $1", [tenantId]);
  }
  await pool.end();
}
