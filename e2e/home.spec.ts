import { expect, test } from "@playwright/test";

test("소개 화면에 흐름·규칙·미포함 범위가 보인다", async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "옵션별 공급가 CSV 가져오기 — 로컬 데모" }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "사용 흐름" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "매칭·검증 규칙" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "이 데모에 없는 것" })).toBeVisible();
  await expect(page.getByText("실제 공급가 쓰기")).toBeVisible();

  await page.getByRole("link", { name: "데모 열기" }).click();
  await expect(page).toHaveURL(/\/demo$/);
  await expect(page.getByRole("heading", { name: "공급가 CSV 가져오기 — 데모" })).toBeVisible();
});
