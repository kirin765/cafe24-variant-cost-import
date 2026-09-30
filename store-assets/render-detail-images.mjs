// store-assets/render-detail-images.mjs
// detail-images.html 의 섹션 3개를 2x(2480px) PNG 로 렌더해 public/store/ 에 둔다.
// 스토어 상세설명(HTML)에 넣어 쓴다. 폰트/레이아웃은 1240px 기준, 표시는 1240px 이하.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const { chromium } = await import("playwright-core");

const here = fileURLToPath(new URL(".", import.meta.url));
const root = path.resolve(here, "..");
const outDir = path.join(root, "public", "store");
fs.mkdirSync(outDir, { recursive: true });

const CHROMIUM = process.env.CHROMIUM_PATH ?? "/usr/bin/chromium";
const browser = await chromium.launch({ executablePath: CHROMIUM, headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1240, height: 900 }, deviceScaleFactor: 2 });
  await page.goto(pathToFileURL(path.join(here, "detail-images.html")).href);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(250);

  const sections = await page.locator("section.shot").all();
  for (let i = 0; i < sections.length; i += 1) {
    const name = `detail-0${i + 1}.png`;
    await sections[i].screenshot({ path: path.join(outDir, name) });
    const kb = fs.statSync(path.join(outDir, name)).size / 1024;
    console.log(`${name}  ${kb.toFixed(0)}KB`);
  }
} finally {
  await browser.close();
}
