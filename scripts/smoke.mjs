import { spawn } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { chromium } from "playwright-core";

const ROOT = path.resolve(import.meta.dirname, "..");
const PORT = Number(process.env.SMOKE_PORT ?? 3111);
const BASE = `http://localhost:${PORT}`;

function findChromium() {
  const candidates = [process.env.CHROMIUM_PATH, "/usr/bin/chromium", "/usr/bin/google-chrome"].filter(
    Boolean,
  );
  const cache = path.join(homedir(), ".cache", "ms-playwright");
  if (existsSync(cache)) {
    for (const entry of readdirSync(cache)) {
      if (entry.startsWith("chromium-")) {
        candidates.push(path.join(cache, entry, "chrome-linux", "chrome"));
      }
    }
  }
  return candidates.find((candidate) => existsSync(candidate));
}

async function waitForServer(timeoutMs = 30_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(BASE, { redirect: "manual" });
      if (response.status < 500) return;
    } catch {
      // 아직 준비되지 않음
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`서버가 ${timeoutMs}ms 안에 준비되지 않았습니다: ${BASE}`);
}

const server = spawn("npx", ["next", "start", "-p", String(PORT)], {
  cwd: ROOT,
  stdio: "ignore",
});

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

async function count(page, testId) {
  return Number(await page.getByTestId(testId).textContent());
}

let browser;
try {
  await waitForServer();
  browser = await chromium.launch({
    executablePath: findChromium(),
    args: ["--no-sandbox"],
  });
  const context = await browser.newContext({
    viewport: { width: 1200, height: 1000 },
    acceptDownloads: true,
  });
  const page = await context.newPage();

  // 1) 기본: 정상 파일
  await page.goto(`${BASE}/demo`, { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: "공급가 CSV 가져오기 — 데모" }).waitFor();
  check("데모 초기 화면", true);
  check("정상 파일 전체 5행", (await count(page, "count-total")) === 5);
  check("정상 파일 변경 1건", (await count(page, "count-changed")) === 1);
  check("정상 파일 동일 4건", (await count(page, "count-unchanged")) === 4);
  check("정상 파일 오류 0건", (await count(page, "count-errors")) === 0);
  check("정상 파일 주의 1건(0원)", (await count(page, "count-warnings")) === 1);
  check("검증 통과 배너", await page.getByText("검증 통과").isVisible());
  check("확정 버튼 활성", await page.getByRole("button", { name: "확정 (데모)" }).isEnabled());

  // 2) 검토 CSV 다운로드
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "검토 결과 CSV" }).click(),
  ]);
  check(
    "검토 결과 CSV 다운로드",
    download.suggestedFilename().includes("review"),
    download.suggestedFilename(),
  );

  // 3) 확정(데모) 안내
  await page.getByRole("button", { name: "확정 (데모)" }).click();
  await page.getByTestId("confirm-notice").waitFor();
  const notice = await page.getByTestId("confirm-notice").textContent();
  check("확정 안내와 무쓰기 고지", (notice ?? "").includes("실제 Cafe24 API 호출은 하지 않았습니다"));

  // 4) 오류 파일: 차단과 행별 오류
  await page.getByLabel("합성 파일").selectOption("errors");
  await page.getByText("확정할 수 없습니다").waitFor();
  check("오류 파일 확정 차단", true);
  check("오류 파일 오류 9건", (await count(page, "count-errors")) === 9);
  check("확정 버튼 비활성", await page.getByRole("button", { name: "확정 (데모)" }).isDisabled());
  const body = (await page.locator("body").innerText()).replace(/\s+/g, " ");
  check("중복 코드 오류 표시", body.includes("같은 variant_code가 두 번 이상"));
  check("미매칭 오류 표시", body.includes("찾지 못했습니다"));
  check("빈 공급가 오류 표시", body.includes("공급가가 비어 있습니다"));
  check("통화/천 단위 오류 표시", body.includes("통화 기호나 천 단위"));
  check("소수 오류 표시", body.includes("소수점은 허용되지 않습니다"));
  check("미매칭 상품 표시", body.includes("GHOST-404"));
  check("앞자리 0 코드 보존", body.includes("LEAD-007"));
  check("0원 주의 표시", body.includes("공급가 0원이 명시적으로"));

  // 5) 잘못된 헤더: 파일 거부
  await page.getByLabel("합성 파일").selectOption("bad-header");
  await page.getByText("헤더는 variant_code,supply_price 여야 합니다").waitFor();
  check("잘못된 헤더 거부", true);

  // 6) 몰 전환·격리
  await page.getByLabel("대상 몰").selectOption("tenant-beta");
  await page.getByLabel("합성 파일").selectOption("normal-beta");
  await page.getByText("검증 통과").waitFor();
  check("베타몰 파일 변경 1건", (await count(page, "count-changed")) === 1);
  check("베타몰 미매칭 없음", (await count(page, "count-errors")) === 0);
  await page.getByLabel("대상 몰").selectOption("tenant-gamma");
  await page.getByText("확정할 수 없습니다").waitFor();
  check("품목 없는 몰은 전부 미매칭", (await count(page, "count-matched")) === 0);
} catch (error) {
  check("스모크 테스트 예외", false, String(error).split("\n")[0]);
} finally {
  await browser?.close();
  server.kill("SIGTERM");
}

const failed = results.filter((result) => !result.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed === 0 ? 0 : 1);
