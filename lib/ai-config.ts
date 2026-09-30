import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { pool } from "./postgres";

export type AiConfig = { base: string; key: string; model: string; tavilyKey?: string; revision: number; source: "environment" | "settings" };
export const settingsKey = "ai-settings-v1";
export function normalizeBase(value: string) {
  let url: URL;
  try { url = new URL(value.trim()); } catch { throw Error("API 地址无效，请填写完整的 Base URL。"); }
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw Error("API 地址不能包含账号、密码、查询参数或片段。");
  if (/\/(chat\/completions|models)\/?$/.test(url.pathname)) throw Error("请填写 Base URL（通常以 /v1 结尾），不包含 /models 或 /chat/completions。");
  return url.toString().replace(/\/+$/, "");
}
// AI keys are encrypted with AI_SETTINGS_KEY. Values sealed before it existed used a key derived from
// SESSION_SECRET; they still open, and are re-sealed with the dedicated key on first read.
function derived(label: string, secret: string | undefined) {
  return secret && secret.length >= 32 ? createHash("sha256").update(label + "\0" + secret).digest() : null;
}
function keys() {
  const current = derived("runway-ai-settings-v2", process.env.AI_SETTINGS_KEY), legacy = derived("opportunity-ai-settings-v1", process.env.SESSION_SECRET);
  if (!current && !legacy) throw Error("服务端加密配置不可用");
  return { seal: (current ?? legacy)!, open: [current, legacy].filter(k => k !== null), dedicated: !!current };
}
export function sealKey(value: string) {
  const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", keys().seal, iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), ciphertext].map(b => b.toString("base64url")).join(".");
}
export function openKey(value: string) {
  const [iv, tag, ciphertext] = value.split(".").map(v => Buffer.from(v, "base64url"));
  const { open, dedicated } = keys();
  for (const [index, key] of open.entries()) {
    try {
      const decipher = createDecipheriv("aes-256-gcm", key, iv); decipher.setAuthTag(tag);
      return { value: Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8"), stale: dedicated && index > 0 };
    } catch { /* try the next key */ }
  }
  throw Error("无法解密已保存的 API Key，请在设置中重新填写。");
}
export async function getAiConfig(): Promise<AiConfig> {
  const row = await pool.query("SELECT value FROM meta WHERE key=$1", [settingsKey]);
  if (!row.rowCount) return { base: process.env.AI_BASE_URL || "", key: process.env.AI_API_KEY || "", model: process.env.AI_MODEL || "", tavilyKey: process.env.TAVILY_API_KEY || "", revision: 0, source: "environment" };
  const saved = JSON.parse(row.rows[0].value), opened = openKey(saved.encryptedKey);
  if (opened.stale) await pool.query("UPDATE meta SET value=$2 WHERE key=$1", [settingsKey, JSON.stringify({ ...saved, encryptedKey: sealKey(opened.value) })]);
  let tavilyKey = process.env.TAVILY_API_KEY || "";
  if (typeof saved.encryptedTavilyKey === "string" && saved.encryptedTavilyKey) {
    try { tavilyKey = openKey(saved.encryptedTavilyKey).value; } catch { /* preserve AI settings availability if optional Tavily key is stale */ }
  }
  return { base: saved.base, key: opened.value, model: saved.model, tavilyKey, revision: saved.revision, source: "settings" };
}
export function publicAiConfig(config: AiConfig) {
  return { base: config.base, model: config.model, revision: config.revision, source: config.source, hasKey: !!config.key, hasTavilyKey: !!config.tavilyKey, configured: !!(config.base && config.key && config.model) };
}
export function resolveConfig(input: { base: string; apiKey?: string; tavilyApiKey?: string; model?: string }, current: AiConfig): AiConfig {
  const base = normalizeBase(input.base), key = input.apiKey?.trim();
  if (!key && (!current.key || base !== normalizeBase(current.base))) throw Error("更换 API 地址时，请同时填写该地址对应的 API Key。");
  return { base, key: key || current.key, model: input.model?.trim() || "", tavilyKey: input.tavilyApiKey?.trim() || current.tavilyKey || "", revision: current.revision, source: "settings" };
}
export async function saveAiConfig(config: AiConfig, revision: number) {
  const value = JSON.stringify({ base: config.base, model: config.model, encryptedKey: sealKey(config.key), encryptedTavilyKey: config.tavilyKey ? sealKey(config.tavilyKey) : null, revision: revision + 1 });
  const saved = revision === 0
    ? await pool.query("INSERT INTO meta(key,value) VALUES($1,$2) ON CONFLICT(key) DO NOTHING RETURNING value", [settingsKey, value])
    : await pool.query("UPDATE meta SET value=$2 WHERE key=$1 AND (value::jsonb->>'revision')::int=$3 RETURNING value", [settingsKey, value, revision]);
  if (!saved.rowCount) throw Error("设置已在其他窗口更新，请重新加载后再保存。");
  return { ...config, revision: revision + 1 };
}
