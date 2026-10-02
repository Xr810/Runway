import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { authRateLimit } from "@/lib/accounts";
import { controlPool } from "@/lib/postgres";
import { appOrigin, clientIp, cookieOptions, oauthCookieName, randomToken, tokenHash } from "@/lib/session";

export async function GET(request: Request) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId || !process.env.GOOGLE_CLIENT_SECRET) return NextResponse.json({ error: "Google 登录未配置" }, { status: 503 });
  if (!await authRateLimit(`oauth:${clientIp(request)}`, 20, 900)) return NextResponse.json({ error: "尝试次数过多，请稍后重试" }, { status: 429 });
  const state = randomToken(), verifier = randomToken(), nonce = randomToken();
  await controlPool.query("DELETE FROM oauth_attempts WHERE expires_at<=now()");
  await controlPool.query("INSERT INTO oauth_attempts(state_hash,verifier,nonce,expires_at) VALUES($1,$2,$3,now()+interval '10 minutes')", [tokenHash(state), verifier, nonce]);
  const redirectUri = appOrigin() + "/api/auth/google/callback";
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, response_type: "code", scope: "openid email profile", state, nonce, code_challenge: createHash("sha256").update(verifier).digest("base64url"), code_challenge_method: "S256", prompt: "select_account" }).toString();
  const response = NextResponse.redirect(url); response.cookies.set(oauthCookieName, state, { ...cookieOptions(), maxAge: 600 }); return response;
}
