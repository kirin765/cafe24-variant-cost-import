import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export const SECRET_BOX_VERSION = "v1";
const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const PARTS = 4;

export function parseEncryptionKey(value: string): Buffer {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new Error("TOKEN_ENCRYPTION_KEY가 비어 있습니다.");
  }
  const decoded = Buffer.from(trimmed, "base64");
  if (decoded.length !== KEY_BYTES) {
    throw new Error(
      `TOKEN_ENCRYPTION_KEY는 32바이트여야 합니다 (base64 디코딩 결과 ${decoded.length}바이트).`,
    );
  }
  return decoded;
}

export function encryptSecret(plaintext: string, key: Buffer): string {
  if (key.length !== KEY_BYTES) {
    throw new Error(`암호화 키는 ${KEY_BYTES}바이트여야 합니다.`);
  }
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    SECRET_BOX_VERSION,
    iv.toString("base64"),
    tag.toString("base64"),
    ciphertext.toString("base64"),
  ].join(".");
}

export function decryptSecret(envelope: string, key: Buffer): string {
  if (key.length !== KEY_BYTES) {
    throw new Error(`암호화 키는 ${KEY_BYTES}바이트여야 합니다.`);
  }
  const parts = envelope.split(".");
  if (parts.length !== PARTS || parts[0] !== SECRET_BOX_VERSION) {
    throw new Error("암호문 형식이 올바르지 않습니다.");
  }
  const iv = Buffer.from(parts[1], "base64");
  const tag = Buffer.from(parts[2], "base64");
  const ciphertext = Buffer.from(parts[3], "base64");
  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) {
    throw new Error("암호문 형식이 올바르지 않습니다.");
  }
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  } catch {
    throw new Error("암호문을 복호화하지 못했습니다. 키가 다르거나 변조되었습니다.");
  }
}
