import { NextResponse, type NextRequest } from "next/server";

export function proxy(request: NextRequest): NextResponse {
  const { searchParams } = request.nextUrl;
  if (searchParams.has("hmac") && searchParams.has("mall_id")) {
    const url = request.nextUrl.clone();
    url.pathname = "/api/cafe24/launch";
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: "/",
};
