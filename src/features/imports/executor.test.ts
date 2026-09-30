import { describe, expect, it } from "vitest";
import { Cafe24ApiError } from "@/lib/cafe24/variants";
import {
  executeRow,
  finalJobStatus,
  summarizeOutcomes,
  type ExecutableRow,
  type VariantWriter,
} from "./executor";

class FakeWriter implements VariantWriter {
  writes: number[] = [];
  reads = 0;
  writeError: unknown = null;
  applyOnWriteError = false;

  constructor(public price: number | null) {}

  async read(): Promise<number | null> {
    this.reads += 1;
    return this.price;
  }

  async write(_productNo: string, _variantCode: string, supplyPrice: number): Promise<void> {
    if (this.writeError) {
      if (this.applyOnWriteError) this.price = supplyPrice;
      throw this.writeError;
    }
    this.writes.push(supplyPrice);
    this.price = supplyPrice;
  }
}

function row(overrides: Partial<ExecutableRow> = {}): ExecutableRow {
  return {
    id: "row-1",
    productNo: "20",
    variantCode: "P000000R000A",
    beforePrice: 1000,
    targetPrice: 2000,
    ...overrides,
  };
}

function networkError(): Error {
  return new TypeError("fetch failed");
}

describe("executeRow", () => {
  it("변경이 필요하면 쓰고 재조회로 반영을 확인한다", async () => {
    const writer = new FakeWriter(1000);
    const result = await executeRow(row(), writer);
    expect(result.status).toBe("success");
    expect(writer.writes).toEqual([2000]);
    expect(result.observedPrice).toBe(2000);
  });

  it("이미 목표값이면 쓰지 않는다", async () => {
    const writer = new FakeWriter(2000);
    const result = await executeRow(row(), writer, { readbackDelayMs: 0 });
    expect(result.status).toBe("success");
    expect(result.errorCode).toBe("already_target");
    expect(writer.writes).toEqual([]);
  });

  it("‘이미 목표값’이 캐시면 확인 후 실제로 쓴다", async () => {
    let wrote = false;
    let preReads = 0;
    const writes: number[] = [];
    const writer: VariantWriter = {
      async read() {
        if (wrote) return 2000;
        preReads += 1;
        return preReads <= 2 ? 2000 : 1000;
      },
      async write(_productNo, _variantCode, supplyPrice) {
        writes.push(supplyPrice);
        wrote = true;
      },
    };
    const result = await executeRow(row(), writer, { readbackDelayMs: 0 });
    expect(result.status).toBe("success");
    expect(writes).toEqual([2000]);
  });

  it("미리보기 이후 값이 바뀌면 충돌로 막고 쓰지 않는다", async () => {
    const writer = new FakeWriter(1500);
    const result = await executeRow(row(), writer);
    expect(result.status).toBe("conflict");
    expect(result.observedPrice).toBe(1500);
    expect(writer.writes).toEqual([]);
  });

  it("현재 공급가를 못 읽으면 실행하지 않는다", async () => {
    const writer = new FakeWriter(null);
    const result = await executeRow(row(), writer);
    expect(result.status).toBe("failed");
    expect(result.errorCode).toBe("missing_platform_price");
    expect(writer.writes).toEqual([]);
  });

  it("timeout 뒤 이미 반영됐으면 성공으로 분류한다", async () => {
    const writer = new FakeWriter(1000);
    writer.writeError = networkError();
    writer.applyOnWriteError = true;
    const result = await executeRow(row(), writer);
    expect(result.status).toBe("success");
    expect(result.errorCode).toBe("applied_after_timeout");
  });

  it("timeout 뒤 반영되지 않았으면 결과 불명으로 남긴다", async () => {
    const writer = new FakeWriter(1000);
    writer.writeError = networkError();
    const result = await executeRow(row(), writer, { readbackDelayMs: 0 });
    expect(result.status).toBe("unknown");
    expect(result.retry).toBe(true);
    expect(result.errorCode).toBe("write_unconfirmed");
  });

  it("429는 즉시 실패로 만들지 않고 재시도로 표시한다", async () => {
    const writer = new FakeWriter(1000);
    writer.writeError = new Cafe24ApiError(429, "too many");
    const result = await executeRow(row(), writer);
    expect(result.status).toBe("pending");
    expect(result.retry).toBe(true);
    expect(writer.writes).toEqual([]);
  });

  it.each([
    [403, "failed", "forbidden"],
    [404, "failed", "variant_not_found"],
    [401, "failed", "reauth_required"],
  ])("HTTP %i는 %s(%s)로 분류한다", async (status, expectedStatus, expectedCode) => {
    const writer = new FakeWriter(1000);
    writer.writeError = new Cafe24ApiError(status, "err");
    const result = await executeRow(row(), writer);
    expect(result.status).toBe(expectedStatus);
    expect(result.errorCode).toBe(expectedCode);
  });

  it("422 Supply price by item은 공급가 관리 방식 안내로 분류한다", async () => {
    const writer = new FakeWriter(1000);
    writer.writeError = new Cafe24ApiError(
      422,
      "err",
      "422",
      "Supply price by item cannot be modified.",
    );
    const result = await executeRow(row(), writer);
    expect(result.status).toBe("failed");
    expect(result.errorCode).toBe("supply_price_mode_required");
    expect(result.message).toContain("품목 단위");
  });

  it("422 Single product는 단일 품목 상품 안내로 분류한다", async () => {
    const writer = new FakeWriter(1000);
    writer.writeError = new Cafe24ApiError(
      422,
      "err",
      "422",
      "Single product cannot be modified.",
    );
    const result = await executeRow(row(), writer);
    expect(result.status).toBe("failed");
    expect(result.errorCode).toBe("single_variant_unsupported");
  });

  it("쓰기가 반영되지 않으면 실패로 남긴다", async () => {
    const writer = new FakeWriter(1000);
    writer.write = async () => {
      writer.writes.push(2000);
    };
    const result = await executeRow(row(), writer, { readbackDelayMs: 0 });
    expect(result.status).toBe("failed");
    expect(result.errorCode).toBe("not_applied");
  });

  it("쓰기 후 캐시로 이전 값이 보여도 재시도로 반영을 확인한다", async () => {
    let wrote = false;
    let readsAfterWrite = 0;
    const writer: VariantWriter = {
      async read() {
        if (!wrote) return 1000;
        readsAfterWrite += 1;
        return readsAfterWrite <= 2 ? 1000 : 2000;
      },
      async write() {
        wrote = true;
      },
    };
    const result = await executeRow(row(), writer, { readbackDelayMs: 0 });
    expect(result.status).toBe("success");
    expect(result.observedPrice).toBe(2000);
    expect(readsAfterWrite).toBe(3);
  });

  it("쓰기 후 다른 값이면 충돌로 남긴다", async () => {
    const writer = new FakeWriter(1000);
    writer.write = async () => {
      writer.price = 7777;
    };
    const result = await executeRow(row(), writer);
    expect(result.status).toBe("conflict");
    expect(result.observedPrice).toBe(7777);
  });

  it("대상 식별자가 없으면 건너뛴다", async () => {
    const result = await executeRow(row({ productNo: null }), new FakeWriter(1000));
    expect(result.status).toBe("skipped");
  });

  it("읽기 오류가 429면 재시도로 표시한다", async () => {
    const writer = new FakeWriter(1000);
    writer.read = async () => {
      throw new Cafe24ApiError(429, "limit");
    };
    const result = await executeRow(row(), writer);
    expect(result.retry).toBe(true);
    expect(result.errorCode).toBe("rate_limited");
  });
});

describe("job status", () => {
  it("집계와 최종 상태를 계산한다", () => {
    const ok = [
      { status: "success" as const },
      { status: "success" as const },
    ].map((entry) => ({ ...entry, message: "", errorCode: null, observedPrice: null, retry: false }));
    expect(summarizeOutcomes(ok).success).toBe(2);
    expect(finalJobStatus(summarizeOutcomes(ok))).toBe("completed");

    const partial = [...ok, { status: "failed" as const, message: "", errorCode: null, observedPrice: null, retry: false }];
    expect(finalJobStatus(summarizeOutcomes(partial))).toBe("partial_failure");

    const review = [...ok, { status: "conflict" as const, message: "", errorCode: null, observedPrice: null, retry: false }];
    expect(finalJobStatus(summarizeOutcomes(review))).toBe("needs_review");

    const running = [...ok, { status: "pending" as const, message: "", errorCode: null, observedPrice: null, retry: true }];
    expect(finalJobStatus(summarizeOutcomes(running))).toBe("running");
  });
});
