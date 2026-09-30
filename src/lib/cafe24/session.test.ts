import { describe, expect, it } from "vitest";
import {
  generateSessionToken,
  hashSessionToken,
  isSessionActive,
  isWellFormedSessionToken,
  sessionExpiresAt,
} from "@/lib/cafe24/session";

describe("session token", () => {
  it("43자 base64url 토큰을 만들고 매번 다르다", () => {
    const first = generateSessionToken();
    const second = generateSessionToken();
    expect(first).toHaveLength(43);
    expect(isWellFormedSessionToken(first)).toBe(true);
    expect(first).not.toBe(second);
  });

  it("해시는 결정적이고 원문과 다르다", () => {
    const token = generateSessionToken();
    expect(hashSessionToken(token)).toBe(hashSessionToken(token));
    expect(hashSessionToken(token)).not.toBe(token);
    expect(hashSessionToken(token)).toHaveLength(64);
  });

  it("형식이 어긋난 토큰을 거부한다", () => {
    expect(isWellFormedSessionToken("")).toBe(false);
    expect(isWellFormedSessionToken("short")).toBe(false);
    expect(isWellFormedSessionToken(`${generateSessionToken()} `)).toBe(false);
    const token = generateSessionToken();
    expect(isWellFormedSessionToken(`${token.slice(0, -1)}+`)).toBe(false);
  });
});

describe("session expiry", () => {
  const now = Date.parse("2026-09-17T00:00:00.000Z");

  it("TTL 뒤 만료 시각을 만든다", () => {
    expect(sessionExpiresAt(now, 1000).getTime()).toBe(now + 1000);
  });

  it("만료·철회 여부를 판정한다", () => {
    expect(isSessionActive(new Date(now + 1000), null, now)).toBe(true);
    expect(isSessionActive(new Date(now - 1000), null, now)).toBe(false);
    expect(isSessionActive(new Date(now + 1000), new Date(now - 1), now)).toBe(false);
  });
});
