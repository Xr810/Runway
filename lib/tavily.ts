const endpoint = "https://api.tavily.com/search";

export type TavilyResult = { title: string; url: string; content: string; score?: number };

export class TavilyError extends Error {}

export function searchQuery(text: string) {
  const query = text.split(/\n(?:用户附图 ID|兼职草稿上下文|提案上下文)：/)[0]
    .replace(/https?:\/\/[^\s<>"'，。；）)]+/g, "")
    // Keep the subject of the request and remove the command used to invoke search.
    .replace(/^\s*(?:请|现在|可以)?\s*(?:帮我\s*)?(?:(?:用|进行)?\s*(?:web\s*search|websearch|联网搜索|联网查|网上查|全网搜索)\s*(?:一下)?|(?:搜索|搜一下|搜一搜|查一下|查找|查搜))\s*/i, "")
    .replace(/\bmlabs\b/gi, "M-Labs")
    .replace(/(?:一个|一家|这家(?:公司)?|这个公司|这个)\s*(?=做|是|公司|团队|$)/g, "")
    .replace(/\s*(?:这家(?:公司)?|这个公司)\s*$/g, "")
    .replace(/[，、,]+/g, " ")
    .replace(/([A-Za-z0-9])([\u4e00-\u9fff])/g, "$1 $2")
    .replace(/([\u4e00-\u9fff])([A-Za-z0-9])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim();
  return query.slice(0, 400);
}

/** Keep ordinary record-management prompts private and avoid unnecessary paid searches. */
export function shouldSearchWeb(text: string) {
  const command = text.split(/\n(?:用户附图 ID|兼职草稿上下文|提案上下文)：/)[0];
  const query = searchQuery(text);
  // `you can websearch` is often permission/context for an in-product action,
  // not a request to search the whole command as a web query.
  if (/(?:公司|企业|company|companies)/i.test(command) && /(?:图标|logo|徽标|标志)/i.test(command)
    && /(?:补|填|更|修|完善|获取|找)/i.test(command)) return false;
  if (/不要.*(?:联网|搜索)|不用.*(?:联网|搜索)|do not search|don't search/i.test(command)) return false;
  // Local records and paid surveys are not requests to disclose a message to a search engine.
  // A bare "搜索岗位/列出我的岗位" is an in-product search, not a web search (#14).
  if (/(?:查询|查找|查看|搜索|搜一下|查一下|列出).*(?:我的|已保存|已投递|工作台|收款记录|收入记录|岗位|项目|比赛|记录|提醒|日程|进度)|调查|提醒我|search (?:my|saved)|research intern/i.test(command)
    && !/联网|网上|全网|web\s*search|websearch|search (?:the )?web/i.test(command)) return false;
  return query.length >= 2 && /搜一下|搜索|搜一搜|查一下|查找.*(?:公司|官网|招聘)|联网|网上查|全网|最新.*(?:新闻|招聘|岗位|消息)|(?:公司|企业).*官网|\b(?:search|look\s*up|web\s*search|websearch)\b/i.test(command);
}

const genericTerms = new Set(["search", "web", "look", "up", "latest", "news", "about", "company", "companies", "the", "for", "and", "的", "这家", "公司", "团队", "一个", "一家"]);

function relevantToQuery(result: { title: string; content: string }, query: string) {
  const haystack = `${result.title}\n${result.content}`.toLocaleLowerCase();
  const compactHaystack = haystack.replace(/[^a-z0-9\u4e00-\u9fff]/g, "");
  const latinTerms = query.toLocaleLowerCase().match(/[a-z][a-z0-9-]{2,}/g) ?? [];
  const chineseTerms = query.match(/[\u4e00-\u9fff]{2,}/g) ?? [];
  const terms = [...new Set([...latinTerms, ...chineseTerms].filter(term => !genericTerms.has(term)))];
  // A result that does not mention any specific subject is usually a search-engine
  // explainer page (for example, a page about ChatGPT Search or Google Search).
  return terms.length === 0 || terms.some(term => haystack.includes(term) || compactHaystack.includes(term.replace(/[^a-z0-9\u4e00-\u9fff]/g, "")));
}

export async function searchTavily(text: string, apiKey: string, signal?: AbortSignal): Promise<TavilyResult[]> {
  const query = searchQuery(text);
  if (!apiKey || !query) return [];
  let response: Response;
  try { response = await fetch(endpoint, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ query, search_depth: "basic", topic: "general", max_results: 5, include_answer: false, include_raw_content: false, auto_parameters: false }),
    redirect: "error",
    signal: AbortSignal.any([AbortSignal.timeout(15000), ...(signal ? [signal] : [])]),
  }); } catch {
    if (signal?.aborted) throw signal.reason;
    throw new TavilyError("联网搜索超时或连接失败，请稍后重试。");
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw new TavilyError(response.status === 401 || response.status === 403 ? "Tavily 密钥无效或没有权限，请在设置中检查。"
      : [429, 432, 433].includes(response.status) ? "Tavily 搜索限流或额度不足，请稍后重试或检查账户额度。" : "Tavily 搜索暂时不可用，请稍后重试。");
  }
  let data: { results?: unknown };
  try {
    const reader = response.body?.getReader();
    if (!reader) throw Error();
    const chunks: Uint8Array[] = []; let bytes = 0;
    while (true) {
      const { value, done } = await reader.read(); if (done) break;
      bytes += value.length;
      if (bytes > 1024 * 1024) { await reader.cancel(); throw Error(); }
      chunks.push(value);
    }
    data = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!data || !Array.isArray(data.results)) throw Error();
  } catch { throw new TavilyError("Tavily 返回的搜索结果无法读取，请稍后重试。"); }
  const seen = new Set<string>();
  return (data.results as unknown[]).flatMap(item => {
    if (!item || typeof item !== "object") return [];
    const result = item as Record<string, unknown>;
    if (typeof result.title !== "string" || typeof result.url !== "string" || typeof result.content !== "string") return [];
    if (!relevantToQuery({ title: result.title, content: result.content }, query)) return [];
    let url: URL;
    try { url = new URL(result.url); } catch { return []; }
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || result.url.length > 2000 || !result.content.trim() || seen.has(url.href)) return [];
    seen.add(url.href);
    return [{ title: result.title.slice(0, 300), url: url.href, content: result.content.slice(0, 4000), score: typeof result.score === "number" ? result.score : undefined }];
  }).slice(0, 5);
}
