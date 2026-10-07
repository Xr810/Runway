import { aiFetch } from "./ai-http";
import type { AiConfig } from "./ai-config";
import type { ModelMessage } from "./agent-model-loop";
import { ChatGptError } from "./chatgpt-oauth";
import { chatGptToken, markChatGptUnauthorized } from "./chatgpt";

function subscriptionError(code: string) {
  const messages: Record<string, string> = {
    subscription_sharing_usage_limit_exceeded:
      "ChatGPT 此应用的订阅额度不足，请在 ChatGPT 设置中查看用量。",
    subscription_sharing_usage_unavailable: "ChatGPT 订阅额度暂不可用，请稍后重试。",
    subscription_sharing_user_not_eligible:
      "当前 ChatGPT 用户、工作区或策略不符合订阅调用资格；重新授权不一定能解决。",
    subscription_sharing_unsupported_capability: "ChatGPT 当前接口或模型不支持所请求的能力。",
  };
  return new ChatGptError(
    (messages[code] ?? "ChatGPT 模型服务不可用或返回未完成结果。") + "未切换到 API Key。",
  );
}
export function responsesBody(model: string, messages: ModelMessage[]) {
  const instructions = messages
    .filter((m) => m.role === "system" || m.role === "developer")
    .map((m) => String(m.content))
    .join("\n\n");
  const input = messages
    .filter((m) => m.role !== "system" && m.role !== "developer")
    .map((m) => ({
      role: m.role,
      content: Array.isArray(m.content)
        ? m.content.map((part) => {
            if (part.type === "text") return { type: "input_text", text: part.text };
            if (part.type === "image_url")
              return { type: "input_image", image_url: part.image_url.url };
            throw new ChatGptError("ChatGPT 不支持此输入类型。");
          })
        : String(m.content),
    }));
  // Runway uses validated JSON reads/actions rather than native function tools. Keep
  // the full read/repair history on every request, with no hosted or implicit tools.
  return {
    model,
    instructions: instructions + "\n只输出符合上述协议的 JSON 对象，不要 markdown。",
    input,
    store: false,
    stream: true,
  };
}
export async function readResponsesStream(response: Response): Promise<string> {
  if (!response.body) throw subscriptionError("missing_stream");
  const reader = response.body.getReader(),
    decoder = new TextDecoder();
  let buffer = "",
    output = "",
    completed = false,
    bytes = 0;
  function event(frame: string) {
    const data = frame
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");
    if (!data || data === "[DONE]") return;
    let item;
    try {
      item = JSON.parse(data);
    } catch {
      throw subscriptionError("malformed_stream");
    }
    if (item.type === "response.output_text.delta") output += item.delta ?? "";
    else if (item.type === "response.completed") {
      if (item.response?.status !== "completed") throw subscriptionError("incomplete");
      completed = true;
      const text = item.response.output
        ?.flatMap((o: { content?: { type: string; text?: string }[] }) => o.content ?? [])
        .filter((c: { type: string }) => c.type === "output_text")
        .map((c: { text?: string }) => c.text ?? "")
        .join("");
      if (text) output = text;
    } else if (["response.failed", "response.incomplete", "error"].includes(item.type))
      throw subscriptionError(item.response?.error?.code ?? item.code ?? "failed");
  }
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.length;
      if (bytes > 2 * 1024 * 1024) throw subscriptionError("too_large");
      buffer += decoder.decode(value, { stream: true });
      buffer = buffer.replace(/\r\n/g, "\n");
      let end;
      while ((end = buffer.indexOf("\n\n")) >= 0) {
        event(buffer.slice(0, end));
        buffer = buffer.slice(end + 2);
      }
    }
    buffer += decoder.decode();
    if (buffer.trim()) event(buffer);
    if (!completed || !output) throw subscriptionError("interrupted");
    return output;
  } finally {
    await reader.cancel().catch(() => {});
  }
}
export async function chatGptModels(signal?: AbortSignal) {
  const token = await chatGptToken();
  const response = await fetch("https://api.openai.com/v1/models", {
    headers: { Authorization: `Bearer ${token}` },
    redirect: "error",
    signal: AbortSignal.any([AbortSignal.timeout(15000), ...(signal ? [signal] : [])]),
  });
  if (response.status === 401) {
    await markChatGptUnauthorized(token);
    throw new ChatGptError("ChatGPT 授权无效，请重新授权。");
  }
  if (!response.ok) throw subscriptionError("models_unavailable");
  const data = await response.json();
  if (!Array.isArray(data.models)) throw subscriptionError("invalid_models");
  return data.models
    .filter(
      (m: { visibility?: string; slug?: string; display_name?: string }) =>
        m.visibility === "list" && typeof m.slug === "string" && typeof m.display_name === "string",
    )
    .map((m: { slug: string; display_name: string }) => ({ id: m.slug, name: m.display_name }));
}
/** The single protocol boundary used by chat and structured background tasks. */
export async function callAiModel(
  config: AiConfig,
  messages: ModelMessage[],
  options: { signal?: AbortSignal; maxTokens?: number; timeout?: number } = {},
) {
  if (config.enabled === false) throw Error("此账户未启用 AI。");
  if (config.source === "chatgpt") {
    const token = await chatGptToken();
    if (!config.model) throw new ChatGptError("请在 ChatGPT 订阅设置中选择可用模型。");
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      redirect: "error",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "text/event-stream",
      },
      body: JSON.stringify(responsesBody(config.model, messages)),
      signal: AbortSignal.any([
        AbortSignal.timeout(options.timeout ?? 90000),
        ...(options.signal ? [options.signal] : []),
      ]),
    });
    if (response.status === 401) {
      await markChatGptUnauthorized(token);
      throw new ChatGptError("ChatGPT 授权无效，请重新授权。未切换到 API Key。");
    }
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw subscriptionError(data.error?.code ?? "unavailable");
    }
    return readResponsesStream(response);
  }
  const response = await aiFetch(config.base, config.key, "/chat/completions", {
    signal: options.signal,
    timeout: options.timeout,
    body: JSON.stringify({
      model: config.model,
      messages,
      response_format: { type: "json_object" },
      max_tokens: options.maxTokens ?? 3000,
    }),
  });
  if (!response.ok)
    throw Error(response.status === 429 ? "模型服务繁忙或额度不足。" : "模型服务暂时不可用。");
  const choice = (await response.json()).choices?.[0];
  if (choice?.finish_reason === "length") throw Error("识别结果太长，请分批操作。");
  if (typeof choice?.message?.content !== "string") throw Error("模型没有返回可读结果。");
  return choice.message.content as string;
}
