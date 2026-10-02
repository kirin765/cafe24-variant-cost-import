import { NextResponse } from "next/server";

/**
 * 상대 Location으로 리다이렉트한다. Cloudflare tunnel/프록시 뒤에서는
 * request.url이 내부 바인딩 주소(http://localhost:<port>)가 되므로
 * 절대 URL로 리다이렉트하면 공개 호스트가 아닌 localhost로 새어 나간다.
 * 브라우저가 현재 공개 URL 기준으로 해석하도록 상대 경로를 넘긴다.
 */
export function relativeRedirect(location: string, status = 307): NextResponse {
  return new NextResponse(null, { status, headers: { location } });
}
