import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile, rename, stat } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { spawn } from "node:child_process";
import {
  authorizationAttempt,
  exchangeCode,
  credentialSchema,
  protectTransfer,
  unprotectTransfer,
  ChatGptError,
} from "../lib/chatgpt-oauth";

// Never print tokens, callback URLs, or returning authorization URLs (id_token_hint).
const args = process.argv.slice(2),
  action = args[0];
function option(name: string) {
  const index = args.indexOf(`--${name}`);
  return index < 0 ? undefined : args[index + 1];
}
async function hostId() {
  const path = resolve(option("host-file") ?? "data/chatgpt-host-id");
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  try {
    await writeFile(path, `urn:uuid:${randomUUID()}`, { flag: "wx", mode: 0o600 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  const host = (await readFile(path, "utf8")).trim();
  if (!/^urn:uuid:[a-f0-9-]{36}$/.test(host)) throw new ChatGptError("主机标识文件格式无效。");
  return host;
}
async function readProtected(path: string) {
  const info = await stat(path);
  if (info.size > 100000 || (process.platform !== "win32" && info.mode & 0o077))
    throw new ChatGptError("凭据文件必须小于 100KB，Unix 权限必须为 0600。");
  return credentialSchema.parse(
    JSON.parse(
      unprotectTransfer(
        await readFile(path, "utf8"),
        process.env.RUNWAY_CHATGPT_TRANSFER_KEY ?? "",
      ),
    ),
  );
}
async function main() {
  if (action === "host") {
    await hostId();
    console.log("主机标识已准备，重启和导入不会替换它。");
    return;
  }
  if (action === "authorize") {
    const out = option("out");
    if (!out) throw new ChatGptError("需要 --out 指定受保护转移文件。");
    // Validate transfer key before user grants consent.
    protectTransfer("", process.env.RUNWAY_CHATGPT_TRANSFER_KEY ?? "");
    const existing = option("existing") ? await readProtected(option("existing")!) : undefined;
    const host = await hostId();
    const server = createServer();
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const port = (server.address() as { port: number }).port;
    const attempt = authorizationAttempt(host, `http://127.0.0.1:${port}/auth/callback`, existing);
    let consumed = false;
    try {
      const credentials = await new Promise<Awaited<ReturnType<typeof exchangeCode>>>(
        (resolve, reject) => {
          const timeout = setTimeout(
            () => reject(new ChatGptError("授权超时，请重新运行。")),
            300000,
          );
          server.on("request", async (request, response) => {
            const callback = new URL(request.url ?? "/", attempt.redirect);
            if (callback.pathname !== "/auth/callback") {
              response.writeHead(404).end();
              return;
            }
            if (consumed || callback.searchParams.get("state") !== attempt.state) {
              response.writeHead(400).end("Invalid authorization state.");
              return;
            }
            consumed = true;
            clearTimeout(timeout);
            try {
              const value = await exchangeCode(attempt, callback);
              response
                .writeHead(200, {
                  "Content-Type": "text/plain; charset=utf-8",
                  "Cache-Control": "no-store",
                  "Referrer-Policy": "no-referrer",
                })
                .end("Runway 授权成功，可关闭此页面。");
              resolve(value);
            } catch (error) {
              response.writeHead(400).end("Runway authorization failed. Check your terminal.");
              reject(error);
            }
          });
          const command =
            process.platform === "darwin"
              ? "open"
              : process.platform === "win32"
                ? "rundll32"
                : "xdg-open";
          const browser = spawn(
            command,
            process.platform === "win32"
              ? ["url.dll,FileProtocolHandler", attempt.url]
              : [attempt.url],
            { stdio: "ignore" },
          );
          browser.on("error", () => {
            clearTimeout(timeout);
            reject(new ChatGptError("无法打开系统浏览器，请在有桌面浏览器的本机运行授权命令。"));
          });
          browser.on("exit", (code) => {
            if (code && !consumed) {
              clearTimeout(timeout);
              reject(new ChatGptError("系统浏览器打开失败，请在本机桌面环境授权。"));
            }
          });
          console.log(
            "Continue with ChatGPT：系统浏览器已启动。此授权只允许订阅额度使用，不是 Runway 登录。",
          );
        },
      );
      const path = resolve(out);
      await mkdir(dirname(path), { recursive: true, mode: 0o700 });
      const temp = path + "." + randomUUID() + ".tmp";
      await writeFile(
        temp,
        protectTransfer(JSON.stringify(credentials), process.env.RUNWAY_CHATGPT_TRANSFER_KEY!),
        { flag: "wx", mode: 0o600 },
      );
      await rename(temp, path);
      console.log(
        "授权成功；受保护凭据已保存。安全转移并导入后，仅 VM 负责刷新。不要上传此文件或转移密钥。",
      );
    } finally {
      server.close();
    }
    return;
  }
  if (action === "import") {
    const file = option("file"),
      user = option("user");
    if (!file || !user) throw new ChatGptError("需要 --file 和 --user（Runway 账户 UUID）。");
    if (!process.env.AI_SETTINGS_KEY || process.env.AI_SETTINGS_KEY.length < 32)
      throw new ChatGptError("服务器必须配置至少 32 字符的独立 AI_SETTINGS_KEY。");
    await hostId(); // VM's own identifier is never replaced by laptop metadata.
    const credentials = await readProtected(file);
    const { runAsUser, pool } = await import("../lib/postgres");
    try {
      const { importChatGpt } = await import("../lib/chatgpt");
      await runAsUser(user, () => importChatGpt(credentials));
      console.log("已导入指定 Runway 账户。请在个人设置明确选择 ChatGPT 来源和模型；未自动切换。");
    } finally {
      await pool.end();
    }
    return;
  }
  console.log(
    "Usage: node --import tsx scripts/chatgpt.ts host | authorize --out FILE [--existing FILE] | import --file FILE --user UUID [--host-file PATH]",
  );
}
main().catch((error) => {
  console.error(
    error instanceof ChatGptError
      ? error.message
      : "ChatGPT 操作失败；未输出凭据。请检查配置、文件权限和网络。",
  );
  process.exitCode = 1;
});
