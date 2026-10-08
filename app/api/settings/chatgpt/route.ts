import { z } from "zod";
import { getUser } from "@/lib/auth";
import { appOrigin, validOrigin } from "@/lib/session";
import { getAiConfig, publicAiConfig, saveAiConfig } from "@/lib/ai-config";
import {
  assertChatGptPolicy,
  readChatGptConnection,
  disconnectChatGpt,
  selectAiSource,
  createChatGptPairing,
} from "@/lib/chatgpt";
import { callAiModel, chatGptModels } from "@/lib/ai-model";
import { ChatGptError } from "@/lib/chatgpt-oauth";
import { hit } from "@/lib/rate-limit";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const json = (data: unknown, status = 200) =>
  Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
async function status() {
  const user = await getUser();
  const config = await getAiConfig(),
    allowed = config.enabled && config.mode === "personal";
  const connection = allowed ? await readChatGptConnection() : null;
  return {
    userId: user!.userId,
    allowed: !!allowed,
    selected: config.source === "chatgpt",
    status: connection?.status ?? "disconnected",
    email: connection?.credentials.email ?? "",
    registration: connection?.credentials.client_id ?? "",
    model: connection?.model ?? "",
    revision: connection?.revision ?? 0,
    pairingId: connection?.pairingId ?? "",
  };
}
export async function GET() {
  if (!(await getUser())) return json({ error: "请先登录" }, 401);
  try {
    return json(await status());
  } catch {
    return json({ error: "读取 ChatGPT 连接失败，请检查服务器加密配置。" }, 503);
  }
}
const schema = z
  .object({
    action: z.enum(["select", "api-key", "models", "save", "test", "disconnect", "pair"]),
    model: z.string().max(250).optional(),
    revision: z.number().int().min(0).optional(),
  })
  .strict();
export async function POST(request: Request) {
  if (!(await getUser())) return json({ error: "请先登录" }, 401);
  if (!validOrigin(request)) return json({ error: "请求来源无效" }, 403);
  try {
    await assertChatGptPolicy();
  } catch {
    return json({ error: "当前账户策略不允许个人订阅授权。" }, 403);
  }
  let input;
  try {
    if (!request.headers.get("content-type")?.startsWith("application/json"))
      return json({ error: "请使用 JSON" }, 415);
    const reader = request.body?.getReader();
    if (!reader) throw Error();
    let size = 0;
    const chunks: Uint8Array[] = [];
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 4096) {
        await reader.cancel();
        return json({ error: "请求过大" }, 413);
      }
      chunks.push(value);
    }
    input = schema.parse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
  } catch {
    return json({ error: "请求格式无效" }, 400);
  }
  try {
    if (!(await hit("chatgpt-settings", 60, 3600)))
      return json({ error: "操作过多，请稍后重试。" }, 429);
    if (input.action === "pair") {
      const origin = appOrigin();
      if (!origin.startsWith("https://"))
        return json({ error: "自动配对需要 HTTPS Runway 地址。" }, 400);
      const { ticket, expiresAt, id } = await createChatGptPairing();
      return json({
        pairing: `${origin}/api/settings/chatgpt/pair#${ticket}`,
        expiresAt,
        pairingId: id,
      });
    }
    if (input.action === "select" || input.action === "api-key")
      await selectAiSource(input.action === "select" ? "chatgpt" : "api-key");
    if (input.action === "disconnect") {
      const { revoked } = await disconnectChatGpt();
      return json({
        ...(await status()),
        message: revoked
          ? "本地凭据已删除，OpenAI 已确认会话撤销。"
          : "本地凭据已删除；OpenAI 撤销未确认，请在 ChatGPT 设置中断开应用。",
      });
    }
    if (input.action === "models") return json({ models: await chatGptModels(request.signal) });
    if (input.action === "save" || input.action === "test") {
      const connection = await readChatGptConnection();
      if (!connection) throw new ChatGptError("ChatGPT 未连接，请先通过本机助手完成授权。");
      const models = await chatGptModels(request.signal),
        model = input.model ?? connection.model;
      if (!models.some((m: { id: string }) => m.id === model))
        throw new ChatGptError("请选择当前 ChatGPT 账户实际可用的模型。");
      const config = {
        base: "https://api.openai.com/v1",
        key: "",
        model,
        source: "chatgpt" as const,
        enabled: true,
        mode: "personal" as const,
        subscriptionReady: true,
        revision: connection.revision,
      };
      if (input.action === "save") {
        await saveAiConfig(config, input.revision ?? -1);
      } else {
        const text = await callAiModel(
          config,
          [{ role: "user", content: 'Reply with this JSON only: {"ok":true}' }],
          { signal: request.signal, timeout: 45000 },
        );
        try {
          if (
            JSON.parse(
              text
                .trim()
                .replace(/^```(?:json)?\s*/, "")
                .replace(/\s*```$/, ""),
            )?.ok !== true
          )
            throw Error();
        } catch {
          throw new ChatGptError("ChatGPT 已响应，但 JSON 协议测试未通过。未切换到 API Key。");
        }
        return json({ message: "ChatGPT 连接与 JSON 协议测试通过；未发送业务记录。" });
      }
    }
    return json({ ...(await status()), config: publicAiConfig(await getAiConfig()) });
  } catch (error) {
    const message =
      error instanceof ChatGptError
        ? error.message
        : "ChatGPT 操作失败，请稍后重试。未切换到 API Key。";
    return json({ error: message }, message.startsWith("设置已") ? 409 : 502);
  }
}
