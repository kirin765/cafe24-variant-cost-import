import { describe, expect, it } from "vitest";
import { IMPORT_FILES, SHOPS, VARIANTS } from "@/fixtures/supply-price-import";
import {
  buildPreview,
  canConfirm,
  collectBlockReasons,
  toChangeSpecCsv,
  toManifest,
  toReviewCsv,
} from "./preview";
import type { ImportPreview, PlatformVariant, ShopRef } from "./model";

const shop: ShopRef = SHOPS[0];
const variants: PlatformVariant[] = VARIANTS.filter(
  (variant) => variant.tenantId === shop.tenantId && variant.mallId === shop.mallId,
);

function fileText(id: string): string {
  const file = IMPORT_FILES.find((entry) => entry.id === id);
  if (!file) throw new Error(`fixture not found: ${id}`);
  return file.content;
}

function build(id: string, tenant: ShopRef = shop): ImportPreview {
  return buildPreview({
    shop: tenant,
    fileName: `${id}.csv`,
    text: fileText(id),
    variants:
      tenant.tenantId === shop.tenantId
        ? variants
        : VARIANTS.filter(
            (variant) => variant.tenantId === tenant.tenantId && variant.mallId === tenant.mallId,
          ),
    now: () => new Date("2026-09-16T00:00:00.000Z"),
  });
}

describe("buildPreview", () => {
  it("정상 파일은 오류 없이 변경·동일을 집계한다", () => {
    const preview = build("normal");
    expect(preview.counts).toEqual({
      total: 5,
      matched: 5,
      changed: 1,
      unchanged: 4,
      errors: 0,
      warnings: 1,
    });
    expect(preview.blocked).toBe(false);
    expect(preview.blockReasons).toEqual([]);
  });

  it("오류 파일은 모든 오류 유형을 잡고 확정을 막는다", () => {
    const preview = build("errors");
    expect(preview.counts.total).toBe(13);
    expect(preview.counts.matched).toBe(11);
    expect(preview.counts.changed).toBe(1);
    expect(preview.counts.unchanged).toBe(3);
    expect(preview.counts.errors).toBe(9);
    expect(preview.counts.warnings).toBe(1);
    expect(preview.blocked).toBe(true);

    const codes = new Set(preview.rows.flatMap((row) => row.issues.map((item) => item.code)));
    for (const code of [
      "duplicate_code",
      "missing_price",
      "missing_code",
      "invalid_price",
      "unmatched_code",
      "malformed_row",
      "zero_price",
    ]) {
      expect(codes.has(code as never)).toBe(true);
    }
  });

  it("잘못된 헤더는 행 없이 파일 오류로 막는다", () => {
    const preview = build("bad-header");
    expect(preview.rows).toEqual([]);
    expect(preview.blocked).toBe(true);
    expect(preview.fileIssues[0]?.code).toBe("file_header");
  });

  it("다른 몰 품목은 매칭하지 않는다", () => {
    const beta = SHOPS[1];
    const preview = build("normal", beta);
    expect(preview.counts.matched).toBe(0);
    expect(preview.counts.errors).toBe(5);
  });

  it("품목이 없는 몰은 전부 미매칭이다", () => {
    const preview = build("normal", SHOPS[2]);
    expect(preview.counts.matched).toBe(0);
    expect(preview.blocked).toBe(true);
  });

  it("파일 해시는 내용에 따라 달라진다", () => {
    const first = build("normal");
    const second = build("normal");
    const other = build("errors");
    expect(first.fileHash).toBe(second.fileHash);
    expect(first.fileHash).not.toBe(other.fileHash);
    expect(first.jobId).toBe(`job_${first.fileHash}`);
  });
});

describe("canConfirm", () => {
  it("오류 파일은 거부하고 사유를 돌려준다", () => {
    const preview = build("errors");
    const check = canConfirm(preview);
    expect(check.ok).toBe(false);
    expect(check.reasons.length).toBeGreaterThan(0);
  });

  it("정상 파일은 허용한다", () => {
    expect(canConfirm(build("normal")).ok).toBe(true);
  });
});

describe("collectBlockReasons", () => {
  it("행이 없으면 사유를 남긴다", () => {
    expect(collectBlockReasons([], [])).toEqual(["가져올 데이터 행이 없습니다."]);
  });
});

describe("export formats", () => {
  const preview = build("errors");

  it("검토 CSV는 모든 행과 이스케이프된 메시지를 담는다", () => {
    const csv = toReviewCsv(preview);
    expect(csv.startsWith("line,variant_code,")).toBe(true);
    expect(csv.endsWith("\r\n")).toBe(true);
    expect(csv).toContain("오류");
    expect(csv.split("\r\n").filter((line) => line.length > 0)).toHaveLength(14);
  });

  it("변경 명세 CSV는 변경 행만 담는다", () => {
    const lines = toChangeSpecCsv(preview).split("\r\n").filter((line) => line.length > 0);
    expect(lines[0]).toBe(
      "variant_code,product_no,product_name,option_name,before_supply_price,after_supply_price",
    );
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain("SKU-0003");
  });

  it("JSON 명세는 변경 목록과 안내를 담는다", () => {
    const manifest = JSON.parse(toManifest(preview)) as {
      counts: { changed: number };
      changes: { variantCode: string }[];
      note: string;
    };
    expect(manifest.counts.changed).toBe(1);
    expect(manifest.changes[0].variantCode).toBe("SKU-0003");
    expect(manifest.note).toContain("실제 Cafe24 품목은 수정하지 않았습니다");
  });
});
