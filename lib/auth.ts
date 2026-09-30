import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { pool } from "./postgres";
import { cookieName, validSession } from "./session";

const key = "session-version";
let cached: { value: number; at: number } | null = null;
/** Current session generation, cached briefly so every request does not hit the database. */
export async function sessionVersion(fresh = false) {
  if (!fresh && cached && Date.now() - cached.at < 5000) return cached.value;
  const row = (await pool.query("SELECT value FROM meta WHERE key=$1", [key])).rows[0];
  cached = { value: row ? Number(row.value) : 0, at: Date.now() };
  return cached.value;
}
export async function bumpSessionVersion() {
  const row = (await pool.query("INSERT INTO meta(key,value) VALUES($1,'1') ON CONFLICT(key) DO UPDATE SET value=(meta.value::int+1)::text RETURNING value", [key])).rows[0];
  cached = { value: Number(row.value), at: Date.now() };
  return cached.value;
}
export async function getUser() {
  const token = (await cookies()).get(cookieName)?.value;
  return token && validSession(token, await sessionVersion()) ? { userId: "owner", displayName: "User" } : null;
}
export async function requireUser() { const user = await getUser(); if (!user) redirect("/login"); return user; }
