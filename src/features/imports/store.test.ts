import { randomUUID } from "node:crypto";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { getPool, hasDatabaseUrl } from "@/lib/db/pool";
import { runMigrations } from "@/lib/db/migrate";
import { upsertShop } from "@/lib/cafe24/shop-store";
import type { PlatformVariant, ShopRef } from "./model";
import { buildPreview } from "./preview";
import { createImportJob, getImportJob, listImportJobs } from "./store";

const enabled = hasDatabaseUrl();
const describeDb = describe.skipIf(!enabled);

const tenantId = `test-imports-${randomUUID()}`;
const mallId = `testmall${randomUUID().slice(0, 8)}`;

let pool: Pool;
let shopId: string;
let shop: ShopRef;

function variant(variantCode: string, supplyPrice: number | null): PlatformVariant {
  return {
    tenantId,
    mallId,
    productNo: "20",
    productName: "티셔츠",
    variantCode,
    optionName: "Size: M",
    supplyPrice,
    currency: "KRW",
  };
}

describeDb("import store", () => {
  beforeAll(async () => {
    pool = getPool();
    await runMigrations(pool, path.join(process.cwd(), "db", "migrations"));
    const created = await upsertShop(pool, { tenantId, mallId, shopNo: "1", name: "저장몰" });
    shopId = created.id;
    shop = { tenantId, mallId, shopNumber: "1", name: "저장몰", currency: "KRW" };
  });

  afterAll(async () => {
    await pool.query("delete from shops where tenant_id = $1", [tenantId]);
  });

  function previewFor(text: string) {
    return buildPreview({
      shop,
      fileName: "cost.csv",
      text,
      variants: [variant("V1", 1000), variant("V2", null)],
    });
  }

  it("미리보기를 저장하고 같은 몰로만 조회한다", async () => {
    const preview = previewFor("variant_code,supply_price\nV1,2000\nV2,3000\nGHOST,1000\n");
    const jobId = await createImportJob(pool, { shopId, preview });

    const detail = await getImportJob(pool, jobId, shopId);
    expect(detail).not.toBeNull();
    expect(detail?.fileName).toBe("cost.csv");
    expect(detail?.format).toBe("simple");
    expect(detail?.counts).toEqual(preview.counts);
    expect(detail?.counts.changed).toBe(1);
    expect(detail?.counts.errors).toBe(2);
    expect(detail?.blocked).toBe(true);
    expect(detail?.rows).toHaveLength(3);
    const v2 = detail?.rows.find((row) => row.variantCode === "V2");
    expect(v2?.beforePrice).toBeNull();
    expect(v2?.issues.some((issue) => issue.code === "unknown_before_price")).toBe(true);
    expect(v2?.optionName).toBe("Size: M");

    expect(await getImportJob(pool, jobId, randomUUID())).toBeNull();
  });

  it("상품목록 형식도 저장하고 품목 코드 미매칭을 남긴다", async () => {
    const preview = previewFor("상품코드,공급가\nP000000T,1000\n");
    const jobId = await createImportJob(pool, { shopId, preview });
    const detail = await getImportJob(pool, jobId, shopId);
    expect(detail?.format).toBe("cafe24-product");
    expect(detail?.blocked).toBe(true);
    expect(detail?.rows).toHaveLength(1);
    expect(detail?.rows[0].issues.some((issue) => issue.code === "unmatched_code")).toBe(true);
  });

  it("헤더가 잘못된 파일은 파일 오류로 저장된다", async () => {
    const preview = previewFor("상품코드\nP000000T\n");
    const jobId = await createImportJob(pool, { shopId, preview });
    const detail = await getImportJob(pool, jobId, shopId);
    expect(detail?.blocked).toBe(true);
    expect(detail?.fileIssues.length).toBeGreaterThan(0);
    expect(detail?.rows).toHaveLength(0);
  });

  it("최근 작업을 몰 기준으로 나열한다", async () => {
    const preview = previewFor("variant_code,supply_price\nV1,5000\n");
    const jobId = await createImportJob(pool, { shopId, preview });
    const jobs = await listImportJobs(pool, shopId);
    expect(jobs.some((job) => job.id === jobId)).toBe(true);
    expect(await listImportJobs(pool, randomUUID())).toEqual([]);
  });
});
