// store-assets/render-icon-banner.mjs
// icon-banner.html → icon-512.png, icon-256.png, icon-100.png, banner-740x416.png
// cafe24-option-detail/store-assets/render-icon-banner.mjs 방식을 그대로 재사용했다.
// Playwright-core + /usr/bin/chromium, 다운스케일은 ImageMagick(magick).
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const { chromium } = await import("playwright-core");

const here = fileURLToPath(new URL(".", import.meta.url));
const source = path.join(here, "icon-banner.html");
const CHROMIUM = process.env.CHROMIUM_PATH ?? "/usr/bin/chromium";

const browser = await chromium.launch({ executablePath: CHROMIUM, headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 740, height: 416 },
    deviceScaleFactor: 1,
  });
  await page.goto(pathToFileURL(source).href);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(200);

  await page.locator("#icon").screenshot({ path: path.join(here, "icon-512.png") });
  console.log("icon-512.png ✓");
  await page.locator("#banner").screenshot({ path: path.join(here, "banner-740x416.png") });
  console.log("banner-740x416.png ✓");
} finally {
  await browser.close();
}

for (const size of [256, 100]) {
  execFileSync(
    "magick",
    [path.join(here, "icon-512.png"), "-resize", `${size}x${size}`, path.join(here, `icon-${size}.png`)],
    { stdio: "inherit" },
  );
  console.log(`icon-${size}.png ✓ (magick resize)`);
}
