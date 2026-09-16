import { parseSupplyPriceCsv } from "./csv";
import { hashText } from "./hash";
import type { ImportPreview, ImportRow, PlatformVariant, ShopRef } from "./model";
import { summarizeRows, validateImportRows } from "./validate";

export interface BuildPreviewInput {
  shop: ShopRef;
  fileName: string;
  text: string;
  variants: PlatformVariant[];
  jobId?: string;
  previewVersion?: number;
  now?: () => Date;
}

export function collectBlockReasons(
  fileIssues: ImportPreview["fileIssues"],
  rows: ImportRow[],
): string[] {
  const reasons: string[] = [];
  const fileErrors = fileIssues.filter((entry) => entry.severity === "error");
  if (fileErrors.length > 0) {
    reasons.push(`파일 오류가 ${fileErrors.length}건 있어 확정할 수 없습니다.`);
  }
  const errorRows = rows.filter((row) => row.verdict === "error").length;
  if (errorRows > 0) {
    reasons.push(`오류 행이 ${errorRows}개 있어 전체 확정을 막습니다. 파일을 수정해 다시 올려주세요.`);
  }
  if (rows.length === 0 && reasons.length === 0) {
    reasons.push("가져올 데이터 행이 없습니다.");
  }
  return reasons;
}

export function buildPreview(input: BuildPreviewInput): ImportPreview {
  const parsed = parseSupplyPriceCsv(input.text);
  const rows = validateImportRows({ rows: parsed.rows, variants: input.variants });
  const counts = summarizeRows(rows);
  const fileHash = hashText(input.text);
  const blockReasons = collectBlockReasons(parsed.fileIssues, rows);
  const createdAt = (input.now ?? (() => new Date()))().toISOString();

  return {
    jobId: input.jobId ?? `job_${fileHash}`,
    shop: input.shop,
    fileName: input.fileName,
    fileHash,
    createdAt,
    previewVersion: input.previewVersion ?? 1,
    counts,
    rows,
    fileIssues: parsed.fileIssues,
    blocked: blockReasons.length > 0,
    blockReasons,
  };
}

export interface ConfirmCheck {
  ok: boolean;
  reasons: string[];
}

export function canConfirm(preview: ImportPreview): ConfirmCheck {
  return { ok: !preview.blocked, reasons: preview.blockReasons };
}

function escapeCsvField(value: string): string {
  if (/[",\r\n]/.test(value)) return `"${value.replaceAll('"', '""')}"`;
  return value;
}

function toCsvLine(fields: string[]): string {
  return fields.map(escapeCsvField).join(",");
}

function priceText(value: number | null): string {
  return value === null ? "" : String(value);
}

function verdictText(verdict: ImportRow["verdict"]): string {
  if (verdict === "changed") return "변경";
  if (verdict === "unchanged") return "동일";
  return "오류";
}

export function toReviewCsv(preview: ImportPreview): string {
  const lines = [
    toCsvLine([
      "line",
      "variant_code",
      "product_no",
      "product_name",
      "option_name",
      "before_supply_price",
      "after_supply_price",
      "verdict",
      "severity_errors",
      "issue_codes",
      "issue_messages",
    ]),
  ];
  for (const row of preview.rows) {
    const errors = row.issues.filter((entry) => entry.severity === "error");
    lines.push(
      toCsvLine([
        String(row.line),
        row.variantCode,
        row.productNo ?? "",
        row.productName ?? "",
        row.optionName ?? "",
        priceText(row.beforePrice),
        priceText(row.afterPrice),
        verdictText(row.verdict),
        String(errors.length),
        row.issues.map((entry) => entry.code).join("|"),
        row.issues.map((entry) => entry.message).join("|"),
      ]),
    );
  }
  return `${lines.join("\r\n")}\r\n`;
}

export function toChangeSpecCsv(preview: ImportPreview): string {
  const lines = [
    toCsvLine([
      "variant_code",
      "product_no",
      "product_name",
      "option_name",
      "before_supply_price",
      "after_supply_price",
    ]),
  ];
  for (const row of preview.rows) {
    if (row.verdict !== "changed") continue;
    lines.push(
      toCsvLine([
        row.variantCode,
        row.productNo ?? "",
        row.productName ?? "",
        row.optionName ?? "",
        priceText(row.beforePrice),
        priceText(row.afterPrice),
      ]),
    );
  }
  return `${lines.join("\r\n")}\r\n`;
}

export function toManifest(preview: ImportPreview): string {
  const changes = preview.rows
    .filter((row) => row.verdict === "changed")
    .map((row) => ({
      line: row.line,
      variantCode: row.variantCode,
      productNo: row.productNo,
      productName: row.productName,
      optionName: row.optionName,
      beforeSupplyPrice: row.beforePrice,
      afterSupplyPrice: row.afterPrice,
    }));
  const manifest = {
    jobId: preview.jobId,
    previewVersion: preview.previewVersion,
    createdAt: preview.createdAt,
    shop: preview.shop,
    fileName: preview.fileName,
    fileHash: preview.fileHash,
    counts: preview.counts,
    blocked: preview.blocked,
    blockReasons: preview.blockReasons,
    fileIssues: preview.fileIssues,
    changes,
    note: "합성 데모 명세입니다. 실제 Cafe24 품목은 수정하지 않았습니다.",
  };
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

export function buildUnappliedNotice(preview: ImportPreview): string {
  return `미리보기 ${preview.previewVersion} (${preview.fileHash.slice(0, 8)}) · 대상 몰 ${preview.shop.name} · 변경 ${preview.counts.changed}건 · 실제 쓰기는 하지 않습니다.`;
}
