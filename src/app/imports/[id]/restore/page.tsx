import Link from "next/link";
import { ReconnectPrompt } from "@/app/imports/connection-prompt";
import { isWriteEnabled } from "@/lib/cafe24/env";
import { getCurrentSession } from "@/lib/cafe24/auth";
import { getPool, hasDatabaseUrl } from "@/lib/db/pool";
import { getRestoreJob, type StoredRestoreRow } from "@/features/imports/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VERDICT_STYLE: Record<string, string> = {
  restorable: "border-emerald-300 bg-emerald-50 text-emerald-800",
  conflict: "border-amber-300 bg-amber-50 text-amber-900",
  error: "border-red-300 bg-red-50 text-red-800",
};

const VERDICT_LABEL: Record<string, string> = {
  restorable: "복원 가능",
  conflict: "충돌",
  error: "오류",
};

const RESULT_LABEL: Record<string, string> = {
  pending: "대기",
  success: "성공",
  failed: "실패",
  conflict: "충돌",
  unknown: "결과 불명",
  skipped: "건너뜀",
};

function formatPrice(value: number | null): string {
  return value === null ? "—" : `${value.toLocaleString("ko-KR")}원`;
}

function RestoreTable({ rows }: { rows: StoredRestoreRow[] }) {
  return (
    <div className="overflow-x-auto rounded border border-neutral-200 bg-white">
      <table className="min-w-full border-collapse text-left text-xs">
        <thead className="bg-neutral-100 text-neutral-600">
          <tr>
            <th className="px-3 py-2 font-semibold">판정</th>
            <th className="px-3 py-2 font-semibold">variant_code</th>
            <th className="px-3 py-2 font-semibold">현재</th>
            <th className="px-3 py-2 font-semibold">작업 목표</th>
            <th className="px-3 py-2 font-semibold">복원 값</th>
            <th className="px-3 py-2 font-semibold">실행</th>
            <th className="px-3 py-2 font-semibold">문제</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-t border-neutral-200 align-top">
              <td className="px-3 py-2">
                <span
                  className={`inline-block rounded border px-2 py-0.5 font-semibold ${VERDICT_STYLE[row.verdict] ?? "border-neutral-300 bg-neutral-100"}`}
                >
                  {VERDICT_LABEL[row.verdict] ?? row.verdict}
                </span>
              </td>
              <td className="break-all px-3 py-2 font-mono">{row.variantCode}</td>
              <td className="px-3 py-2 tabular-nums">{formatPrice(row.currentPrice)}</td>
              <td className="px-3 py-2 tabular-nums">{formatPrice(row.targetPrice)}</td>
              <td className="px-3 py-2 tabular-nums">{formatPrice(row.restorePrice)}</td>
              <td className="px-3 py-2">
                {RESULT_LABEL[row.result] ?? row.result}
                {row.resultMessage ? (
                  <span className="block text-neutral-500">{row.resultMessage}</span>
                ) : null}
              </td>
              <td className="px-3 py-2">
                {row.issues.length === 0 ? (
                  <span className="text-neutral-400">—</span>
                ) : (
                  <ul className="space-y-0.5">
                    {row.issues.map((entry, index) => (
                      <li
                        key={`${entry.code}-${index}`}
                        className={entry.severity === "error" ? "text-red-700" : "text-amber-700"}
                      >
                        [{entry.severity === "error" ? "오류" : "주의"}] {entry.message}
                      </li>
                    ))}
                  </ul>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default async function RestorePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const rid = typeof query.rid === "string" ? query.rid : null;

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

  const writeEnabled = isWriteEnabled();
  const errorCode = typeof query.error === "string" ? query.error : null;
  const restoreJob = rid ? await getRestoreJob(getPool(), rid, access.shop.id) : null;

  const restorable = restoreJob?.rows.filter((row) => row.verdict === "restorable").length ?? 0;

  return (
    <main className="mx-auto max-w-6xl px-4 py-10">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold tracking-widest text-neutral-500">RESTORE</p>
          <h1 className="mt-1 text-xl font-bold">공급가 복원 검토</h1>
          <p className="mt-1 text-xs text-neutral-500">
            현재 값이 원작업의 목표값과 같을 때만 이전 값으로 복원을 제안합니다. 다르면 충돌로
            남기고 자동 복원하지 않습니다.
          </p>
        </div>
        <Link
          className="rounded border border-neutral-300 bg-white px-3 py-1.5 text-xs font-semibold text-neutral-700"
          href={`/imports/${id}`}
        >
          작업으로
        </Link>
      </div>

      {!writeEnabled ? (
        <p
          className="mt-4 rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900"
          data-testid="write-disabled"
        >
          공급가 쓰기가 비활성입니다. 한 품목 실제 검증 후 <code className="font-mono">IMPORT_WRITE_ENABLED=true</code>
          로 켭니다.
        </p>
      ) : null}

      {errorCode ? (
        <p className="mt-4 rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800">
          {errorCode === "write_disabled"
            ? "쓰기가 비활성입니다."
            : errorCode === "no_success"
              ? "성공한 행이 없습니다."
              : "복원 요청을 처리하지 못했습니다."}
        </p>
      ) : null}

      {!restoreJob ? (
        <section className="mt-6 rounded border border-neutral-200 bg-white p-4">
          <p className="text-sm text-neutral-700">
            아직 복원 검토가 없습니다. 만들면 현재 값과 원작업 목표값을 비교해 복원 가능/충돌을
            계산합니다.
          </p>
          <form className="mt-3" action={`/api/imports/${id}/restore`} method="post">
            <button
              className="rounded border border-neutral-300 bg-white px-3 py-1.5 text-xs font-semibold text-neutral-800 disabled:opacity-40"
              type="submit"
              disabled={!writeEnabled}
            >
              복원 검토 만들기
            </button>
          </form>
        </section>
      ) : (
        <>
          <section className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
            <div className="rounded border border-neutral-200 bg-white px-3 py-2">
              <p className="text-xs text-neutral-500">복원 가능</p>
              <p className="mt-1 text-lg font-bold" data-testid="restore-ready">
                {restorable}
              </p>
            </div>
            <div className="rounded border border-neutral-200 bg-white px-3 py-2">
              <p className="text-xs text-neutral-500">충돌</p>
              <p className="mt-1 text-lg font-bold">
                {restoreJob.rows.filter((row) => row.verdict === "conflict").length}
              </p>
            </div>
            <div className="rounded border border-neutral-200 bg-white px-3 py-2">
              <p className="text-xs text-neutral-500">상태</p>
              <p className="mt-1 text-sm font-bold">{restoreJob.status}</p>
            </div>
          </section>

          <section className="mt-4 flex flex-wrap gap-2">
            <form action={`/api/imports/${id}/restore/run`} method="post">
              <input type="hidden" name="rid" value={restoreJob.id} />
              <button
                className="rounded bg-red-700 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40"
                type="submit"
                disabled={!writeEnabled || restorable === 0}
              >
                복원 실행 ({restorable}건)
              </button>
            </form>
          </section>

          <section className="mt-6">
            <RestoreTable rows={restoreJob.rows} />
          </section>
        </>
      )}
    </main>
  );
}
