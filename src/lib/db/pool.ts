import { attachDatabasePool } from "@vercel/functions";
import { Pool, type PoolConfig } from "pg";

export interface DatabaseEnv {
  [key: string]: string | undefined;
  DATABASE_URL?: string;
  DATABASE_URL_UNPOOLED?: string;
  POSTGRES_URL?: string;
}

export function readDatabaseUrl(env: DatabaseEnv = process.env): string | null {
  return env.DATABASE_URL?.trim() || env.POSTGRES_URL?.trim() || null;
}

export function readMigrationUrl(env: DatabaseEnv = process.env): string | null {
  return env.DATABASE_URL_UNPOOLED?.trim() || readDatabaseUrl(env);
}

export function hasDatabaseUrl(env: DatabaseEnv = process.env): boolean {
  return readDatabaseUrl(env) !== null;
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

export function buildPoolConfig(connectionString: string, max = 5): PoolConfig {
  // sslmode는 pg-connection-string에서 의미가 바뀔 예정이라 URL에서 제거하고 ssl을 직접 지정한다.
  const url = new URL(connectionString);
  const sslMode = url.searchParams.get("sslmode");
  if (sslMode) url.searchParams.delete("sslmode");
  const useSsl = sslMode === "disable" ? false : sslMode ? true : !LOCAL_HOSTS.has(url.hostname);
  return {
    connectionString: url.toString(),
    max,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
    ssl: useSsl ? { rejectUnauthorized: true } : false,
  };
}

export function createPool(connectionString: string, max = 5, attach = false): Pool {
  const pool = new Pool(buildPoolConfig(connectionString, max));
  if (attach && process.env.VERCEL) {
    attachDatabasePool(pool);
  }
  return pool;
}

interface PoolGlobal {
  __cafe24VariantCostPool?: Pool;
}

export function getPool(env: DatabaseEnv = process.env): Pool {
  const globalForPool = globalThis as typeof globalThis & PoolGlobal;
  if (globalForPool.__cafe24VariantCostPool) return globalForPool.__cafe24VariantCostPool;
  const url = readDatabaseUrl(env);
  if (!url) throw new Error("DATABASE_URL이 설정되지 않았습니다.");
  const pool = createPool(url, 5, true);
  globalForPool.__cafe24VariantCostPool = pool;
  return pool;
}

export async function closePool(): Promise<void> {
  const globalForPool = globalThis as typeof globalThis & PoolGlobal;
  const pool = globalForPool.__cafe24VariantCostPool;
  if (!pool) return;
  delete globalForPool.__cafe24VariantCostPool;
  await pool.end();
}
