import { describe, expect, it, vi } from "vitest";
import { readCafe24Config } from "@/lib/cafe24/env";
import {
  CAFE24_OAUTH_SCOPES,
  OAUTH_STATE_TTL_MS,
  buildAuthorizeUrl,
  createOAuthState,
  exchangeAuthorizationCode,
  missingScopes,
  parseCafe24Token,
  verifyOAuthState,
} from "@/lib/cafe24/oauth";

const SECRET = "test-secret";

function tokenResponse(overrides: Record<string, unknown> = {}) {
  return {
    access_token: "access-123",
    expires_at: "2026-09-17T12:00:00.000",
    refresh_token: "refresh-123",
    refresh_token_expires_at: "2026-10-01T12:00:00.000",
    client_id: "client-1",
    mall_id: "demo",
    user_id: "admin",
    scopes: ["mall.read_product", "mall.write_product", "mall.read_store"],
    issued_at: "2026-09-17T10:00:00.000",
    shop_no: "1",
    token_type: "Bearer",
    ...overrides,
  };
}

describe("OAuth state", () => {
  it("서명한 state를 검증한다", () => {
    const state = createOAuthState(SECRET, "demo", 1_000_000);
    const check = verifyOAuthState(state, SECRET, 1_000_001);
    expect(check.ok).toBe(true);
    if (check.ok) expect(check.state.mallId).toBe("demo");
  });

  it("잘못된 mall_id는 state 생성 단계에서 거부한다", () => {
    expect(() => createOAuthState(SECRET, "evil/../host")).toThrow();
    expect(() => createOAuthState(SECRET, "demo.evil.com")).toThrow();
  });

  it("변조된 서명을 거부한다", () => {
    const state = createOAuthState(SECRET, "demo", 1_000_000);
    const tampered = `${state.slice(0, -1)}0`;
    const check = verifyOAuthState(tampered, SECRET, 1_000_001);
    expect(check.ok).toBe(false);
  });

  it("다른 비밀키로 서명된 state를 거부한다", () => {
    const state = createOAuthState(SECRET, "demo", 1_000_000);
    expect(verifyOAuthState(state, "other", 1_000_001).ok).toBe(false);
  });

  it("만료된 state를 거부한다", () => {
    const state = createOAuthState(SECRET, "demo", 1_000_000);
    const check = verifyOAuthState(state, SECRET, 1_000_000 + OAUTH_STATE_TTL_MS + 1);
    expect(check).toEqual({ ok: false, reason: "expired" });
  });

  it("형식이 어긋난 state를 거부한다", () => {
    expect(verifyOAuthState("nope", SECRET).ok).toBe(false);
  });
});

describe("buildAuthorizeUrl", () => {
  it("mall 도메인과 필수 파라미터를 만든다", () => {
    const url = new URL(
      buildAuthorizeUrl({
        mallId: "demo",
        clientId: "client-1",
        redirectUri: "https://app.example.com/api/cafe24/oauth/callback",
        state: "state-1",
        scope: CAFE24_OAUTH_SCOPES,
      }),
    );
    expect(url.origin).toBe("https://demo.cafe24api.com");
    expect(url.pathname).toBe("/api/v2/oauth/authorize");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("client_id")).toBe("client-1");
    expect(url.searchParams.get("state")).toBe("state-1");
    expect(url.searchParams.get("scope")).toBe(CAFE24_OAUTH_SCOPES.join(" "));
  });

  it("잘못된 mall_id로 URL을 만들지 않는다", () => {
    expect(() =>
      buildAuthorizeUrl({
        mallId: "demo.evil.com",
        clientId: "client-1",
        redirectUri: "https://app.example.com/cb",
        state: "state-1",
      }),
    ).toThrow();
  });
});

describe("parseCafe24Token", () => {
  it("토큰 응답을 정규화한다", () => {
    const token = parseCafe24Token(tokenResponse());
    expect(token.accessToken).toBe("access-123");
    expect(token.refreshToken).toBe("refresh-123");
    expect(token.scopes).toContain("mall.write_product");
    expect(missingScopes(token.scopes)).toEqual([]);
  });

  it("필수 값이 없으면 거부한다", () => {
    expect(() => parseCafe24Token({ access_token: "a" })).toThrow();
    expect(() => parseCafe24Token(null)).toThrow();
  });

  it("부족한 scope를 계산한다", () => {
    expect(missingScopes(["mall.read_product"])).toEqual(["mall.write_product"]);
  });
});

describe("exchangeAuthorizationCode", () => {
  it("Basic 인증과 form 본문으로 토큰을 요청한다", async () => {
    const fetchImpl = vi.fn(async (input: string, init?: RequestInit) => {
      expect(input).toBe("https://demo.cafe24api.com/api/v2/oauth/token");
      expect(init?.method).toBe("POST");
      const headers = init?.headers as Record<string, string>;
      expect(headers.Authorization).toBe(
        `Basic ${Buffer.from("client-1:secret-1").toString("base64")}`,
      );
      expect(String(init?.body)).toContain("grant_type=authorization_code");
      expect(String(init?.body)).toContain("code=code-1");
      return new Response(JSON.stringify(tokenResponse()), { status: 200 });
    });

    const token = await exchangeAuthorizationCode(
      {
        mallId: "demo",
        clientId: "client-1",
        clientSecret: "secret-1",
        code: "code-1",
        redirectUri: "https://app.example.com/api/cafe24/oauth/callback",
      },
      fetchImpl,
    );
    expect(token.accessToken).toBe("access-123");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("오류 응답이면 예외를 던진다", async () => {
    const fetchImpl = async () =>
      new Response(JSON.stringify({ error: "invalid_grant" }), { status: 401 });
    await expect(
      exchangeAuthorizationCode(
        {
          mallId: "demo",
          clientId: "client-1",
          clientSecret: "secret-1",
          code: "bad",
          redirectUri: "https://app.example.com/cb",
        },
        fetchImpl,
      ),
    ).rejects.toThrow(/invalid_grant/);
  });
});

describe("readCafe24Config", () => {
  it("필수 환경변수가 없으면 missing을 보고한다", () => {
    const result = readCafe24Config({});
    expect(result.ok).toBe(false);
    expect(result.missing).toEqual(["CAFE24_CLIENT_ID", "CAFE24_CLIENT_SECRET"]);
  });

  it("state secret이 없으면 client secret을 재사용한다", () => {
    const result = readCafe24Config({ CAFE24_CLIENT_ID: "id", CAFE24_CLIENT_SECRET: "secret" });
    expect(result.ok).toBe(true);
    expect(result.config?.stateSecret).toBe("secret");
  });
});
