import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { Pool } from "pg";

const MIGRATION_LOCK_KEY = 728_341_907;

export interface MigrationResult {
  applied: string[];
  skipped: string[];
}

export async function listMigrationFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir);
  return entries.filter((entry) => entry.endsWith(".sql")).sort();
}

export function checksumSql(sql: string): string {
  return createHash("sha256").update(sql).digest("hex");
}

export async function runMigrations(pool: Pool, dir: string): Promise<MigrationResult> {
  const files = await listMigrationFiles(dir);
  const client = await pool.connect();
  const applied: string[] = [];
  const skipped: string[] = [];
  try {
    await client.query("select pg_advisory_lock($1)", [MIGRATION_LOCK_KEY]);
    await client.query(`
      create table if not exists schema_migrations (
        version text primary key,
        checksum text not null,
        applied_at timestamptz not null default now()
      )
    `);
    const existing = await client.query<{ version: string; checksum: string }>(
      "select version, checksum from schema_migrations",
    );
    const appliedMap = new Map(existing.rows.map((row) => [row.version, row.checksum]));

    for (const file of files) {
      const sql = await readFile(path.join(dir, file), "utf8");
      const checksum = checksumSql(sql);
      const previous = appliedMap.get(file);
      if (previous !== undefined) {
        if (previous !== checksum) {
          throw new Error(`이미 적용된 migration ${file}의 내용이 바뀌었습니다. 새 migration을 추가하세요.`);
        }
        skipped.push(file);
        continue;
      }
      await client.query("begin");
      try {
        await client.query(sql);
        await client.query("insert into schema_migrations (version, checksum) values ($1, $2)", [
          file,
          checksum,
        ]);
        await client.query("commit");
      } catch (error) {
        await client.query("rollback").catch(() => undefined);
        throw error;
      }
      applied.push(file);
    }
    return { applied, skipped };
  } finally {
    await client.query("select pg_advisory_unlock($1)", [MIGRATION_LOCK_KEY]).catch(() => undefined);
    client.release();
  }
}
