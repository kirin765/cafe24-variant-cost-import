import { randomUUID } from "node:crypto";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { getPool, hasDatabaseUrl } from "@/lib/db/pool";
import { runMigrations } from "@/lib/db/migrate";
import { upsertShop } from "@/lib/cafe24/shop-store";
import type { Shop } from "@/lib/cafe24/store-model";
import { Cafe24ApiError } from "@/lib/cafe24/variants";
import type { VariantWriter } from "./executor";
import type { PlatformVariant, ShopRef } from "./model";
import { buildPreview } from "./preview";
import { planRestore } from "./restore";
import { runImportJob, runRestoreJob, type RunnerContext } from "./runner";
import {
  claimImportJob,
  confirmImportJob,
  createImportJob,
  createRestoreJob,
  getImportJob,
  getRestoreJob,
  listRestoreSourceRows,
} from "./store";

const enabled = hasDatabaseUrl();
const describeDb = describe.skipIf(!enabled);

const tenantId = `test-run-${randomUUID()}`;
const mallId = `testmall${randomUUID().slice(0, 8)}`;
const CSV = "variant_code,supply_price\nV1,2000\nV2,500\n";

class MapWriter implements VariantWriter {
  writes: Array<{ variantCode: string; price: number }> = [];
  pendingErrors: unknown[] = [];
  applyOnError = false;
  failReadWith: unknown = null;

  constructor(public prices: Map<string, number | null>) {}

  async read(_productNo: string, variantCode: string): Promise<number | null> {
    if (this.failReadWith) throw this.failReadWith;
    return this.prices.has(variantCode) ? (this.prices.get(variantCode) ?? null) : null;
  }

  async write(_productNo: string, variantCode: string, price: number): Promise<void> {
    if (this.pendingErrors.length > 0) {
      const error = this.pendingErrors.shift();
      if (this.applyOnError) this.prices.set(variantCode, price);
      if (error) throw error;
    }
    this.writes.push({ variantCode, price });
    this.prices.set(variantCode, price);
  }
}

let pool: Pool;
let shop: Shop;
let shopRef: ShopRef;

function variant(variantCode: string, supplyPrice: number | null): PlatformVariant {
  return {
    tenantId,
    mallId,
    productNo: "20",
    productName: "티셔츠",
    variantCode,
    optionName: "기본",
    supplyPrice,
    currency: "KRW",
  };
}

async function newConfirmedJob(): Promise<string> {
  const preview = buildPreview({
    shop: shopRef,
    fileName: "cost.csv",
    text: CSV,
    variants: [variant("V1", 1000), variant("V2", 500)],
  });
  const jobId = await createImportJob(pool, { shopId: shop.id, preview });
  const confirmed = await confirmImportJob(pool, jobId, shop.id, {
    fileHash: preview.fileHash,
    previewVersion: preview.previewVersion,
  });
  expect(confirmed).toBe(true);
  return jobId;
}

function runnerContext(writer: VariantWriter): RunnerContext {
  return {
    pool,
    shop,
    clientId: "client",
    clientSecret: "secret",
    encryptionKey: Buffer.alloc(32),
    writerFactory: () => writer,
    sleep: async () => undefined,
    maxAttempts: 4,
    timeBudgetMs: 60_000,
    leaseMs: 5_000,
  };
}

