"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { buildPreview, buildUnappliedNotice, canConfirm, toChangeSpecCsv, toManifest, toReviewCsv } from "@/features/imports/preview";
import { buildPlatformSnapshot } from "@/features/imports/platform-snapshot";
import { SUPPLY_CSV_FORMAT_LABELS } from "@/features/imports/model";
import type { ImportPreview, ImportRow, PlatformVariant } from "@/features/imports/model";
import { FixtureVariantGateway } from "@/lib/cafe24/gateway";
import { downloadTextFile } from "@/lib/download";
import { IMPORT_FILES, SHOPS, VARIANTS, findImportFile, findShop } from "@/fixtures/supply-price-import";

const gateway = new FixtureVariantGateway(VARIANTS);

type Verdict = ImportRow["verdict"];

const VERDICT_STYLE: Record<Verdict, string> = {
  changed: "border-blue-300 bg-blue-50 text-blue-800",
  unchanged: "border-neutral-300 bg-neutral-100 text-neutral-700",
  error: "border-red-300 bg-red-50 text-red-800",
};

const VERDICT_LABEL: Record<Verdict, string> = {
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

function IssueList({ row }: { row: ImportRow }) {
  if (row.issues.length === 0) return <span className="text-neutral-400">—</span>;
  return (
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
  );
}

function PreviewTable({ preview }: { preview: ImportPreview }) {
  if (preview.rows.length === 0) {
    return (
      <p className="rounded border border-neutral-200 bg-white p-4 text-sm text-neutral-600">
        표시할 데이터 행이 없습니다.
      </p>
    );
  }
  return (
    <div className="overflow-x-auto rounded border border-neutral-200 bg-white">
      <table className="min-w-full border-collapse text-left text-xs">
        <thead className="bg-neutral-100 text-neutral-600">
          <tr>
            <th className="px-3 py-2 font-semibold">판정</th>
            <th className="px-3 py-2 font-semibold">파일 행</th>
            <th className="px-3 py-2 font-semibold">variant_code</th>
            <th className="px-3 py-2 font-semibold">상품 / 옵션</th>
            <th className="px-3 py-2 font-semibold">변경 전</th>
            <th className="px-3 py-2 font-semibold">변경 후</th>
            <th className="px-3 py-2 font-semibold">문제</th>
          </tr>
        </thead>
        <tbody>
          {preview.rows.map((row) => (
            <tr key={`${row.line}-${row.variantCode}`} className="border-t border-neutral-200 align-top">
              <td className="px-3 py-2">
                <span
                  className={`inline-block rounded border px-2 py-0.5 font-semibold ${VERDICT_STYLE[row.verdict]}`}
                >
                  {VERDICT_LABEL[row.verdict]}
                </span>
              </td>
              <td className="px-3 py-2 text-neutral-500">{row.line}</td>
              <td className="break-all px-3 py-2 font-mono">
                {row.variantCode === "" ? <span className="text-red-700">(빈 값)</span> : row.variantCode}
              </td>
              <td className="px-3 py-2">
                {row.productName ? (
                  <>
                    <span className="font-medium">{row.productName}</span>
                    <span className="block text-neutral-500">{row.optionName}</span>
                  </>
                ) : (
                  <span className="text-neutral-400">미매칭</span>
                )}
              </td>
              <td className="px-3 py-2 tabular-nums">{formatPrice(row.beforePrice)}</td>
              <td className="px-3 py-2 tabular-nums">{formatPrice(row.afterPrice)}</td>
              <td className="px-3 py-2">
                <IssueList row={row} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function DemoPage() {
  const [tenantId, setTenantId] = useState(SHOPS[0].tenantId);
  const [fileId, setFileId] = useState(IMPORT_FILES[0].id);
  const [uploaded, setUploaded] = useState<{ fileName: string; text: string } | null>(null);
  const [variantState, setVariantState] = useState<{
    tenantId: string;
    variants: PlatformVariant[];
  } | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [platformFile, setPlatformFile] = useState<{ fileName: string; text: string } | null>(null);
  const [platformError, setPlatformError] = useState<string | null>(null);
  const [confirmedHash, setConfirmedHash] = useState<string | null>(null);

  const shop = findShop(tenantId);

  useEffect(() => {
    if (!shop) return;
    let cancelled = false;
    gateway
      .listVariants(shop)
      .then((list) => {
        if (!cancelled) setVariantState({ tenantId: shop.tenantId, variants: list });
      })
      .catch(() => {
        if (!cancelled) setVariantState({ tenantId: shop.tenantId, variants: [] });
      });
    return () => {
      cancelled = true;
    };
  }, [shop]);

  const platformSnapshot = useMemo(() => {
    if (!platformFile || !shop) return null;
    return buildPlatformSnapshot({ shop, text: platformFile.text });
  }, [platformFile, shop]);

  const fixtureVariants =
    variantState && variantState.tenantId === tenantId ? variantState.variants : null;
  const variants = platformSnapshot ? platformSnapshot.variants : fixtureVariants;

  const source = useMemo(() => {
    if (uploaded) return uploaded;
    const file = findImportFile(fileId);
    return file ? { fileName: file.fileName, text: file.content } : null;
  }, [uploaded, fileId]);

  const preview = useMemo(() => {
    if (!shop || !variants || !source) return null;
    return buildPreview({
      shop,
      fileName: source.fileName,
      text: source.text,
      variants,
    });
  }, [shop, variants, source]);

  const confirmed = preview !== null && preview.fileHash === confirmedHash;
  const confirmCheck = preview ? canConfirm(preview) : { ok: false, reasons: [] };
  const sampleFile = findImportFile(fileId);

  async function handleUpload(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      setUploaded({ fileName: file.name, text });
      setUploadError(null);
    } catch {
      setUploadError("파일을 읽지 못했습니다.");
    }
  }

  async function handlePlatformUpload(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      setPlatformFile({ fileName: file.name, text });
      setPlatformError(null);
      setConfirmedHash(null);
    } catch {
      setPlatformError("현재 상품목록 파일을 읽지 못했습니다.");
    }
  }

  function selectSample(id: string) {
    setFileId(id);
    setUploaded(null);
    setUploadError(null);
  }

  return (
    <main className="mx-auto max-w-6xl px-4 py-10">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold tracking-widest text-neutral-500">IMPORT DEMO</p>
          <h1 className="mt-1 text-xl font-bold">공급가 CSV 가져오기 — 데모</h1>
          <p className="mt-1 text-xs text-neutral-500">
            합성 품목과 CSV로 매칭·검증·변경 미리보기를 수행합니다. 실제 품목 값은 바뀌지 않습니다.
          </p>
        </div>
        <Link
          className="rounded border border-neutral-300 bg-white px-3 py-1.5 text-xs font-semibold text-neutral-700"
          href="/"
        >
          소개로
        </Link>
      </div>

      <section className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <label className="block text-sm">
          <span className="font-semibold">대상 몰</span>
          <select
            className="mt-1 w-full rounded border border-neutral-300 bg-white px-2 py-1.5 text-sm"
            value={tenantId}
            onChange={(event) => {
              setTenantId(event.target.value);
              setConfirmedHash(null);
            }}
          >
            {SHOPS.map((entry) => (
              <option key={entry.tenantId} value={entry.tenantId}>
                {entry.name} · {entry.currency} · shop {entry.shopNumber}
              </option>
            ))}
          </select>
        </label>

        <label className="block text-sm">
          <span className="font-semibold">합성 파일</span>
          <select
            className="mt-1 w-full rounded border border-neutral-300 bg-white px-2 py-1.5 text-sm"
            value={fileId}
            onChange={(event) => selectSample(event.target.value)}
          >
            {IMPORT_FILES.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.label}
              </option>
            ))}
          </select>
        </label>

        <label className="block text-sm">
          <span className="font-semibold">CSV 직접 올리기</span>
          <input
            className="mt-1 w-full rounded border border-neutral-300 bg-white px-2 py-1 text-sm"
            type="file"
            accept=".csv,text/csv"
            onChange={handleUpload}
          />
        </label>

        <label className="block text-sm">
          <span className="font-semibold">현재 상품목록 파일 (선택)</span>
          <input
            className="mt-1 w-full rounded border border-neutral-300 bg-white px-2 py-1 text-sm"
            type="file"
            accept=".csv,text/csv"
            onChange={handlePlatformUpload}
          />
        </label>
      </section>

      <p className="mt-3 text-xs text-neutral-500">
        {uploaded
          ? `직접 올린 파일: ${uploaded.fileName}`
          : sampleFile
            ? sampleFile.description
            : "합성 파일을 고르세요."}
      </p>
      {uploadError ? <p className="mt-1 text-xs text-red-700">{uploadError}</p> : null}

      {platformFile && platformSnapshot ? (
        <div className="mt-2 rounded border border-neutral-200 bg-white p-2 text-xs text-neutral-600" data-testid="platform-status">
          <p>
            현재 상품목록: <span className="font-mono">{platformFile.fileName}</span> · 형식{" "}
            {platformSnapshot.format
              ? SUPPLY_CSV_FORMAT_LABELS[platformSnapshot.format]
              : "알 수 없음"}{" "}
            · 매칭 품목 {platformSnapshot.variants.length}개
            {platformSnapshot.skipped.length > 0
              ? ` · 건너뜀 ${platformSnapshot.skipped.length}개`
              : ""}
          </p>
          {platformSnapshot.fileIssues.map((entry, index) => (
            <p key={`${entry.code}-${index}`} className="text-red-700">
              [파일] {entry.message}
            </p>
          ))}
          {platformSnapshot.skipped.slice(0, 5).map((entry) => (
            <p key={`${entry.line}-${entry.variantCode}`} className="text-amber-700">
              {entry.line}행{entry.variantCode ? ` ${entry.variantCode}` : ""}: {entry.reason}
            </p>
          ))}
          <button
            type="button"
            className="mt-1 rounded border border-neutral-300 bg-white px-2 py-0.5 font-semibold text-neutral-700"
            onClick={() => {
              setPlatformFile(null);
              setPlatformError(null);
              setConfirmedHash(null);
            }}
          >
            현재 목록 비우기
          </button>
        </div>
      ) : null}
      {platformError ? <p className="mt-1 text-xs text-red-700">{platformError}</p> : null}

      {!shop ? (
        <p className="mt-8 text-sm text-neutral-600">대상 몰을 찾지 못했습니다.</p>
      ) : variants === null ? (
        <p className="mt-8 text-sm text-neutral-500">품목 목록을 불러오는 중…</p>
      ) : !preview ? (
        <p className="mt-8 text-sm text-neutral-600">파일을 선택하세요.</p>
      ) : (
        <>
          <section className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <CountCard label="전체" value={preview.counts.total} testId="count-total" />
            <CountCard label="매칭" value={preview.counts.matched} testId="count-matched" />
            <CountCard label="변경" value={preview.counts.changed} testId="count-changed" />
            <CountCard label="동일" value={preview.counts.unchanged} testId="count-unchanged" />
            <CountCard label="오류" value={preview.counts.errors} testId="count-errors" />
            <CountCard label="주의" value={preview.counts.warnings} testId="count-warnings" />
          </section>

          <section className="mt-4 rounded border border-neutral-200 bg-white p-3 text-xs text-neutral-600">
            <p>
              미리보기 버전 {preview.previewVersion} · 파일 해시{" "}
              <span className="font-mono">{preview.fileHash.slice(0, 12)}</span> · 파일명{" "}
              <span className="font-mono">{preview.fileName}</span> · 이 몰 품목{" "}
              {variants.length}개
            </p>
            <p data-testid="csv-format" className="mt-1">
              형식: {SUPPLY_CSV_FORMAT_LABELS[preview.format]}
            </p>
          </section>

          {preview.fileIssues.length > 0 ? (
            <ul className="mt-4 space-y-1 rounded border border-red-300 bg-red-50 p-3 text-xs text-red-800">
              {preview.fileIssues.map((entry, index) => (
                <li key={`${entry.code}-${index}`}>[파일] {entry.message}</li>
              ))}
            </ul>
          ) : null}

          {preview.blocked ? (
            <section className="mt-4 rounded border border-red-400 bg-red-50 p-4">
              <h2 className="text-sm font-bold text-red-900">확정할 수 없습니다</h2>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-red-900">
                {preview.blockReasons.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
            </section>
          ) : (
            <section className="mt-4 rounded border border-emerald-300 bg-emerald-50 p-4">
              <h2 className="text-sm font-bold text-emerald-900">검증 통과</h2>
              <p className="mt-1 text-sm text-emerald-900">
                변경 {preview.counts.changed}건, 동일 {preview.counts.unchanged}건입니다. 확정하면 이
                미리보기 버전에 연결됩니다.
              </p>
            </section>
          )}

          <section className="mt-6 flex flex-wrap gap-2">
            <button
              type="button"
              className="rounded border border-neutral-300 bg-white px-3 py-1.5 text-xs font-semibold text-neutral-800"
              onClick={() =>
                downloadTextFile(
                  `${preview.fileName.replace(/\.csv$/, "")}-review.csv`,
                  toReviewCsv(preview),
                )
              }
            >
              검토 결과 CSV
            </button>
            <button
              type="button"
              className="rounded border border-neutral-300 bg-white px-3 py-1.5 text-xs font-semibold text-neutral-800 disabled:opacity-40"
              disabled={preview.counts.changed === 0}
              onClick={() =>
                downloadTextFile(
                  `${preview.fileName.replace(/\.csv$/, "")}-change-spec.csv`,
                  toChangeSpecCsv(preview),
                )
              }
            >
              변경 명세 CSV
            </button>
            <button
              type="button"
              className="rounded border border-neutral-300 bg-white px-3 py-1.5 text-xs font-semibold text-neutral-800"
              onClick={() =>
                downloadTextFile(
                  `${preview.fileName.replace(/\.csv$/, "")}-manifest.json`,
                  toManifest(preview),
                  "application/json",
                )
              }
            >
              JSON 명세
            </button>
            <button
              type="button"
              className="rounded bg-neutral-900 px-3 py-1.5 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
              disabled={!confirmCheck.ok}
              onClick={() => setConfirmedHash(preview.fileHash)}
            >
              확정 (데모)
            </button>
          </section>

          {confirmed ? (
            <p
              className="mt-3 rounded border border-neutral-300 bg-white p-3 text-xs text-neutral-700"
              data-testid="confirm-notice"
            >
              {buildUnappliedNotice(preview)} 실제 Cafe24 API 호출은 하지 않았습니다.
            </p>
          ) : null}

          <section className="mt-6">
            <PreviewTable preview={preview} />
          </section>
        </>
      )}
    </main>
  );
}
