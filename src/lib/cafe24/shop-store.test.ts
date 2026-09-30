import { randomUUID } from "node:crypto";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { getEncryptionKey } from "@/lib/crypto/key";
import { closePool, getPool, hasDatabaseUrl } from "@/lib/db/pool";
import { runMigrations } from "@/lib/db/migrate";
import { parseCafe24Token } from "@/lib/cafe24/oauth";
import { createSession, loadSession, revokeSession } from "@/lib/cafe24/shop-store";
import { ReauthRequiredError } from "@/lib/cafe24/store-model";

const enabled = hasDatabaseUrl() && Boolean(process.env.TOKEN_ENCRYPTION_KEY);
const describeDb = describe.skipIf(!enabled);

const tenantId = `test-${randomUUID()}`;
const mallId = `testmall${randomUUID().slice(0, 8)}`;
const shopNo = "1";

let pool: Pool;
let encryptionKey: Buffer;

function token(overrides: Record<string, unknown> = {}) {
  return parseCafe24Token({
    access_token: "access-1",
    refresh_token: "refresh-1",
    expires_at: new Date(Date.now() + 3_600_000).toISOString(),
    refresh_token_expires_at: new Date(Date.now() + 30 * 24 * 3_600_000).toISOString(),
    mall_id: mallId,
    shop_no: shopNo,
    scopes: ["mall.read_product", "mall.write_product"],
    user_id: "user-1",
    token_type: "Bearer",
    issued_at: new Date().toISOString(),
    ...overrides,
  });
}

