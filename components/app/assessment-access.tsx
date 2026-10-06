"use client";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { AssessmentAccess as Access } from "@/lib/assessment-access";
import { postJson, readJson } from "./store";

export function AssessmentAccess({
  entryId,
  appointmentId,
  url,
}: {
  entryId: string;
  appointmentId: string;
  url: string;
}) {
  const [value, setValue] = useState<Access | null>(null),
    [saved, setSaved] = useState<Access | null>(null);
  const [visible, setVisible] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const result = await readJson<Access>(
          await fetch("/api/assessment-access?" + new URLSearchParams({ entryId, appointmentId }), {
            cache: "no-store",
            signal: controller.signal,
          }),
        );
        if (controller.signal.aborted) return;
        setValue(result);
        setSaved(result);
        setError("");
        setVisible(false);
      } catch (e) {
        if (!controller.signal.aborted) setError((e as Error).message);
      }
    })();
    return () => controller.abort();
  }, [entryId, appointmentId, attempt]);
  async function copy(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`${label}已复制`);
    } catch {
      toast.error(`${label}复制失败，请手动选择复制。`);
    }
  }
  async function save() {
    if (!value || busy) return;
    setBusy(true);
    setError("");
    try {
      const next = await postJson<Access>("/api/assessment-access", {
        ...value,
        entryId,
        appointmentId,
      });
      setValue(next);
      setSaved(next);
      setVisible(false);
      toast.success("测评访问资料已保存");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="mt-3 min-w-0 space-y-3 border-t pt-3">
      {url && (
        <div className="flex items-start gap-2">
          <a
            className="min-w-0 flex-1 break-all select-text text-sm text-primary hover:underline"
            href={url}
            target="_blank"
            rel="noreferrer"
          >
            {url}
          </a>
          <Button
            type="button"
            size="sm"
            variant="outline"
            aria-label="复制测评网址"
            onClick={() => void copy(url, "测评网址")}
          >
            复制网址
          </Button>
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        访问资料仅自己可见，加密保存，不发送给 Agent，不包含在普通备份／导出中。
      </p>
      {value ? (
        <>
          <div className="space-y-1">
            <Label htmlFor={`access-login-${appointmentId}`}>测评账号（可选）</Label>
            <div className="flex gap-2">
              <Input
                id={`access-login-${appointmentId}`}
                autoComplete="off"
                value={value.login}
                maxLength={320}
                disabled={busy}
                onChange={(event) => setValue({ ...value, login: event.target.value })}
              />
              {value.login && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  aria-label="复制测评账号"
                  onClick={() => void copy(value.login, "测评账号")}
                >
                  复制
                </Button>
              )}
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor={`access-password-${appointmentId}`}>测评密码／访问码（可选）</Label>
            <div className="flex flex-wrap gap-2">
              <Input
                className="min-w-0 flex-1 basis-36"
                id={`access-password-${appointmentId}`}
                type={visible ? "text" : "password"}
                autoComplete="new-password"
                value={value.password}
                maxLength={4096}
                disabled={busy}
                onChange={(event) => setValue({ ...value, password: event.target.value })}
              />
              {value.password && (
                <>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    aria-label={visible ? "隐藏测评密码" : "显示测评密码"}
                    onClick={() => setVisible(!visible)}
                  >
                    {visible ? "隐藏" : "显示"}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    aria-label="复制测评密码"
                    onClick={() => void copy(value.password, "测评密码")}
                  >
                    复制
                  </Button>
                </>
              )}
            </div>
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={busy || (value.login === saved?.login && value.password === saved?.password)}
            onClick={() => void save()}
          >
            {busy ? "正在保存…" : "保存访问资料"}
          </Button>
          <p className="text-xs text-muted-foreground">清空字段后保存即可移除对应资料。</p>
        </>
      ) : (
        !error && <p className="text-xs text-muted-foreground">正在读取访问资料…</p>
      )}
      {error && (
        <div role="alert" className="space-y-2 text-sm text-destructive">
          <p>{error}</p>
          <Button type="button" size="sm" variant="outline" onClick={() => setAttempt(attempt + 1)}>
            {value ? "丢弃更改并重新读取" : "重新读取访问资料"}
          </Button>
        </div>
      )}
    </div>
  );
}
