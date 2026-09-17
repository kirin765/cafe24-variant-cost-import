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
