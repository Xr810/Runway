import { createHash, randomBytes, createCipheriv, createDecipheriv } from "node:crypto";
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import { z } from "zod";

export const issuer = "https://auth.openai.com";
export const resource = "https://api.openai.com/v1";
export const scopes = [
  "openid",
  "profile",
  "email",
  "offline_access",
  "resource.invoke",
  "chatgpt.tokens.use.direct",
];
const jwks = createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`));
const tokenSchema = z.object({
  access_token: z.string().min(1).max(16000),
  refresh_token: z.string().min(1).max(16000),
  id_token: z.string().min(1).max(16000),
  token_type: z.literal("Bearer"),
  expires_in: z.number().int().positive().max(86400),
  scope: z.string().max(2000),
});
export const credentialSchema = z
  .object({
    issuer: z.literal(issuer),
    subject: z.string().min(1).max(500),
    email: z.string().max(500),
    client_id: z
      .string()
      .min(1)
      .regex(/^[A-Za-z0-9_-]+$/)
      .max(500)
      .refine((value) => value !== "dynamic_agent_client"),
    access_token: tokenSchema.shape.access_token,
    refresh_token: tokenSchema.shape.refresh_token,
    id_token: tokenSchema.shape.id_token,
    scopes: z.array(z.string()).max(30),
    expires_at: z.number().positive(),
    saved_at: z.number().positive(),
  })
  .strict();
export type ChatGptCredentials = z.infer<typeof credentialSchema>;
export class ChatGptError extends Error {}
export function requireScopes(granted: string[]) {
  if (!scopes.every((scope) => granted.includes(scope)))
    throw new ChatGptError("ChatGPT 未授予身份和订阅额度所需权限，请重新授权。");
}
export function authorizationAttempt(
  host: string,
  redirect: string,
  existing?: ChatGptCredentials,
) {
  const callback = new URL(redirect);
  if (
    callback.protocol !== "http:" ||
    callback.hostname !== "127.0.0.1" ||
    callback.pathname !== "/auth/callback" ||
    callback.search ||
    callback.hash
  )
    throw new ChatGptError("ChatGPT 授权必须使用本机 127.0.0.1 /auth/callback。");
  const state = randomBytes(32).toString("base64url"),
    nonce = randomBytes(32).toString("base64url"),
    verifier = randomBytes(32).toString("base64url");
  const params = new URLSearchParams({
    client_id: existing?.client_id ?? "dynamic_agent_client",
    ext_agent_host_id: host,
    response_type: "code",
    redirect_uri: redirect,
    scope: scopes.join(" "),
    resource,
    state,
    nonce,
    code_challenge_method: "S256",
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
  });
  if (existing) {
    params.set("id_token_hint", existing.id_token);
    params.set("login_hint", existing.email);
  } else params.set("agent_name_hint", "Runway");
  return {
    state,
    nonce,
    verifier,
    redirect,
    clientId: existing?.client_id,
    subject: existing?.subject,
    url: `${issuer}/api/accounts/authorize?${params}`,
  };
}
export type AuthorizationAttempt = ReturnType<typeof authorizationAttempt>;
export async function validateIdentity(
  idToken: string,
  clientId: string,
  nonce?: string,
  expectedSubject?: string,
  keys: JWTVerifyGetKey = jwks,
) {
  try {
    const { payload } = await jwtVerify(idToken, keys, {
      issuer,
      audience: clientId,
      algorithms: ["RS256"],
      requiredClaims: ["exp", "sub", "iat"],
    });
    if (
      !payload.sub ||
      (nonce !== undefined && payload.nonce !== nonce) ||
      (expectedSubject && payload.sub !== expectedSubject)
    )
      throw Error();
    return { subject: payload.sub, email: typeof payload.email === "string" ? payload.email : "" };
  } catch {
    throw new ChatGptError("ChatGPT 身份签名、有效期、客户端或 nonce 校验失败，请重新授权。");
  }
}
export async function oauthPost(path: "token" | "revoke", body: URLSearchParams, fetcher = fetch) {
  const response = await fetcher(`${issuer}/api/accounts/oauth/${path}`, {
    method: "POST",
    redirect: "error",
    signal: AbortSignal.timeout(30000),
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!response.ok)
    throw new ChatGptError(
      response.status === 400 || response.status === 401
        ? "ChatGPT 授权已失效，请重新授权。"
        : "ChatGPT 授权服务不可用，请稍后重试。",
    );
  return response;
}
export async function exchangeCode(
  attempt: AuthorizationAttempt,
  callback: URL,
  fetcher = fetch,
  keys: JWTVerifyGetKey = jwks,
): Promise<ChatGptCredentials> {
  if (callback.searchParams.get("state") !== attempt.state)
    throw new ChatGptError("ChatGPT 授权 state 校验失败。");
  if (callback.searchParams.has("error"))
    throw new ChatGptError("ChatGPT 授权被拒绝或取消，未保存凭据。");
  const clientId = callback.searchParams.get("client_id") ?? attempt.clientId;
  if (
    !clientId ||
    clientId === "dynamic_agent_client" ||
    (attempt.clientId && clientId !== attempt.clientId)
  )
    throw new ChatGptError("ChatGPT 注册客户端不匹配。");
  const code = callback.searchParams.get("code");
  if (!code) throw new ChatGptError("ChatGPT 授权未返回授权码。");
  const response = await oauthPost(
    "token",
    new URLSearchParams({
      grant_type: "authorization_code",
      client_id: clientId,
      code,
      code_verifier: attempt.verifier,
      redirect_uri: attempt.redirect,
      resource,
    }),
    fetcher,
  );
  const token = tokenSchema.parse(await response.json());
  const identity = await validateIdentity(
    token.id_token,
    clientId,
    attempt.nonce,
    attempt.subject,
    keys,
  );
  const granted = token.scope.split(/\s+/);
  requireScopes(granted);
  return credentialSchema.parse({
    issuer,
    ...identity,
    client_id: clientId,
    access_token: token.access_token,
    refresh_token: token.refresh_token,
    id_token: token.id_token,
    scopes: granted,
    saved_at: Date.now(),
    expires_at: Date.now() + token.expires_in * 1000,
  });
}
export async function refreshCredentials(
  saved: ChatGptCredentials,
  fetcher = fetch,
): Promise<ChatGptCredentials> {
  const response = await oauthPost(
    "token",
    new URLSearchParams({
      grant_type: "refresh_token",
      client_id: saved.client_id,
      refresh_token: saved.refresh_token,
      resource,
    }),
    fetcher,
  );
  const token = tokenSchema
    .omit({ id_token: true })
    .extend({ id_token: z.string().optional() })
    .parse(await response.json());
  const granted = token.scope.split(/\s+/);
  requireScopes(granted);
  if (token.id_token)
    await validateIdentity(token.id_token, saved.client_id, undefined, saved.subject);
  return credentialSchema.parse({
    ...saved,
    access_token: token.access_token,
    refresh_token: token.refresh_token,
    id_token: token.id_token ?? saved.id_token,
    scopes: granted,
    saved_at: Date.now(),
    expires_at: Date.now() + token.expires_in * 1000,
  });
}
// Portable transfer files use a separate high-entropy key, never the deployment encryption key.
export function protectTransfer(value: string, secret: string) {
  if (secret.length < 32)
    throw new ChatGptError(
      "RUNWAY_CHATGPT_TRANSFER_KEY 必须至少 32 字符，建议使用随机生成的密钥。",
    );
  const iv = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", createHash("sha256").update(secret).digest(), iv);
  const data = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map((part) => part.toString("base64url")).join(".");
}
export function unprotectTransfer(value: string, secret: string) {
  try {
    if (secret.length < 32) throw Error();
    const [iv, tag, data] = value
      .trim()
      .split(".")
      .map((part) => Buffer.from(part, "base64url"));
    const cipher = createDecipheriv(
      "aes-256-gcm",
      createHash("sha256").update(secret).digest(),
      iv,
    );
    cipher.setAuthTag(tag);
    return Buffer.concat([cipher.update(data), cipher.final()]).toString("utf8");
  } catch {
    throw new ChatGptError("ChatGPT 转移文件无法解密或已损坏。");
  }
}
