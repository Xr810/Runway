import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { currentUserId, pool, controlPool } from "./postgres";
import { sealKey, openKey } from "./ai-config";
import {
  ChatGptError,
  authorizationAttempt,
  exchangeCode,
  credentialSchema,
  requireScopes,
  refreshCredentials,
  oauthPost,
  validateIdentity,
  type ChatGptCredentials,
} from "./chatgpt-oauth";

export const chatGptKey = "chatgpt-connection-v1";
export const aiSourceKey = "ai-source-v1";
const pairingKey = "chatgpt-pairing-v1";
type Pairing = {
  id: string;
  ticket: string;
  expiresAt: number;
  attempt?: ReturnType<typeof authorizationAttempt>;
};
type Connection = {
  pairingId?: string;
  credentials: ChatGptCredentials;
  model: string;
  revision: number;
  status: "connected" | "reauthorize" | "refreshing";
};
function encode(owner: string, connection: Connection) {
  return sealKey(JSON.stringify({ owner, ...connection }));
}
function decode(owner: string, value: string): Connection {
  const data = JSON.parse(openKey(value).value);
  if (data.owner !== owner) throw new ChatGptError("ChatGPT 凭据不属于当前账户。");
  return {
    pairingId: data.pairingId,
    credentials: credentialSchema.parse(data.credentials),
    model: data.model,
    revision: data.revision,
    status: data.status,
  };
}
export async function assertChatGptPolicy() {
  const user = await currentUserId();
  if (process.env.AI_MODE === "managed")
    throw new ChatGptError("托管模式不允许个人 ChatGPT 订阅授权。");
  const row = await controlPool.query("SELECT ai_enabled FROM accounts WHERE id=$1", [user]);
  if (row.rows[0]?.ai_enabled !== true) throw new ChatGptError("此账户未启用 AI。");
  return user;
}
export async function readChatGptConnection() {
  const owner = await currentUserId();
  const row = await pool.query("SELECT value FROM meta WHERE key=$1", [chatGptKey]);
  return row.rowCount ? decode(owner, row.rows[0].value) : null;
}
// Session-level DB lock serializes import, disconnect, model changes and rotating refreshes
// across workers/processes. No serializable automatic retry can replay an OAuth operation.
async function locked<T>(
  work: (
    read: () => Promise<Connection | null>,
    save: (value: Connection | null) => Promise<void>,
    db: PoolClient,
  ) => Promise<T>,
) {
  const owner = await assertChatGptPolicy(),
    db = await pool.connect();
  const lock = `runway-chatgpt:${owner}`;
  try {
    await db.query("SELECT pg_advisory_lock(hashtextextended($1,0))", [lock]);
    const live = await db.query("SELECT ai_enabled FROM accounts WHERE id=$1", [owner]);
    if (live.rows[0]?.ai_enabled !== true) throw new ChatGptError("此账户未启用 AI。");
    const read = async () => {
      const row = await db.query("SELECT value FROM meta WHERE key=$1", [chatGptKey]);
      return row.rowCount ? decode(owner, row.rows[0].value) : null;
    };
    const save = async (connection: Connection | null) => {
      if (connection)
        await db.query(
          "INSERT INTO meta(user_id,key,value) VALUES($1,$2,$3) ON CONFLICT(user_id,key) DO UPDATE SET value=EXCLUDED.value",
          [owner, chatGptKey, encode(owner, connection)],
        );
      else await db.query("DELETE FROM meta WHERE key=$1", [chatGptKey]);
    };
    return await work(read, save, db);
  } finally {
    try {
      await db.query("SELECT pg_advisory_unlock(hashtextextended($1,0))", [lock]);
    } catch {
      db.release(true);
      throw new ChatGptError("ChatGPT 连接锁释放失败。");
    }
    db.release();
  }
}
// The ticket grants only one short-lived connection attempt, never ordinary API access.
export function chatGptPairingOwner(ticket: string) {
  try {
    const value = JSON.parse(openKey(ticket).value);
    if (
      value.purpose !== pairingKey ||
      typeof value.owner !== "string" ||
      !Number.isFinite(value.expiresAt) ||
      value.expiresAt <= Date.now()
    )
      throw Error();
    return value.owner as string;
  } catch {
    throw new ChatGptError("配对码无效或已过期，请在设置页重新生成。");
  }
}
export async function createChatGptPairing() {
  if (!process.env.AI_SETTINGS_KEY || process.env.AI_SETTINGS_KEY.length < 32)
    throw new ChatGptError("服务器必须配置至少 32 字符的独立 AI_SETTINGS_KEY。");
  const owner = await assertChatGptPolicy();
  return locked(async (_read, _save, db) => {
    const expiresAt = Date.now() + 10 * 60 * 1000;
    const id = randomUUID();
    const ticket = sealKey(JSON.stringify({ purpose: pairingKey, owner, expiresAt, id }));
    await db.query(
      "INSERT INTO meta(user_id,key,value) VALUES($1,$2,$3) ON CONFLICT(user_id,key) DO UPDATE SET value=EXCLUDED.value",
      [owner, pairingKey, sealKey(JSON.stringify({ id, ticket, expiresAt }))],
    );
    return { ticket, expiresAt, id };
  });
}
export async function processChatGptPairing(
  ticket: string,
  input: { action: "start"; host: string; port: number } | { action: "finish"; callback: string },
) {
  const owner = chatGptPairingOwner(ticket);
  if (owner !== (await currentUserId())) throw new ChatGptError("配对码不属于当前账户。");
  return locked(async (read, save, db) => {
    const row = await db.query("SELECT value FROM meta WHERE key=$1", [pairingKey]);
    const pending: Pairing | null = row.rowCount
      ? JSON.parse(openKey(row.rows[0].value).value)
      : null;
    if (!pending || pending.ticket !== ticket || pending.expiresAt <= Date.now())
      throw new ChatGptError("配对码已使用、取消或过期，请在设置页重新生成。");
    const old = await read();
    if (input.action === "start") {
      if (pending.attempt) throw new ChatGptError("此配对码已启动授权，请重新生成后重试。");
      pending.attempt = authorizationAttempt(
        input.host,
        `http://127.0.0.1:${input.port}/auth/callback`,
        old?.credentials,
      );
      await db.query("UPDATE meta SET value=$2 WHERE key=$1", [
        pairingKey,
        sealKey(JSON.stringify(pending)),
      ]);
      return { url: pending.attempt.url };
    }
    const callback = new URL(input.callback);
    const attempt = pending.attempt;
    if (
      !attempt ||
      callback.origin + callback.pathname !== attempt.redirect ||
      callback.searchParams.get("state") !== attempt.state
    )
      throw new ChatGptError("授权回调不匹配，请重新授权。");
    // Consume before exchanging a single-use code. An uncertain outcome requires a new attempt.
    await db.query("DELETE FROM meta WHERE key=$1", [pairingKey]);
    const credentials = await exchangeCode(attempt, callback);
    await save({
      pairingId: pending.id,
      credentials,
      model: old?.model ?? "",
      revision: (old?.revision ?? 0) + 1,
      status: "connected",
    });
    return { connected: true };
  });
}
export async function importChatGpt(credentials: ChatGptCredentials) {
  const parsed = credentialSchema.parse(credentials);
  requireScopes(parsed.scopes);
  await validateIdentity(parsed.id_token, parsed.client_id, undefined, parsed.subject);
  if (parsed.expires_at <= Date.now()) throw new ChatGptError("请使用刚完成本地授权的转移文件。");
  await locked(async (read, save, db) => {
    const old = await read();
    if (
      old &&
      (old.credentials.client_id !== parsed.client_id || old.credentials.subject !== parsed.subject)
    )
      throw new ChatGptError("请先断开原 ChatGPT 注册，再导入不同账号或工作区。");
    await db.query("DELETE FROM meta WHERE key=$1", [pairingKey]);
    await save({
      credentials: parsed,
      model: old?.model ?? "",
      revision: (old?.revision ?? 0) + 1,
      status: "connected",
    });
  });
}
export async function chatGptToken(fetcher = fetch) {
  return locked(async (read, save) => {
    const connection = await read();
    if (!connection) throw new ChatGptError("ChatGPT 未连接，请在设置页通过本机助手完成授权。");
    if (connection.status !== "connected")
      throw new ChatGptError(
        "ChatGPT 授权失效或刷新结果不确定，请重新授权，不能自动重用旧刷新凭据。",
      );
    if (connection.credentials.expires_at > Date.now() + 60000)
      return connection.credentials.access_token;
    // Persist intent before the external rotating-token operation; a crash fails closed.
    await save({ ...connection, status: "refreshing" });
    try {
      const credentials = await refreshCredentials(connection.credentials, fetcher);
      await save({ ...connection, credentials, status: "connected" });
      return credentials.access_token;
    } catch {
      await save({ ...connection, status: "reauthorize" });
      throw new ChatGptError("ChatGPT 刷新失败或结果不确定，请重新授权。未切换到 API Key。");
    }
  });
}
export async function selectAiSource(source: "chatgpt" | "api-key") {
  const owner = await assertChatGptPolicy();
  await pool.query(
    "INSERT INTO meta(user_id,key,value) VALUES($1,$2,$3) ON CONFLICT(user_id,key) DO UPDATE SET value=EXCLUDED.value",
    [owner, aiSourceKey, source],
  );
}
export async function setChatGptModel(model: string, revision: number) {
  await locked(async (read, save) => {
    const connection = await read();
    if (!connection) throw new ChatGptError("ChatGPT 未连接。");
    if (connection.revision !== revision)
      throw new ChatGptError("设置已在其他窗口更新，请重新加载。");
    await save({ ...connection, model, revision: revision + 1 });
  });
}
export async function disconnectChatGpt(fetcher = fetch) {
  return locked(async (read, save, db) => {
    await db.query("DELETE FROM meta WHERE key=$1", [pairingKey]);
    let readable = true;
    const connection = await read().catch(() => {
      readable = false;
      return null;
    });
    let revoked = readable && !connection;
    if (connection) {
      try {
        await oauthPost(
          "revoke",
          new URLSearchParams({
            token: connection.credentials.refresh_token,
            token_type_hint: "refresh_token",
            client_id: connection.credentials.client_id,
          }),
          fetcher,
        );
        revoked = true;
      } catch {
        /* Always erase local tokens; remote status is reported separately. */
      }
    }
    await save(null);
    // Keep source selected: disconnect never silently enables a billable API key.
    return { revoked };
  });
}
export async function markChatGptUnauthorized(token: string) {
  await locked(async (read, save) => {
    const connection = await read();
    if (connection?.credentials.access_token === token)
      await save({ ...connection, status: "reauthorize" });
  });
}
