import Link from "next/link";
import { ReconnectPrompt } from "@/app/imports/connection-prompt";
import { SUPPLY_CSV_FORMAT_LABELS, type ImportIssue } from "@/features/imports/model";
import { getImportJob, type StoredImportRow } from "@/features/imports/store";
import { getCurrentSession } from "@/lib/cafe24/auth";
import { isWriteEnabled } from "@/lib/cafe24/env";
import { getPool, hasDatabaseUrl } from "@/lib/db/pool";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VERDICT_STYLE: Record<StoredImportRow["verdict"], string> = {
  changed: "border-blue-300 bg-blue-50 text-blue-800",
  unchanged: "border-neutral-300 bg-neutral-100 text-neutral-700",
  error: "border-red-300 bg-red-50 text-red-800",
};

const VERDICT_LABEL: Record<StoredImportRow["verdict"], string> = {
  changed: "변경",
  unchanged: "동일",
  error: "오류",
};

function formatPrice(value: number | null): string {
  return value === null ? "—" : `${value.toLocaleString("ko-KR")}원`;
}

function CountCard({ label, value, testId }: { label: string; value: number; testId: string }) {
  return (
    <div className="rounded border border-neutral-200 bg-white px-3 py-2">
      <p className="text-xs text-neutral-500">{label}</p>
      <p className="mt-1 text-lg font-bold" data-testid={testId}>
        {value}
      </p>
    </div>
  );
}

function IssueList({ issues }: { issues: ImportIssue[] }) {
  if (issues.length === 0) return <span className="text-neutral-400">—</span>;
  return (
    <ul className="space-y-0.5">
      {issues.map((entry, index) => (
        <li
          key={`${entry.code}-${index}`}
          className={entry.severity === "error" ? "text-red-700" : "text-amber-700"}
        >
          [{entry.severity === "error" ? "오류" : "주의"}] {entry.message}
        </li>
      ))}
    </ul>
  );
}

function MissingJob({ mallId }: { mallId: string | null }) {
  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <h1 className="text-xl font-bold">검토를 찾을 수 없습니다</h1>
      <p className="mt-3 rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
        삭제되었거나 이 몰에 속하지 않는 검토입니다. 몰 권한이 있는 검토만 열 수 있습니다.
      </p>
      <Link
        className="mt-4 inline-block rounded border border-neutral-300 bg-white px-3 py-1.5 text-xs font-semibold text-neutral-700"
        href={mallId ? `/imports/new?mall_id=${encodeURIComponent(mallId)}` : "/imports/new"}
      >
        작업 화면으로
      </Link>
    </main>
  );
}

