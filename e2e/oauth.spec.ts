import { expect, test } from "@playwright/test";

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

test("start는 빈 mall_id를 기본값으로 대체한다", async ({ request }) => {
  test.skip(Boolean(process.env.E2E_BASE_URL), "기본 mall_id는 로컬 서버에서만 설정된다");
  const response = await request.get("/api/cafe24/oauth/start?mall_id=", { maxRedirects: 0 });
  expect(response.status()).toBe(302);
  expect(new URL(response.headers()["location"]).origin).toBe("https://e2e-mall.cafe24api.com");
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
