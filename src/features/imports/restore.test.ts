import { describe, expect, it } from "vitest";
import { planRestore, summarizeRestore, type RestoreSourceRow } from "./restore";

function row(overrides: Partial<RestoreSourceRow> = {}): RestoreSourceRow {
  return {
    rowId: "row-1",
    productNo: "20",
    variantCode: "P000000R000A",
    beforePrice: 1000,
    targetPrice: 2000,
    status: "success",
    ...overrides,
  };
}

describe("planRestore", () => {
  it("현재 값이 목표값이면 이전 값으로 복원을 제안한다", () => {
    const plan = planRestore([row()], new Map([["row-1", 2000]]));
    expect(plan[0].verdict).toBe("restorable");
    expect(plan[0].restorePrice).toBe(1000);
  });

  it("이미 이전 값이면 복원 필요 없음으로 표시한다", () => {
    const plan = planRestore([row()], new Map([["row-1", 1000]]));
    expect(plan[0].verdict).toBe("restorable");
    expect(plan[0].issues[0].code).toBe("restore_no_change");
    expect(plan[0].issues[0].severity).toBe("warning");
  });

  it("현재 값이 목표값과 다르면 충돌로 자동 복원하지 않는다", () => {
    const plan = planRestore([row()], new Map([["row-1", 7777]]));
    expect(plan[0].verdict).toBe("conflict");
    expect(plan[0].issues[0].code).toBe("restore_external_change");
  });

  it("성공하지 않은 행은 복원 대상이 아니다", () => {
    const plan = planRestore([row({ status: "failed" })], new Map([["row-1", 2000]]));
    expect(plan[0].verdict).toBe("error");
    expect(plan[0].issues[0].code).toBe("restore_source_not_success");
  });

  it("이전/목표 값이 없거나 현재 값을 못 읽으면 오류", () => {
    expect(planRestore([row({ beforePrice: null })], new Map()).at(0)?.verdict).toBe("error");
    expect(planRestore([row()], new Map()).at(0)?.verdict).toBe("error");
  });

  it("변경이 없던 행은 복원 대상이 아니다", () => {
    const plan = planRestore([row({ beforePrice: 1000, targetPrice: 1000 })], new Map([["row-1", 1000]]));
    expect(plan[0].issues[0].code).toBe("restore_no_change");
    expect(plan[0].verdict).toBe("error");
  });

  it("복원 계획을 집계한다", () => {
    const plan = planRestore(
      [row({ rowId: "a" }), row({ rowId: "b" }), row({ rowId: "c" })],
      new Map([
        ["a", 2000],
        ["b", 7777],
        ["c", null],
      ]),
    );
    expect(summarizeRestore(plan)).toEqual({ restorable: 1, conflict: 1, errors: 1 });
  });
});
