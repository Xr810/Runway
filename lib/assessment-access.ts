import { z } from "zod";
import { EntryError, getEntry } from "./entries";
import { currentUserId, pool, tx, type Db } from "./postgres";
import { sealKey, openKey } from "./ai-config";

const id = z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/);
export const assessmentAccessSchema = z
  .object({
    entryId: id,
    appointmentId: id,
    revision: z.number().int().min(0),
    login: z.string().max(320),
    password: z.string().max(4096),
  })
  .strict();
export type AssessmentAccess = Pick<
  z.infer<typeof assessmentAccessSchema>,
  "login" | "password" | "revision"
>;
const key = (entryId: string, appointmentId: string) =>
  `assessment-access-v1:${entryId}:${appointmentId}`;
const storedSchema = z.object({ revision: z.number().int().positive(), encrypted: z.string() });

async function requireAssessment(entryId: string, appointmentId: string, db: Db = pool) {
  const entry = await getEntry(entryId, db);
  if (
    !entry ||
    entry.kind !== "job" ||
    !entry.appointments.some((item) => item.id === appointmentId && item.type === "assessment")
  )
    throw new EntryError(404, "测评不存在或无权访问");
}

/** Credentials live only in encrypted, user-scoped meta, never in entries, versions or model snapshots. */
export async function getAssessmentAccess(
  entryId: string,
  appointmentId: string,
): Promise<AssessmentAccess> {
  await requireAssessment(entryId, appointmentId);
  const row = (
    await pool.query("SELECT value FROM meta WHERE key=$1", [key(entryId, appointmentId)])
  ).rows[0];
  if (!row) return { login: "", password: "", revision: 0 };
  try {
    const stored = storedSchema.parse(JSON.parse(row.value));
    const data = z
      .object({
        userId: z.string(),
        entryId: id,
        appointmentId: id,
        login: z.string(),
        password: z.string(),
      })
      .strict()
      .parse(JSON.parse(openKey(stored.encrypted).value));
    if (
      data.userId !== (await currentUserId()) ||
      data.entryId !== entryId ||
      data.appointmentId !== appointmentId
    )
      throw Error("binding");
    return { login: data.login, password: data.password, revision: stored.revision };
  } catch {
    throw new EntryError(503, "访问资料无法解密，请联系部署管理员核对加密配置；未覆盖已存资料。");
  }
}

export async function saveAssessmentAccess(raw: unknown): Promise<AssessmentAccess> {
  const parsed = assessmentAccessSchema.safeParse(raw);
  if (!parsed.success) throw new EntryError(400, "访问资料格式无效");
  if (!process.env.AI_SETTINGS_KEY || process.env.AI_SETTINGS_KEY.length < 32)
    throw new EntryError(503, "服务端访问资料加密配置不可用");
  const { entryId, appointmentId, login, password, revision } = parsed.data,
    userId = await currentUserId();
  return tx(
    async (client) => {
      await client.query("SELECT id FROM entries WHERE id=$1 AND deleted_at IS NULL FOR SHARE", [
        entryId,
      ]);
      await requireAssessment(entryId, appointmentId, client);
      const storageKey = key(entryId, appointmentId);
      const row = (
        await client.query("SELECT value FROM meta WHERE key=$1 FOR UPDATE", [storageKey])
      ).rows[0];
      const previous = row ? storedSchema.parse(JSON.parse(row.value)).revision : 0;
      if (previous !== revision)
        throw new EntryError(409, "访问资料已在其他窗口修改，请重新读取后再保存。");
      const next = revision + 1;
      const encrypted = sealKey(
        JSON.stringify({ userId, entryId, appointmentId, login, password }),
      );
      await client.query(
        "INSERT INTO meta(key,value) VALUES($1,$2) ON CONFLICT(user_id,key) DO UPDATE SET value=EXCLUDED.value",
        [storageKey, JSON.stringify({ revision: next, encrypted })],
      );
      return { login, password, revision: next };
    },
    { serializable: true },
  );
}
