import { Cafe24ApiError } from "@/lib/cafe24/variants";

export const ROW_STATUSES = [
  "pending",
  "success",
  "failed",
  "conflict",
  "unknown",
  "unchanged",
  "skipped",
] as const;
export type RowStatus = (typeof ROW_STATUSES)[number];

export type WriteErrorKind =
  | "reauth"
  | "forbidden"
  | "not_found"
  | "rate_limited"
  | "transient"
  | "supply_price_mode"
  | "single_variant"
  | "failed";

export const SUPPLY_PRICE_MODE_HINT =
  "이 몰의 '공급가 관리 방식'이 '상품 단위'로 설정되어 있어 품목별 공급가를 수정할 수 없습니다. " +
  "Cafe24 관리자 > 쇼핑몰 설정 > 상품 설정 > 상품 판매정보 설정에서 '공급가 관리 방식'을 " +
  "'품목 단위'로 변경한 뒤 다시 실행하세요.";

export const SINGLE_VARIANT_HINT =
  "옵션 없는 단일 품목 상품은 품목별 공급가를 수정할 수 없습니다. 옵션이 있는 상품만 대상으로 하세요.";

// Cafe24 품목 조회는 캐시(Cache: Enabled)가 있어 쓰기 직후 재조회가 잠시 이전 값을 돌려준다.
// 실측상 캐시가 약 5초에 걸쳐 수렴하므로, 쓰기 후 재조회는 값이 바뀔 때까지 제한적으로 재시도한다.
export const DEFAULT_READBACK_RETRIES = 6;
export const DEFAULT_READBACK_DELAY_MS = 1000;

