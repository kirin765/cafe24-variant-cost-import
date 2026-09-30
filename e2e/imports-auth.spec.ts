import { createHmac } from "node:crypto";
import path from "node:path";
import { expect, test } from "@playwright/test";
import type { Pool } from "pg";
import { runMigrations } from "../src/lib/db/migrate";
import {
  cleanupTenants,
  createTestPool,
  dbEnabled,
  seedShopAndSession,
  sessionCookie,
} from "./db-utils";

// 로컬 webServer는 CAFE24_CLIENT_SECRET을 "e2e-client-secret"으로 띄운다. 서버와 같은 값을 쓴다.
const E2E_SECRET = "e2e-client-secret";

let pool: Pool;
const seededTenants: string[] = [];

function launchUrl(mallId: string) {
  const query = `is_multi_shop=T&lang=ko_KR&mall_id=${mallId}&nation=KR&shop_no=1&timestamp=1&user_id=demo&user_type=P`;
  const hmac = createHmac("sha256", E2E_SECRET).update(query).digest("base64");
  return `/api/cafe24/launch?${query}&hmac=${encodeURIComponent(hmac)}`;
}

test.describe("imports/new 인증 흐름", () => {
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

  test("세션이 없으면 Cafe24 연결을 안내한다", async ({ page }) => {
    await page.goto("/imports/new");
    await expect(page.getByRole("heading", { name: "Cafe24 연결이 필요합니다" })).toBeVisible();
  });

  test("유효한 세션이면 연결된 몰과 shop_no를 보여준다", async ({ page, context }) => {
    const seed = await seedShopAndSession(pool, "e2emall", { shopNo: "2" });
    seededTenants.push(seed.tenantId);
    await context.addCookies([sessionCookie(seed.token)]);
    await page.goto("/imports/new");
    await expect(page.getByTestId("shop-mall")).toHaveText("e2emall");
    await expect(page.getByTestId("shop-no")).toHaveText("2");
    await expect(page.getByTestId("csv-upload")).toBeVisible();
  });

  test("만료된 세션이면 다시 연결을 안내한다", async ({ page, context }) => {
    const seed = await seedShopAndSession(pool, "expiredmall", { expired: true });
    seededTenants.push(seed.tenantId);
    await context.addCookies([sessionCookie(seed.token)]);
    await page.goto("/imports/new");
    await expect(page.getByRole("heading", { name: "Cafe24 연결이 필요합니다" })).toBeVisible();
  });

  test("다른 몰 쿼리로는 세션의 몰 데이터에 접근하지 못한다", async ({ page, context }) => {
    const seed = await seedShopAndSession(pool, "mall-a");
    seededTenants.push(seed.tenantId);
    await context.addCookies([sessionCookie(seed.token)]);
    await page.goto("/imports/new?mall_id=mall-b");
    await expect(page.getByRole("heading", { name: "Cafe24 연결이 필요합니다" })).toBeVisible();
    await expect(page.getByRole("link", { name: "mall-b 다시 연결" })).toBeVisible();
    await expect(page.getByTestId("shop-mall")).toHaveCount(0);
  });

  test("유효한 세션으로 launch하면 /imports/new로 이동한다", async ({ page, context }) => {
    const seed = await seedShopAndSession(pool, "launchmall");
    seededTenants.push(seed.tenantId);
    await context.addCookies([sessionCookie(seed.token)]);
    const response = await page.request.get(launchUrl("launchmall"), { maxRedirects: 0 });
    expect(response.status()).toBe(303);
    expect(new URL(response.headers()["location"], "http://localhost").pathname).toBe(
      "/imports/new",
    );
  });

  test("다른 몰 세션으로 launch하면 OAuth를 다시 시작한다", async ({ page, context }) => {
    const seed = await seedShopAndSession(pool, "sessionmall");
    seededTenants.push(seed.tenantId);
    await context.addCookies([sessionCookie(seed.token)]);
    const response = await page.request.get(launchUrl("othermall"), { maxRedirects: 0 });
    expect(response.status()).toBe(302);
    expect(new URL(response.headers()["location"], "http://localhost").pathname).toBe(
      "/api/cafe24/oauth/start",
    );
  });
});
