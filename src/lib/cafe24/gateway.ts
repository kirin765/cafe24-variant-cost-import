import type { PlatformVariant, ShopRef } from "@/features/imports/model";

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
