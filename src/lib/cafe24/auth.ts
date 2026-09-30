import { cookies } from "next/headers";
import { getPool, hasDatabaseUrl } from "@/lib/db/pool";
import { loadSession, type Db } from "./shop-store";
import { SESSION_COOKIE, SESSION_TTL_MS, isWellFormedSessionToken } from "./session";
import type { SessionWithShop } from "./store-model";

export function sessionCookieOptions(secure: boolean): {
  name: string;
  value: string;
  httpOnly: boolean;
  sameSite: "lax";
  secure: boolean;
  path: string;
  maxAge: number;
} {
  return {
    name: SESSION_COOKIE,
    value: "",
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/",
    maxAge: SESSION_TTL_MS / 1000,
  };
}

export async function readSessionToken(): Promise<string | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value ?? "";
  return isWellFormedSessionToken(token) ? token : null;
}

export async function getCurrentSession(
  db?: Db,
  now: number = Date.now(),
): Promise<SessionWithShop | null> {
  if (!hasDatabaseUrl()) return null;
  const token = await readSessionToken();
  if (!token) return null;
  const pool = db ?? getPool();
  return loadSession(pool, token, now);
}

export function sessionMatchesShop(
  access: SessionWithShop,
  mallId: string,
  shopNo?: string | null,
): boolean {
  if (access.shop.mallId !== mallId) return false;
  if (shopNo && access.shop.shopNo !== shopNo) return false;
  return true;
}
