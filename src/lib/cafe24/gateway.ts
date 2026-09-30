import type { PlatformVariant, ShopRef } from "@/features/imports/model";
import type { FetchLike } from "./oauth";
import { listProductSummaries, listProductVariants } from "./variants";

export interface VariantGateway {
  listVariants(shop: ShopRef): Promise<PlatformVariant[]>;
}

export class FixtureVariantGateway implements VariantGateway {
  constructor(private readonly variants: PlatformVariant[]) {}

  async listVariants(shop: ShopRef): Promise<PlatformVariant[]> {
    return this.variants.filter(
      (variant) => variant.tenantId === shop.tenantId && variant.mallId === shop.mallId,
    );
  }
}

export interface Cafe24GatewayConfig {
  accessToken: string;
  shopNo?: string | null;
  currency?: string;
  apiVersion?: string | null;
  fetchImpl?: FetchLike;
  maxProducts?: number;
  perPage?: number;
}

export interface ShopVariantsResult {
  variants: PlatformVariant[];
  productCount: number;
  productsWithoutVariants: number;
  truncated: boolean;
}

export async function loadShopVariants(
  shop: ShopRef,
  config: Cafe24GatewayConfig,
): Promise<ShopVariantsResult> {
  const shopNo = config.shopNo ?? shop.shopNumber;
  const { products, truncated } = await listProductSummaries({
    mallId: shop.mallId,
    accessToken: config.accessToken,
    shopNo,
    apiVersion: config.apiVersion,
    fetchImpl: config.fetchImpl,
    maxProducts: config.maxProducts,
    limit: config.perPage,
  });

  const variants: PlatformVariant[] = [];
  let productsWithoutVariants = 0;
  for (const product of products) {
    const list = await listProductVariants({
      mallId: shop.mallId,
      accessToken: config.accessToken,
      shopNo,
      apiVersion: config.apiVersion,
      fetchImpl: config.fetchImpl,
      product,
    });
    if (list.length === 0) productsWithoutVariants += 1;
    for (const variant of list) {
      variants.push({
        tenantId: shop.tenantId,
        mallId: shop.mallId,
        productNo: variant.productNo,
        productName: variant.productName,
        variantCode: variant.variantCode,
        optionName: variant.optionName,
        supplyPrice: variant.supplyPrice,
        currency: config.currency ?? shop.currency,
      });
    }
  }

  return { variants, productCount: products.length, productsWithoutVariants, truncated };
}

export class Cafe24VariantGateway implements VariantGateway {
  constructor(private readonly config: Cafe24GatewayConfig) {}

  async listVariants(shop: ShopRef): Promise<PlatformVariant[]> {
    return (await loadShopVariants(shop, this.config)).variants;
  }
}
