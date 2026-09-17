import { createHmac, timingSafeEqual } from "node:crypto";

export function launchHmacInput(rawSearch: string): string {
  const query = rawSearch.startsWith("?") ? rawSearch.slice(1) : rawSearch;
  return query
    .split("&")
    .filter((pair) => !pair.startsWith("hmac="))
    .join("&");
}

export function verifyLaunchHmac(
  rawSearch: string,
  providedHmac: string,
  secret: string,
): boolean {
  if (!providedHmac) return false;
  const expected = createHmac("sha256", secret).update(launchHmacInput(rawSearch)).digest("base64");
  const given = Buffer.from(providedHmac, "utf8");
  const want = Buffer.from(expected, "utf8");
  return given.length === want.length && timingSafeEqual(given, want);
}
