import { parseSupplyCsv } from "./csv";
import type { ImportIssue, PlatformVariant, ShopRef, SupplyCsvFormat } from "./model";
import { parseSupplyPrice } from "./validate";

export interface SkippedSnapshotRow {
  line: number;
  variantCode: string;
  reason: string;
}

export interface PlatformSnapshot {
  format: SupplyCsvFormat | null;
  variants: PlatformVariant[];
  skipped: SkippedSnapshotRow[];
  fileIssues: ImportIssue[];
}

export interface BuildPlatformSnapshotInput {
  shop: ShopRef;
  text: string;
  optionName?: string;
}

export function buildPlatformSnapshot({
  shop,
  text,
  optionName = "기본",
}: BuildPlatformSnapshotInput): PlatformSnapshot {
  const parsed = parseSupplyCsv(text);
  const variants: PlatformVariant[] = [];
  const skipped: SkippedSnapshotRow[] = [];

  for (const row of parsed.rows) {
    const code = row.variantCode;
    if (code.length === 0) {
      skipped.push({ line: row.line, variantCode: "", reason: "상품코드가 비어 있습니다." });
      continue;
    }
    const price = parseSupplyPrice(row.rawSupplyPrice);
    if (!price.ok || price.value === null) {
      skipped.push({
        line: row.line,
        variantCode: code,
        reason: price.issues[0]?.message ?? "공급가를 읽지 못했습니다.",
      });
      continue;
    }
    variants.push({
      tenantId: shop.tenantId,
      mallId: shop.mallId,
      productNo: code,
      productName: row.sourceProductName?.trim() || code,
      variantCode: code,
      optionName,
      supplyPrice: price.value,
      currency: shop.currency,
    });
  }

  return { format: parsed.format, variants, skipped, fileIssues: parsed.fileIssues };
}
