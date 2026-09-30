import { issue, type ImportIssue } from "./model";

export type RestoreVerdict = "restorable" | "conflict" | "error";

export interface RestoreSourceRow {
  rowId: string;
  productNo: string | null;
  variantCode: string;
  beforePrice: number | null;
  targetPrice: number | null;
  status: string;
}

export interface RestorePlanRow {
  rowId: string;
  productNo: string | null;
  variantCode: string;
  beforePrice: number | null;
  targetPrice: number | null;
  currentPrice: number | null;
  restorePrice: number | null;
  verdict: RestoreVerdict;
  issues: ImportIssue[];
}

/**
 * 복원 계획. 현재 값이 원작업의 목표값(또는 이미 이전 값)일 때만 복원을 제안한다.
 * 그 외에는 자동 복원하지 않고 conflict로 남긴다.
 */
export function planRestore(
  rows: RestoreSourceRow[],
  currentByRowId: Map<string, number | null>,
): RestorePlanRow[] {
  return rows.map((row) => {
    const currentPrice = currentByRowId.has(row.rowId)
      ? (currentByRowId.get(row.rowId) ?? null)
      : null;
    const base = {
      rowId: row.rowId,
      productNo: row.productNo,
      variantCode: row.variantCode,
      beforePrice: row.beforePrice,
      targetPrice: row.targetPrice,
      currentPrice,
      restorePrice: row.beforePrice,
    };
    if (row.status !== "success") {
      return {
        ...base,
        restorePrice: null,
        verdict: "error" as const,
        issues: [
          issue("restore_source_not_success", "error", "성공한 행만 복원할 수 있습니다."),
        ],
      };
    }
    if (row.beforePrice === null || row.targetPrice === null) {
      return {
        ...base,
        restorePrice: null,
        verdict: "error" as const,
        issues: [issue("restore_missing_price", "error", "이전/목표 공급가가 없습니다.")],
      };
    }
    if (row.beforePrice === row.targetPrice) {
      return {
        ...base,
        restorePrice: null,
        verdict: "error" as const,
        issues: [issue("restore_no_change", "error", "변경이 없어 복원할 값이 없습니다.")],
      };
    }
    if (currentPrice === null) {
      return {
        ...base,
        verdict: "error" as const,
        issues: [
          issue("restore_current_unknown", "error", "현재 공급가를 읽지 못했습니다."),
        ],
      };
    }
    if (currentPrice === row.targetPrice) {
      return { ...base, verdict: "restorable" as const, issues: [] };
    }
    if (currentPrice === row.beforePrice) {
      return {
        ...base,
        verdict: "restorable" as const,
        issues: [
          issue("restore_no_change", "warning", "이미 이전 값이라 복원이 필요하지 않습니다."),
        ],
      };
    }
    return {
      ...base,
      verdict: "conflict" as const,
      issues: [
        issue(
          "restore_external_change",
          "error",
          "현재 값이 원작업의 목표값과 달라 자동 복원하지 않습니다.",
        ),
      ],
    };
  });
}

export function summarizeRestore(
  rows: RestorePlanRow[],
): { restorable: number; conflict: number; errors: number } {
  const counts = { restorable: 0, conflict: 0, errors: 0 };
  for (const row of rows) {
    if (row.verdict === "restorable") counts.restorable += 1;
    else if (row.verdict === "conflict") counts.conflict += 1;
    else counts.errors += 1;
  }
  return counts;
}
