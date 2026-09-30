import Link from "next/link";
import { ReconnectPrompt } from "@/app/imports/connection-prompt";
import { isWriteEnabled } from "@/lib/cafe24/env";
import { getCurrentSession } from "@/lib/cafe24/auth";
import { getPool, hasDatabaseUrl } from "@/lib/db/pool";
import type { RowStatus } from "@/features/imports/executor";
import { getImportJob, type StoredImportRow } from "@/features/imports/store";
import { PromoCard } from "./promo-card";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const JOB_STATUS_LABELS: Record<string, string> = {
  preview: "미리보기",
  confirmed: "확정됨",
  running: "실행 중",
  completed: "완료",
  partial_failure: "부분 실패",
  needs_review: "재검토 필요",
  cancelled: "취소",
};

const ROW_STATUS_STYLE: Record<RowStatus, string> = {
  pending: "border-neutral-300 bg-neutral-100 text-neutral-700",
  success: "border-emerald-300 bg-emerald-50 text-emerald-800",
  failed: "border-red-300 bg-red-50 text-red-800",
  conflict: "border-amber-300 bg-amber-50 text-amber-900",
  unknown: "border-purple-300 bg-purple-50 text-purple-800",
  unchanged: "border-neutral-300 bg-neutral-50 text-neutral-600",
  skipped: "border-neutral-300 bg-neutral-100 text-neutral-500",
};

const ROW_STATUS_LABELS: Record<RowStatus, string> = {
  pending: "대기",
  success: "성공",
  failed: "실패",
  conflict: "충돌",
  unknown: "결과 불명",
  unchanged: "동일",
  skipped: "건너뜀",
};

const MESSAGES: Record<string, string> = {
  storage: "저장소가 설정되지 않았습니다.",
  not_found: "작업을 찾을 수 없습니다.",
  blocked: "오류 행이 있어 확정할 수 없습니다.",
  confirm_failed: "확정에 실패했습니다. 파일이 바뀌었는지 확인하세요.",
  not_confirmed: "먼저 확정해야 실행할 수 있습니다.",
  write_disabled:
    "공급가 쓰기가 비활성입니다. 한 품목 실제 검증 후 IMPORT_WRITE_ENABLED=true 로 켭니다.",
  no_success: "성공한 행이 없어 복원 검토를 만들 수 없습니다.",
  config: "Cafe24 환경변수가 설정되지 않았습니다.",
  reauth: "Cafe24 재인증이 필요합니다.",
};

function formatPrice(value: number | null): string {
  return value === null ? "—" : `${value.toLocaleString("ko-KR")}원`;
}

