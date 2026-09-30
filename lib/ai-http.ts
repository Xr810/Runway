import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";
import http from "node:http";
import https from "node:https";
import { normalizeBase } from "./ai-config";

const denied = new BlockList();
for (const [ip, mask] of [["0.0.0.0",8],["10.0.0.0",8],["100.64.0.0",10],["127.0.0.0",8],["169.254.0.0",16],["172.16.0.0",12],["192.168.0.0",16],["192.0.0.0",24],["192.0.2.0",24],["198.18.0.0",15],["198.51.100.0",24],["203.0.113.0",24],["224.0.0.0",3]] as const) denied.addSubnet(ip, mask, "ipv4");
for (const [ip, mask] of [["::",96],["::1",128],["fc00::",7],["fe80::",10],["ff00::",8],["2001:db8::",32],["64:ff9b::",96],["2002::",16]] as const) denied.addSubnet(ip, mask, "ipv6");
export function publicAddress(address: string) { const family = isIP(address); return !!family && !denied.check(address, family === 4 ? "ipv4" : "ipv6"); }
export async function checkEndpoint(base: string) {
  const normalized = normalizeBase(base), url = new URL(normalized);
  const internal = !!process.env.AI_BASE_URL && normalized === normalizeBase(process.env.AI_BASE_URL);
  if (!internal && url.protocol !== "https:") throw Error("自定义 API 地址请使用 HTTPS；已有的服务器内部接口可继续使用。");
  let addresses;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { addresses = await Promise.race([lookup(url.hostname.replace(/^\[|\]$/g, ""), { all: true }), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(Error("DNS timeout")), 5000); })]); }
  catch { throw Error("无法解析 API 地址，请检查域名。"); }
  finally { clearTimeout(timer); }
  if (!addresses.length || (!internal && addresses.some(item => !publicAddress(item.address)))) throw Error("该 API 地址指向本机或受限网络，请使用公开的 API 服务地址。");
  return { url, address: addresses[0] };
}
export async function aiFetch(base: string, key: string, path: "/models" | "/chat/completions", options: { body?: string; signal?: AbortSignal; timeout?: number } = {}): Promise<Response> {
  const { url, address } = await checkEndpoint(base);
  const signal = AbortSignal.any([AbortSignal.timeout(options.timeout || 90000), ...(options.signal ? [options.signal] : [])]);
  return new Promise((resolve, reject) => {
    // Pin the checked DNS address; do not follow redirects with a credential.
    const transport = url.protocol === "https:" ? https : http;
    const request = transport.request({ hostname: address.address, family: address.family, servername: url.hostname, port: url.port || (url.protocol === "https:" ? 443 : 80),
      path: url.pathname.replace(/\/$/, "") + path, method: options.body ? "POST" : "GET", agent: false, signal,
      headers: { Host: url.host, Authorization: `Bearer ${key}`, Accept: "application/json", ...(options.body ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(options.body) } : {}) } }, response => {
      const chunks: Buffer[] = []; let bytes = 0;
      response.on("data", (chunk: Buffer) => { bytes += chunk.length; if (bytes > 2 * 1024 * 1024) { response.destroy(); request.destroy(); reject(Error("模型接口返回的数据过大。")); } else chunks.push(chunk); });
      response.on("error", () => reject(Error("模型接口连接中断，请重试。")));
      response.on("end", () => { const status = response.statusCode || 502;
        if (status >= 300 && status < 400) { reject(Error("API 地址发生重定向，请填写最终 API Base URL。")); return; }
        resolve(new Response([204,205,304].includes(status) ? null : Buffer.concat(chunks), { status, headers: { "Content-Type": response.headers["content-type"] || "application/octet-stream" } })); });
    });
    request.on("error", () => reject(Error(signal.aborted ? "模型请求超时或已取消。" : "模型接口连接失败，请检查地址和网络。")));
    if (options.body) request.write(options.body); request.end();
  });
}
export function apiError(status: number) { return status === 401 || status === 403 ? "API 密钥无效或没有访问权限。" : status === 429 ? "模型服务限流或额度不足，请稍后重试。" : status === 404 ? "接口或模型不存在，请检查 Base URL 和模型 ID。" : "模型服务返回错误（HTTP " + status + "），请检查接口兼容性。"; }
