import { createRemoteJWKSet, jwtVerify } from "jose";
import { NextResponse } from "next/server";
import { createDbSession, findOrCreateGoogle } from "@/lib/accounts";
import { controlPool } from "@/lib/postgres";
import { appOrigin, cookieName, cookieOptions, oauthCookieName, sessionSeconds, tokenHash } from "@/lib/session";

const googleKeys = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));
export async function GET(request: Request) {
  const url = new URL(request.url), state = url.searchParams.get("state"), code = url.searchParams.get("code");
  const cookieState = request.headers.get("cookie")?.match(new RegExp(`(?:^|; )${oauthCookieName}=([^;]+)`))?.[1];
  if (!state || !code || state !== cookieState) return NextResponse.redirect(appOrigin() + "/login?error=oauth");
  const attempt = (await controlPool.query("DELETE FROM oauth_attempts WHERE state_hash=$1 AND expires_at>now() RETURNING verifier,nonce", [tokenHash(state)])).rows[0];
  if (!attempt) return NextResponse.redirect(appOrigin() + "/login?error=oauth");
  try {
    const clientId = process.env.GOOGLE_CLIENT_ID, secret = process.env.GOOGLE_CLIENT_SECRET;
    if (!clientId || !secret) throw new Error("Google auth unavailable");
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ code, client_id: clientId, client_secret: secret, redirect_uri: appOrigin() + "/api/auth/google/callback", grant_type: "authorization_code", code_verifier: attempt.verifier }) });
    if (!tokenResponse.ok) throw new Error("Google token exchange failed");
    const tokens = await tokenResponse.json() as { id_token?: string };
    if (!tokens.id_token) throw new Error("Google identity missing");
    const { payload } = await jwtVerify(tokens.id_token, googleKeys, { issuer: ["https://accounts.google.com", "accounts.google.com"], audience: clientId, requiredClaims: ["exp", "iat", "sub"] });
    if (payload.nonce !== attempt.nonce || payload.email_verified !== true || typeof payload.sub !== "string" || typeof payload.email !== "string") throw new Error("Google identity invalid");
    const user = await findOrCreateGoogle(payload.sub, payload.email, typeof payload.name === "string" ? payload.name : "");
    const response = NextResponse.redirect(appOrigin());
    response.cookies.set(cookieName, await createDbSession(user.userId), { ...cookieOptions(), maxAge: sessionSeconds });
    response.cookies.set(oauthCookieName, "", { ...cookieOptions(), maxAge: 0 }); return response;
  } catch (error) { console.error(error); return NextResponse.redirect(appOrigin() + "/login?error=oauth"); }
}