describeDb("postgres shop store", () => {
  beforeAll(async () => {
    pool = getPool();
    encryptionKey = getEncryptionKey();
    await runMigrations(pool, path.join(process.cwd(), "db", "migrations"));
  });

  afterAll(async () => {
    await pool.query("delete from shops where tenant_id = $1", [tenantId]);
    await closePool();
  });

  it("연결하면 몰·품목과 암호화된 자격 증명을 저장한다", async () => {
    const { connectShop, loadCredentials, loadCredentialMetadata, getShopById } = await import(
      "@/lib/cafe24/shop-store"
    );
    const shop = await connectShop(pool, {
      shop: { tenantId, mallId, shopNo, name: "테스트몰", currency: "KRW" },
      token: token(),
      encryptionKey,
    });
    expect(shop.mallId).toBe(mallId);
    expect(shop.shopNo).toBe(shopNo);

    const stored = await loadCredentials(pool, shop.id, encryptionKey);
    expect(stored?.accessToken).toBe("access-1");
    expect(stored?.refreshToken).toBe("refresh-1");

    const raw = await pool.query<{ access_token: string }>(
      "select access_token from shop_credentials where shop_id = $1",
      [shop.id],
    );
    expect(raw.rows[0].access_token.startsWith("v1.")).toBe(true);
    expect(raw.rows[0].access_token).not.toContain("access-1");

    const meta = await loadCredentialMetadata(pool, shop.id);
    expect(meta?.scopes).toEqual(["mall.read_product", "mall.write_product"]);
    expect(meta).not.toHaveProperty("accessToken");

    expect((await getShopById(pool, shop.id))?.name).toBe("테스트몰");
  });

  it("같은 tenant/mall/shop_no는 한 행으로 upsert한다", async () => {
    const { upsertShop, getShopByMall } = await import("@/lib/cafe24/shop-store");
    const first = await upsertShop(pool, { tenantId, mallId, shopNo, name: "이름1" });
    const second = await upsertShop(pool, { tenantId, mallId, shopNo, name: "이름2" });
    expect(second.id).toBe(first.id);
    expect((await getShopByMall(pool, tenantId, mallId, shopNo))?.name).toBe("이름2");
    expect(await getShopByMall(pool, tenantId, mallId, "9")).toBeNull();
  });

  it("세션을 발급하고 원문 토큰으로만 조회한다", async () => {
    const { upsertShop } = await import("@/lib/cafe24/shop-store");
    const shop = await upsertShop(pool, { tenantId, mallId, shopNo, name: "세션몰" });
    const now = Date.now();
    const session = await createSession(pool, shop.id, { now, ttlMs: 60_000 });

    const loaded = await loadSession(pool, session.token, now);
    expect(loaded?.shop.id).toBe(shop.id);
    expect(loaded?.shop.mallId).toBe(mallId);

    expect(await loadSession(pool, "A".repeat(43), now)).toBeNull();
    expect(await loadSession(pool, session.token, now + 60_000)).toBeNull();

    await revokeSession(pool, session.token);
    expect(await loadSession(pool, session.token, now)).toBeNull();
  });

  it("유효한 access token은 네트워크 호출 없이 반환한다", async () => {
    const { connectShop, getValidAccessToken, getShopByMall } = await import(
      "@/lib/cafe24/shop-store"
    );
    await connectShop(pool, {
      shop: { tenantId, mallId, shopNo, name: "토큰몰" },
      token: token(),
      encryptionKey,
    });
    const shop = await getShopByMall(pool, tenantId, mallId, shopNo);
    const accessToken = await getValidAccessToken(pool, {
      shopId: shop!.id,
      mallId,
      clientId: "client",
      clientSecret: "secret",
      encryptionKey,
      fetchImpl: async () => {
        throw new Error("네트워크를 호출하면 안 됩니다.");
      },
    });
    expect(accessToken).toBe("access-1");
  });

  it("access token이 만료되면 refresh하고 회전된 값을 저장한다", async () => {
    const { connectShop, loadCredentials, getValidAccessToken, getShopByMall } = await import(
      "@/lib/cafe24/shop-store"
    );
    await connectShop(pool, {
      shop: { tenantId, mallId, shopNo, name: "갱신몰" },
      token: token({
        access_token: "old-access",
        refresh_token: "old-refresh",
        expires_at: "2020-01-01T00:00:00.000Z",
      }),
      encryptionKey,
    });
    const shop = await getShopByMall(pool, tenantId, mallId, shopNo);
    const accessToken = await getValidAccessToken(pool, {
      shopId: shop!.id,
      mallId,
      clientId: "client",
      clientSecret: "secret",
      encryptionKey,
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            access_token: "new-access",
            refresh_token: "new-refresh",
            expires_at: new Date(Date.now() + 3_600_000).toISOString(),
            refresh_token_expires_at: new Date(Date.now() + 30 * 24 * 3_600_000).toISOString(),
            mall_id: mallId,
            scopes: ["mall.read_product", "mall.write_product"],
          }),
          { status: 200 },
        ),
    });
    expect(accessToken).toBe("new-access");
    const stored = await loadCredentials(pool, shop!.id, encryptionKey);
    expect(stored?.refreshToken).toBe("new-refresh");
  });

  it("동시 refresh 요청을 DB 잠금으로 1회로 합친다", async () => {
    const { connectShop, getValidAccessToken, getShopByMall } = await import(
      "@/lib/cafe24/shop-store"
    );
    await connectShop(pool, {
      shop: { tenantId, mallId, shopNo, name: "동시성몰" },
      token: token({
        access_token: "old-access",
        refresh_token: "old-refresh",
        expires_at: "2020-01-01T00:00:00.000Z",
      }),
      encryptionKey,
    });
    const shop = await getShopByMall(pool, tenantId, mallId, shopNo);
    let calls = 0;
    const fetchImpl = async () => {
      calls += 1;
      await new Promise((resolve) => setTimeout(resolve, 50));
      return new Response(
        JSON.stringify({
          access_token: "new-access",
          refresh_token: "new-refresh",
          expires_at: new Date(Date.now() + 3_600_000).toISOString(),
          refresh_token_expires_at: new Date(Date.now() + 30 * 24 * 3_600_000).toISOString(),
          mall_id: mallId,
          scopes: ["mall.read_product"],
        }),
        { status: 200 },
      );
    };
    const params = {
      shopId: shop!.id,
      mallId,
      clientId: "client",
      clientSecret: "secret",
      encryptionKey,
      fetchImpl,
    };
    const [first, second] = await Promise.all([
      getValidAccessToken(pool, params),
      getValidAccessToken(pool, params),
    ]);
    expect(calls).toBe(1);
    expect(first).toBe("new-access");
    expect(second).toBe("new-access");
  });

  it("refresh token까지 만료되면 재인증을 요구한다", async () => {
    const { connectShop, getValidAccessToken, getShopByMall } = await import(
      "@/lib/cafe24/shop-store"
    );
    await connectShop(pool, {
      shop: { tenantId, mallId, shopNo, name: "만료몰" },
      token: token({
        expires_at: "2020-01-01T00:00:00.000Z",
        refresh_token_expires_at: "2020-01-02T00:00:00.000Z",
      }),
      encryptionKey,
    });
    const shop = await getShopByMall(pool, tenantId, mallId, shopNo);
    await expect(
      getValidAccessToken(pool, {
        shopId: shop!.id,
        mallId,
        clientId: "client",
        clientSecret: "secret",
        encryptionKey,
      }),
    ).rejects.toBeInstanceOf(ReauthRequiredError);
  });
});
