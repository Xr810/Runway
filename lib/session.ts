import { createHmac, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
const derive = promisify(scrypt);
export const cookieName = "opportunity_session";
export const sessionSeconds = 7 * 24 * 60 * 60;
export function appOrigin() { return new URL(process.env.APP_ORIGIN || "http://localhost:3000").origin; }
export function validOrigin(request: Request) { return request.headers.get("origin") === appOrigin(); }
/** Client address as seen by Cloudflare; the app is only reachable through the tunnel. */
export function clientIp(request: Request) { return request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for")?.split(",")[0].trim() || "local"; }
function secret() {
  const value = process.env.SESSION_SECRET;
  if (!value || value.length < 32) throw Error("SESSION_SECRET is not configured");
  return value;
}
function signature(value: string) { return createHmac("sha256", secret()).update(value).digest("base64url"); }
/** `version` is the server-side session generation; bumping it signs every device out. */
export function createSession(version = 0, now = Date.now()) {
  const payload = Buffer.from(JSON.stringify({ sub: "owner", exp: Math.floor(now / 1000) + sessionSeconds, ver: version })).toString("base64url");
  return payload + "." + signature(payload);
}
export function validSession(token: string | undefined, version = 0, now = Date.now()) {
  if (!token || token.length > 512) return false;
  const parts = token.split(".");
  if (parts.length !== 2) return false;
  try {
    const expected = Buffer.from(signature(parts[0])), actual = Buffer.from(parts[1]);
    if (actual.length !== expected.length || !timingSafeEqual(expected, actual)) return false;
    const payload = JSON.parse(Buffer.from(parts[0], "base64url").toString());
    return payload.sub === "owner" && Number.isInteger(payload.exp) && payload.exp > Math.floor(now / 1000) && (payload.ver ?? 0) === version;
  } catch { return false; }
}
export async function validPassword(password: unknown) {
  if (typeof password !== "string" || password.length > 1024) return false;
  const [salt, hash] = (process.env.LOGIN_PASSWORD_HASH || "").split(":");
  if (!/^[a-f0-9]{32}$/.test(salt || "") || !/^[a-f0-9]{128}$/.test(hash || "")) throw Error("Login password is not configured");
  const actual = await derive(password, salt, 64) as Buffer;
  return timingSafeEqual(actual, Buffer.from(hash, "hex"));
}
