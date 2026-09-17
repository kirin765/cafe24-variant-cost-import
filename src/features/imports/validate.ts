import {
  issue,
  type CsvRow,
  type ImportIssue,
  type ImportRow,
  type PlatformVariant,
  type PreviewCounts,
  type RowVerdict,
  type SupplyCsvFormat,
} from "./model";

const PRICE_PATTERN = /^\d+$/;
const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);

export interface PriceParseResult {
  ok: boolean;
  value: number | null;
  issues: ImportIssue[];
}

function describeInvalidPrice(raw: string): string {
  if (raw.trim() !== raw) return "앞뒤 공백은 허용되지 않습니다. 공백 없이 입력하세요.";
  if (/[₩$€¥,]/.test(raw)) return "통화 기호나 천 단위 구분자는 허용되지 않습니다.";
  if (raw.includes(".")) return "소수점은 허용되지 않습니다. 원 단위 정수로 입력하세요.";
  if (/^[-+]/.test(raw)) return "부호가 있는 금액은 허용되지 않습니다.";
  if (/[eE]/.test(raw)) return "지수 표기는 허용되지 않습니다.";
  if (/[a-zA-Z]/.test(raw)) return "숫자가 아닌 문자가 들어 있습니다.";
  return "올바른 정수 금액이 아닙니다.";
}

export function parseSupplyPrice(raw: string): PriceParseResult {
  if (raw.length === 0) {
    return {
      ok: false,
      value: null,
      issues: [issue("missing_price", "error", "공급가가 비어 있습니다. 0으로 해석하지 않습니다.")],
    };
  }
  if (!PRICE_PATTERN.test(raw)) {
    return {
      ok: false,
      value: null,
      issues: [issue("invalid_price", "error", describeInvalidPrice(raw))],
    };
  }
  const big = BigInt(raw);
  if (big > MAX_SAFE) {
    return {
      ok: false,
      value: null,
      issues: [issue("invalid_price", "error", "금액이 안전한 정수 범위를 넘습니다.")],
    };
  }
  const value = Number(big);
  const issues: ImportIssue[] = [];
  if (value === 0) {
    issues.push(issue("zero_price", "warning", "공급가 0원이 명시적으로 입력되었습니다."));
  }
  return { ok: true, value, issues };
}

export interface ValidateInput {
  rows: CsvRow[];
  variants: PlatformVariant[];
  format?: SupplyCsvFormat;
}

const DEFAULT_FIELD_COUNT = 2;

export function validateImportRows({
  rows,
  variants,
  format = "simple",
}: ValidateInput): ImportRow[] {
  const codeLabel = format === "cafe24-product" ? "상품코드" : "variant_code";
  const codeCounts = new Map<string, number>();
  for (const row of rows) {
    if (row.variantCode.length === 0) continue;
    codeCounts.set(row.variantCode, (codeCounts.get(row.variantCode) ?? 0) + 1);
  }

  const variantByCode = new Map<string, PlatformVariant>();
  const platformDuplicateCodes = new Set<string>();
  for (const variant of variants) {
    if (variantByCode.has(variant.variantCode)) {
      platformDuplicateCodes.add(variant.variantCode);
    } else {
      variantByCode.set(variant.variantCode, variant);
    }
  }

  return rows.map((row) => {
    const issues: ImportIssue[] = [];
    const code = row.variantCode;

    const expectedFieldCount = row.expectedFieldCount ?? DEFAULT_FIELD_COUNT;
    if (row.fieldCount !== expectedFieldCount) {
      issues.push(
        issue(
          "malformed_row",
          "error",
          `열 개수가 맞지 않습니다. 기대 ${expectedFieldCount}개, 받은 ${row.fieldCount}개`,
        ),
      );
    }

    if (code.length === 0) {
      issues.push(issue("missing_code", "error", `${codeLabel}가 비어 있습니다.`));
    } else if ((codeCounts.get(code) ?? 0) > 1) {
      issues.push(
        issue("duplicate_code", "error", `파일 안에 같은 ${codeLabel}가 두 번 이상 있습니다.`),
      );
    }

    const price = parseSupplyPrice(row.rawSupplyPrice);
    issues.push(...price.issues);
    const after = price.ok ? price.value : null;

    let matched = false;
    let before: number | null = null;
    let productNo: string | null = null;
    let productName: string | null = null;
    let optionName: string | null = null;

    if (code.length > 0) {
      const variant = variantByCode.get(code);
      if (!variant) {
        issues.push(
          issue("unmatched_code", "error", `이 몰의 품목에서 ${codeLabel}를 찾지 못했습니다.`),
        );
      } else {
        matched = true;
        before = variant.supplyPrice;
        productNo = variant.productNo;
        productName = variant.productName;
        optionName = variant.optionName;
        if (platformDuplicateCodes.has(code)) {
          issues.push(
            issue(
              "duplicate_platform_code",
              "error",
              `이 몰에 같은 ${codeLabel} 품목이 둘 이상이라 자동 매칭할 수 없습니다.`,
            ),
          );
        }
      }
    }

    const hasError = issues.some((entry) => entry.severity === "error");
    let verdict: RowVerdict = "error";
    if (!hasError) {
      verdict = after !== null && after === before ? "unchanged" : "changed";
    }

    return {
      ...row,
      verdict,
      matched,
      beforePrice: before,
      afterPrice: after,
      productNo,
      productName,
      optionName,
      issues,
    };
  });
}

export function summarizeRows(rows: ImportRow[]): PreviewCounts {
  const counts: PreviewCounts = {
    total: rows.length,
    matched: 0,
    changed: 0,
    unchanged: 0,
    errors: 0,
    warnings: 0,
  };
  for (const row of rows) {
    if (row.matched) counts.matched += 1;
    if (row.verdict === "changed") counts.changed += 1;
    else if (row.verdict === "unchanged") counts.unchanged += 1;
    else counts.errors += 1;
    counts.warnings += row.issues.filter((entry) => entry.severity === "warning").length;
  }
  return counts;
}
