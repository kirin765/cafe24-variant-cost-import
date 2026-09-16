export const IMPORT_ISSUE_SEVERITIES = ["error", "warning"] as const;
export type ImportIssueSeverity = (typeof IMPORT_ISSUE_SEVERITIES)[number];

export const IMPORT_ISSUE_CODES = [
  "file_header",
  "file_too_large",
  "file_too_many_rows",
  "malformed_row",
  "missing_code",
  "missing_price",
  "invalid_price",
  "duplicate_code",
  "unmatched_code",
  "duplicate_platform_code",
  "zero_price",
] as const;
export type ImportIssueCode = (typeof IMPORT_ISSUE_CODES)[number];

export interface ImportIssue {
  code: ImportIssueCode;
  severity: ImportIssueSeverity;
  message: string;
}

export type RowVerdict = "changed" | "unchanged" | "error";

export interface CsvRow {
  line: number;
  variantCode: string;
  rawSupplyPrice: string;
  fieldCount: number;
}

export interface PlatformVariant {
  tenantId: string;
  mallId: string;
  productNo: string;
  productName: string;
  variantCode: string;
  optionName: string;
  supplyPrice: number;
  currency: string;
}

export interface ShopRef {
  tenantId: string;
  mallId: string;
  shopNumber: string;
  name: string;
  currency: string;
}

export interface ImportRow extends CsvRow {
  verdict: RowVerdict;
  matched: boolean;
  beforePrice: number | null;
  afterPrice: number | null;
  productNo: string | null;
  productName: string | null;
  optionName: string | null;
  issues: ImportIssue[];
}

export interface PreviewCounts {
  total: number;
  matched: number;
  changed: number;
  unchanged: number;
  errors: number;
  warnings: number;
}

export interface ImportPreview {
  jobId: string;
  shop: ShopRef;
  fileName: string;
  fileHash: string;
  createdAt: string;
  previewVersion: number;
  counts: PreviewCounts;
  rows: ImportRow[];
  fileIssues: ImportIssue[];
  blocked: boolean;
  blockReasons: string[];
}

export const CSV_LIMITS = {
  maxBytes: 1024 * 1024,
  maxRows: 1000,
} as const;

export function issue(
  code: ImportIssueCode,
  severity: ImportIssueSeverity,
  message: string,
): ImportIssue {
  return { code, severity, message };
}
