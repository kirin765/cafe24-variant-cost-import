import { describe, expect, it } from "vitest";
import { parseCsvRecords, parseSupplyPriceCsv } from "./csv";

describe("parseCsvRecords", () => {
  it("기본 레코드와 개행을 나눈다", () => {
    const records = parseCsvRecords("a,b\nc,d\n");
    expect(records).toEqual([
      { values: ["a", "b"], line: 1 },
      { values: ["c", "d"], line: 2 },
    ]);
  });

  it("BOM을 제거한다", () => {
    expect(parseCsvRecords("\uFEFFa,b\n")[0].values).toEqual(["a", "b"]);
  });

  it("CRLF를 한 개의 레코드 구분자로 본다", () => {
    const records = parseCsvRecords("a,b\r\nc,d\r\n");
    expect(records).toHaveLength(2);
    expect(records[1]).toEqual({ values: ["c", "d"], line: 2 });
  });

  it("인용부호 안의 쉼표·개행·이중 인용부호를 보존한다", () => {
    const records = parseCsvRecords('a,"x,y"\nb,"line1\nline2"\nc,"he said ""hi"""\n');
    expect(records[0].values).toEqual(["a", "x,y"]);
    expect(records[1].values).toEqual(["b", "line1\nline2"]);
    expect(records[2].values).toEqual(["c", 'he said "hi"']);
  });

  it("여러 줄 필드 뒤의 물리적 행 번호를 센다", () => {
    const records = parseCsvRecords('h1,h2\n"a\nb",1\nc,2\n');
    expect(records.map((record) => record.line)).toEqual([1, 2, 4]);
  });

  it("마지막 개행이 없어도 레코드를 만든다", () => {
    const records = parseCsvRecords("a,b");
    expect(records).toEqual([{ values: ["a", "b"], line: 1 }]);
  });
});

describe("parseSupplyPriceCsv", () => {
  it("정상 파일을 행으로 바꾸고 앞자리 0을 보존한다", () => {
    const result = parseSupplyPriceCsv("variant_code,supply_price\n007,4500\nABC,0\n");
    expect(result.fileIssues).toEqual([]);
    expect(result.rows).toEqual([
      { line: 2, variantCode: "007", rawSupplyPrice: "4500", fieldCount: 2 },
      { line: 3, variantCode: "ABC", rawSupplyPrice: "0", fieldCount: 2 },
    ]);
  });

  it("헤더가 다르면 파일 전체를 거부한다", () => {
    const result = parseSupplyPriceCsv("variant,price\nA,1\n");
    expect(result.rows).toEqual([]);
    expect(result.fileIssues[0]?.code).toBe("file_header");
  });

  it("빈 줄은 건너뛰고 행 번호는 유지한다", () => {
    const result = parseSupplyPriceCsv("variant_code,supply_price\n\nA,1\n");
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].line).toBe(3);
  });

  it("열 개수가 다르면 fieldCount로 알린다", () => {
    const result = parseSupplyPriceCsv("variant_code,supply_price\nA,1,extra\nB\n");
    expect(result.rows[0].fieldCount).toBe(3);
    expect(result.rows[1].fieldCount).toBe(1);
    expect(result.rows[1].rawSupplyPrice).toBe("");
  });

  it("행 수를 넘으면 잘라내고 파일 오류를 남긴다", () => {
    const body = Array.from({ length: 5 }, (_, index) => `A${index},100`).join("\n");
    const result = parseSupplyPriceCsv(`variant_code,supply_price\n${body}\n`, {
      maxBytes: 1024,
      maxRows: 3,
    });
    expect(result.rows).toHaveLength(3);
    expect(result.fileIssues.some((entry) => entry.code === "file_too_many_rows")).toBe(true);
  });

  it("바이트 한도를 넘으면 파싱하지 않는다", () => {
    const result = parseSupplyPriceCsv("variant_code,supply_price\nA,1\n", {
      maxBytes: 5,
      maxRows: 1000,
    });
    expect(result.rows).toEqual([]);
    expect(result.fileIssues[0]?.code).toBe("file_too_large");
  });
});
