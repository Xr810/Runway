import { createHash, randomBytes } from "node:crypto";

export const cookieName = "opportunity_session";
export const oauthCookieName = "opportunity_oauth_state";
export const sessionSeconds = 7 * 24 * 60 * 60;

export function appOrigin() {
  const configured = process.env.APP_ORIGIN;
  if (!configured) throw new Error("APP_ORIGIN is not configured");
  const url = new URL(configured);
  if (url.pathname !== "/" || url.search || url.hash) throw new Error("APP_ORIGIN must be an origin");
  return url.origin;
}

export function validOrigin(request: Request) {
  try { return request.headers.get("origin") === appOrigin(); } catch { return false; }
}

/** Client address supplied by the trusted deployment proxy. */
export function clientIp(request: Request) {
  return request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for")?.split(",")[0].trim() || "local";
}

export function randomToken(bytes = 32) { return randomBytes(bytes).toString("base64url"); }
export function tokenHash(token: string) { return createHash("sha256").update(token).digest(); }

export function cookieOptions() {
  return { httpOnly: true, sameSite: "lax" as const, secure: appOrigin().startsWith("https:"), path: "/" };
}
