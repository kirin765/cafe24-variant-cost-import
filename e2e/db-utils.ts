import { createHash, randomBytes, randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { Pool } from "pg";
import { buildPoolConfig } from "../src/lib/db/pool";

export function readEnvFile(file: string): Record<string, string> {
  const values: Record<string, string> = {};
  if (!existsSync(file)) return values;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (!match) continue;
    const quoted = /^(['"])(.*)\1$/.exec(match[2]);
    values[match[1]] = quoted ? quoted[2] : match[2];
  }
  return values;
}

const fileEnv = readEnvFile(".env.local");

export const connectionString =
  fileEnv.DATABASE_URL_UNPOOLED ??
  fileEnv.DATABASE_URL ??
  process.env.DATABASE_URL_UNPOOLED ??
  process.env.DATABASE_URL;

export const dbEnabled = Boolean(connectionString) && !process.env.E2E_BASE_URL;

export function createTestPool(): Pool {
  return new Pool(buildPoolConfig(connectionString as string, 2));
}

export function sessionCookie(token: string) {
  return { name: "cafe24_session", value: token, domain: "localhost", path: "/" };
}

export interface SeededSession {
  tenantId: string;
  token: string;
  shopId: string;
}

export async function seedShopAndSession(
  pool: Pool,
  mallId: string,
  options: { expired?: boolean; shopNo?: string } = {},
): Promise<SeededSession> {
  const tenantId = `e2e-${randomUUID()}`;
  const shopNo = options.shopNo ?? "1";
  const shop = await pool.query<{ id: string }>(
    `insert into shops (tenant_id, mall_id, shop_no, name, currency)
     values ($1, $2, $3, $4, 'KRW') returning id`,
    [tenantId, mallId, shopNo, mallId],
  );
  const token = randomBytes(32).toString("base64url");
  await pool.query("insert into sessions (id_hash, shop_id, expires_at) values ($1, $2, $3)", [
    createHash("sha256").update(token).digest("hex"),
    shop.rows[0].id,
    new Date(Date.now() + (options.expired ? -60_000 : 3_600_000)),
  ]);
  return { tenantId, token, shopId: shop.rows[0].id };
}

export interface SeedRowInput {
  line: number;
  variantCode: string;
  productNo?: string | null;
  productName?: string | null;
  optionName?: string | null;
  beforePrice?: number | null;
  afterPrice?: number | null;
  verdict: "changed" | "unchanged" | "error";
  status?: string;
  resultMessage?: string | null;
  issues?: unknown[];
}

export interface SeedJobInput {
  fileName: string;
  format?: string;
  status?: string;
  counts?: Record<string, number>;
  fileIssues?: unknown[];
  blocked?: boolean;
  blockReasons?: string[];
  rows?: SeedRowInput[];
}

export async function seedImportJob(
  pool: Pool,
  shopId: string,
  input: SeedJobInput,
): Promise<string> {
  const counts = input.counts ?? { total: 0, matched: 0, changed: 0, unchanged: 0, errors: 0, warnings: 0 };
  const job = await pool.query<{ id: string }>(
    `insert into import_jobs (
       shop_id, status, file_name, file_format, file_hash, preview_version,
       counts, file_issues, blocked, block_reasons
     ) values ($1, $2, $3, $4, $5, 1, $6, $7, $8, $9)
     returning id`,
    [
      shopId,
      input.status ?? "preview",
      input.fileName,
      input.format ?? "simple",
      "hash-" + randomUUID(),
      JSON.stringify(counts),
      JSON.stringify(input.fileIssues ?? []),
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

export interface SeedRestoreRowInput {
  sourceRowId: string;
  variantCode: string;
  productNo?: string | null;
  beforePrice?: number | null;
  targetPrice?: number | null;
  restorePrice?: number | null;
  currentPrice?: number | null;
  verdict: "restorable" | "conflict" | "error";
  issues?: unknown[];
  result?: string;
}

export async function seedRestoreJob(
  pool: Pool,
  sourceJobId: string,
  shopId: string,
  rows: SeedRestoreRowInput[],
): Promise<string> {
  const job = await pool.query<{ id: string }>(
    `insert into restore_jobs (source_job_id, shop_id, status)
     values ($1, $2, 'preview') returning id`,
    [sourceJobId, shopId],
  );
  const restoreJobId = job.rows[0].id;
  for (const row of rows) {
    await pool.query(
      `insert into restore_rows (
         restore_job_id, source_row_id, variant_code, product_no,
         before_price, target_price, restore_price, current_price, verdict, issues, result
       ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        restoreJobId,
        row.sourceRowId,
        row.variantCode,
        row.productNo ?? null,
        row.beforePrice ?? null,
        row.targetPrice ?? null,
        row.restorePrice ?? null,
        row.currentPrice ?? null,
        row.verdict,
        JSON.stringify(row.issues ?? []),
        row.result ?? "pending",
      ],
    );
  }
  return restoreJobId;
}

export async function cleanupTenants(pool: Pool, tenantIds: string[]): Promise<void> {
  for (const tenantId of tenantIds.splice(0)) {
    await pool.query("delete from shops where tenant_id = $1", [tenantId]);
  }
}