export interface ExecuteRowOptions {
  readbackRetries?: number;
  readbackDelayMs?: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface VariantWriter {
  read(productNo: string, variantCode: string): Promise<number | null>;
  write(productNo: string, variantCode: string, supplyPrice: number): Promise<void>;
}

export interface ExecutableRow {
  id: string;
  productNo: string | null;
  variantCode: string;
  beforePrice: number | null;
  targetPrice: number | null;
}

export interface RowOutcome {
  status: RowStatus;
  message: string;
  errorCode: string | null;
  observedPrice: number | null;
  retry: boolean;
}

export function classifyWriteError(error: unknown): WriteErrorKind {
  if (error instanceof Cafe24ApiError) {
    if (error.status === 401) return "reauth";
    if (error.status === 403) return "forbidden";
    if (error.status === 404) return "not_found";
    if (error.status === 429) return "rate_limited";
    if (error.status === 422) {
      const message = (error.apiMessage ?? "").toLowerCase();
      if (message.includes("single product")) return "single_variant";
      if (message.includes("cannot be modified") || message.includes("by item")) {
        return "supply_price_mode";
      }
      return "failed";
    }
    if (error.status >= 500) return "transient";
    return "failed";
  }
  return "transient";
}

function outcome(
  status: RowStatus,
  message: string,
  errorCode: string | null,
  observedPrice: number | null,
  retry = false,
): RowOutcome {
  return { status, message, errorCode, observedPrice, retry };
}

async function safeRead(
  writer: VariantWriter,
  productNo: string,
  variantCode: string,
): Promise<{ ok: true; price: number | null } | { ok: false; error: unknown }> {
  try {
    return { ok: true, price: await writer.read(productNo, variantCode) };
  } catch (error) {
    return { ok: false, error };
  }
}

/**
 * 값이 계속 `value`로 보이면 캐시일 수 있으므로, 값이 달라지거나 재시도를 소진할 때까지
 * 제한적으로 다시 읽는다. 쓰기 후 재조회(이전 값)와 ‘이미 목표값’ 확인(목표 값)에 쓴다.
 */
async function readWhileEquals(
  writer: VariantWriter,
  productNo: string,
  variantCode: string,
  value: number | null,
  retries: number,
  delayMs: number,
): Promise<{ ok: true; price: number | null } | { ok: false; error: unknown }> {
  let result = await safeRead(writer, productNo, variantCode);
  for (let i = 0; i < retries; i += 1) {
    if (!result.ok || result.price !== value) break;
    await sleep(delayMs);
    result = await safeRead(writer, productNo, variantCode);
  }
  return result;
}

/**
 * 한 행을 실행한다. 순서: 현재 값 재조회 → 충돌 검사 → 쓰기 → 재조회.
 * timeout·응답 유실은 성공으로 단정하지 않고 재조회로 분류한다. 맹목 재시도하지 않는다.
 */
export async function executeRow(
  row: ExecutableRow,
  writer: VariantWriter,
  options: ExecuteRowOptions = {},
): Promise<RowOutcome> {
  const readbackRetries = options.readbackRetries ?? DEFAULT_READBACK_RETRIES;
  const readbackDelayMs = options.readbackDelayMs ?? DEFAULT_READBACK_DELAY_MS;
  if (
    row.targetPrice === null ||
    row.beforePrice === null ||
    !row.productNo ||
    row.variantCode.length === 0
  ) {
    return outcome("skipped", "대상 식별자나 금액이 없어 건너뜁니다.", "not_executable", null);
  }
  const productNo = row.productNo;

  const first = await safeRead(writer, productNo, row.variantCode);
  if (!first.ok) {
    const kind = classifyWriteError(first.error);
    if (kind === "reauth") {
      return outcome("failed", "재인증이 필요합니다.", "reauth_required", null);
    }
    if (kind === "rate_limited") {
      return outcome("pending", "호출 한도에 걸렸습니다. 잠시 후 재시도합니다.", "rate_limited", null, true);
    }
    return outcome("unknown", "현재 값을 읽지 못했습니다. 재조회가 필요합니다.", "read_failed", null);
  }
  let current = first.price;
  if (current === null) {
    return outcome(
      "failed",
      "이 품목의 현재 공급가를 읽지 못했습니다.",
      "missing_platform_price",
      null,
    );
  }
  if (current === row.targetPrice) {
    // 변경이 필요했던 행이 이미 목표값이면 캐시일 수 있다. 확인 후에도 목표값이면 건너뛴다.
    if (row.beforePrice !== row.targetPrice) {
      const confirmed = await readWhileEquals(
        writer,
        productNo,
        row.variantCode,
        row.targetPrice,
        readbackRetries,
        readbackDelayMs,
      );
      if (!confirmed.ok) {
        return outcome("unknown", "현재 값을 확인하지 못했습니다.", "read_failed", null);
      }
      if (confirmed.price !== row.targetPrice) {
        current = confirmed.price;
      } else {
        return outcome("success", "이미 목표값이라 쓰기를 건너뜁니다.", "already_target", current);
      }
    } else {
      return outcome("success", "이미 목표값이라 쓰기를 건너뜁니다.", "already_target", current);
    }
  }
  if (current !== row.beforePrice) {
    return outcome(
      "conflict",
      "미리보기 이후 현재 공급가가 바뀌었습니다. 자동으로 덮어쓰지 않습니다.",
      "conflict",
      current,
    );
  }

  try {
    await writer.write(productNo, row.variantCode, row.targetPrice);
  } catch (error) {
    const kind = classifyWriteError(error);
    if (kind === "rate_limited") {
      return outcome("pending", "호출 한도에 걸렸습니다. 잠시 후 재시도합니다.", "rate_limited", null, true);
    }
    if (kind === "reauth") {
      return outcome("failed", "권한이 철회되어 재인증이 필요합니다.", "reauth_required", null);
    }
    if (kind === "forbidden") {
      return outcome("failed", "쓰기 권한이 없습니다.", "forbidden", null);
    }
    if (kind === "not_found") {
      return outcome("failed", "품목이 삭제되었거나 찾을 수 없습니다.", "variant_not_found", null);
    }
    if (kind === "supply_price_mode") {
      return outcome("failed", SUPPLY_PRICE_MODE_HINT, "supply_price_mode_required", null);
    }
    if (kind === "single_variant") {
      return outcome("failed", SINGLE_VARIANT_HINT, "single_variant_unsupported", null);
    }
    // timeout·5xx·응답 유실: 결과 불명으로 두고 재조회로 판단한다.
    const again = await readWhileEquals(
      writer,
      productNo,
      row.variantCode,
      row.beforePrice,
      readbackRetries,
      readbackDelayMs,
    );
    if (again.ok) {
      if (again.price === row.targetPrice) {
        return outcome("success", "쓰기 응답은 유실됐지만 재조회에서 반영을 확인했습니다.", "applied_after_timeout", again.price);
      }
      if (again.price === row.beforePrice) {
        return outcome("unknown", "쓰기 결과를 확인하지 못했습니다. 재조회 후 재시도가 필요합니다.", "write_unconfirmed", again.price, true);
      }
      if (again.price === null) {
        return outcome("unknown", "쓰기 후 현재 값을 읽지 못했습니다.", "write_unconfirmed", null, true);
      }
      return outcome("conflict", "쓰기 후 다른 값으로 바뀌었습니다.", "changed_by_other", again.price);
    }
    const kind2 = classifyWriteError(again.error);
    if (kind2 === "reauth") {
      return outcome("failed", "권한이 철회되어 재인증이 필요합니다.", "reauth_required", null);
    }
    return outcome("unknown", "쓰기 결과를 확인하지 못했습니다.", "write_unconfirmed", null, true);
  }

  const after = await readWhileEquals(
    writer,
    productNo,
    row.variantCode,
    row.beforePrice,
    readbackRetries,
    readbackDelayMs,
  );
  if (!after.ok) {
    return outcome("unknown", "쓰기 후 재조회에 실패했습니다.", "readback_failed", null);
  }
  if (after.price === row.targetPrice) {
    return outcome("success", "목표값 반영을 확인했습니다.", null, after.price);
  }
  if (after.price === row.beforePrice) {
    return outcome("failed", "쓰기가 반영되지 않았습니다.", "not_applied", after.price);
  }
  if (after.price === null) {
    return outcome("unknown", "쓰기 후 현재 값을 읽지 못했습니다.", "readback_missing", null);
  }
  return outcome("conflict", "쓰기 후 값이 예상과 다릅니다.", "changed_by_other", after.price);
}

export function summarizeOutcomes(outcomes: RowOutcome[]): {
  success: number;
  unchanged: number;
  failed: number;
  conflict: number;
  unknown: number;
  pending: number;
} {
  const counts = { success: 0, unchanged: 0, failed: 0, conflict: 0, unknown: 0, pending: 0 };
  for (const entry of outcomes) {
    if (entry.status === "success") counts.success += 1;
    else if (entry.status === "unchanged") counts.unchanged += 1;
    else if (entry.status === "failed") counts.failed += 1;
    else if (entry.status === "conflict") counts.conflict += 1;
    else if (entry.status === "unknown") counts.unknown += 1;
    else if (entry.status === "pending") counts.pending += 1;
  }
  return counts;
}

export function finalJobStatus(
  counts: ReturnType<typeof summarizeOutcomes>,
): "completed" | "partial_failure" | "needs_review" | "running" {
  if (counts.pending > 0) return "running";
  if (counts.conflict > 0 || counts.unknown > 0) return "needs_review";
  if (counts.failed > 0) return "partial_failure";
  return "completed";
}
