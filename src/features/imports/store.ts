import type { Pool, PoolClient } from "pg";
import type { Db } from "@/lib/cafe24/shop-store";
import type { RowStatus } from "./executor";
import type { RestorePlanRow } from "./restore";
import {
  type ImportIssue,
  type ImportPreview,
  type PreviewCounts,
  type RowVerdict,
  type SupplyCsvFormat,
} from "./model";

type JobRow = {
  id: string;
  shop_id: string;
  status: string;
  file_name: string;
  file_format: string;
  file_hash: string;
  preview_version: number;
  counts: PreviewCounts | null;
  file_issues: ImportIssue[] | null;
  blocked: boolean;
  block_reasons: string[] | null;
  created_at: Date;
  confirmed_at: Date | null;
};

type RowRow = {
  id: string;
  line: number;
  variant_code: string;
  product_no: string | null;
  product_name: string | null;
  option_name: string | null;
  before_price: string | null;
  after_price: string | null;
  verdict: string;
  issues: ImportIssue[] | null;
  status: string;
  result_message: string | null;
};

export interface StoredImportRow {
  id: string;
  line: number;
  variantCode: string;
  productNo: string | null;
  productName: string | null;
  optionName: string | null;
  beforePrice: number | null;
  afterPrice: number | null;
  verdict: RowVerdict;
  issues: ImportIssue[];
  status: RowStatus;
  resultMessage: string | null;
}

export interface ImportJobSummary {
  id: string;
  shopId: string;
  status: string;
  fileName: string;
  format: SupplyCsvFormat;
  fileHash: string;
  previewVersion: number;
  counts: PreviewCounts;
  fileIssues: ImportIssue[];
  blocked: boolean;
  blockReasons: string[];
  createdAt: Date;
  confirmedAt: Date | null;
}

export interface ImportJobDetail extends ImportJobSummary {
  rows: StoredImportRow[];
}

const EMPTY_COUNTS: PreviewCounts = {
  total: 0,
  matched: 0,
  changed: 0,
  unchanged: 0,
  errors: 0,
  warnings: 0,
};

const JOB_COLUMNS =
  "id, shop_id, status, file_name, file_format, file_hash, preview_version, counts, file_issues, blocked, block_reasons, created_at, confirmed_at";
const ROW_COLUMNS =
  "id, line, variant_code, product_no, product_name, option_name, before_price, after_price, verdict, issues, status, result_message";