function ResultTable({ rows }: { rows: StoredImportRow[] }) {
  if (rows.length === 0) {
    return (
      <p className="rounded border border-neutral-200 bg-white p-4 text-sm text-neutral-600">
        행이 없습니다.
      </p>
    );
  }
  return (
    <div className="overflow-x-auto rounded border border-neutral-200 bg-white">
      <table className="min-w-full border-collapse text-left text-xs">
        <thead className="bg-neutral-100 text-neutral-600">
          <tr>
            <th className="px-3 py-2 font-semibold">상태</th>
            <th className="px-3 py-2 font-semibold">행</th>
            <th className="px-3 py-2 font-semibold">variant_code</th>
            <th className="px-3 py-2 font-semibold">상품 / 옵션</th>
            <th className="px-3 py-2 font-semibold">이전</th>
            <th className="px-3 py-2 font-semibold">목표</th>
            <th className="px-3 py-2 font-semibold">메시지</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-t border-neutral-200 align-top">
              <td className="px-3 py-2">
                <span
                  className={`inline-block rounded border px-2 py-0.5 font-semibold ${ROW_STATUS_STYLE[row.status]}`}
                  data-testid={`row-status-${row.variantCode}`}
                >
                  {ROW_STATUS_LABELS[row.status]}
                </span>
              </td>
              <td className="px-3 py-2 text-neutral-500">{row.line}</td>
              <td className="break-all px-3 py-2 font-mono">{row.variantCode}</td>
              <td className="px-3 py-2">
                {row.productName ? (
                  <>
                    <span className="font-medium">{row.productName}</span>
                    <span className="block text-neutral-500">
                      {row.productNo} {row.optionName}
                    </span>
                  </>
                ) : (
                  <span className="text-neutral-400">미매칭</span>
                )}
              </td>
              <td className="px-3 py-2 tabular-nums">{formatPrice(row.beforePrice)}</td>
              <td className="px-3 py-2 tabular-nums">{formatPrice(row.afterPrice)}</td>
              <td className="px-3 py-2 text-neutral-600">{row.resultMessage ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default async function ImportJobPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const query = await searchParams;

  if (!hasDatabaseUrl()) {
    return <ReconnectPrompt mallId={null} message="DATABASE_URL이 설정되지 않았습니다." />;
  }
  const access = await getCurrentSession();
  if (!access) {
    return (
      <ReconnectPrompt
        mallId={null}
        message="유효한 연결 세션이 없거나 만료되었습니다. Cafe24 앱을 다시 실행해 주세요."
      />
    );
  }

  const job = await getImportJob(getPool(), id, access.shop.id);
  if (!job) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-10">
        <h1 className="text-xl font-bold">작업을 찾을 수 없습니다</h1>
        <Link className="mt-4 inline-block text-sm underline" href="/imports/new">
          작업 화면으로
        </Link>
      </main>
    );
  }

  const writeEnabled = isWriteEnabled();
  const errorCode = typeof query.error === "string" ? query.error : null;
  const confirmed = typeof query.confirmed === "string";
  const runStatus = typeof query.run === "string" ? query.run : null;
  const successRows = job.rows.filter((row) => row.status === "success").length;
  const canConfirm = job.status === "preview" && !job.blocked && writeEnabled;
  const canRun =
    writeEnabled &&
    ["confirmed", "running", "needs_review", "partial_failure"].includes(job.status);
  const canRestore = writeEnabled && successRows > 0;
  // 리뷰이사 추천: 깨끗하게 완료된 작업(성공 행이 있고 미해결 실패·충돌·불명·대기 없음)에서만.
  const promoEligible =
    job.status === "completed" &&
    successRows > 0 &&
    job.rows.every(
      (row) => row.status !== "failed" && row.status !== "conflict" && row.status !== "unknown" && row.status !== "pending",
    );

  return (
    <main className="mx-auto max-w-6xl px-4 py-10">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold tracking-widest text-neutral-500">IMPORT JOB</p>
          <h1 className="mt-1 text-xl font-bold">
            {job.fileName}{" "}
            <span className="text-sm font-semibold text-neutral-500" data-testid="job-status">
              {JOB_STATUS_LABELS[job.status] ?? job.status}
            </span>
          </h1>
          <p className="mt-1 text-xs text-neutral-500">
            {access.shop.mallId} · shop_no {access.shop.shopNo} · 파일 해시{" "}
            <span className="font-mono">{job.fileHash.slice(0, 12)}</span>
          </p>
        </div>
        <div className="flex gap-2">
          <Link
            className="rounded border border-neutral-300 bg-white px-3 py-1.5 text-xs font-semibold text-neutral-700"
            href={`/imports/${job.id}/preview`}
          >
            미리보기
          </Link>
          <Link
            className="rounded border border-neutral-300 bg-white px-3 py-1.5 text-xs font-semibold text-neutral-700"
            href="/imports/new"
          >
            작업 화면
          </Link>
        </div>
      </div>

      {errorCode ? (
        <p
          className="mt-4 rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800"
          data-testid="job-error"
        >
          {MESSAGES[errorCode] ?? "요청을 처리하지 못했습니다."}
        </p>
      ) : null}
      {confirmed ? (
        <p className="mt-4 rounded border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-800">
          확정했습니다. 실행하면 실제 공급가를 수정합니다.
        </p>
      ) : null}
      {runStatus ? (
        <p className="mt-4 rounded border border-neutral-300 bg-white p-3 text-sm text-neutral-700">
          실행 결과: {JOB_STATUS_LABELS[runStatus] ?? runStatus}
        </p>
      ) : null}

      {!writeEnabled ? (
        <p
          className="mt-4 rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900"
          data-testid="write-disabled"
        >
          공급가 쓰기가 비활성입니다. 테스트몰에서 한 품목 변경·복원을 수동 검증한 뒤
          <code className="mx-1 font-mono">IMPORT_WRITE_ENABLED=true</code>로 켭니다. 지금은
          조회·검토만 가능합니다.
        </p>
      ) : null}

      <section className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <div className="rounded border border-neutral-200 bg-white px-3 py-2">
          <p className="text-xs text-neutral-500">변경</p>
          <p className="mt-1 text-lg font-bold">{job.counts.changed}</p>
        </div>
        <div className="rounded border border-neutral-200 bg-white px-3 py-2">
          <p className="text-xs text-neutral-500">성공</p>
          <p className="mt-1 text-lg font-bold" data-testid="count-success">
            {job.rows.filter((row) => row.status === "success").length}
          </p>
        </div>
        <div className="rounded border border-neutral-200 bg-white px-3 py-2">
          <p className="text-xs text-neutral-500">실패</p>
          <p className="mt-1 text-lg font-bold" data-testid="count-failed">
            {job.rows.filter((row) => row.status === "failed").length}
          </p>
        </div>
        <div className="rounded border border-neutral-200 bg-white px-3 py-2">
          <p className="text-xs text-neutral-500">충돌</p>
          <p className="mt-1 text-lg font-bold" data-testid="count-conflict">
            {job.rows.filter((row) => row.status === "conflict").length}
          </p>
        </div>
        <div className="rounded border border-neutral-200 bg-white px-3 py-2">
          <p className="text-xs text-neutral-500">결과 불명</p>
          <p className="mt-1 text-lg font-bold">{job.rows.filter((row) => row.status === "unknown").length}</p>
        </div>
        <div className="rounded border border-neutral-200 bg-white px-3 py-2">
          <p className="text-xs text-neutral-500">대기</p>
          <p className="mt-1 text-lg font-bold">{job.rows.filter((row) => row.status === "pending").length}</p>
        </div>
      </section>

      <section className="mt-6 flex flex-wrap gap-2">
        <form action={`/api/imports/${job.id}/confirm`} method="post">
          <button
            className="rounded bg-neutral-900 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40"
            type="submit"
            disabled={!canConfirm}
          >
            확정
          </button>
        </form>
        <form action={`/api/imports/${job.id}/run`} method="post">
          <button
            className="rounded bg-red-700 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40"
            type="submit"
            disabled={!canRun}
          >
            실행
          </button>
        </form>
        <form action={`/api/imports/${job.id}/restore`} method="post">
          <button
            className="rounded border border-neutral-300 bg-white px-3 py-1.5 text-xs font-semibold text-neutral-800 disabled:opacity-40"
            type="submit"
            disabled={!canRestore}
          >
            복원 검토 만들기
          </button>
        </form>
      </section>

      <section className="mt-6">
        <ResultTable rows={job.rows} />
      </section>

      {promoEligible ? (
        <PromoCard mallId={access.shop.mallId} shopNo={access.shop.shopNo} />
      ) : null}
    </main>
  );
}
