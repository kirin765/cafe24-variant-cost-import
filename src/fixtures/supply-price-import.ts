import type { PlatformVariant, ShopRef } from "@/features/imports/model";

export interface SyntheticImportFile {
  id: string;
  label: string;
  fileName: string;
  description: string;
  content: string;
}

export const SHOPS: ShopRef[] = [
  {
    tenantId: "tenant-alpha",
    mallId: "synthetic-alpha",
    shopNumber: "1001",
    name: "합성몰 알파",
    currency: "KRW",
  },
  {
    tenantId: "tenant-beta",
    mallId: "synthetic-beta",
    shopNumber: "2002",
    name: "합성몰 베타",
    currency: "KRW",
  },
  {
    tenantId: "tenant-gamma",
    mallId: "synthetic-gamma",
    shopNumber: "3003",
    name: "합성몰 감마 (품목 없음)",
    currency: "KRW",
  },
  {
    tenantId: "tenant-delta",
    mallId: "synthetic-delta",
    shopNumber: "4004",
    name: "합성몰 델타 (Cafe24 상품목록)",
    currency: "KRW",
  },
];

function variant(
  tenantId: string,
  mallId: string,
  productNo: string,
  productName: string,
  variantCode: string,
  optionName: string,
  supplyPrice: number,
): PlatformVariant {
  return {
    tenantId,
    mallId,
    productNo,
    productName,
    variantCode,
    optionName,
    supplyPrice,
    currency: "KRW",
  };
}

export const VARIANTS: PlatformVariant[] = [
  variant("tenant-alpha", "synthetic-alpha", "P1000001", "R1 러닝화", "SKU-0001", "블랙 / 270", 4500),
  variant("tenant-alpha", "synthetic-alpha", "P1000001", "R1 러닝화", "SKU-0002", "화이트 / 270", 4500),
  variant("tenant-alpha", "synthetic-alpha", "P1000002", "보온 텀블러 500ml", "SKU-0003", "스테인리스", 6200),
  variant("tenant-alpha", "synthetic-alpha", "P1000002", "보온 텀블러 500ml", "SKU-0004", "매트", 5000),
  variant("tenant-alpha", "synthetic-alpha", "P1000003", "리드 007 노트", "LEAD-007", "기본", 8900),
  variant("tenant-alpha", "synthetic-alpha", "P1000003", "리드 007 노트", "ZERO-001", "샘플", 0),
  variant("tenant-alpha", "synthetic-alpha", "P1000004", "검증용 상품", "ERR-NEG", "음수", 1000),
  variant("tenant-alpha", "synthetic-alpha", "P1000004", "검증용 상품", "ERR-CUR", "통화", 1000),
  variant("tenant-alpha", "synthetic-alpha", "P1000004", "검증용 상품", "ERR-DEC", "소수", 1000),
  variant("tenant-alpha", "synthetic-alpha", "P1000004", "검증용 상품", "ERR-EMPTY", "빈값", 1000),
  variant("tenant-beta", "synthetic-beta", "P2000001", "베타 전용 파우치", "BETA-01", "기본형", 3000),
  variant("tenant-beta", "synthetic-beta", "P2000001", "베타 전용 파우치", "BETA-02", "와이드형", 3800),
  variant("tenant-delta", "synthetic-delta", "P9000001", "합성 상품 1", "P9000001", "기본", 4500),
  variant("tenant-delta", "synthetic-delta", "P9000002", "합성 상품 2", "P9000002", "기본", 9500),
  variant("tenant-delta", "synthetic-delta", "P9000003", "합성 상품 3", "P9000003", "기본", 2000),
];

export const IMPORT_FILES: SyntheticImportFile[] = [
  {
    id: "normal",
    label: "정상 파일",
    fileName: "supply-prices-normal.csv",
    description: "오류 없는 파일입니다. 변경 1건, 동일 4건(0원 1건 포함)으로 확정할 수 있습니다.",
    content: [
      "variant_code,supply_price",
      "SKU-0001,4800",
      "SKU-0002,4500",
      "SKU-0003,6200",
      "LEAD-007,8900",
      "ZERO-001,0",
      "",
    ].join("\n"),
  },
  {
    id: "normal-beta",
    label: "정상 파일 (베타몰)",
    fileName: "supply-prices-beta.csv",
    description: "베타몰 품목만 담은 파일입니다. 다른 몰 품목은 매칭되지 않습니다.",
    content: [
      "variant_code,supply_price",
      "BETA-01,3300",
      "BETA-02,3800",
      "",
    ].join("\n"),
  },
  {
    id: "errors",
    label: "오류 파일",
    fileName: "supply-prices-errors.csv",
    description:
      "중복·빈값·음수·통화 기호·소수·미매칭·열 개수 오류를 섞은 파일입니다. 확정이 차단됩니다.",
    content: [
      "variant_code,supply_price",
      "SKU-0001,4800",
      "SKU-0001,4700",
      "SKU-0002,4500",
      "SKU-0003,6500",
      "LEAD-007,8900",
      "ZERO-001,0",
      "ERR-NEG,-100",
      'ERR-CUR,"₩1,000"',
      "ERR-DEC,1200.50",
      "ERR-EMPTY,",
      ",5000",
      "SKU-0004,5000,extra",
      "GHOST-404,5000",
      "",
    ].join("\n"),
  },
  {
    id: "cafe24-product",
    label: "Cafe24 상품목록 형식",
    fileName: "cafe24-products.csv",
    description:
      "Cafe24 상품목록 내보내기 형식(상품코드·공급가)입니다. 합성몰 델타를 고르면 상품코드로 매칭됩니다. 공급가 4500.00은 4500으로 정규화됩니다.",
    content: [
      "상품코드,자체 상품코드,상품명,소비자가,공급가,판매가",
      "P9000001,,합성 상품 1,5000.00,4500.00,5000.00",
      "P9000002,,합성 상품 2,10000.00,9000.00,10000.00",
      "P9000003,,합성 상품 3,3000.00,2000.00,3000.00",
      "",
    ].join("\n"),
  },
  {
    id: "bad-header",
    label: "잘못된 헤더 파일",
    fileName: "supply-prices-bad-header.csv",
    description: "헤더가 variant_code,supply_price 가 아니어서 파일 전체가 거부됩니다.",
    content: ["variant,price", "SKU-0001,4800", ""].join("\n"),
  },
];

export function findShop(tenantId: string): ShopRef | null {
  return SHOPS.find((shop) => shop.tenantId === tenantId) ?? null;
}

export function findImportFile(id: string): SyntheticImportFile | null {
  return IMPORT_FILES.find((entry) => entry.id === id) ?? null;
}
