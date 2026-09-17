import { describe, expect, it } from "vitest";
import { launchHmacInput, verifyLaunchHmac } from "@/lib/cafe24/launch";

const SECRET = "test-secret";
const RAW_QUERY =
  "is_multi_shop=T&lang=ko_KR&mall_id=onnurimun&nation=KR&shop_no=1&timestamp=1789632264&user_id=onnurimun&user_name=%EA%B9%80%EA%B8%B0%EC%99%84&user_type=P&hmac=kB9Xfr%2FLFUXItNzYW2CvuDwNEt3YT0GqWKf4jAX8p7Q%3D";
const RAW_QUERY_WITHOUT_HMAC =
  "is_multi_shop=T&lang=ko_KR&mall_id=onnurimun&nation=KR&shop_no=1&timestamp=1789632264&user_id=onnurimun&user_name=%EA%B9%80%EA%B8%B0%EC%99%84&user_type=P";

describe("launchHmacInput", () => {
  it("앞의 ?와 hmac 파라미터를 제거한다", () => {
    expect(launchHmacInput(`?${RAW_QUERY}`)).toBe(RAW_QUERY_WITHOUT_HMAC);
    expect(launchHmacInput(RAW_QUERY)).toBe(RAW_QUERY_WITHOUT_HMAC);
  });

  it("hmac이 중간에 있어도 제거한다", () => {
    expect(launchHmacInput("a=1&hmac=zzz&b=2")).toBe("a=1&b=2");
  });
});

describe("verifyLaunchHmac", () => {
  it("실제 Cafe24 launch 쿼리와 비밀키로 서명을 검증한다", () => {
    expect(verifyLaunchHmac(RAW_QUERY, "kB9Xfr/LFUXItNzYW2CvuDwNEt3YT0GqWKf4jAX8p7Q=", "1XkutkSXKJVh62SKdphULB")).toBe(true);
  });

  it("변조된 서명을 거부한다", () => {
    expect(verifyLaunchHmac(RAW_QUERY, "kB9Xfr/LFUXItNzYW2CvuDwNEt3YT0GqWKf4jAX8p7Q=", SECRET)).toBe(false);
  });

  it("값이 바뀌면 서명이 맞지 않는다", () => {
    const tampered = RAW_QUERY.replace("shop_no=1", "shop_no=2");
    expect(
      verifyLaunchHmac(tampered, "kB9Xfr/LFUXItNzYW2CvuDwNEt3YT0GqWKf4jAX8p7Q=", "1XkutkSXKJVh62SKdphULB"),
    ).toBe(false);
  });

  it("빈 서명을 거부한다", () => {
    expect(verifyLaunchHmac(RAW_QUERY, "", "1XkutkSXKJVh62SKdphULB")).toBe(false);
  });
});
