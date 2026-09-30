import { lookup } from "node:dns/promises";
import https from "node:https";
import { publicAddress } from "./ai-http";

// Local proxies in "fake-IP" mode answer every lookup from 198.18.0.0/15. Development machines may opt in
// to that range; production never does.
const devFakeIp = (address: string) => process.env.NODE_ENV !== "production" && process.env.DEV_ALLOW_FAKE_IP === "1" && /^198\.1[89]\./.test(address);
// Some corporate sites (including Goldman Sachs) hard-block non-browser bot
// identifiers even for public brand assets. Use a conventional browser UA so
// the same public pages/icons that work in a browser can be fetched safely.
const userAgent = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
export type Download = { bytes: Buffer; url: string; mime: string; status: number };
type Options = { signal?: AbortSignal; maxBytes?: number; accept?: string; method?: "GET" | "POST"; body?: string; contentType?: string };

/**
 * Fetches a public HTTPS resource. DNS is resolved once and the connection is pinned to that
 * address, private and reserved ranges are refused, redirects are re-checked, and the body is capped.
 */
export async function publicFetch(address: string, options: Options = {}, redirects = 0): Promise<Download> {
  const url = new URL(address);
  if (url.protocol !== "https:" || url.username || url.password || url.port && url.port !== "443") throw Error("仅允许公开 HTTPS 网址");
  const addresses = await Promise.race([lookup(url.hostname, { all: true }), new Promise<never>((_, reject) => { const timer = setTimeout(() => reject(Error("域名解析超时")), 5000); timer.unref(); })]);
  if (!addresses.length || addresses.some(a => !(publicAddress(a.address) || devFakeIp(a.address)) || a.address.toLowerCase().startsWith("::ffff:"))) throw Error("网址指向受限网络");
  const resolved = addresses[0], signal = options.signal ?? AbortSignal.timeout(25000), maxBytes = options.maxBytes ?? 2 * 1024 * 1024;
  return new Promise((resolve, reject) => {
    const request = https.request({ hostname: resolved.address, family: resolved.family, servername: url.hostname, path: url.pathname + url.search, method: options.method ?? "GET", agent: false, signal,
      headers: { Host: url.host, "User-Agent": userAgent, Accept: options.accept ?? "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.5", "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
        ...(options.body ? { "Content-Type": options.contentType ?? "application/json", "Content-Length": Buffer.byteLength(options.body) } : {}) } }, response => {
      const status = response.statusCode || 500;
      if (status >= 300 && status < 400) {
        response.resume();
        if (!response.headers.location || redirects >= 4) { reject(Error("重定向过多")); return; }
        void publicFetch(new URL(response.headers.location, url).href, { ...options, method: status === 307 || status === 308 ? options.method : "GET", body: status === 307 || status === 308 ? options.body : undefined }, redirects + 1).then(resolve, reject);
        return;
      }
      if (status !== 200) { response.resume(); reject(Error(status === 403 || status === 429 ? `网站拒绝了自动访问（HTTP ${status}）` : status === 404 ? "网站返回 HTTP 404，链接可能已过期、需要登录，或不是公开职位链接。" : `网站返回 HTTP ${status}`)); return; }
      const chunks: Buffer[] = []; let size = 0;
      response.on("data", (chunk: Buffer) => { size += chunk.length; if (size > maxBytes) { response.destroy(); reject(Error("页面内容超过读取上限")); } else chunks.push(chunk); });
      response.on("error", () => reject(Error("读取中断")));
      response.on("end", () => resolve({ bytes: Buffer.concat(chunks), url: url.href, mime: String(response.headers["content-type"] || "").split(";")[0].trim(), status }));
    });
    request.on("error", () => reject(Error(signal.aborted ? "访问超时" : "连接失败")));
    if (options.body) request.write(options.body);
    request.end();
  });
}
export async function fetchJson<T = unknown>(address: string, options: Options = {}): Promise<T> {
  const response = await publicFetch(address, { accept: "application/json", ...options });
  try { return JSON.parse(response.bytes.toString("utf8")) as T; } catch { throw Error("接口没有返回有效的 JSON"); }
}

