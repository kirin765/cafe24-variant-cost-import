import path from "node:path";
import { expect, test } from "@playwright/test";
import type { Pool } from "pg";
import { runMigrations } from "../src/lib/db/migrate";
import {
  cleanupTenants,
  createTestPool,
  dbEnabled,
  seedImportJob,
  seedShopAndSession,
  sessionCookie,
} from "./db-utils";

let pool: Pool;
const seededTenants: string[] = [];

test.describe("imports preview", () => {
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

  async function seededShop(mallId: string) {
    const seed = await seedShopAndSession(pool, mallId);
    seededTenants.push(seed.tenantId);
    return seed;
  }

  test("저장한 미리보기를 읽기 전용으로 보여준다", async ({ page, context }) => {
    const seed = await seededShop("previewmall");
    const jobId = await seedImportJob(pool, seed.shopId, {
      fileName: "cost.csv",
      format: "simple",
      counts: { total: 3, matched: 2, changed: 1, unchanged: 1, errors: 1, warnings: 0 },
      blocked: true,
      blockReasons: ["오류 행이 1개 있어 전체 확정을 막습니다."],
      rows: [
        {
          line: 2,
          variantCode: "P000000R000A",
          productNo: "20",
          productName: "티셔츠",
          optionName: "Size: M",
          beforePrice: 1000,
          afterPrice: 2000,
          verdict: "changed",
        },
        {
          line: 3,
          variantCode: "P000000R000B",
          productNo: "20",
          productName: "티셔츠",
          optionName: "Size: L",
          beforePrice: 1000,
          afterPrice: 1000,
          verdict: "unchanged",
        },
        {
          line: 4,
          variantCode: "GHOST",
          verdict: "error",
          issues: [{ code: "unmatched_code", severity: "error", message: "찾지 못했습니다." }],
        },
      ],
    });
    await context.addCookies([sessionCookie(seed.token)]);

    await page.goto(`/imports/${jobId}/preview`);
    await expect(page.getByRole("heading", { name: "공급가 변경 미리보기" })).toBeVisible();
    await expect(page.getByTestId("count-total")).toHaveText("3");
    await expect(page.getByTestId("count-changed")).toHaveText("1");
    await expect(page.getByTestId("count-errors")).toHaveText("1");
    await expect(page.getByText("읽기 전용 미리보기입니다")).toBeVisible();
    await expect(page.getByText("확정할 수 없습니다")).toBeVisible();
    await expect(page.getByText("P000000R000A")).toBeVisible();
    await expect(page.getByText("2,000원")).toBeVisible();
    await expect(page.getByText("미매칭")).toBeVisible();
  });

  test("상품목록 형식 검토에는 필요한 파일 형식을 안내한다", async ({ page, context }) => {
    const seed = await seededShop("productmall");
    const jobId = await seedImportJob(pool, seed.shopId, {
      fileName: "products.csv",
      format: "cafe24-product",
      counts: { total: 1, matched: 0, changed: 0, unchanged: 0, errors: 1, warnings: 0 },
      blocked: true,
      blockReasons: ["오류 행이 1개 있어 전체 확정을 막습니다."],
    });
    await context.addCookies([sessionCookie(seed.token)]);
    await page.goto(`/imports/${jobId}/preview`);
    await expect(page.getByTestId("product-format-notice")).toContainText("variant_code");
  });

  test("다른 몰의 검토는 열 수 없다", async ({ page, context }) => {
    const owner = await seededShop("ownermall");
    const intruder = await seededShop("intrudermall");
    const jobId = await seedImportJob(pool, owner.shopId, { fileName: "secret.csv" });
    await context.addCookies([sessionCookie(intruder.token)]);
    await page.goto(`/imports/${jobId}/preview`);
    await expect(page.getByRole("heading", { name: "검토를 찾을 수 없습니다" })).toBeVisible();
  });

  test("없는 검토는 찾을 수 없음으로 안내한다", async ({ page, context }) => {
    const seed = await seededShop("missingmall");
    await context.addCookies([sessionCookie(seed.token)]);
    await page.goto("/imports/00000000-0000-0000-0000-000000000000/preview");
    await expect(page.getByRole("heading", { name: "검토를 찾을 수 없습니다" })).toBeVisible();
  });

  test("세션 없이 업로드하면 세션 오류로 돌려보낸다", async ({ request }) => {
    const response = await request.post("/api/imports", {
      multipart: {
        file: {
          name: "cost.csv",
          mimeType: "text/csv",
          buffer: Buffer.from("variant_code,supply_price\nV1,1000\n"),
        },
      },
      maxRedirects: 0,
    });
    expect(response.status()).toBe(303);
    const location = new URL(response.headers()["location"], "http://localhost");
    expect(location.pathname).toBe("/imports/new");
    expect(location.searchParams.get("error")).toBe("session");
  });

  test("상품목록 형식 CSV는 품목 형식을 안내하며 막는다", async ({ page }) => {
    const seed = await seededShop("uploadmall");
    await page.context().addCookies([sessionCookie(seed.token)]);
    const response = await page.request.post("/api/imports", {
      multipart: {
        file: {
          name: "products.csv",
          mimeType: "text/csv",
          buffer: Buffer.from("상품코드,공급가\nP000000T,1000\n"),
        },
      },
      maxRedirects: 0,
    });
    expect(response.status()).toBe(303);
    const location = new URL(response.headers()["location"], "http://localhost");
    expect(location.pathname).toBe("/imports/new");
    expect(location.searchParams.get("error")).toBe("product_csv");

    await page.goto(location.pathname + location.search);
    await expect(page.getByTestId("upload-error")).toContainText("variant_code");
  });

  test("헤더가 잘못된 CSV는 파일 오류 미리보기로 저장한다", async ({ page }) => {
    const seed = await seededShop("badheadermall");
    await page.context().addCookies([sessionCookie(seed.token)]);
    const response = await page.request.post("/api/imports", {
      multipart: {
        file: {
          name: "broken.csv",
          mimeType: "text/csv",
          buffer: Buffer.from("foo,bar\n1,2\n"),
        },
      },
      maxRedirects: 0,
    });
    expect(response.status()).toBe(303);
    const location = new URL(response.headers()["location"], "http://localhost");
    expect(location.pathname).toMatch(/^\/imports\/[0-9a-f-]+\/preview$/);

    await page.goto(location.pathname + location.search);
    await expect(page.getByText("[파일]")).toBeVisible();
    await expect(page.getByRole("heading", { name: "확정할 수 없습니다" })).toBeVisible();
  });
});
