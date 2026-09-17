import { afterEach, describe, expect, it } from "vitest";
import {
  clearToken,
  getToken,
  refreshStoredToken,
  saveToken,
  withRefreshLock,
} from "@/lib/cafe24/token-store";
import { parseCafe24Token } from "@/lib/cafe24/oauth";

function token(accessToken: string, refreshToken: string) {
  return parseCafe24Token({
    access_token: accessToken,
    refresh_token: refreshToken,
    expires_at: "2026-09-17T12:00:00.000",
    refresh_token_expires_at: "2026-10-01T12:00:00.000",
    mall_id: "demo",
    scopes: ["mall.read_product", "mall.write_product"],
  });
}

const params = {
  mallId: "demo",
  clientId: "client-1",
  clientSecret: "secret-1",
  refreshToken: "refresh-1",
};

afterEach(() => {
  clearToken("demo");
});

describe("refreshStoredToken", () => {
  it("회전된 refresh token을 저장한다", async () => {
    saveToken("demo", token("access-1", "refresh-1"));
    const fetchImpl = async () =>
      new Response(
        JSON.stringify({
          access_token: "access-2",
          refresh_token: "refresh-2",
          mall_id: "demo",
          scopes: ["mall.read_product", "mall.write_product"],
        }),
        { status: 200 },
      );

    const refreshed = await refreshStoredToken(params, fetchImpl);
    expect(refreshed.refreshToken).toBe("refresh-2");
    expect(getToken("demo")?.refreshToken).toBe("refresh-2");
  });

  it("동시 refresh 요청을 1회로 합친다", async () => {
    let calls = 0;
    const fetchImpl = async () => {
      calls += 1;
      await new Promise((resolve) => setTimeout(resolve, 10));
      return new Response(
        JSON.stringify({
          access_token: "access-2",
          refresh_token: "refresh-2",
          mall_id: "demo",
          scopes: ["mall.read_product"],
        }),
        { status: 200 },
      );
    };

    const [first, second] = await Promise.all([
      refreshStoredToken(params, fetchImpl),
      refreshStoredToken(params, fetchImpl),
    ]);
    expect(calls).toBe(1);
    expect(first.accessToken).toBe("access-2");
    expect(second.accessToken).toBe("access-2");
  });

  it("실패한 refresh 뒤에는 잠금이 풀려 재시도할 수 있다", async () => {
    const failing = async () => new Response(JSON.stringify({ error: "invalid_grant" }), { status: 401 });
    await expect(refreshStoredToken(params, failing)).rejects.toThrow();

    let calls = 0;
    await withRefreshLock("demo", async () => {
      calls += 1;
      return token("access-3", "refresh-3");
    });
    expect(calls).toBe(1);
  });
});
