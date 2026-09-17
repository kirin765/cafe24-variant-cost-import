import { refreshAccessToken, type Cafe24Token, type FetchLike, type RefreshAccessTokenParams } from "./oauth";

interface StoredToken {
  token: Cafe24Token;
  storedAt: number;
}

const tokens = new Map<string, StoredToken>();
const refreshLocks = new Map<string, Promise<Cafe24Token>>();

export const TOKEN_STORE_NOTE =
  "메모리 저장소입니다. 서버 재시작이나 서버리스 인스턴스 교체 시 사라지고, refresh 잠금도 인스턴스별로만 동작합니다. B단계에서 암호화된 DB ledger로 교체합니다.";

export function saveToken(mallId: string, token: Cafe24Token): void {
  tokens.set(mallId, { token, storedAt: Date.now() });
}

export function getToken(mallId: string): Cafe24Token | null {
  return tokens.get(mallId)?.token ?? null;
}

export function hasToken(mallId: string): boolean {
  return tokens.has(mallId);
}

export function clearToken(mallId: string): void {
  tokens.delete(mallId);
}

export function listMallIds(): string[] {
  return [...tokens.keys()];
}

export function withRefreshLock(
  mallId: string,
  task: () => Promise<Cafe24Token>,
): Promise<Cafe24Token> {
  const existing = refreshLocks.get(mallId);
  if (existing) return existing;
  const run = task().finally(() => {
    refreshLocks.delete(mallId);
  });
  refreshLocks.set(mallId, run);
  return run;
}

export async function refreshStoredToken(
  params: RefreshAccessTokenParams,
  fetchImpl: FetchLike = fetch,
): Promise<Cafe24Token> {
  return withRefreshLock(params.mallId, async () => {
    const token = await refreshAccessToken(params, fetchImpl);
    saveToken(params.mallId, token);
    return token;
  });
}
