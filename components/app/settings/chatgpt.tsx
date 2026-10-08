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
  pairingId: string;
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
  const [pairing, setPairing] = useState<{
    code: string;
    expiresAt: number;
    id: string;
  } | null>(null);
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
  useEffect(() => {
    if (!pairing) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      if (Date.now() >= pairing.expiresAt) {
        setPairing(null);
        setError("配对码已过期。如仍未连接，请生成新配对码并重新运行助手。");
        return;
      }
      try {
        const value = await readJson<Connection>(
          await fetch("/api/settings/chatgpt", {
            cache: "no-store",
            signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]),
          }),
        );
        if (controller.signal.aborted) return;
        setConnection(value);
        if (value.status === "connected" && value.pairingId === pairing.id) {
          setPairing(null);
          setModel(value.model);
          setError("");
          setNotice("ChatGPT 已连接。请读取可用模型、保存并测试，再选择使用订阅来源。");
          await onChange();
          return;
        }
        timer = setTimeout(poll, 3000);
      } catch {
        if (!controller.signal.aborted) {
          setPairing(null);
          setError("连接状态检查失败，请点击刷新连接状态；未连接时重新生成配对码。");
        }
      }
    };
    timer = setTimeout(poll, 3000);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [pairing, onChange]);
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
      const value = await readJson<{
        models?: { id: string; name: string }[];
        message?: string;
        pairing?: string;
        expiresAt?: number;
        pairingId?: string;
      }>(
        await fetch("/api/settings/chatgpt", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action, model, revision: connection?.revision }),
        }),
      );
      if (value.pairing && value.expiresAt && value.pairingId) {
        setPairing({
          code: value.pairing,
          expiresAt: value.expiresAt,
          id: value.pairingId,
        });
        return;
      }
      if (action === "disconnect") setPairing(null);
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
        <div className="space-y-3 rounded-lg border p-4">
          <p className="font-medium">Continue with ChatGPT · 本机授权助手</p>
          <p className="text-xs text-muted-foreground">
            浏览器完成 OpenAI 登录，助手自动连接
            Runway。无需传文件、转移密钥或操作服务器；本机不保存 ChatGPT token。
          </p>
          <ol className="list-inside list-decimal space-y-3 text-sm">
            <li>
              在有浏览器的电脑上准备 Node.js 22.13+ 和最新版 Runway 仓库，首次运行{" "}
              <code>npm ci</code>。
            </li>
            <li>
              在仓库目录启动助手：
              <code className="mt-1 block overflow-x-auto whitespace-pre rounded bg-muted px-2 py-2 text-xs select-all">
                node --import tsx scripts/chatgpt.ts connect
              </code>
            </li>
            <li>
              生成并复制配对码，粘贴到助手提示中；核对服务器地址后输入 <code>yes</code>，在打开的
              OpenAI 页面授权。
            </li>
          </ol>
          <Button
            size="sm"
            disabled={locked || !connection?.allowed}
            onClick={() => void run("pair")}
          >
            {pairing ? "重新生成配对码（旧码失效）" : "生成本机配对码"}
          </Button>
          {pairing && (
            <div className="space-y-2">
              <Label htmlFor="chatgpt-pairing">一次性配对码 · 10 分钟有效 · 请勿分享</Label>
              <textarea
                id="chatgpt-pairing"
                readOnly
                value={pairing.code}
                rows={3}
                className="w-full resize-none rounded-md border bg-background p-2 font-mono text-xs"
                onFocus={(event) => event.target.select()}
              />
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  void navigator.clipboard.writeText(pairing.code).then(
                    () => setNotice("配对码已复制，请粘贴到本机助手。"),
                    () => setError("无法自动复制，请选中配对码后手动复制。"),
                  );
                }}
              >
                复制配对码
              </Button>
              <p role="status" className="text-xs text-muted-foreground">
                等待本机助手完成授权… 此页会自动检查连接，最多 10 分钟。
              </p>
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            只使用你本人设置页生成的配对码。不要向任何页面粘贴 ChatGPT token、密码或
            Cookie。完成后在下方选择模型并测试。
          </p>
        </div>
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
