import { defineConfig } from "@playwright/test";
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

const PORT = Number(process.env.E2E_PORT ?? 3112);
const BASE_URL = process.env.E2E_BASE_URL ?? `http://localhost:${PORT}`;
const EXTERNAL = Boolean(process.env.E2E_BASE_URL);

function findChromium(): string | undefined {
  const candidates: string[] = [
    process.env.CHROMIUM_PATH,
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/google-chrome",
  ].filter((value): value is string => Boolean(value));
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

const chromiumPath = findChromium();

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [["list"]],
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
    ...(chromiumPath ? { launchOptions: { executablePath: chromiumPath } } : {}),
  },
  webServer: EXTERNAL
    ? undefined
    : {
        command: `npm run build && npx next start -p ${PORT}`,
        url: BASE_URL,
        reuseExistingServer: !process.env.CI,
        timeout: 180_000,
        env: {
          CAFE24_CLIENT_ID: process.env.CAFE24_CLIENT_ID ?? "e2e-client-id",
          CAFE24_CLIENT_SECRET: process.env.CAFE24_CLIENT_SECRET ?? "e2e-client-secret",
          CAFE24_MALL_ID: process.env.CAFE24_MALL_ID ?? "e2e-mall",
        },
      },
});