function toNumber(value: string | null): number | null {
  if (value === null) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function mapRow(row: RowRow): StoredImportRow {
  return {
    id: row.id,
    line: row.line,
    variantCode: row.variant_code,
    productNo: row.product_no,
    productName: row.product_name,
    optionName: row.option_name,
    beforePrice: toNumber(row.before_price),
    afterPrice: toNumber(row.after_price),
    verdict: row.verdict as RowVerdict,
    issues: row.issues ?? [],
    status: row.status as RowStatus,
    resultMessage: row.result_message,
  };
}

function mapJob(row: JobRow): ImportJobSummary {
  return {
    id: row.id,
    shopId: row.shop_id,
    status: row.status,
    fileName: row.file_name,
    format: row.file_format as SupplyCsvFormat,
    fileHash: row.file_hash,
    previewVersion: row.preview_version,
    counts: row.counts ?? EMPTY_COUNTS,
    fileIssues: row.file_issues ?? [],
    blocked: row.blocked,
    blockReasons: row.block_reasons ?? [],
    createdAt: row.created_at,
    confirmedAt: row.confirmed_at,
  };
}

export interface CreateImportJobInput {
  shopId: string;
  preview: ImportPreview;
}

export async function createImportJob(
  pool: Pool,
  input: CreateImportJobInput,
): Promise<string> {
  const { preview } = input;
  const client: PoolClient = await pool.connect();
  try {
    await client.query("begin");
    const job = await client.query<{ id: string }>(
      `insert into import_jobs (
         shop_id, status, file_name, file_format, file_hash, preview_version,
         counts, file_issues, blocked, block_reasons
       ) values ($1, 'preview', $2, $3, $4, $5, $6, $7, $8, $9)
       returning id`,
      [
        input.shopId,
        preview.fileName,
        preview.format,
        preview.fileHash,
        preview.previewVersion,
        JSON.stringify(preview.counts),
        JSON.stringify(preview.fileIssues),
        preview.blocked,
        JSON.stringify(preview.blockReasons),
      ],
    );
    const jobId = job.rows[0].id;
    if (preview.rows.length > 0) {
      const payload = preview.rows.map((row) => ({
        line: row.line,
        variant_code: row.variantCode,
        product_no: row.productNo,
        product_name: row.productName,
        option_name: row.optionName,
        before_price: row.beforePrice,
        after_price: row.afterPrice,
        verdict: row.verdict,
        issues: row.issues,
      }));
      await client.query(
        `insert into import_rows (
           job_id, line, variant_code, product_no, product_name, option_name,
           before_price, after_price, verdict, issues
         )
         select $1, x.line, x.variant_code, x.product_no, x.product_name, x.option_name,
                x.before_price, x.after_price, x.verdict, x.issues
         from jsonb_to_recordset($2::jsonb) as x(
           line int, variant_code text, product_no text, product_name text, option_name text,
           before_price bigint, after_price bigint, verdict text, issues jsonb
         )`,
        [jobId, JSON.stringify(payload)],
      );
    }
    await client.query("commit");
    return jobId;
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function getImportJob(
  db: Db,
  jobId: string,
  shopId: string,
): Promise<ImportJobDetail | null> {
  const job = await db.query<JobRow>(
    `select ${JOB_COLUMNS} from import_jobs where id = $1 and shop_id = $2`,
    [jobId, shopId],
  );
  if (!job.rows[0]) return null;
  const rows = await db.query<RowRow>(
    `select ${ROW_COLUMNS} from import_rows where job_id = $1 order by line asc, variant_code asc`,
    [jobId],
  );
  return { ...mapJob(job.rows[0]), rows: rows.rows.map(mapRow) };
}

export async function listImportJobs(
  db: Db,
  shopId: string,
  limit = 10,
): Promise<ImportJobSummary[]> {
  const result = await db.query<JobRow>(
    `select ${JOB_COLUMNS} from import_jobs where shop_id = $1 order by created_at desc limit $2`,
    [shopId, Math.min(Math.max(limit, 1), 50)],
  );
  return result.rows.map(mapJob);
}

export interface ConfirmImportJobInput {
  fileHash: string;
  previewVersion: number;
}

/** 사용자 확정을 파일 해시·미리보기 버전에 연결한다. 값이 바뀌면 확정되지 않는다. */
export async function confirmImportJob(
  pool: Pool,
  jobId: string,
  shopId: string,
  input: ConfirmImportJobInput,
): Promise<boolean> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const updated = await client.query(
      `update import_jobs
       set status = 'confirmed', confirmed_at = now(), confirmed_file_hash = $3,
           confirmed_preview_version = $4, updated_at = now()
       where id = $1 and shop_id = $2 and status = 'preview'
         and file_hash = $3 and preview_version = $4`,
      [jobId, shopId, input.fileHash, input.previewVersion],
    );
    if (updated.rowCount !== 1) {
      await client.query("rollback");
      return false;
    }
    await client.query(
      `update import_rows set status = 'unchanged'
       where job_id = $1 and verdict = 'unchanged' and status = 'pending'`,
      [jobId],
    );
    await client.query("commit");
    return true;
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export interface ClaimImportJobOptions {
  owner: string;
  leaseMs: number;
}

/** 실행 리스를 잡는다. 다른 인스턴스가 잡고 있으면 false. */
export async function claimImportJob(
  db: Db,
  jobId: string,
  shopId: string,
  options: ClaimImportJobOptions,
): Promise<boolean> {
  const result = await db.query(
    `update import_jobs
     set status = case when status = 'confirmed' then 'running' else status end,
         started_at = coalesce(started_at, now()),
         lease_owner = $3,
         lease_expires_at = now() + ($4::bigint * interval '1 millisecond'),
         updated_at = now()
     where id = $1 and shop_id = $2
       and status in ('confirmed', 'running', 'needs_review', 'partial_failure')
       and (lease_expires_at is null or lease_expires_at < now())`,
    [jobId, shopId, options.owner, options.leaseMs],
  );
  return (result.rowCount ?? 0) === 1;
}

export interface ExecutableStoredRow {
  id: string;
  productNo: string | null;
  variantCode: string;
  beforePrice: number | null;
  targetPrice: number | null;
  status: RowStatus;
}

export async function listExecutableRows(db: Db, jobId: string): Promise<ExecutableStoredRow[]> {
  const result = await db.query<{
    id: string;
    product_no: string | null;
    variant_code: string;
    before_price: string | null;
    after_price: string | null;
    status: string;
  }>(
    `select id, product_no, variant_code, before_price, after_price, status
     from import_rows where job_id = $1 order by line asc, variant_code asc`,
    [jobId],
  );
  return result.rows.map((row) => ({
    id: row.id,
    productNo: row.product_no,
    variantCode: row.variant_code,
    beforePrice: toNumber(row.before_price),
    targetPrice: toNumber(row.after_price),
    status: row.status as RowStatus,
  }));
}

export async function setRowOutcome(
  db: Db,
  rowId: string,
  outcome: { status: RowStatus; message: string | null; observedPrice?: number | null },
): Promise<void> {
  await db.query(
    `update import_rows
     set status = $2, result_message = $3, last_checked_at = now()
     where id = $1`,
    [rowId, outcome.status, outcome.message],
  );
}

export async function insertAttempt(
  db: Db,
  input: {
    jobId: string;
    rowId: string | null;
    kind: string;
    attemptNo: number;
    result: string;
    errorCode: string | null;
    message: string | null;
  },
): Promise<void> {
  await db.query(
    `insert into attempts (job_id, row_id, kind, attempt_no, result, error_code, message, finished_at)
     values ($1, $2, $3, $4, $5, $6, $7, now())`,
    [input.jobId, input.rowId, input.kind, input.attemptNo, input.result, input.errorCode, input.message],
  );
}

export async function countRowStatuses(db: Db, jobId: string): Promise<Record<string, number>> {
  const result = await db.query<{ status: string; count: string }>(
    "select status, count(*)::text as count from import_rows where job_id = $1 group by status",
    [jobId],
  );
  const counts: Record<string, number> = {};
  for (const row of result.rows) counts[row.status] = Number(row.count);
  return counts;
}

export async function finalizeImportJob(
  db: Db,
  jobId: string,
  status: string,
  finished: boolean,
): Promise<void> {
  await db.query(
    `update import_jobs
     set status = $2,
         updated_at = now(),
         finished_at = case when $3 then now() else finished_at end,
         lease_owner = null,
         lease_expires_at = null
     where id = $1`,
    [jobId, status, finished],
  );
}

export interface RestoreSourceRowRecord {
  rowId: string;
  productNo: string | null;
  variantCode: string;
  beforePrice: number | null;
  targetPrice: number | null;
  status: string;
}

export async function listRestoreSourceRows(
  db: Db,
  sourceJobId: string,
): Promise<RestoreSourceRowRecord[]> {
  const result = await db.query<{
    id: string;
    product_no: string | null;
    variant_code: string;
    before_price: string | null;
    after_price: string | null;
    status: string;
  }>(
    `select id, product_no, variant_code, before_price, after_price, status
     from import_rows where job_id = $1 and status = 'success' order by line asc, variant_code asc`,
    [sourceJobId],
  );
  return result.rows.map((row) => ({
    rowId: row.id,
    productNo: row.product_no,
    variantCode: row.variant_code,
    beforePrice: toNumber(row.before_price),
    targetPrice: toNumber(row.after_price),
    status: row.status,
  }));
}

export async function createRestoreJob(
  pool: Pool,
  input: { sourceJobId: string; shopId: string; rows: RestorePlanRow[] },
): Promise<string> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const job = await client.query<{ id: string }>(
      `insert into restore_jobs (source_job_id, shop_id, status)
       values ($1, $2, 'preview') returning id`,
      [input.sourceJobId, input.shopId],
    );
    const restoreJobId = job.rows[0].id;
    for (const row of input.rows) {
      await client.query(
        `insert into restore_rows (
           restore_job_id, source_row_id, variant_code, product_no,
           before_price, target_price, restore_price, current_price, verdict, issues
         ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          restoreJobId,
          row.rowId,
          row.variantCode,
          row.productNo,
          row.beforePrice,
          row.targetPrice,
          row.restorePrice,
          row.currentPrice,
          row.verdict,
          JSON.stringify(row.issues),
        ],
      );
    }
    await client.query("commit");
    return restoreJobId;
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export interface StoredRestoreRow {
  id: string;
  sourceRowId: string;
  variantCode: string;
  productNo: string | null;
  beforePrice: number | null;
  targetPrice: number | null;
  restorePrice: number | null;
  currentPrice: number | null;
  verdict: string;
  issues: ImportIssue[];
  result: string;
  resultMessage: string | null;
}

export interface RestoreJobDetail {
  id: string;
  sourceJobId: string;
  status: string;
  createdAt: Date;
  rows: StoredRestoreRow[];
}

export async function getRestoreJob(
  db: Db,
  restoreJobId: string,
  shopId: string,
): Promise<RestoreJobDetail | null> {
  const job = await db.query<{
    id: string;
    source_job_id: string;
    status: string;
    created_at: Date;
  }>(
    "select id, source_job_id, status, created_at from restore_jobs where id = $1 and shop_id = $2",
    [restoreJobId, shopId],
  );
  if (!job.rows[0]) return null;
  const rows = await db.query<{
    id: string;
    source_row_id: string;
    variant_code: string;
    product_no: string | null;
    before_price: string | null;
    target_price: string | null;
    restore_price: string | null;
    current_price: string | null;
    verdict: string;
    issues: ImportIssue[] | null;
    result: string;
    result_message: string | null;
  }>(
    `select id, source_row_id, variant_code, product_no, before_price, target_price,
            restore_price, current_price, verdict, issues, result, result_message
     from restore_rows where restore_job_id = $1 order by id asc`,
    [restoreJobId],
  );
  return {
    id: job.rows[0].id,
    sourceJobId: job.rows[0].source_job_id,
    status: job.rows[0].status,
    createdAt: job.rows[0].created_at,
    rows: rows.rows.map((row) => ({
      id: row.id,
      sourceRowId: row.source_row_id,
      variantCode: row.variant_code,
      productNo: row.product_no,
      beforePrice: toNumber(row.before_price),
      targetPrice: toNumber(row.target_price),
      restorePrice: toNumber(row.restore_price),
      currentPrice: toNumber(row.current_price),
      verdict: row.verdict,
      issues: row.issues ?? [],
      result: row.result,
      resultMessage: row.result_message,
    })),
  };
}

export async function setRestoreRowResult(
  db: Db,
  rowId: string,
  result: string,
  message: string | null,
): Promise<void> {
  await db.query(
    "update restore_rows set result = $2, result_message = $3 where id = $1",
    [rowId, result, message],
  );
}

export async function finalizeRestoreJob(
  db: Db,
  restoreJobId: string,
  status: string,
): Promise<void> {
  await db.query("update restore_jobs set status = $2, updated_at = now() where id = $1", [
    restoreJobId,
    status,
  ]);
}

export async function confirmRestoreJob(
  db: Db,
  restoreJobId: string,
  shopId: string,
): Promise<boolean> {
  const result = await db.query(
    `update restore_jobs set status = 'confirmed', confirmed_at = now(), updated_at = now()
     where id = $1 and shop_id = $2 and status in ('preview', 'confirmed')`,
    [restoreJobId, shopId],
  );
  return (result.rowCount ?? 0) === 1;
}
