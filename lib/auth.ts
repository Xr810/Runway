import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { controlPool } from "./postgres";
import { cookieName, tokenHash } from "./session";

export type AuthUser = { userId: string; displayName: string };

export async function getUser(): Promise<AuthUser | null> {
  const token = (await cookies()).get(cookieName)?.value;
  if (!token || token.length > 128) return null;
  const row = (await controlPool.query(
    `SELECT a.id, a.display_name FROM auth_sessions s JOIN accounts a ON a.id=s.account_id
       WHERE s.token_hash=$1 AND s.revoked_at IS NULL AND s.expires_at>now()`, [tokenHash(token)],
  )).rows[0];
  if (!row) return null;
  const user = { userId: String(row.id), displayName: String(row.display_name) };
  return user;
}

export async function requireUser() { const user = await getUser(); if (!user) redirect("/login"); return user; }
