export interface Cafe24Config {
  clientId: string;
  clientSecret: string;
  stateSecret: string;
  mallId: string | null;
  redirectUri: string | null;
}

export interface Cafe24ConfigResult {
  ok: boolean;
  config: Cafe24Config | null;
  missing: string[];
}

/**
 * 실제 공급가 쓰기 기능 활성화 여부. 한 품목 검증 전에는 켜지 않는다.
 * 기본값은 비활성(false)이다.
 */
export function isWriteEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return env.IMPORT_WRITE_ENABLED?.trim().toLowerCase() === "true";
}

export function readCafe24Config(
  env: Record<string, string | undefined> = process.env,
): Cafe24ConfigResult {
  const clientId = env.CAFE24_CLIENT_ID?.trim() ?? "";
  const clientSecret = env.CAFE24_CLIENT_SECRET?.trim() ?? "";
  const missing: string[] = [];
  if (!clientId) missing.push("CAFE24_CLIENT_ID");
  if (!clientSecret) missing.push("CAFE24_CLIENT_SECRET");
  if (!clientId || !clientSecret) {
    return { ok: false, config: null, missing };
  }
  return {
    ok: true,
    missing: [],
    config: {
      clientId,
      clientSecret,
      stateSecret: env.CAFE24_STATE_SECRET?.trim() || clientSecret,
      mallId: env.CAFE24_MALL_ID?.trim() || null,
      redirectUri: env.CAFE24_REDIRECT_URI?.trim() || null,
    },
  };
}
