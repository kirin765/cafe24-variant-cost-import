import { NextResponse } from "next/server";
import { parseSupplyCsv } from "@/features/imports/csv";
import { CSV_LIMITS, type PlatformVariant } from "@/features/imports/model";
import { buildPreview } from "@/features/imports/preview";
import { createImportJob } from "@/features/imports/store";
import { getCurrentSession } from "@/lib/cafe24/auth";
import { readCafe24Config } from "@/lib/cafe24/env";
import { loadShopVariants } from "@/lib/cafe24/gateway";
import { getValidAccessToken } from "@/lib/cafe24/shop-store";
import { ReauthRequiredError, toShopRef } from "@/lib/cafe24/store-model";
import { getEncryptionKey } from "@/lib/crypto/key";
import { getPool, hasDatabaseUrl } from "@/lib/db/pool";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function redirectTo(requestUrl: string, path: string): NextResponse {
  return NextResponse.redirect(new URL(path, requestUrl), 303);
}

export async function POST(request: Request): Promise<NextResponse> {
  const back = (query: string) => redirectTo(request.url, `/imports/new?${query}`);

  if (!hasDatabaseUrl()) return back("error=storage");

  const access = await getCurrentSession();
  if (!access) return back("error=session");

  const config = readCafe24Config();
  if (!config.ok || !config.config) return back("error=config");

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return back("error=form");
  }

  const file = form.get("file");
  if (typeof file !== "object" || file === null || !("text" in file) || !("size" in file)) {
    return back("error=file");
  }
  const upload = file as File;
  if (upload.size === 0) return back("error=empty_file");
  if (upload.size > CSV_LIMITS.maxBytes) return back("error=size");

  const text = await upload.text();
  const parsed = parseSupplyCsv(text);

  // 상품 단위 파일(상품코드·공급가)은 옵션별 품목 변경의 근거가 아니다. 자동 추정하지 않는다.
  if (parsed.format === "cafe24-product") return back("error=product_csv");

  const template = parsed.format === null ? [] : null;
  try {
    const pool = getPool();
    const shopRef = toShopRef(access.shop);

    let variants: PlatformVariant[];
    if (template !== null) {
      variants = template;
    } else {
      const accessToken = await getValidAccessToken(pool, {
        shopId: access.shop.id,
        mallId: access.shop.mallId,
        clientId: config.config.clientId,
        clientSecret: config.config.clientSecret,
        encryptionKey: getEncryptionKey(),
      });
      const lookup = await loadShopVariants(shopRef, {
        accessToken,
        shopNo: access.shop.shopNo,
        currency: access.shop.currency,
        apiVersion: process.env.CAFE24_API_VERSION?.trim() || null,
        maxProducts: Number(process.env.IMPORT_MAX_PRODUCTS ?? 500) || 500,
      });
      if (lookup.variants.length === 0) return back("error=empty_variants");
      variants = lookup.variants;
    }

    const preview = buildPreview({
      shop: shopRef,
      fileName: upload.name,
      text,
      variants,
    });
    const jobId = await createImportJob(pool, { shopId: access.shop.id, preview });
    return redirectTo(request.url, `/imports/${jobId}/preview`);
  } catch (error) {
    if (error instanceof ReauthRequiredError) return back("error=reauth");
    const message = error instanceof Error ? error.message : "알 수 없는 오류";
    return back(`error=lookup&detail=${encodeURIComponent(message)}`);
  }
}
