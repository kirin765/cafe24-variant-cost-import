import type { Pool } from "pg";
import { getValidAccessToken } from "@/lib/cafe24/shop-store";
import type { Shop } from "@/lib/cafe24/store-model";
import type { FetchLike } from "@/lib/cafe24/oauth";
import { getVariant, updateVariantSupplyPrice } from "@/lib/cafe24/variants";
import {
  executeRow,
  type ExecutableRow,
  type RowOutcome,
  type VariantWriter,
} from "./executor";
import {
  claimImportJob,
  countRowStatuses,
  finalizeImportJob,
  finalizeRestoreJob,
  getRestoreJob,
  insertAttempt,
  listExecutableRows,
  setRestoreRowResult,
  setRowOutcome,
} from "./store";

export interface RunnerContext {
  pool: Pool;
  shop: Shop;
  clientId: string;
  clientSecret: string;
  encryptionKey: Buffer;
  apiVersion?: string | null;
  fetchImpl?: FetchLike;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  timeBudgetMs?: number;
  maxAttempts?: number;
  leaseMs?: number;
  owner?: string;
  writerFactory?: () => VariantWriter;
}

export async function createRunnerWriter(ctx: RunnerContext): Promise<VariantWriter | null> {
  if (ctx.writerFactory) return ctx.writerFactory();
  const accessToken = await acquireAccessToken(ctx);
  return accessToken ? createWriter(ctx, accessToken) : null;
}

const resolveWriter = createRunnerWriter;

const DEFAULT_TIME_BUDGET_MS = 50_000;
const DEFAULT_MAX_ATTEMPTS = 4;
const DEFAULT_LEASE_MS = 120_000;

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface RunJobResult {
  claimed: boolean;
  processed: number;
  status: string;
  counts: Record<string, number>;
}

function statusFromCounts(counts: Record<string, number>): {
  status: "running" | "needs_review" | "partial_failure" | "completed";
  finished: boolean;
} {
  if ((counts.pending ?? 0) > 0) return { status: "running", finished: false };
  if ((counts.conflict ?? 0) > 0 || (counts.unknown ?? 0) > 0) {
    return { status: "needs_review", finished: true };
  }
  if ((counts.failed ?? 0) > 0) return { status: "partial_failure", finished: true };
  return { status: "completed", finished: true };
}

async function acquireAccessToken(ctx: RunnerContext): Promise<string | null> {
  try {
    return await getValidAccessToken(ctx.pool, {
      shopId: ctx.shop.id,
      mallId: ctx.shop.mallId,
      clientId: ctx.clientId,
      clientSecret: ctx.clientSecret,
      encryptionKey: ctx.encryptionKey,
      fetchImpl: ctx.fetchImpl,
    });
  } catch {
    return null;
  }
}

function createWriter(ctx: RunnerContext, accessToken: string): VariantWriter {
  const base = {
    mallId: ctx.shop.mallId,
    accessToken,
    shopNo: ctx.shop.shopNo,
    apiVersion: ctx.apiVersion ?? null,
    fetchImpl: ctx.fetchImpl,
  };
  return {
    read: async (productNo, variantCode) => {
      const variant = await getVariant({
        ...base,
        product: { productNo, productName: "" },
        variantCode,
      });
      return variant ? variant.supplyPrice : null;
    },
    write: (productNo, variantCode, supplyPrice) =>
      updateVariantSupplyPrice({ ...base, productNo, variantCode, supplyPrice }),
  };
}

