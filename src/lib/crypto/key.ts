import { parseEncryptionKey } from "@/lib/crypto/secret-box";

export function getEncryptionKey(
  env: Record<string, string | undefined> = process.env,
): Buffer {
  const value = env.TOKEN_ENCRYPTION_KEY?.trim();
  if (!value) {
    throw new Error("TOKEN_ENCRYPTION_KEY가 설정되지 않았습니다.");
  }
  return parseEncryptionKey(value);
}
