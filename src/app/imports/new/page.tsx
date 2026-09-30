import Link from "next/link";
import { ReconnectPrompt } from "@/app/imports/connection-prompt";
import { listImportJobs } from "@/features/imports/store";
import { listAdminProducts, type AdminProduct } from "@/lib/cafe24/admin";
import { getCurrentSession } from "@/lib/cafe24/auth";
import { isWriteEnabled, readCafe24Config } from "@/lib/cafe24/env";
import { CAFE24_REQUIRED_SCOPES, missingScopes } from "@/lib/cafe24/oauth";
import {
  getValidAccessToken,
  loadCredentialMetadata,
  type CredentialMetadata,
} from "@/lib/cafe24/shop-store";
import { getEncryptionKey } from "@/lib/crypto/key";
import { getPool, hasDatabaseUrl } from "@/lib/db/pool";
import { ReauthRequiredError, type SessionWithShop } from "@/lib/cafe24/store-model";
import { isRefreshTokenUsable, parseCafe24Instant } from "@/lib/cafe24/token-lifecycle";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ProductState =
  | { status: "idle" }
  | { status: "ok"; products: AdminProduct[] }
  | { status: "reauth"; reason: string }
  | { status: "error"; message: string };

async function loadProducts(access: SessionWithShop): Promise<ProductState> {
  const config = readCafe24Config();
  if (!config.ok || !config.config) {
    return { status: "error", message: "Cafe24 환경변수가 설정되지 않았습니다." };
  }
  try {
    const accessToken = await getValidAccessToken(getPool(), {
      shopId: access.shop.id,
      mallId: access.shop.mallId,
      clientId: config.config.clientId,
      clientSecret: config.config.clientSecret,
      encryptionKey: getEncryptionKey(),
    });
    const products = await listAdminProducts({
      mallId: access.shop.mallId,
      accessToken,
      shopNo: access.shop.shopNo,
      apiVersion: process.env.CAFE24_API_VERSION?.trim() || null,
    });
    return { status: "ok", products };
  } catch (error) {
    if (error instanceof ReauthRequiredError) {
      return { status: "reauth", reason: error.reason };
    }
    const message = error instanceof Error ? error.message : "알 수 없는 오류";
    return { status: "error", message };
  }
}

function formatInstant(raw: string | null): string {
  const parsed = parseCafe24Instant(raw);
  if (!parsed) return raw || "—";
  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Seoul",
  }).format(parsed);
}

const UPLOAD_ERRORS: Record<string, string> = {
  storage: "저장소(DATABASE_URL)가 설정되지 않았습니다.",
  session: "세션이 없습니다. Cafe24 앱을 다시 실행해 주세요.",
  config: "Cafe24 환경변수가 설정되지 않았습니다.",
  form: "업로드 요청을 해석하지 못했습니다.",
  file: "CSV 파일을 선택해 주세요.",
  empty_file: "빈 파일입니다.",
  size: "파일이 1MB를 넘습니다.",
  product_csv:
    "상품목록(상품코드·공급가) 파일은 옵션 식별자가 없어 품목별 변경에 쓸 수 없습니다. variant_code,supply_price 형식을 올려 주세요.",
  empty_variants: "이 몰에서 조회된 품목이 없습니다. 상품·옵션 등록 상태를 확인하세요.",
  reauth: "Cafe24 재인증이 필요합니다. 앱을 다시 실행해 주세요.",
  lookup: "품목 조회에 실패했습니다.",
};

function ShopCards({ access, metadata }: { access: SessionWithShop; metadata: CredentialMetadata | null }) {
  return (
    <section className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <div className="rounded border border-neutral-200 bg-white px-3 py-2">
        <p className="text-xs text-neutral-500">몰</p>
        <p className="mt-1 font-semibold" data-testid="shop-mall">
          {access.shop.mallId}
        </p>
      </div>
      <div className="rounded border border-neutral-200 bg-white px-3 py-2">
        <p className="text-xs text-neutral-500">쇼핑몰 번호 (shop_no)</p>
        <p className="mt-1 font-semibold" data-testid="shop-no">
          {access.shop.shopNo}
        </p>
      </div>
      <div className="rounded border border-neutral-200 bg-white px-3 py-2">
        <p className="text-xs text-neutral-500">통화</p>
        <p className="mt-1 font-semibold">{access.shop.currency}</p>
      </div>
      <div className="rounded border border-neutral-200 bg-white px-3 py-2">
        <p className="text-xs text-neutral-500">Access Token 만료 (KST)</p>
        <p className="mt-1 text-sm font-semibold">
          {formatInstant(metadata?.accessExpiresAt ?? null)}
        </p>
      </div>
    </section>
  );
}

