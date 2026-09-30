import type { z } from "zod";
import { aiFetch } from "./ai-http";
import { getAiConfig } from "./ai-config";

export class AiUnavailable extends Error {}
const strip = (content: string) => content.trim().replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");

/**
 * One structured call to the configured model. The task name leads the system prompt, which
 * keeps prompts identifiable in provider logs. The reply must parse against `schema`.
 */
export async function aiJson<T extends z.ZodTypeAny>(task: string, system: string, user: string, schema: T, options: { signal?: AbortSignal; maxTokens?: number; timeout?: number } = {}): Promise<z.infer<T>> {
  const config = await getAiConfig();
  if (!config.base || !config.key || !config.model) throw new AiUnavailable("AI 模型尚未配置，请在设置中填写接口和模型。");
  const response = await aiFetch(config.base, config.key, "/chat/completions", {
    signal: options.signal, timeout: options.timeout ?? 90000,
    body: JSON.stringify({ model: config.model, max_tokens: options.maxTokens ?? 3000, response_format: { type: "json_object" },
      messages: [{ role: "system", content: `[task:${task}]\n${system}\n只输出一个 JSON 对象，不要 markdown 包裹。` }, { role: "user", content: user }] }),
  });
  if (!response.ok) throw new AiUnavailable(response.status === 429 ? "模型服务限流或额度不足" : `模型服务返回 HTTP ${response.status}`);
  const choice = (await response.json()).choices?.[0];
  if (typeof choice?.message?.content !== "string") throw Error("模型没有返回内容");
  let raw: unknown; try { raw = JSON.parse(strip(choice.message.content)); } catch { throw Error("模型返回的不是有效 JSON"); }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw Error("模型返回的格式不符合要求：" + parsed.error.issues[0].path.join(".") + " " + parsed.error.issues[0].message);
  return parsed.data;
}
export async function aiConfigured() { const c = await getAiConfig(); return !!(c.base && c.key && c.model); }
