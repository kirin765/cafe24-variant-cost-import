import { describe, expect, it } from "vitest";
import { buildPoolConfig, readDatabaseUrl, readMigrationUrl } from "@/lib/db/pool";

describe("readDatabaseUrl", () => {
  it("DATABASE_URL을 POSTGRES_URL보다 먼저 쓴다", () => {
    expect(
      readDatabaseUrl({ DATABASE_URL: "postgres://a", POSTGRES_URL: "postgres://b" }),
    ).toBe("postgres://a");
    expect(readDatabaseUrl({ POSTGRES_URL: "postgres://b" })).toBe("postgres://b");
  });

  it("없으면 null이고 공백은 무시한다", () => {
    expect(readDatabaseUrl({})).toBeNull();
    expect(readDatabaseUrl({ DATABASE_URL: "   " })).toBeNull();
  });
});

describe("readMigrationUrl", () => {
  it("unpooled를 우선하고 없으면 pooled로 떨어진다", () => {
    expect(
      readMigrationUrl({
        DATABASE_URL: "postgres://pooled",
        DATABASE_URL_UNPOOLED: "postgres://direct",
      }),
    ).toBe("postgres://direct");
    expect(readMigrationUrl({ DATABASE_URL: "postgres://pooled" })).toBe("postgres://pooled");
  });
});

describe("buildPoolConfig", () => {
  it("sslmode를 제거하고 원격 호스트에 TLS 검증을 켠다", () => {
    const config = buildPoolConfig(
      "postgresql://u:p@ep-x-pooler.c-11.us-east-1.aws.neon.tech/neondb?sslmode=require",
    );
    expect(config.ssl).toEqual({ rejectUnauthorized: true });
    expect(config.connectionString).not.toContain("sslmode");
    expect(config.max).toBe(5);
  });

  it("sslmode=disable은 TLS를 끈다", () => {
    expect(buildPoolConfig("postgresql://u:p@db.example.com/x?sslmode=disable").ssl).toBe(false);
  });

  it("localhost는 sslmode가 없으면 TLS를 끄고 명시하면 켠다", () => {
    expect(buildPoolConfig("postgresql://u:p@localhost:5432/x").ssl).toBe(false);
    expect(buildPoolConfig("postgresql://u:p@127.0.0.1:5432/x?sslmode=require").ssl).toEqual({
      rejectUnauthorized: true,
    });
  });

  it("max를 지정할 수 있다", () => {
    expect(buildPoolConfig("postgresql://u:p@db.example.com/x", 1).max).toBe(1);
  });
});