const entities: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'" };
export function decodeEntities(text: string) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+\d*);/gi, (match, code: string) => {
    if (code[0] === "#") { const n = code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10); return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : match; }
    return entities[code.toLowerCase()] ?? match;
  });
}
/** Readable text from HTML: scripts and styles dropped, block elements become line breaks. */
export function htmlToText(html: string, max = 20000) {
  const text = html
    .replace(/<(script|style|noscript|svg|template|iframe)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(br|hr)\b[^>]*>/gi, "\n")
    .replace(/<li\b[^>]*>/gi, "\n• ")
    .replace(/<\/?(p|div|section|article|header|footer|li|ul|ol|h[1-6]|tr|table|main|aside|nav|dd|dt|blockquote|pre)\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  return decodeEntities(text).replace(/[ \t\f\v ]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n").trim().slice(0, max);
}

export type Posting = { title: string; organization: string; location: string; url: string; description: string; employmentType: string; datePosted: string; validThrough: string };
function asText(value: unknown): string { return typeof value === "string" ? value : Array.isArray(value) ? value.map(asText).filter(Boolean).join(", ") : value && typeof value === "object" && "name" in value ? asText((value as { name: unknown }).name) : ""; }
function place(value: unknown): string {
  const items = Array.isArray(value) ? value : [value];
  return items.map(item => { const a = (item as { address?: Record<string, unknown> })?.address; return a ? [a.addressLocality, a.addressRegion, a.addressCountry].map(asText).filter(Boolean).join(", ") : asText(item); }).filter(Boolean).join(" / ");
}
/** schema.org JobPosting objects embedded as JSON-LD, which most career sites publish for search engines. */
export function jobPostings(html: string, base: string): Posting[] {
  const found: Posting[] = [];
  const visit = (node: unknown) => {
    if (Array.isArray(node)) { node.forEach(visit); return; }
    if (!node || typeof node !== "object") return;
    const item = node as Record<string, unknown>, type = item["@type"];
    if (type === "JobPosting" || Array.isArray(type) && type.includes("JobPosting")) {
      let url = asText(item.url); try { url = url ? new URL(url, base).href : base; } catch { url = base; }
      found.push({ title: asText(item.title).trim(), organization: asText(item.hiringOrganization).trim(), location: place(item.jobLocation) || asText(item.jobLocationType), url,
        description: htmlToText(decodeEntities(asText(item.description)), 12000), employmentType: asText(item.employmentType), datePosted: asText(item.datePosted).slice(0, 10), validThrough: asText(item.validThrough).slice(0, 10) });
    }
    if (item["@graph"]) visit(item["@graph"]);
  };
  for (const match of html.matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) { try { visit(JSON.parse(match[1].trim())); } catch { /* ignore malformed blocks */ } }
  return found.filter(p => p.title);
}
export type Link = { text: string; url: string };
export function pageLinks(html: string, base: string, limit = 300): Link[] {
  const links: Link[] = [], seen = new Set<string>();
  for (const match of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const href = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(match[1]); if (!href) continue;
    let url: string; try { url = new URL(decodeEntities(href[1] ?? href[2] ?? href[3]), base).href.replace(/#.*$/, ""); } catch { continue; }
    if (!/^https:/.test(url) || seen.has(url)) continue;
    const text = htmlToText(match[2], 200).replace(/\s+/g, " ").trim(); if (text.length < 3) continue;
    seen.add(url); links.push({ text, url }); if (links.length >= limit) break;
  }
  return links;
}
export type ReadablePage = { url: string; title: string; text: string; postings: Posting[]; links: Link[] };
/** Detects a sign-in shell returned instead of the public posting. */
export function isLoginPage(html: string, title = "") {
  const heading = `${title}\n${htmlToText(html, 12000)}`;
  const hasLoginWord = /\b(log\s*in|login|sign\s*in|登录|登入)\b/i.test(heading);
  const hasCredentialField = /<input\b[^>]*(?:type\s*=\s*["']?password\b|name\s*=\s*["']?(?:password|username|email)\b)/i.test(html);
  return hasLoginWord && hasCredentialField;
}
/** Recruitment systems may show a bot check instead of the posting to server-side clients. */
export function isAccessChallenge(html: string, title = "") {
  const text = `${title}\n${htmlToText(html, 12000)}`;
  return /quick check needed|captcha|challenge|checking your browser|verify you are human|access denied|just a moment/i.test(text);
}
/** One page, reduced to what a model needs: title, readable text, JSON-LD postings and links. */
export async function readPage(address: string, signal?: AbortSignal): Promise<ReadablePage> {
  const page = await publicFetch(address, { signal });
  if (!/html|xml|text\/plain/.test(page.mime)) throw Error("链接不是网页（" + (page.mime || "未知类型") + "）");
  const html = page.bytes.toString("utf8"), title = decodeEntities(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? "").replace(/\s+/g, " ").trim();
  if (isLoginPage(html, title)) throw Error("这个链接需要登录才能查看，是个人申请页面而不是公开职位详情；请发送公开职位链接或岗位截图。");
  if (isAccessChallenge(html, title)) throw Error("招聘网站要求浏览器验证，Runway 无法直接读取这页；请发送公开职位链接、岗位截图或粘贴文字。");
  return { url: page.url, title, text: htmlToText(html), postings: jobPostings(html, page.url), links: pageLinks(html, page.url) };
}