export default async function NewImportPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const requestedMall = typeof params.mall_id === "string" ? params.mall_id : null;
  const configResult = readCafe24Config();
  const fallbackMall = requestedMall ?? configResult.config?.mallId ?? null;
  const shouldLookup = typeof params.lookup === "string";

  if (!hasDatabaseUrl()) {
    return (
      <ReconnectPrompt
        mallId={fallbackMall}
        message="DATABASE_URL이 설정되지 않아 연결을 복구할 수 없습니다. 서버 환경변수를 확인하세요."
      />
    );
  }

  const access = await getCurrentSession();
  if (!access) {
    return (
      <ReconnectPrompt
        mallId={fallbackMall}
        message="유효한 연결 세션이 없거나 만료되었습니다. Cafe24 앱을 다시 실행해 주세요."
      />
    );
  }

  // 요청 쿼리의 몰 ID만으로 세션의 몰과 다른 몰에 접근하지 못하게 한다.
  if (requestedMall && requestedMall !== access.shop.mallId) {
    return (
      <ReconnectPrompt
        mallId={requestedMall}
        message={`이 세션은 ${access.shop.mallId} 몰에 연결되어 있습니다. ${requestedMall} 몰은 다시 인증이 필요합니다.`}
      />
    );
  }

  let metadata: CredentialMetadata | null;
  try {
    metadata = await loadCredentialMetadata(getPool(), access.shop.id);
  } catch (error) {
    const message = error instanceof Error ? error.message : "알 수 없는 오류";
    return <ReconnectPrompt mallId={fallbackMall} message={`저장소를 읽지 못했습니다. ${message}`} />;
  }

  if (metadata && !isRefreshTokenUsable(metadata.refreshExpiresAt)) {
    return (
      <ReconnectPrompt
        mallId={access.shop.mallId}
        message="Cafe24 재인증이 필요합니다. refresh token이 만료되었거나 권한이 철회되었습니다."
      />
    );
  }

  const productState: ProductState = shouldLookup ? await loadProducts(access) : { status: "idle" };
  if (productState.status === "reauth") {
    return (
      <ReconnectPrompt
        mallId={access.shop.mallId}
        message={`Cafe24 재인증이 필요합니다 (${productState.reason}).`}
      />
    );
  }

  const missing = missingScopes(metadata?.scopes ?? []);
  const retryCount = Number(params.retry ?? 0) || 0;
  const lookupHref = shouldLookup
    ? `/imports/new?lookup=1&retry=${retryCount + 1}`
    : "/imports/new?lookup=1";
  const products = productState.status === "ok" ? productState.products : [];
  const withPrice = products.filter((entry) => entry.supplyPrice !== null).length;

  const errorCode = typeof params.error === "string" ? params.error : null;
  const errorDetail = typeof params.detail === "string" ? params.detail : null;
  const errorMessage = errorCode ? UPLOAD_ERRORS[errorCode] ?? "업로드를 처리하지 못했습니다." : null;

  let recentJobs: Awaited<ReturnType<typeof listImportJobs>> = [];
  try {
    recentJobs = await listImportJobs(getPool(), access.shop.id, 5);
  } catch {
    recentJobs = [];
  }

  return (
    <main className="mx-auto max-w-5xl px-4 py-10">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold tracking-widest text-neutral-500">NEW IMPORT</p>
          <h1 className="mt-1 text-xl font-bold">공급가 CSV 가져오기</h1>
          <p className="mt-1 text-xs text-neutral-500">
            {isWriteEnabled()
              ? "CSV를 올려 검토를 만들고, 실행 화면에서 확정 후 품목별 공급가를 반영합니다."
              : "CSV를 올려 품목을 조회·검토합니다. 공급가 쓰기는 비활성입니다."}
          </p>
        </div>
        <div className="flex gap-2">
          <Link
            className="rounded border border-neutral-300 bg-white px-3 py-1.5 text-xs font-semibold text-neutral-700"
            href="/demo"
          >
            데모
          </Link>
          <Link
            className="rounded border border-neutral-300 bg-white px-3 py-1.5 text-xs font-semibold text-neutral-700"
            href="/"
          >
            소개
          </Link>
        </div>
      </div>

      <ShopCards access={access} metadata={metadata} />

      <section className="mt-4 rounded border border-neutral-200 bg-white p-3 text-xs text-neutral-600">
        <p>
          승인 scope: <span className="font-mono">{metadata?.scopes.join(", ") || "—"}</span>
        </p>
        <p className="mt-1">
          Refresh Token 만료 (KST): {formatInstant(metadata?.refreshExpiresAt ?? null)}
        </p>
        {missing.length > 0 ? (
          <p className="mt-2 rounded border border-amber-300 bg-amber-50 p-2 text-amber-900">
            <strong>주의:</strong> 필수 scope가 부족합니다 — {missing.join(", ")}. 앱 권한을
            확인하세요. (필수: {CAFE24_REQUIRED_SCOPES.join(", ")})
          </p>
        ) : (
          <p className="mt-2 text-emerald-700">
            필수 scope {CAFE24_REQUIRED_SCOPES.join(", ")}가 모두 승인되었습니다.
          </p>
        )}
      </section>

      <section
        className="mt-4 rounded border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900"
        data-testid="supply-mode-guide"
      >
        <h2 className="text-sm font-bold">먼저 확인하세요 — 쇼핑몰의 공급가 관리 방식</h2>
        <p className="mt-1">
          품목별 공급가를 수정하려면 쇼핑몰의 <strong>&lsquo;공급가 관리 방식&rsquo;</strong>이{" "}
          <strong>&lsquo;품목 단위&rsquo;</strong>여야 합니다.
        </p>
        <ol className="mt-2 list-decimal space-y-0.5 pl-4">
          <li>
            Cafe24 관리자 &gt; 쇼핑몰 설정 &gt; 상품 설정 &gt; 상품 판매정보 설정으로 이동합니다.
          </li>
          <li>
            &lsquo;공급가 관리 방식&rsquo;을 &lsquo;상품 단위 (기본)&rsquo;에서 &lsquo;품목
            단위&rsquo;로 바꾸고 저장합니다.
          </li>
        </ol>
        <p className="mt-2">
          &lsquo;상품 단위&rsquo;이면 API가{" "}
          <code className="font-mono">422 Supply price by item cannot be modified.</code> 로
          거부합니다. &lsquo;판매가 계산 기준&rsquo;은 별도 설정이라 그대로 두어도 됩니다. 옵션 없는
          단일 품목 상품은 품목별 공급가를 지원하지 않습니다.
        </p>
      </section>

      {errorMessage ? (
        <section
          className="mt-4 rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800"
          data-testid="upload-error"
        >
          {errorMessage}
          {errorDetail ? (
            <span className="mt-1 block text-xs text-red-700">{errorDetail}</span>
          ) : null}
        </section>
      ) : null}

      <section className="mt-6 rounded border border-neutral-200 bg-white p-4" data-testid="csv-upload">
        <h2 className="text-sm font-bold">공급가 CSV 업로드</h2>
        <p className="mt-1 text-xs text-neutral-600">
          품목 단위 변경에는 <code className="font-mono">variant_code,supply_price</code> 형식만
          쓸 수 있습니다. 상품목록 내보내기(<code className="font-mono">상품코드</code>·
          <code className="font-mono">공급가</code>)는 옵션 식별자가 없어 자동 추정하지 않습니다.
        </p>
        <form
          className="mt-3 flex flex-wrap items-center gap-2"
          action="/api/imports"
          method="post"
          encType="multipart/form-data"
        >
          <input
            className="rounded border border-neutral-300 bg-white px-2 py-1 text-sm"
            type="file"
            name="file"
            accept=".csv,text/csv"
            required
          />
          <button
            className="rounded bg-neutral-900 px-3 py-1.5 text-xs font-semibold text-white"
            type="submit"
          >
            검토 만들기
          </button>
        </form>
        <p className="mt-2 text-xs text-neutral-500">
          최대 1MB / 1,000행. 업로드하면 연결된 몰의 실제 품목과 현재 공급가를 조회해 미리보기를
          만듭니다. 쓰기는 하지 않습니다.
        </p>
      </section>

      {recentJobs.length > 0 ? (
        <section className="mt-6 rounded border border-neutral-200 bg-white p-4" data-testid="recent-jobs">
          <h2 className="text-sm font-bold">최근 검토</h2>
          <ul className="mt-2 space-y-1 text-xs text-neutral-700">
            {recentJobs.map((job) => (
              <li key={job.id} className="flex flex-wrap gap-2">
                <Link className="font-semibold underline" href={`/imports/${job.id}/preview`}>
                  {job.fileName}
                </Link>
                <span className="text-neutral-500">
                  {job.createdAt.toISOString().slice(0, 10)} · 변경 {job.counts.changed} · 오류{" "}
                  {job.counts.errors}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="mt-6 rounded border border-neutral-200 bg-white p-4" data-testid="product-state">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-bold">연결 확인 (상품 조회)</h2>
          <Link
            className="rounded border border-neutral-300 bg-white px-3 py-1.5 text-xs font-semibold text-neutral-700"
            href={lookupHref}
          >
            {productState.status === "idle" ? "상품 조회" : "다시 시도"}
          </Link>
        </div>

        {productState.status === "idle" ? (
          <p className="mt-2 text-sm text-neutral-600">
            아직 조회하지 않았습니다. “상품 조회”를 눌러 연결된 몰의 상품을 확인하세요. 옵션별 품목과
            현재 공급가는 CSV 업로드 후 미리보기에서 조회합니다.
          </p>
        ) : productState.status === "ok" ? (
          <>
            <p className="mt-2 text-sm text-neutral-700">
              상품 {products.length}개를 조회했습니다. 공급가를 읽은 상품 {withPrice}개.
            </p>
            {products.length === 0 ? (
              <p className="mt-2 text-xs text-neutral-500">
                조회된 상품이 없습니다. 몰에 상품이 있는지 확인하세요.
              </p>
            ) : (
              <ul className="mt-2 space-y-0.5 text-xs text-neutral-600">
                {products.slice(0, 20).map((entry) => (
                  <li key={entry.productNo}>
                    <code>{entry.productNo}</code> {entry.productName}
                    {entry.supplyPrice === null ? " (공급가 없음)" : ""}
                  </li>
                ))}
                {products.length > 20 ? <li>…외 {products.length - 20}개</li> : null}
              </ul>
            )}
          </>
        ) : (
          <p className="mt-2 rounded border border-red-300 bg-red-50 p-2 text-sm text-red-800">
            품목 조회에 실패했습니다. {productState.status === "error" ? productState.message : ""}{" "}
            잠시 후 “다시 시도”를 눌러 주세요.
          </p>
        )}
      </section>

      <section className="mt-6 rounded border border-neutral-200 bg-neutral-50 p-4 text-sm text-neutral-700">
        <h2 className="text-sm font-bold">다음 단계</h2>
        <p className="mt-1">
          CSV를 올려 검토를 만든 뒤, 검토 화면에서 확정하고 실행 화면에서 반영합니다. 복원이 필요하면
          실행 화면의 ‘복원 검토 만들기’를 사용하세요.{" "}
          {isWriteEnabled()
            ? "현재 공급가 쓰기가 활성화되어 있습니다."
            : "공급가 쓰기가 비활성이라 지금은 조회·검토만 가능합니다."}
        </p>
      </section>
    </main>
  );
}
