const expired = "登录已过期，请刷新页面重新登录。";

/** An HTML error from a proxy is not evidence that the user's session expired. */
export async function readJson<T = Record<string, unknown>>(response: Response): Promise<T> {
  if (response.status === 401) throw Error(expired);
  if (response.redirected && response.url) {
    const url = new URL(response.url);
    if (url.pathname === "/login" || url.pathname.startsWith("/cdn-cgi/access/")) throw Error(expired);
  }
  const fallback = response.status === 403 ? "请求被拒绝，请检查访问权限后重试。"
    : response.status === 429 ? "请求太频繁，请稍后重试。"
    : [408, 504, 524].includes(response.status) ? "请求超时，请稍后重试。"
    : response.status >= 500 ? `服务暂时不可用（HTTP ${response.status}），请稍后重试。`
    : `接口返回了非预期响应（HTTP ${response.status}），请刷新页面后重试。`;
  if (!response.headers.get("content-type")?.includes("application/json")) throw Error(fallback);
  let body: unknown;
  try { body = await response.json(); } catch { throw Error("接口返回的数据无法解析，请稍后重试。"); }
  if (!response.ok) {
    const error = body && typeof body === "object" && "error" in body ? body.error : null;
    throw Error(typeof error === "string" && error ? error : fallback);
  }
  return body as T;
}
