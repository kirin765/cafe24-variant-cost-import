import type { Pool, PoolClient, QueryResultRow } from "pg";
import { decryptSecret, encryptSecret } from "@/lib/crypto/secret-box";
import { refreshAccessToken, type Cafe24Token, type FetchLike } from "./oauth";
import { generateSessionToken, hashSessionToken, isSessionActive, sessionExpiresAt } from "./session";
import {
  ReauthRequiredError,
  type Shop,
  type ShopSession,
  type SessionWithShop,
  type StoredCredentials,
  type UpsertShopInput,
} from "./store-model";
import { classifyAccessToken, DEFAULT_REFRESH_MARGIN_MS } from "./token-lifecycle";

export type Db = Pool | PoolClient;

type ShopRow = QueryResultRow & {
  id: string;
  tenant_id: string;
  mall_id: string;
  shop_no: string;
  name: string | null;
  currency: string;
};

type CredentialRow = QueryResultRow & {
  shop_id: string;
  access_token: string;
  refresh_token: string;
  token_type: string;
  scopes: string[] | null;
  user_id: string | null;
  access_expires_at: string | null;
  refresh_expires_at: string | null;
  issued_at: string | null;
};

type SessionRow = QueryResultRow & {
  id_hash: string;
  shop_id: string;
  expires_at: Date;
  revoked_at: Date | null;
  tenant_id: string;
  mall_id: string;
  shop_no: string;
  name: string | null;
  currency: string;
};

const SHOP_COLUMNS = "id, tenant_id, mall_id, shop_no, name, currency";
const CREDENTIAL_COLUMNS =
  "shop_id, access_token, refresh_token, token_type, scopes, user_id, access_expires_at, refresh_expires_at, issued_at";

function mapShop(row: ShopRow): Shop {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    mallId: row.mall_id,
    shopNo: row.shop_no,
    name: row.name,
    currency: row.currency,
  };
}

function mapCredentials(row: CredentialRow, encryptionKey: Buffer): StoredCredentials {
  return {
    shopId: row.shop_id,
    accessToken: decryptSecret(row.access_token, encryptionKey),
    refreshToken: decryptSecret(row.refresh_token, encryptionKey),
    tokenType: row.token_type,
    scopes: row.scopes ?? [],
    userId: row.user_id,
    accessExpiresAt: row.access_expires_at,
    refreshExpiresAt: row.refresh_expires_at,
    issuedAt: row.issued_at,
  };
}

export async function upsertShop(db: Db, input: UpsertShopInput): Promise<Shop> {
  const result = await db.query<ShopRow>(
    `insert into shops (tenant_id, mall_id, shop_no, name, currency, updated_at)
     values ($1, $2, $3, $4, $5, now())
     on conflict (tenant_id, mall_id, shop_no)
     do update set name = excluded.name, currency = excluded.currency, updated_at = now()
     returning ${SHOP_COLUMNS}`,
    [input.tenantId, input.mallId, input.shopNo, input.name ?? null, input.currency ?? "KRW"],
  );
  return mapShop(result.rows[0]);
}

export async function getShopById(db: Db, shopId: string): Promise<Shop | null> {
  const result = await db.query<ShopRow>(`select ${SHOP_COLUMNS} from shops where id = $1`, [shopId]);
  return result.rows[0] ? mapShop(result.rows[0]) : null;
}

export async function getShopByMall(
  db: Db,
  tenantId: string,
  mallId: string,
  shopNo: string,
): Promise<Shop | null> {
  const result = await db.query<ShopRow>(
    `select ${SHOP_COLUMNS} from shops where tenant_id = $1 and mall_id = $2 and shop_no = $3`,
    [tenantId, mallId, shopNo],
  );
  return result.rows[0] ? mapShop(result.rows[0]) : null;
}

async function writeCredentials(
  db: Db,
  shopId: string,
  token: Cafe24Token,
  encryptionKey: Buffer,
): Promise<void> {
  await db.query(
    `insert into shop_credentials (
       shop_id, access_token, refresh_token, token_type, scopes, user_id,
       access_expires_at, refresh_expires_at, issued_at, updated_at
     )
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, now())
     on conflict (shop_id) do update set
       access_token = excluded.access_token,
       refresh_token = excluded.refresh_token,
       token_type = excluded.token_type,
       scopes = excluded.scopes,
       user_id = excluded.user_id,
       access_expires_at = excluded.access_expires_at,
       refresh_expires_at = excluded.refresh_expires_at,
       issued_at = excluded.issued_at,
       updated_at = now()`,
    [
      shopId,
      encryptSecret(token.accessToken, encryptionKey),
      encryptSecret(token.refreshToken, encryptionKey),
      token.tokenType,
      token.scopes,
      token.userId,
      token.expiresAt || null,
      token.refreshTokenExpiresAt || null,
      token.issuedAt || null,
    ],
  );
}

export interface ConnectShopInput {
  shop: UpsertShopInput;
  token: Cafe24Token;
  encryptionKey: Buffer;
}

