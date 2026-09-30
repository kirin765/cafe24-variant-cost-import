import type { ShopRef } from "@/features/imports/model";

export interface Shop {
  id: string;
  tenantId: string;
  mallId: string;
  shopNo: string;
  name: string | null;
  currency: string;
}

export interface UpsertShopInput {
  tenantId: string;
  mallId: string;
  shopNo: string;
  name?: string | null;
  currency?: string;
}

export interface StoredCredentials {
  shopId: string;
  accessToken: string;
  refreshToken: string;
  tokenType: string;
  scopes: string[];
  userId: string | null;
  accessExpiresAt: string | null;
  refreshExpiresAt: string | null;
  issuedAt: string | null;
}

export interface ShopSession {
  shopId: string;
  expiresAt: Date;
}

export interface SessionWithShop {
  session: ShopSession;
  shop: Shop;
}

export class ReauthRequiredError extends Error {
  readonly reason: string;

  constructor(reason: string) {
    super(`Cafe24 재인증이 필요합니다: ${reason}`);
    this.name = "ReauthRequiredError";
    this.reason = reason;
  }
}

export function toShopRef(shop: Shop): ShopRef {
  return {
    tenantId: shop.tenantId,
    mallId: shop.mallId,
    shopNumber: shop.shopNo,
    name: shop.name ?? shop.mallId,
    currency: shop.currency,
  };
}
