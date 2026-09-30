import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  SECRET_BOX_VERSION,
  decryptSecret,
  encryptSecret,
  parseEncryptionKey,
} from "@/lib/crypto/secret-box";

function key(): Buffer {
  return randomBytes(32);
}

describe("parseEncryptionKey", () => {
  it("32바이트 base64 키를 받는다", () => {
    const raw = randomBytes(32);
    expect(parseEncryptionKey(raw.toString("base64"))).toEqual(raw);
  });

  it("빈 값과 잘못된 길이를 거부한다", () => {
    expect(() => parseEncryptionKey("   ")).toThrow(/비어/);
    expect(() => parseEncryptionKey(randomBytes(16).toString("base64"))).toThrow(/32바이트/);
  });
});

describe("secret-box", () => {
  it("암호화한 값을 같은 키로 복호화한다", () => {
    const secret = key();
    const envelope = encryptSecret("refresh-token-abc", secret);
    expect(envelope.startsWith(`${SECRET_BOX_VERSION}.`)).toBe(true);
    expect(envelope).not.toContain("refresh-token-abc");
    expect(decryptSecret(envelope, secret)).toBe("refresh-token-abc");
  });

  it("유니코드와 빈 문자열도 왕복한다", () => {
    const secret = key();
    expect(decryptSecret(encryptSecret("", secret), secret)).toBe("");
    expect(decryptSecret(encryptSecret("토큰-값", secret), secret)).toBe("토큰-값");
  });

  it("매번 다른 IV를 써서 암호문이 달라진다", () => {
    const secret = key();
    expect(encryptSecret("same", secret)).not.toBe(encryptSecret("same", secret));
  });

  it("다른 키로는 복호화하지 못한다", () => {
    const envelope = encryptSecret("secret", key());
    expect(() => decryptSecret(envelope, key())).toThrow(/복호화/);
  });

  it("변조된 암호문과 태그를 거부한다", () => {
    const secret = key();
    const envelope = encryptSecret("secret", secret);
    const [version, iv, tag, ciphertext] = envelope.split(".");
    const flipped = Buffer.from(ciphertext, "base64");
    flipped[0] ^= 0xff;
    expect(() =>
      decryptSecret([version, iv, tag, flipped.toString("base64")].join("."), secret),
    ).toThrow(/복호화/);
    expect(() =>
      decryptSecret([version, iv, tag, ciphertext].join("."), secret.subarray(0, 31)),
    ).toThrow(/32바이트/);
  });

  it("형식이 깨진 암호문을 거부한다", () => {
    const secret = key();
    expect(() => decryptSecret("plain", secret)).toThrow(/형식/);
    expect(() => decryptSecret("v2.a.b.c", secret)).toThrow(/형식/);
    expect(() => decryptSecret("v1.a.b", secret)).toThrow(/형식/);
  });
});
