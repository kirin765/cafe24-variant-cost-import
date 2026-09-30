import { readCafe24Config } from "@/lib/cafe24/env";
import type { Shop } from "@/lib/cafe24/store-model";
import { getEncryptionKey } from "@/lib/crypto/key";
import { getPool } from "@/lib/db/pool";
import type { RunnerContext } from "./runner";

export function buildRunnerContext(shop: Shop, owner: string): RunnerContext | null {
  const config = readCafe24Config();
  if (!config.ok || !config.config) return null;
  try {
    return {
      pool: getPool(),
      shop,
      clientId: config.config.clientId,
      clientSecret: config.config.clientSecret,
      encryptionKey: getEncryptionKey(),
      apiVersion: process.env.CAFE24_API_VERSION?.trim() || null,
      owner,
      timeBudgetMs: Number(process.env.IMPORT_RUN_BUDGET_MS ?? 45_000) || 45_000,
      leaseMs: Number(process.env.IMPORT_RUN_LEASE_MS ?? 120_000) || 120_000,
    };
  } catch {
    return null;
  }
}
