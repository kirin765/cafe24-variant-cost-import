import { describe, expect, it } from "vitest";
import type { CsvRow, PlatformVariant } from "./model";
import { parseSupplyPrice, summarizeRows, validateImportRows } from "./validate";

function row(
  line: number,
  variantCode: string,
  rawSupplyPrice: string,
  fieldCount = 2,
): CsvRow {
  return { line, variantCode, rawSupplyPrice, fieldCount };
}

function variant(variantCode: string, supplyPrice: number): PlatformVariant {
  return {
    tenantId: "t1",
    mallId: "m1",
    productNo: `P-${variantCode}`,
    productName: "합성 상품",
    variantCode,
    optionName: "기본",
    supplyPrice,
    currency: "KRW",
  };
}

describe("parseSupplyPrice", () => {
  it("정수 원 단위를 받는다", () => {
    const result = parseSupplyPrice("4500");
    expect(result.ok).toBe(true);
    expect(result.value).toBe(4500);
    expect(result.issues).toEqual([]);
  });

  it("앞자리 0은 숫자로 정규화한다", () => {
    expect(parseSupplyPrice("04500").value).toBe(4500);
  });

  it("0원을 허용하되 주의를 남긴다", () => {
    const result = parseSupplyPrice("0");
    expect(result.ok).toBe(true);
    expect(result.value).toBe(0);
    expect(result.issues[0]).toMatchObject({ code: "zero_price", severity: "warning" });
  });

  it("빈 값은 0으로 해석하지 않는다", () => {
    const result = parseSupplyPrice("");
    expect(result.ok).toBe(false);
    expect(result.issues[0].code).toBe("missing_price");
  });

  it.each([
    ["-100", "부호"],
    ["+100", "부호"],
    ["₩4,500", "통화"],
    ["4,500", "천"],
    ["12.5", "소수"],
    ["1e3", "지수"],
    [" 4500", "공백"],
    ["4500 ", "공백"],
    ["NaN", "숫자"],
    ["abc", "숫자"],
    ["12_000", "정수"],
  ])("%s 는 invalid_price 오류", (raw) => {
    const result = parseSupplyPrice(raw);
    expect(result.ok).toBe(false);
    expect(result.issues[0].code).toBe("invalid_price");
  });

  it("안전한 정수 범위를 넘으면 거부한다", () => {
    const result = parseSupplyPrice("99999999999999999999");
    expect(result.ok).toBe(false);
    expect(result.issues[0].code).toBe("invalid_price");
  });
});

describe("validateImportRows", () => {
  const variants = [
    variant("A", 1000),
    variant("B", 2000),
    variant("C", 3000),
    variant("ZERO", 0),
  ];

  it("변경·동일을 나누고 이전 값을 보존한다", () => {
    const rows = validateImportRows({
      rows: [row(2, "A", "1500"), row(3, "B", "2000"), row(4, "ZERO", "0")],
      variants,
    });
    expect(rows.map((entry) => entry.verdict)).toEqual(["changed", "unchanged", "unchanged"]);
    expect(rows[0].beforePrice).toBe(1000);
    expect(rows[0].afterPrice).toBe(1500);
    expect(rows[2].issues[0].code).toBe("zero_price");
  });

  it("파일 안 중복 코드는 값이 같아도 오류로 막는다", () => {
    const rows = validateImportRows({
      rows: [row(2, "A", "1000"), row(3, "A", "1000")],
      variants,
    });
    expect(rows.every((entry) => entry.verdict === "error")).toBe(true);
    expect(rows.every((entry) => entry.issues.some((item) => item.code === "duplicate_code"))).toBe(
      true,
    );
  });

  it("미매칭 코드를 오류로 표시한다", () => {
    const rows = validateImportRows({ rows: [row(2, "GHOST", "1000")], variants });
    expect(rows[0].verdict).toBe("error");
    expect(rows[0].matched).toBe(false);
    expect(rows[0].beforePrice).toBeNull();
    expect(rows[0].issues.some((item) => item.code === "unmatched_code")).toBe(true);
  });

  it("빈 코드와 빈 공급가를 구분해 오류로 표시한다", () => {
    const rows = validateImportRows({ rows: [row(2, "", "1000"), row(3, "A", "")], variants });
    expect(rows[0].issues.some((item) => item.code === "missing_code")).toBe(true);
    expect(rows[1].issues.some((item) => item.code === "missing_price")).toBe(true);
    expect(rows[1].afterPrice).toBeNull();
  });

  it("열 개수가 다르면 malformed_row 오류", () => {
    const rows = validateImportRows({ rows: [row(2, "A", "1000", 3)], variants });
    expect(rows[0].issues.some((item) => item.code === "malformed_row")).toBe(true);
    expect(rows[0].verdict).toBe("error");
  });

  it("플랫폼 안 같은 코드가 둘이면 매칭을 막는다", () => {
    const duplicated = [...variants, variant("A", 9000)];
    const rows = validateImportRows({ rows: [row(2, "A", "1500")], variants: duplicated });
    expect(rows[0].issues.some((item) => item.code === "duplicate_platform_code")).toBe(true);
    expect(rows[0].verdict).toBe("error");
  });

  it("다른 몰의 같은 코드는 이 몰 변형만 매칭한다", () => {
    const rows = validateImportRows({ rows: [row(2, "A", "1500")], variants });
    expect(rows[0].productNo).toBe("P-A");
    expect(rows[0].optionName).toBe("기본");
  });
});

describe("summarizeRows", () => {
  it("판정과 주의를 집계한다", () => {
    const rows = validateImportRows({
      rows: [
        row(2, "A", "1500"),
        row(3, "B", "2000"),
        row(4, "GHOST", "1000"),
        row(5, "ZERO", "0"),
      ],
      variants: [variant("A", 1000), variant("B", 2000), variant("ZERO", 0)],
    });
    expect(summarizeRows(rows)).toEqual({
      total: 4,
      matched: 3,
      changed: 1,
      unchanged: 2,
      errors: 1,
      warnings: 1,
    });
  });
});