export async function runImportJob(
  ctx: RunnerContext,
  jobId: string,
): Promise<RunJobResult> {
  const sleep = ctx.sleep ?? defaultSleep;
  const now = ctx.now ?? Date.now;
  const maxAttempts = ctx.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const timeBudget = ctx.timeBudgetMs ?? DEFAULT_TIME_BUDGET_MS;
  const startedAt = now();

  const claimed = await claimImportJob(ctx.pool, jobId, ctx.shop.id, {
    owner: ctx.owner ?? "runner",
    leaseMs: ctx.leaseMs ?? DEFAULT_LEASE_MS,
  });
  if (!claimed) {
    const counts = await countRowStatuses(ctx.pool, jobId);
    return { claimed: false, processed: 0, status: "not_claimed", counts };
  }

  const writer = await resolveWriter(ctx);
  if (!writer) {
    await finalizeImportJob(ctx.pool, jobId, "needs_review", true);
    const counts = await countRowStatuses(ctx.pool, jobId);
    return { claimed: true, processed: 0, status: "needs_review", counts };
  }

  const rows = (await listExecutableRows(ctx.pool, jobId)).filter(
    (row) => row.status === "pending",
  );

  let processed = 0;
  let stoppedForReauth = false;
  let outOfTime = false;

  for (const row of rows) {
    if (now() - startedAt > timeBudget) {
      outOfTime = true;
      break;
    }
    const executable: ExecutableRow = {
      id: row.id,
      productNo: row.productNo,
      variantCode: row.variantCode,
      beforePrice: row.beforePrice,
      targetPrice: row.targetPrice,
    };

    let attemptNo = 1;
    let final: RowOutcome | null = null;
    for (;;) {
      const outcome = await executeRow(executable, writer);
      await insertAttempt(ctx.pool, {
        jobId,
        rowId: row.id,
        kind: "write",
        attemptNo,
        result: outcome.status,
        errorCode: outcome.errorCode,
        message: outcome.message,
      });
      if (!outcome.retry || attemptNo >= maxAttempts) {
        final = outcome;
        break;
      }
      attemptNo += 1;
      await sleep(Math.min(250 * 2 ** (attemptNo - 2), 4_000));
    }

    if (final) {
      await setRowOutcome(ctx.pool, row.id, {
        status: final.status,
        message: final.message,
        observedPrice: final.observedPrice,
      });
      processed += 1;
      if (final.errorCode === "reauth_required") {
        stoppedForReauth = true;
        break;
      }
    }
  }

  const counts = await countRowStatuses(ctx.pool, jobId);
  const decision = statusFromCounts(counts);
  if (stoppedForReauth) {
    await finalizeImportJob(ctx.pool, jobId, "needs_review", true);
    return { claimed: true, processed, status: "needs_review", counts };
  }
  if (outOfTime || decision.status === "running") {
    await finalizeImportJob(ctx.pool, jobId, "running", false);
    return { claimed: true, processed, status: "running", counts };
  }
  await finalizeImportJob(ctx.pool, jobId, decision.status, decision.finished);
  return { claimed: true, processed, status: decision.status, counts };
}

export interface RunRestoreResult {
  status: string;
  processed: number;
  counts: { completed: number; failed: number; conflict: number; unknown: number };
}

export async function runRestoreJob(
  ctx: RunnerContext,
  restoreJobId: string,
): Promise<RunRestoreResult> {
  const counts = { completed: 0, failed: 0, conflict: 0, unknown: 0 };
  const job = await getRestoreJob(ctx.pool, restoreJobId, ctx.shop.id);
  if (!job) return { status: "not_found", processed: 0, counts };
  await finalizeRestoreJob(ctx.pool, restoreJobId, "running");

  const writer = await resolveWriter(ctx);
  if (!writer) {
    await finalizeRestoreJob(ctx.pool, restoreJobId, "needs_review");
    return { status: "needs_review", processed: 0, counts };
  }

  const targets = job.rows.filter((row) => row.verdict === "restorable" && row.result === "pending");
  for (const row of targets) {
    if (row.restorePrice === null || row.targetPrice === null) continue;
    const executable: ExecutableRow = {
      id: row.id,
      productNo: row.productNo,
      variantCode: row.variantCode,
      beforePrice: row.targetPrice,
      targetPrice: row.restorePrice,
    };
    const outcome = await executeRow(executable, writer);
    await setRestoreRowResult(ctx.pool, row.id, outcome.status, outcome.message);
    if (outcome.status === "success") counts.completed += 1;
    else if (outcome.status === "conflict") counts.conflict += 1;
    else if (outcome.status === "unknown") counts.unknown += 1;
    else counts.failed += 1;
    if (outcome.errorCode === "reauth_required") break;
  }

  const processedCount = counts.completed + counts.failed + counts.conflict + counts.unknown;
  const incomplete = processedCount < targets.length;
  let status = "completed";
  if (incomplete) status = "running";
  else if (counts.conflict > 0 || counts.unknown > 0) status = "needs_review";
  else if (counts.failed > 0) status = "partial_failure";
  await finalizeRestoreJob(ctx.pool, restoreJobId, status);
  return { status, processed: processedCount, counts };
}
