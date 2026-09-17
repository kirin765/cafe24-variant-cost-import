import { expect, test, type Page } from "@playwright/test";

function count(page: Page, testId: string) {
  return page.getByTestId(testId);
}

test.beforeEach(async ({ page }) => {
  await page.goto("/demo");
  await expect(page.getByRole("heading", { name: "공급가 CSV 가져오기 — 데모" })).toBeVisible();
  await expect(count(page, "count-total")).toBeVisible();
});

test("정상 파일은 5행을 검증하고 확정할 수 있다", async ({ page }) => {
  await expect(count(page, "count-total")).toHaveText("5");
  await expect(count(page, "count-matched")).toHaveText("5");
  await expect(count(page, "count-changed")).toHaveText("1");
  await expect(count(page, "count-unchanged")).toHaveText("4");
  await expect(count(page, "count-errors")).toHaveText("0");
  await expect(count(page, "count-warnings")).toHaveText("1");

  await expect(page.getByRole("heading", { name: "검증 통과" })).toBeVisible();
  await expect(page.getByRole("button", { name: "확정 (데모)" })).toBeEnabled();
});

test("확정하면 미리보기 버전과 무쓰기 안내가 보인다", async ({ page }) => {
  await page.getByRole("button", { name: "확정 (데모)" }).click();
  const notice = page.getByTestId("confirm-notice");
  await expect(notice).toBeVisible();
  await expect(notice).toContainText("실제 Cafe24 API 호출은 하지 않았습니다");
});

test("검토·변경·JSON 명세를 내려받는다", async ({ page }) => {
  const downloads = [
    { button: "검토 결과 CSV", fileName: "supply-prices-normal-review.csv" },
    { button: "변경 명세 CSV", fileName: "supply-prices-normal-change-spec.csv" },
    { button: "JSON 명세", fileName: "supply-prices-normal-manifest.json" },
  ] as const;

  for (const entry of downloads) {
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: entry.button }).click(),
    ]);
    expect(download.suggestedFilename()).toBe(entry.fileName);
  }
});

test("오류 파일은 행별 오류를 표시하고 확정을 막는다", async ({ page }) => {
  await page.getByLabel("합성 파일").selectOption("errors");

  await expect(page.getByRole("heading", { name: "확정할 수 없습니다" })).toBeVisible();
  await expect(count(page, "count-errors")).toHaveText("9");
  await expect(page.getByRole("button", { name: "확정 (데모)" })).toBeDisabled();

  const body = page.locator("body");
  await expect(body).toContainText("같은 variant_code가 두 번 이상");
  await expect(body).toContainText("찾지 못했습니다");
  await expect(body).toContainText("공급가가 비어 있습니다");
  await expect(body).toContainText("통화 기호나 천 단위");
  await expect(body).toContainText("소수점은 허용되지 않습니다");
  await expect(body).toContainText("GHOST-404");
  await expect(body).toContainText("LEAD-007");
  await expect(body).toContainText("공급가 0원이 명시적으로");
});

test("잘못된 헤더 파일은 전체를 거부한다", async ({ page }) => {
  await page.getByLabel("합성 파일").selectOption("bad-header");
  await expect(page.getByText("헤더는 variant_code,supply_price 여야 합니다")).toBeVisible();
  await expect(page.getByRole("button", { name: "확정 (데모)" })).toBeDisabled();
});

test("몰을 바꾸면 품목이 격리된다", async ({ page }) => {
  await page.getByLabel("대상 몰").selectOption("tenant-beta");
  await page.getByLabel("합성 파일").selectOption("normal-beta");
  await expect(page.getByRole("heading", { name: "검증 통과" })).toBeVisible();
  await expect(count(page, "count-changed")).toHaveText("1");
  await expect(count(page, "count-errors")).toHaveText("0");

  await page.getByLabel("대상 몰").selectOption("tenant-gamma");
  await expect(page.getByRole("heading", { name: "확정할 수 없습니다" })).toBeVisible();
  await expect(count(page, "count-matched")).toHaveText("0");
});

test("직접 올린 CSV도 같은 검증을 거친다", async ({ page }) => {
  await page.getByLabel("CSV 직접 올리기").setInputFiles({
    name: "uploaded.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("variant_code,supply_price\nLEAD-007,9500\nSKU-0002,4500\n"),
  });

  await expect(page.getByText("직접 올린 파일: uploaded.csv")).toBeVisible();
  await expect(count(page, "count-total")).toHaveText("2");
  await expect(count(page, "count-changed")).toHaveText("1");
  await expect(count(page, "count-unchanged")).toHaveText("1");
  await expect(count(page, "count-errors")).toHaveText("0");
});