describeDb("import runner", () => {
  beforeAll(async () => {
    pool = getPool();
    await runMigrations(pool, path.join(process.cwd(), "db", "migrations"));
    shop = await upsertShop(pool, { tenantId, mallId, shopNo: "1", name: "실행몰" });
    shopRef = { tenantId, mallId, shopNumber: "1", name: "실행몰", currency: "KRW" };
  });

  afterAll(async () => {
    await pool.query("delete from shops where tenant_id = $1", [tenantId]);
  });

  it("확정 후 실행하면 쓰기·재조회로 성공을 확정한다", async () => {
    const jobId = await newConfirmedJob();
    const writer = new MapWriter(new Map([["V1", 1000], ["V2", 500]]));
    const result = await runImportJob(runnerContext(writer), jobId);
    expect(result.claimed).toBe(true);
    expect(result.status).toBe("completed");
    expect(writer.writes).toEqual([{ variantCode: "V1", price: 2000 }]);

    const detail = await getImportJob(pool, jobId, shop.id);
    expect(detail?.status).toBe("completed");
    const v1 = detail?.rows.find((row) => row.variantCode === "V1");
    expect(v1?.status).toBe("success");
    const v2 = detail?.rows.find((row) => row.variantCode === "V2");
    expect(v2?.status).toBe("unchanged");
  });

  it("미리보기 이후 값이 바뀌면 충돌로 남긴다", async () => {
    const jobId = await newConfirmedJob();
    const writer = new MapWriter(new Map([["V1", 1500], ["V2", 500]]));
    const result = await runImportJob(runnerContext(writer), jobId);
    expect(result.status).toBe("needs_review");
    expect(writer.writes).toEqual([]);
    const detail = await getImportJob(pool, jobId, shop.id);
    expect(detail?.rows.find((row) => row.variantCode === "V1")?.status).toBe("conflict");
  });

  it("429는 백오프 후 재시도해 성공한다", async () => {
    const jobId = await newConfirmedJob();
    const writer = new MapWriter(new Map([["V1", 1000], ["V2", 500]]));
    writer.pendingErrors = [new Cafe24ApiError(429, "limit"), new Cafe24ApiError(429, "limit")];
    const result = await runImportJob(runnerContext(writer), jobId);
    expect(result.status).toBe("completed");
    expect(writer.writes).toEqual([{ variantCode: "V1", price: 2000 }]);
  });

  it("timeout 뒤 이미 반영됐으면 성공으로 기록한다", async () => {
    const jobId = await newConfirmedJob();
    const writer = new MapWriter(new Map([["V1", 1000], ["V2", 500]]));
    writer.pendingErrors = [new TypeError("fetch failed")];
    writer.applyOnError = true;
    const result = await runImportJob(runnerContext(writer), jobId);
    expect(result.status).toBe("completed");
    const detail = await getImportJob(pool, jobId, shop.id);
    expect(detail?.rows.find((row) => row.variantCode === "V1")?.status).toBe("success");
  });

  it("권한 철회면 실행을 멈추고 재검토로 남긴다", async () => {
    const jobId = await newConfirmedJob();
    const writer = new MapWriter(new Map([["V1", 1000]]));
    writer.failReadWith = new Cafe24ApiError(401, "unauthorized");
    const result = await runImportJob(runnerContext(writer), jobId);
    expect(result.status).toBe("needs_review");
    const detail = await getImportJob(pool, jobId, shop.id);
    expect(detail?.rows.find((row) => row.variantCode === "V1")?.status).toBe("failed");
  });

  it("다른 인스턴스가 리스를 잡고 있으면 실행하지 않는다", async () => {
    const jobId = await newConfirmedJob();
    const held = await claimImportJob(pool, jobId, shop.id, { owner: "first", leaseMs: 5_000 });
    expect(held).toBe(true);
    const writer = new MapWriter(new Map([["V1", 1000], ["V2", 500]]));
    const second = await runImportJob({ ...runnerContext(writer), owner: "other" }, jobId);
    expect(second.claimed).toBe(false);
    expect(second.status).toBe("not_claimed");
    expect(writer.writes).toEqual([]);
  });

  it("복원 계획을 실행해 이전 값으로 되돌린다", async () => {
    const jobId = await newConfirmedJob();
    const writer = new MapWriter(new Map([["V1", 1000], ["V2", 500]]));
    await runImportJob(runnerContext(writer), jobId);
    expect(writer.prices.get("V1")).toBe(2000);

    const sourceRows = await listRestoreSourceRows(pool, jobId);
    const currents = new Map(sourceRows.map((row) => [row.rowId, writer.prices.get(row.variantCode) ?? null]));
    const plan = planRestore(sourceRows, currents);
    expect(plan.every((row) => row.verdict === "restorable")).toBe(true);

    const restoreJobId = await createRestoreJob(pool, { sourceJobId: jobId, shopId: shop.id, rows: plan });
    const result = await runRestoreJob(runnerContext(writer), restoreJobId);
    expect(result.counts.completed).toBe(1);
    expect(writer.prices.get("V1")).toBe(1000);

    const detail = await getRestoreJob(pool, restoreJobId, shop.id);
    expect(detail?.rows[0].result).toBe("success");
  });

  it("복원 전 외부 변경은 충돌로 남기고 실행하지 않는다", async () => {
    const jobId = await newConfirmedJob();
    const writer = new MapWriter(new Map([["V1", 1000], ["V2", 500]]));
    await runImportJob(runnerContext(writer), jobId);
    writer.prices.set("V1", 7777);

    const sourceRows = await listRestoreSourceRows(pool, jobId);
    const currents = new Map(sourceRows.map((row) => [row.rowId, writer.prices.get(row.variantCode) ?? null]));
    const plan = planRestore(sourceRows, currents);
    expect(plan[0].verdict).toBe("conflict");

    const restoreJobId = await createRestoreJob(pool, { sourceJobId: jobId, shopId: shop.id, rows: plan });
    const before = writer.prices.get("V1");
    await runRestoreJob(runnerContext(writer), restoreJobId);
    expect(writer.prices.get("V1")).toBe(before);
    const detail = await getRestoreJob(pool, restoreJobId, shop.id);
    expect(detail?.rows[0].result).toBe("pending");
  });
});