export async function connectShop(pool: Pool, input: ConnectShopInput): Promise<Shop> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const shop = await upsertShop(client, input.shop);
    await writeCredentials(client, shop.id, input.token, input.encryptionKey);
    await client.query("commit");
    return shop;
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function loadCredentials(
  db: Db,
  shopId: string,
  encryptionKey: Buffer,
): Promise<StoredCredentials | null> {
  const result = await db.query<CredentialRow>(
    `select ${CREDENTIAL_COLUMNS} from shop_credentials where shop_id = $1`,
    [shopId],
  );
  return result.rows[0] ? mapCredentials(result.rows[0], encryptionKey) : null;
}

export interface CredentialMetadata {
  tokenType: string;
  scopes: string[];
  userId: string | null;
  accessExpiresAt: string | null;
  refreshExpiresAt: string | null;
  issuedAt: string | null;
}

export async function loadCredentialMetadata(
  db: Db,
  shopId: string,
): Promise<CredentialMetadata | null> {
  const result = await db.query<CredentialRow>(
    `select shop_id, '' as access_token, '' as refresh_token, token_type, scopes, user_id,
            access_expires_at, refresh_expires_at, issued_at
     from shop_credentials where shop_id = $1`,
    [shopId],
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    tokenType: row.token_type,
    scopes: row.scopes ?? [],
    userId: row.user_id,
    accessExpiresAt: row.access_expires_at,
    refreshExpiresAt: row.refresh_expires_at,
    issuedAt: row.issued_at,
  };
}

export interface CreateSessionOptions {
  now?: number;
  ttlMs?: number;
}

export async function createSession(
  db: Db,
  shopId: string,
  options: CreateSessionOptions = {},
): Promise<{ token: string; expiresAt: Date }> {
  const token = generateSessionToken();
  const expiresAt = sessionExpiresAt(options.now, options.ttlMs);
  await db.query("insert into sessions (id_hash, shop_id, expires_at) values ($1, $2, $3)", [
    hashSessionToken(token),
    shopId,
    expiresAt,
  ]);
  return { token, expiresAt };
}

export async function loadSession(
  db: Db,
  token: string,
  now: number = Date.now(),
): Promise<SessionWithShop | null> {
  const result = await db.query<SessionRow>(
    `select s.id_hash, s.shop_id, s.expires_at, s.revoked_at,
            sh.tenant_id, sh.mall_id, sh.shop_no, sh.name, sh.currency
     from sessions s
     join shops sh on sh.id = s.shop_id
     where s.id_hash = $1`,
    [hashSessionToken(token)],
  );
  const row = result.rows[0];
  if (!row || !isSessionActive(row.expires_at, row.revoked_at, now)) return null;
  const session: ShopSession = { shopId: row.shop_id, expiresAt: row.expires_at };
  return {
    session,
    shop: {
      id: row.shop_id,
      tenantId: row.tenant_id,
      mallId: row.mall_id,
      shopNo: row.shop_no,
      name: row.name,
      currency: row.currency,
    },
  };
}

export async function revokeSession(db: Db, token: string): Promise<void> {
  await db.query(
    "update sessions set revoked_at = now() where id_hash = $1 and revoked_at is null",
    [hashSessionToken(token)],
  );
}

export async function revokeSessionsForShop(db: Db, shopId: string): Promise<number> {
  const result = await db.query(
    "update sessions set revoked_at = now() where shop_id = $1 and revoked_at is null",
    [shopId],
  );
  return result.rowCount ?? 0;
}

export interface GetValidAccessTokenParams {
  shopId: string;
  mallId: string;
  clientId: string;
  clientSecret: string;
  encryptionKey: Buffer;
  fetchImpl?: FetchLike;
  now?: () => number;
  marginMs?: number;
}

export async function getValidAccessToken(
  pool: Pool,
  params: GetValidAccessTokenParams,
): Promise<string> {
  const client = await pool.connect();
  let committed = false;
  try {
    await client.query("begin");
    // 여러 인스턴스가 동시에 refresh하는 것을 막는다. xact 잠금은 커밋/롤백 시 자동 해제된다.
    await client.query("select pg_advisory_xact_lock(hashtext($1))", [params.shopId]);
    const result = await client.query<CredentialRow>(
      `select ${CREDENTIAL_COLUMNS} from shop_credentials where shop_id = $1 for update`,
      [params.shopId],
    );
    const row = result.rows[0];
    if (!row) throw new ReauthRequiredError("저장된 자격 증명이 없습니다.");

    const now = (params.now ?? Date.now)();
    const freshness = classifyAccessToken(
      row.access_expires_at,
      row.refresh_expires_at,
      now,
      params.marginMs ?? DEFAULT_REFRESH_MARGIN_MS,
    );

    if (freshness === "fresh" || freshness === "unknown") {
      const accessToken = decryptSecret(row.access_token, params.encryptionKey);
      await client.query("commit");
      committed = true;
      return accessToken;
    }
    if (freshness === "reauth") {
      throw new ReauthRequiredError("refresh token이 만료되었습니다.");
    }

    const refreshToken = decryptSecret(row.refresh_token, params.encryptionKey);
    const refreshed = await refreshAccessToken(
      {
        mallId: params.mallId,
        clientId: params.clientId,
        clientSecret: params.clientSecret,
        refreshToken,
      },
      params.fetchImpl,
    );
    await writeCredentials(client, params.shopId, refreshed, params.encryptionKey);
    await client.query("commit");
    committed = true;
    return refreshed.accessToken;
  } catch (error) {
    if (!committed) await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
