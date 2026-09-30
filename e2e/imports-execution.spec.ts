import path from "node:path";
import { expect, test } from "@playwright/test";
import type { Pool } from "pg";
import { runMigrations } from "../src/lib/db/migrate";
import {
  cleanupTenants,
  createTestPool,
  dbEnabled,
  seedImportJob,
  seedRestoreJob,
  seedShopAndSession,
  sessionCookie,
} from "./db-utils";

let pool: Pool;
const seededTenants: string[] = [];

test.describe("imports 실행·복원 화면 (쓰기 비활성)", () => {
  test.skip(!dbEnabled, "DATABASE_URL이 있는 로컬 실행에서만 검증한다");

  test.beforeAll(async () => {
    pool = createTestPool();
    await runMigrations(pool, path.join(process.cwd(), "db", "migrations"));
  });

  test.afterAll(async () => {
    await pool.end();
  });

  test.afterEach(async () => {
    await cleanupTenants(pool, seededTenants);
  });

  async function seeded(mallId: string) {
    const seed = await seedShopAndSession(pool, mallId);
    seededTenants.push(seed.tenantId);
    return seed;
  }

  test("작업 페이지가 상태와 행별 결과를 보여준다", async ({ page, context }) => {
    const seed = await seeded("jobmall");
    const jobId = await seedImportJob(pool, seed.shopId, {
      fileName: "cost.csv",
      status: "confirmed",
      counts: { total: 4, matched: 4, changed: 2, unchanged: 1, errors: 0, warnings: 0 },
      rows: [
        {
          line: 2,
          variantCode: "V1",
          productNo: "20",
          productName: "티셔츠",
          beforePrice: 1000,
          afterPrice: 2000,
          verdict: "changed",
          status: "success",
        },
        {
          line: 3,
          variantCode: "V2",
          productNo: "20",
          productName: "티셔츠",
          beforePrice: 1000,
          afterPrice: 2000,
          verdict: "changed",
          status: "pending",
        },
        {
          line: 4,
          variantCode: "V3",
          productNo: "20",
          productName: "티셔츠",
          beforePrice: 1000,
          afterPrice: 2000,
          verdict: "changed",
          status: "conflict",
        },
        {
          line: 5,
          variantCode: "V4",
          productNo: "20",
          productName: "티셔츠",
          beforePrice: 1000,
          afterPrice: 1000,
          verdict: "unchanged",
          status: "unchanged",
        },
      ],
    });
    await context.addCookies([sessionCookie(seed.token)]);

    await page.goto(`/imports/${jobId}`);
    await expect(page.getByTestId("job-status")).toHaveText("확정됨");
    await expect(page.getByTestId("row-status-V1")).toHaveText("성공");
    await expect(page.getByTestId("row-status-V3")).toHaveText("충돌");
    await expect(page.getByTestId("count-success")).toHaveText("1");
    await expect(page.getByTestId("count-conflict")).toHaveText("1");
    await expect(page.getByTestId("write-disabled")).toBeVisible();
    await expect(page.getByRole("button", { name: "실행" })).toBeDisabled();
  });

  test("쓰기가 비활성이면 확정·실행을 막는다", async ({ page }) => {
    const seed = await seeded("gatemail");
    const jobId = await seedImportJob(pool, seed.shopId, {
      fileName: "cost.csv",
      status: "preview",
      rows: [
        {
          line: 2,
          variantCode: "V1",
          beforePrice: 1000,
          afterPrice: 2000,
          verdict: "changed",
          status: "pending",
        },
      ],
    });
    await page.context().addCookies([sessionCookie(seed.token)]);

    const confirm = await page.request.post(`/api/imports/${jobId}/confirm`, {
      maxRedirects: 0,
    });
    expect(confirm.status()).toBe(303);
    expect(new URL(confirm.headers()["location"], "http://localhost").searchParams.get("error")).toBe(
      "write_disabled",
    );

    const run = await page.request.post(`/api/imports/${jobId}/run`, { maxRedirects: 0 });
    expect(run.status()).toBe(303);
    expect(new URL(run.headers()["location"], "http://localhost").searchParams.get("error")).toBe(
      "write_disabled",
    );
  });

  test("복원 페이지가 복원 가능·충돌을 구분한다", async ({ page, context }) => {
    const seed = await seeded("restoremall");
    const jobId = await seedImportJob(pool, seed.shopId, {
      fileName: "cost.csv",
      status: "completed",
      counts: { total: 2, matched: 2, changed: 2, unchanged: 0, errors: 0, warnings: 0 },
      rows: [
        {
          line: 2,
          variantCode: "V1",
          productNo: "20",
          beforePrice: 1000,
          afterPrice: 2000,
          verdict: "changed",
          status: "success",
        },
        {
          line: 3,
          variantCode: "V2",
          productNo: "20",
          beforePrice: 1000,
          afterPrice: 2000,
          verdict: "changed",
          status: "success",
        },
      ],
    });
    const sourceRows = await pool.query<{ id: string; variant_code: string }>(
      "select id, variant_code from import_rows where job_id = $1 order by line",
      [jobId],
    );
    const [v1, v2] = sourceRows.rows;
    const restoreJobId = await seedRestoreJob(pool, jobId, seed.shopId, [
      {
        sourceRowId: v1.id,
        variantCode: v1.variant_code,
        productNo: "20",
        beforePrice: 1000,
        targetPrice: 2000,
        restorePrice: 1000,
        currentPrice: 2000,
        verdict: "restorable",
      },
      {
        sourceRowId: v2.id,
        variantCode: v2.variant_code,
        productNo: "20",
        beforePrice: 1000,
        targetPrice: 2000,
        restorePrice: 1000,
        currentPrice: 7777,
        verdict: "conflict",
      },
    ]);
    await context.addCookies([sessionCookie(seed.token)]);

    await page.goto(`/imports/${jobId}/restore?rid=${restoreJobId}`);
    await expect(page.getByTestId("restore-ready")).toHaveText("1");
    await expect(page.getByRole("cell", { name: "복원 가능" })).toBeVisible();
    await expect(page.getByRole("cell", { name: "충돌" })).toBeVisible();
    await expect(page.getByTestId("write-disabled")).toBeVisible();
    await expect(page.getByRole("button", { name: /복원 실행/ })).toBeDisabled();
  });

  test("다른 몰의 작업 페이지는 열 수 없다", async ({ page, context }) => {
    const owner = await seeded("jobowner");
    const intruder = await seeded("jobintruder");
    const jobId = await seedImportJob(pool, owner.shopId, { fileName: "owned.csv" });
    await context.addCookies([sessionCookie(intruder.token)]);
    await page.goto(`/imports/${jobId}`);
    await expect(page.getByRole("heading", { name: "작업을 찾을 수 없습니다" })).toBeVisible();
  });
});