export default async function ImportPreviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  if (!hasDatabaseUrl()) {
    return (
      <ReconnectPrompt
        mallId={null}
        message="DATABASE_URL이 설정되지 않아 검토를 열 수 없습니다."
      />
    );
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

  let job;
  try {
    job = await getImportJob(getPool(), id, access.shop.id);
  } catch {
    return <MissingJob mallId={access.shop.mallId} />;
  }
  if (!job) return <MissingJob mallId={access.shop.mallId} />;

  return (
    <main className="mx-auto max-w-6xl px-4 py-10">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold tracking-widest text-neutral-500">IMPORT PREVIEW</p>
          <h1 className="mt-1 text-xl font-bold">공급가 변경 미리보기</h1>
          <p className="mt-1 text-xs text-neutral-500">
            {access.shop.mallId} · shop_no {access.shop.shopNo} · 파일{" "}
            <span className="font-mono">{job.fileName}</span>
          </p>
        </div>
        <div className="flex gap-2">
          <Link
            className="rounded border border-neutral-300 bg-white px-3 py-1.5 text-xs font-semibold text-neutral-700"
            href={`/imports/${job.id}`}
          >
            실행 화면
          </Link>
          <Link
            className="rounded border border-neutral-300 bg-white px-3 py-1.5 text-xs font-semibold text-neutral-700"
            href="/imports/new"
          >
            작업 화면으로
          </Link>
        </div>
      </div>

      <section className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <CountCard label="전체" value={job.counts.total} testId="count-total" />
        <CountCard label="매칭" value={job.counts.matched} testId="count-matched" />
        <CountCard label="변경" value={job.counts.changed} testId="count-changed" />
        <CountCard label="동일" value={job.counts.unchanged} testId="count-unchanged" />
        <CountCard label="오류" value={job.counts.errors} testId="count-errors" />
        <CountCard label="주의" value={job.counts.warnings} testId="count-warnings" />
      </section>

      <section className="mt-4 rounded border border-neutral-200 bg-white p-3 text-xs text-neutral-600">
        <p>
          미리보기 버전 {job.previewVersion} · 파일 해시{" "}
          <span className="font-mono">{job.fileHash.slice(0, 12)}</span> · 형식{" "}
          {SUPPLY_CSV_FORMAT_LABELS[job.format]} · 생성{" "}
          <span className="font-mono">{job.createdAt.toISOString()}</span>
        </p>
      </section>

      <section className="mt-4 rounded border border-neutral-300 bg-neutral-50 p-3 text-sm text-neutral-700">
        <strong>읽기 전용 미리보기입니다.</strong> 이 화면은 실제 품목 공급가를 변경하지 않습니다.{" "}
        {isWriteEnabled()
          ? "‘실행 화면’에서 확정 후 실행하면 목표 공급가를 반영합니다."
          : "공급가 쓰기가 비활성이라 지금은 조회·검토만 가능합니다."}
      </section>

      {job.fileIssues.length > 0 ? (
        <ul className="mt-4 space-y-1 rounded border border-red-300 bg-red-50 p-3 text-xs text-red-800">
          {job.fileIssues.map((entry, index) => (
            <li key={`${entry.code}-${index}`}>[파일] {entry.message}</li>
          ))}
        </ul>
      ) : null}

      {job.blocked ? (
        <section className="mt-4 rounded border border-red-400 bg-red-50 p-4">
          <h2 className="text-sm font-bold text-red-900">확정할 수 없습니다</h2>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-red-900">
            {job.blockReasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        </section>
      ) : (
        <section className="mt-4 rounded border border-emerald-300 bg-emerald-50 p-4">
          <h2 className="text-sm font-bold text-emerald-900">검증 통과</h2>
          <p className="mt-1 text-sm text-emerald-900">
            변경 {job.counts.changed}건, 동일 {job.counts.unchanged}건입니다.
          </p>
        </section>
      )}

      {job.format === "cafe24-product" ? (
        <p
          className="mt-4 rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900"
          data-testid="product-format-notice"
        >
          이 파일은 상품 단위(상품코드·공급가)입니다. 옵션별 품목 공급가를 바꾸려면 품목 코드
          (<code className="font-mono">variant_code</code>)가 있는 파일이 필요합니다.
        </p>
      ) : null}

      <section className="mt-6">
        {job.rows.length === 0 ? (
          <p className="rounded border border-neutral-200 bg-white p-4 text-sm text-neutral-600">
            표시할 데이터 행이 없습니다. 파일 형식과 내용을 확인하세요.
          </p>
        ) : (
          <div className="overflow-x-auto rounded border border-neutral-200 bg-white">
            <table className="min-w-full border-collapse text-left text-xs">
              <thead className="bg-neutral-100 text-neutral-600">
                <tr>
                  <th className="px-3 py-2 font-semibold">판정</th>
                  <th className="px-3 py-2 font-semibold">파일 행</th>
                  <th className="px-3 py-2 font-semibold">variant_code</th>
                  <th className="px-3 py-2 font-semibold">상품 / 옵션</th>
                  <th className="px-3 py-2 font-semibold">현재 공급가</th>
                  <th className="px-3 py-2 font-semibold">목표 공급가</th>
                  <th className="px-3 py-2 font-semibold">문제</th>
                </tr>
              </thead>
              <tbody>
                {job.rows.map((row) => (
                  <tr
                    key={`${row.line}-${row.variantCode}`}
                    className="border-t border-neutral-200 align-top"
                  >
                    <td className="px-3 py-2">
                      <span
                        className={`inline-block rounded border px-2 py-0.5 font-semibold ${VERDICT_STYLE[row.verdict]}`}
                      >
                        {VERDICT_LABEL[row.verdict]}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-neutral-500">{row.line}</td>
                    <td className="break-all px-3 py-2 font-mono">
                      {row.variantCode === "" ? (
                        <span className="text-red-700">(빈 값)</span>
                      ) : (
                        row.variantCode
                      )}
                    </td>
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
                    <td className="px-3 py-2">
                      <IssueList issues={row.issues} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
