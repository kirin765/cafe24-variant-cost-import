import path from "node:path";
import { runMigrations } from "./migrate.ts";
import { createPool, readMigrationUrl } from "./pool.ts";

async function main(): Promise<void> {
  const url = readMigrationUrl();
  if (!url) {
    console.error("DATABASE_URL_UNPOOLED(또는 DATABASE_URL)이 필요합니다.");
    process.exitCode = 1;
    return;
  }
  // migration은 세션 수준 advisory lock과 DDL을 쓰므로 pooled(-pooler)가 아닌 direct 연결을 쓴다.
  const pool = createPool(url, 1);
  try {
    const dir = path.join(process.cwd(), "db", "migrations");
    const result = await runMigrations(pool, dir);
    for (const file of result.applied) console.log(`적용: ${file}`);
    console.log(`완료: 적용 ${result.applied.length}개, 이미 적용됨 ${result.skipped.length}개`);
  } finally {
    await pool.end();
  }
}

await main();
