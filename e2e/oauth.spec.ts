import { createHmac } from "node:crypto";
import { expect, test } from "@playwright/test";

const E2E_SECRET = process.env.CAFE24_CLIENT_SECRET ?? "e2e-client-secret";

function launchQuery(): string {
  return "is_multi_shop=T&lang=ko_KR&mall_id=demo&nation=KR&shop_no=1&timestamp=1&user_id=demo&user_type=P";
}

function sign(query: string): string {
  return createHmac("sha256", E2E_SECRET).update(query).digest("base64");
}

test("루트로 들어온 launch 요청을 launch 경로로 넘긴다", async ({ request }) => {
  const query = launchQuery();
  const response = await request.get(`/?${query}&hmac=${encodeURIComponent(sign(query))}`, {
    maxRedirects: 0,
  });
  expect(response.status()).toBe(307);
  const location = new URL(response.headers()["location"], "http://localhost");
  expect(location.pathname).toBe("/api/cafe24/launch");
  expect(location.searchParams.get("mall_id")).toBe("demo");
  expect(location.searchParams.get("shop_no")).toBe("1");
});

test("launch는 잘못된 hmac을 403으로 거부한다", async ({ request }) => {
  const response = await request.get("/api/cafe24/launch?mall_id=demo&hmac=not-valid", {
    maxRedirects: 0,
  });
  expect(response.status()).toBe(403);
});

test("launch는 유효한 hmac이면 start로 넘긴다", async ({ request }) => {
  test.skip(Boolean(process.env.E2E_BASE_URL), "로컬 e2e 비밀키로만 서명을 만들 수 있다");
  const query = launchQuery();
  const response = await request.get(
    `/api/cafe24/launch?${query}&hmac=${encodeURIComponent(sign(query))}`,
    { maxRedirects: 0 },
  );
  expect(response.status()).toBe(302);
  const location = new URL(response.headers()["location"], "http://localhost");
  expect(location.pathname).toBe("/api/cafe24/oauth/start");
  expect(location.searchParams.get("mall_id")).toBe("demo");
  expect(location.searchParams.get("shop_no")).toBe("1");
});

test("launch는 hmac 없이 mall_id만으로도 시작한다", async ({ request }) => {
  const response = await request.get("/api/cafe24/launch?mall_id=demo", { maxRedirects: 0 });
  expect(response.status()).toBe(302);
});

test("start는 Cafe24 authorize URL로 리다이렉트하고 state 쿠키를 심는다", async ({ request }) => {
  const response = await request.get("/api/cafe24/oauth/start?mall_id=demo", { maxRedirects: 0 });
  expect(response.status()).toBe(302);

  const location = response.headers()["location"];
  expect(location).toBeTruthy();
  const url = new URL(location);
  expect(url.origin).toBe("https://demo.cafe24api.com");
  expect(url.pathname).toBe("/api/v2/oauth/authorize");
  expect(url.searchParams.get("response_type")).toBe("code");
  expect(url.searchParams.get("client_id")).toBeTruthy();
  expect(url.searchParams.get("state")).toBeTruthy();
  expect(url.searchParams.get("redirect_uri")).toContain("/api/cafe24/oauth/callback");
  expect(url.searchParams.get("scope")).toContain("mall.write_product");

  const setCookie = response.headers()["set-cookie"] ?? "";
  expect(setCookie).toContain("cafe24_oauth_state=");
  expect(setCookie.toLowerCase()).toContain("httponly");
});

test("launch는 mall_id·shop_no를 보존해 OAuth start로 넘긴다", async ({ request }) => {
  const response = await request.get("/api/cafe24/launch?mall_id=demo&shop_no=2", {
    maxRedirects: 0,
  });
  expect(response.status()).toBe(302);
  const location = new URL(response.headers()["location"], "http://localhost");
  expect(location.pathname).toBe("/api/cafe24/oauth/start");
  expect(location.searchParams.get("mall_id")).toBe("demo");
  expect(location.searchParams.get("shop_no")).toBe("2");
});

test("start는 shop_no를 authorize URL에 넣는다", async ({ request }) => {
  const response = await request.get("/api/cafe24/oauth/start?mall_id=demo&shop_no=2", {
    maxRedirects: 0,
  });
  expect(response.status()).toBe(302);
  expect(new URL(response.headers()["location"], "http://localhost").searchParams.get("shop_no")).toBe("2");
});

test("start는 빈 mall_id를 기본값으로 대체한다", async ({ request }) => {
  test.skip(Boolean(process.env.E2E_BASE_URL), "기본 mall_id는 로컬 서버에서만 설정된다");
  const response = await request.get("/api/cafe24/oauth/start?mall_id=", { maxRedirects: 0 });
  expect(response.status()).toBe(302);
  expect(new URL(response.headers()["location"], "http://localhost").origin).toBe("https://e2e-mall.cafe24api.com");
});

test("start는 잘못된 mall_id를 거부한다", async ({ request }) => {
  const response = await request.get("/api/cafe24/oauth/start?mall_id=evil.example.com", {
    maxRedirects: 0,
  });
  expect(response.status()).toBe(400);
});

test("callback은 state 없이는 토큰을 교환하지 않는다", async ({ request }) => {
  const response = await request.get("/api/cafe24/oauth/callback?code=abc&state=fake", {
    maxRedirects: 0,
  });
  expect(response.status()).toBe(400);
  const body = await response.text();
  expect(body).toContain("state");
});

test("callback은 사용자가 거부하면 실패로 안내한다", async ({ request }) => {
  const response = await request.get(
    "/api/cafe24/oauth/callback?error=access_denied&error_description=denied",
    { maxRedirects: 0 },
  );
  expect(response.status()).toBe(400);
  expect(await response.text()).toContain("access_denied");
});
