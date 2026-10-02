import { randomUUID, scrypt, timingSafeEqual } from "node:crypto";
import * as postgres from "./postgres";
import type { Pool } from "pg";
import { randomToken, sessionSeconds, tokenHash } from "./session";

// `controlPool` is supplied by the database-scoping integration and deliberately
// bypasses tenant business-data scoping for pre-authentication lookups.
const controlPool = (postgres as typeof postgres & { controlPool: Pool }).controlPool;
function derive(password: string, salt: string, length: number, options: { N: number; r: number; p: number }) {
  return new Promise<Buffer>((resolve, reject) => scrypt(password, salt, length, options, (error, result) => error ? reject(error) : resolve(result)));
}
export function normalizeEmail(value: unknown) {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}
export function validNewPassword(value: unknown): value is string { return typeof value === "string" && value.length >= 10 && value.length <= 1024; }
export async function hashPassword(password: string) {
  if (!validNewPassword(password)) throw new Error("密码至少需要 10 个字符");
  const salt = randomToken(16);
  const hash = await derive(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$16384$8$1$${salt}$${hash.toString("base64url")}`;
}
export async function verifyPassword(password: unknown, encoded: string) {
  if (typeof password !== "string" || password.length > 1024) return false;
  const parts = encoded.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [N, r, p] = parts.slice(1, 4).map(Number), expected = Buffer.from(parts[5], "base64url");
  if (N !== 16384 || r !== 8 || p !== 1 || expected.length !== 64) return false;
  const actual = await derive(password, parts[4], 64, { N, r, p });
  return timingSafeEqual(actual, expected);
}

export async function registerPassword(emailValue: unknown, password: unknown, nameValue: unknown) {
  const email = normalizeEmail(emailValue);
  if (!email || !validNewPassword(password)) throw new Error("请输入有效邮箱和至少 10 个字符的密码");
  const displayName = typeof nameValue === "string" && nameValue.trim() ? nameValue.trim().slice(0, 100) : email.split("@")[0];
  const id = randomUUID(), hash = await hashPassword(password);
  const client = await controlPool.connect();
  try {
    await client.query("BEGIN");
    await client.query("INSERT INTO accounts(id,display_name) VALUES($1,$2)", [id, displayName]);
    await client.query("INSERT INTO password_credentials(account_id,email,password_hash) VALUES($1,$2,$3)", [id, email, hash]);
    await client.query("COMMIT");
    return { userId: id, displayName };
  } catch (error) { await client.query("ROLLBACK").catch(() => {}); if ((error as { code?: string }).code === "23505") throw new Error("该邮箱已注册"); throw error; }
  finally { client.release(); }
}

export async function authenticatePassword(emailValue: unknown, password: unknown) {
  const email = normalizeEmail(emailValue);
  if (!email) return null;
  const row = (await controlPool.query(`SELECT a.id,a.display_name,p.password_hash FROM password_credentials p JOIN accounts a ON a.id=p.account_id WHERE p.email=$1`, [email])).rows[0];
  if (!row || !await verifyPassword(password, row.password_hash)) return null;
  return { userId: String(row.id), displayName: String(row.display_name) };
}

export async function findOrCreateGoogle(subject: string, email: string, name: string) {
  const found = (await controlPool.query("SELECT a.id,a.display_name FROM account_identities i JOIN accounts a ON a.id=i.account_id WHERE i.provider='google' AND i.subject=$1", [subject])).rows[0];
  if (found) return { userId: String(found.id), displayName: String(found.display_name) };
  // Deliberately do not look up password_credentials by email: identities are never auto-linked.
  const id = randomUUID(), displayName = name.trim().slice(0, 100) || email.split("@")[0];
  const client = await controlPool.connect();
  try {
    await client.query("BEGIN");
    await client.query("INSERT INTO accounts(id,display_name) VALUES($1,$2)", [id, displayName]);
    await client.query("INSERT INTO account_identities(account_id,provider,subject,email) VALUES($1,'google',$2,$3)", [id, subject, email.toLowerCase()]);
    await client.query("COMMIT");
    return { userId: id, displayName };
  } catch (error) { await client.query("ROLLBACK").catch(() => {}); throw error; }
  finally { client.release(); }
}

export async function createDbSession(accountId: string) {
  const token = randomToken();
  await controlPool.query("INSERT INTO auth_sessions(token_hash,account_id,expires_at) VALUES($1,$2,now()+make_interval(secs=>$3))", [tokenHash(token), accountId, sessionSeconds]);
  return token;
}
export async function revokeSession(token?: string) { if (token) await controlPool.query("UPDATE auth_sessions SET revoked_at=now() WHERE token_hash=$1", [tokenHash(token)]); }
export async function revokeAllSessions(accountId: string) { await controlPool.query("UPDATE auth_sessions SET revoked_at=now() WHERE account_id=$1 AND revoked_at IS NULL", [accountId]); }

export async function authRateLimit(key: string, limit: number, seconds: number) {
  const row = (await controlPool.query(`INSERT INTO rate_limits(key,count,window_start) VALUES($1,1,now()) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN rate_limits.window_start<now()-make_interval(secs=>$2) THEN 1 ELSE rate_limits.count+1 END,window_start=CASE WHEN rate_limits.window_start<now()-make_interval(secs=>$2) THEN now() ELSE rate_limits.window_start END RETURNING count`, ["auth:" + key, seconds])).rows[0];
  return Number(row.count) <= limit;
}
