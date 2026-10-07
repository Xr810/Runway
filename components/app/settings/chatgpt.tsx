"use client";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Panel } from "../ui";
import { readJson } from "../store";

type Connection = {
  userId: string;
  allowed: boolean;
  selected: boolean;
  status: "connected" | "disconnected" | "refreshing" | "reauthorize";
  email: string;
  registration: string;
  model: string;
  revision: number;
};
export default function ChatGptSettings({
  onChange,
  disabled,
}: {
  onChange: () => Promise<void>;
  disabled: boolean;
}) {
  const [connection, setConnection] = useState<Connection | null>(null),
    [models, setModels] = useState<{ id: string; name: string }[]>([]),
    [model, setModel] = useState("");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  async function load() {
    const value = await readJson<Connection>(
      await fetch("/api/settings/chatgpt", { cache: "no-store" }),
    );
    setConnection(value);
    setModel(value.model);
  }
  useEffect(() => {
    let active = true;
    fetch("/api/settings/chatgpt", { cache: "no-store" })
      .then(readJson<Connection>)
      .then((value) => {
        if (active) {
          setConnection(value);
          setModel(value.model);
        }
      })
      .catch((error) => {
        if (active) setError(error.message);
      });
    return () => {
      active = false;
    };
  }, []);
  async function run(action: string) {
    if (busy || disabled) return;
    if (
      action === "disconnect" &&
      !window.confirm("删除本地 ChatGPT 凭据并尝试撤销 OpenAI 会话？不会自动切换到 API Key。")
    )
      return;
    if (
      action === "api-key" &&
      !window.confirm("明确切换到 API Key？后续请求可能产生独立 API 费用。")
    )
      return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const value = await readJson<{ models?: { id: string; name: string }[]; message?: string }>(
        await fetch("/api/settings/chatgpt", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action, model, revision: connection?.revision }),
        }),
      );
      if (value.models) setModels(value.models);
      setNotice(
        value.message ??
          (action === "save"
            ? "订阅模型已保存。"
            : action === "models"
              ? "模型列表来自当前授权账号；这里只显示接口允许列出的模型。"
              : "模型来源已更新。"),
      );
      await load();
      await onChange();
    } catch (error) {
      setError((error as Error).message);
      await load().catch(() => {});
    } finally {
      setBusy(false);
    }
  }
  const unavailable = connection?.status !== "connected",
    locked = busy || disabled || !connection;
  return (
    <Panel
      title="ChatGPT 订阅授权（预览）"
      description="仅用于本人、个人自托管实例；不是 Runway 登录，也不会读取你的 ChatGPT 历史。"
    >
      <div className="flex flex-col gap-4 text-sm">
        <div role="status">
          当前来源：<b>{connection?.selected ? "ChatGPT 订阅" : "API Key"}</b> ·{" "}
          {connection?.status === "connected"
            ? "已连接"
            : connection?.status === "reauthorize" || connection?.status === "refreshing"
              ? "需要重新授权（失效或刷新结果不确定）"
              : "未连接"}
        </div>
        {connection?.email && (
          <p className="break-all text-muted-foreground">
            授权账号：{connection.email}
            <br />
            注册：{connection.registration}
          </p>
        )}
        <p className="text-xs text-muted-foreground">
          合资格请求使用本人 ChatGPT Work／Codex 订阅额度，实际资格与模型以 OpenAI
          为准。额度不足、失效或服务故障不会自动使用 API Key。
        </p>
        {error && (
          <p role="alert" className="text-destructive">
            {error}
          </p>
        )}
        {notice && (
          <p role="status" className="text-emerald-700 dark:text-emerald-300">
            {notice}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={locked}
            onClick={() => void run(connection?.selected ? "api-key" : "select")}
          >
            {connection?.selected ? "切换到 API Key（可能额外计费）" : "使用 ChatGPT 订阅"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={locked}
            onClick={() => {
              setError("");
              setNotice("");
              void load().catch((error) => setError(error.message));
            }}
          >
            刷新连接状态
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={
              busy || disabled || (!connection && !error) || connection?.status === "disconnected"
            }
            onClick={() => void run("disconnect")}
          >
            断开并删除本地凭据
          </Button>
        </div>
        <details className="rounded-lg border p-3" open={unavailable}>
          <summary className="cursor-pointer font-medium">
            Continue with ChatGPT · 在本机完成授权
          </summary>
          <div className="mt-3 space-y-2 text-xs text-muted-foreground">
            <p>
              在有浏览器的本机运行 Runway 授权命令（需要 Node.js 22.13+、仓库和 npm ci）。OAuth
              仅支持本机回调；不要在远程 VM 浏览器中直接授权，也不要粘贴 token、密码或 Cookie
              到此页面。
            </p>
            <p>
              准备独立随机转移密钥并保存在本机受保护环境文件的 RUNWAY_CHATGPT_TRANSFER_KEY
              中，再运行：
            </p>
            <code className="block break-all">
              node --env-file=.env.chatgpt.local --import tsx scripts/chatgpt.ts authorize --out
              data/chatgpt-credentials.json
            </code>
            <p>
              将加密文件经 SSH/SCP
              转移至个人服务器，转移密钥通过独立安全通道提供。服务器保留自己的主机标识，用应用数据库和加密配置导入至本人账户：
            </p>
            <code className="block break-all">
              node --env-file=.env.local --env-file=.env.chatgpt.local --import tsx
              scripts/chatgpt.ts import --file data/chatgpt-credentials.json --user{" "}
              {connection?.userId ?? "账户 UUID"}
            </code>
            <p>
              导入后删除转移副本和转移密钥（可另保留离线加密副本用于 --existing
              重新授权）。只有服务器负责后续刷新。点击“刷新连接状态”，读取模型并测试后，再明确选用此来源。
            </p>
          </div>
        </details>
        {connection && connection.status !== "disconnected" && (
          <div className="flex flex-col gap-3">
            <div>
              <Button
                variant="outline"
                size="sm"
                disabled={locked || unavailable}
                onClick={() => void run("models")}
              >
                读取订阅可用模型
              </Button>
            </div>
            <Label htmlFor="chatgpt-model">
              订阅模型{connection.model && `（已保存：${connection.model}）`}
            </Label>
            <select
              id="chatgpt-model"
              className="h-9 w-full rounded-md border bg-background px-3 text-sm"
              value={model}
              disabled={locked || unavailable}
              onChange={(event) => setModel(event.target.value)}
            >
              <option value="">从当前授权的模型列表选择</option>
              {connection.model && !models.some((m) => m.id === connection.model) && (
                <option value={connection.model}>{connection.model}</option>
              )}
              {models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name} · {m.id}
                </option>
              ))}
            </select>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={locked || unavailable || !model}
                onClick={() => void run("test")}
              >
                测试订阅连接
              </Button>
              <Button
                size="sm"
                disabled={locked || unavailable || !model || model === connection.model}
                onClick={() => void run("save")}
              >
                保存订阅模型
              </Button>
            </div>
          </div>
        )}
        <p className="text-xs text-muted-foreground">
          HTTP 预览采用无服务端存储的流式 Responses；JSON 由 Runway
          校验，业务工具仍需权限与确认。未实测模型的图片能力。断开时本地删除与 OpenAI
          撤销结果分别报告。
        </p>
        <a
          href="https://chatgpt.com/settings/usage"
          target="_blank"
          rel="noreferrer"
          className="text-xs underline"
        >
          ChatGPT 设置：查看额度与撤销应用授权
        </a>
      </div>
    </Panel>
  );
}
