import { ChatGptError } from "./chatgpt-oauth";

// Used only by the desktop helper, never by browser JavaScript. No redirects: a
// proxy login page or redirect must not receive the pairing ticket or callback.
export function pairingClient(code: string, fetcher = fetch) {
  let endpoint: URL;
  try {
    endpoint = new URL(code);
    if (
      code.length > 4096 ||
      endpoint.protocol !== "https:" ||
      endpoint.username ||
      endpoint.password ||
      endpoint.search ||
      endpoint.pathname !== "/api/settings/chatgpt/pair" ||
      !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(endpoint.hash.slice(1))
    )
      throw Error();
  } catch {
    throw new ChatGptError("配对码格式无效，请复制 HTTPS Runway 设置页生成的完整配对码。");
  }
  const ticket = endpoint.hash.slice(1);
  endpoint.hash = "";
  return {
    origin: endpoint.origin,
    async request(
      input:
        | { action: "start"; host: string; port: number }
        | { action: "finish"; callback: string },
    ) {
      let response: Response;
      try {
        response = await fetcher(endpoint, {
          method: "POST",
          redirect: "error",
          signal: AbortSignal.timeout(45000),
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${ticket}` },
          body: JSON.stringify(input),
        });
      } catch {
        throw new ChatGptError(
          "无法连接 Runway 或结果不确定。请返回设置页检查状态；未连接时生成新配对码，不要重复提交旧授权。",
        );
      }
      if (!response.ok)
        throw new ChatGptError(
          `Runway 拒绝配对（HTTP ${response.status}）。请检查账户 AI 权限、配对码有效期和服务器访问限制，再生成新配对码。`,
        );
      const value = await response.json();
      if (input.action === "start" ? typeof value.url !== "string" : value.connected !== true)
        throw new ChatGptError("Runway 未确认配对成功，请返回设置页检查状态。");
      return value as { url?: string; connected?: boolean };
    },
  };
}
