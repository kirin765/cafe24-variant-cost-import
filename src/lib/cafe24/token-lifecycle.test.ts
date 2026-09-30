import { describe, expect, it } from "vitest";
import {
  classifyAccessToken,
  isRefreshTokenUsable,
  parseCafe24Instant,
} from "@/lib/cafe24/token-lifecycle";

describe("parseCafe24Instant", () => {
  it("타임존 없는 값은 KST(UTC+9)로 해석한다", () => {
    expect(parseCafe24Instant("2026-09-17T12:00:00.000")?.toISOString()).toBe(
      "2026-09-17T03:00:00.000Z",
    );
  });

  it("공백 구분자도 받는다", () => {
    expect(parseCafe24Instant("2026-09-17 12:00:00")?.toISOString()).toBe(
      "2026-09-17T03:00:00.000Z",
    );
  });

  it("명시적 타임존을 그대로 존중한다", () => {
    expect(parseCafe24Instant("2026-09-17T12:00:00.000Z")?.toISOString()).toBe(
      "2026-09-17T12:00:00.000Z",
    );
    expect(parseCafe24Instant("2026-09-17T12:00:00+02:00")?.toISOString()).toBe(
      "2026-09-17T10:00:00.000Z",
    );
  });

  it("빈 값과 잘못된 값을 null로 만든다", () => {
    expect(parseCafe24Instant("")).toBeNull();
    expect(parseCafe24Instant("   ")).toBeNull();
    expect(parseCafe24Instant(null)).toBeNull();
    expect(parseCafe24Instant("not-a-date")).toBeNull();
  });
});

describe("isRefreshTokenUsable", () => {
  const now = Date.parse("2026-09-17T00:00:00.000Z");

  it("만료가 없으면 사용 가능으로 본다", () => {
    expect(isRefreshTokenUsable(null, now)).toBe(true);
  });

  it("만료가 지났으면 false, 남았으면 true", () => {
    expect(isRefreshTokenUsable("2026-09-16T00:00:00.000Z", now)).toBe(false);
    expect(isRefreshTokenUsable("2026-10-01T00:00:00.000Z", now)).toBe(true);
  });
});

describe("classifyAccessToken", () => {
  const now = Date.parse("2026-09-17T00:00:00.000Z");
  const futureAccess = "2026-09-17T09:00:00.000Z";
  const pastAccess = "2026-09-16T09:00:00.000Z";
  const futureRefresh = "2026-10-01T00:00:00.000Z";
  const pastRefresh = "2026-09-16T00:00:00.000Z";

  it("access가 유효하면 fresh", () => {
    expect(classifyAccessToken(futureAccess, futureRefresh, now)).toBe("fresh");
  });

  it("access 만료 + refresh 유효면 refresh", () => {
    expect(classifyAccessToken(pastAccess, futureRefresh, now)).toBe("refresh");
  });

  it("refresh까지 만료면 reauth", () => {
    expect(classifyAccessToken(pastAccess, pastRefresh, now)).toBe("reauth");
    expect(classifyAccessToken(null, pastRefresh, now)).toBe("reauth");
  });

  it("만료 시각을 모르면 unknown", () => {
    expect(classifyAccessToken(null, futureRefresh, now)).toBe("unknown");
    expect(classifyAccessToken(null, null, now)).toBe("unknown");
    expect(classifyAccessToken("garbage", null, now)).toBe("unknown");
  });

  it("margin 안에 만료되면 미리 refresh한다", () => {
    const soon = new Date(now + 30_000).toISOString();
    expect(classifyAccessToken(soon, futureRefresh, now, 60_000)).toBe("refresh");
    expect(classifyAccessToken(soon, futureRefresh, now, 10_000)).toBe("fresh");
  });
});
