import type { z } from "zod";
import { callAiModel } from "./ai-model";
import { getAiConfig, isAiConfigured } from "./ai-config";

export class AiUnavailable extends Error {}
const strip = (content: string) =>
  content
    .trim()
    .replace(/^```(?:json)?\s*/, "")
    .replace(/\s*```$/, "");

/**
 * One structured call to the configured model. The task name leads the system prompt, which
 * keeps prompts identifiable in provider logs. The reply must parse against `schema`.
 */
export async function aiJson<T extends z.ZodTypeAny>(
  task: string,
  system: string,
  user: string,
  schema: T,
  options: { signal?: AbortSignal; maxTokens?: number; timeout?: number } = {},
): Promise<z.infer<T>> {
  const config = await getAiConfig();
  if (!isAiConfigured(config))
    throw new AiUnavailable(
      config.source === "chatgpt"
        ? "ChatGPT 尚未连接、授权失效或未选择模型。未切换到 API Key。"
        : "AI 模型尚未配置，请在设置中填写接口和模型。",
    );
  const content = await callAiModel(
    config,
    [
      {
        role: "system",
        content: `[task:${task}]\n${system}\n只输出一个 JSON 对象，不要 markdown 包裹。`,
      },
      { role: "user", content: user },
    ],
    options,
  );
  let raw: unknown;
  try {
    raw = JSON.parse(strip(content));
  } catch {
    throw Error("模型返回的不是有效 JSON");
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success)
    throw Error(
      "模型返回的格式不符合要求：" +
        parsed.error.issues[0].path.join(".") +
        " " +
        parsed.error.issues[0].message,
    );
  return parsed.data;
}
export async function aiConfigured() {
  return isAiConfigured(await getAiConfig());
}
