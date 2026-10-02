"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, LoaderCircle } from "lucide-react";
import { APP_NAME, APP_TAGLINE } from "@/lib/brand";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Logo } from "@/components/app/logo";

export default function LoginForm({ oauthError = false }: { oauthError?: boolean }) {
  const router = useRouter();
  const [register, setRegister] = useState(false), [error, setError] = useState(oauthError ? "Google 登录失败，请重试" : ""), [busy, setBusy] = useState(false);
  return <main className="flex min-h-dvh items-center justify-center bg-background px-4"><div className="w-full max-w-[360px]">
    <div className="mb-8 flex flex-col items-center text-center"><Logo className="size-10 rounded-xl [&_svg]:size-5" /><h1 className="mt-4 text-xl font-semibold tracking-tight">{APP_NAME}</h1><p className="mt-1 text-sm text-muted-foreground">{APP_TAGLINE}</p></div>
    <form className="rounded-xl border bg-card p-6 shadow-sm" onSubmit={async event => {
      event.preventDefault(); setError(""); const values = Object.fromEntries(new FormData(event.currentTarget));
      if (register && values.password !== values.confirmPassword) { setError("两次输入的密码不一致"); return; }
      setBusy(true);
      try { const response = await fetch("/api/auth", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: register ? "register" : "login", ...values }) }); const data = await response.json(); if (!response.ok) throw Error(data.error); router.replace("/"); router.refresh(); }
      catch (e) { setError((e as Error).message || "登录失败"); setBusy(false); }
    }}>
      <div className="grid gap-4">
        {register && <div className="grid gap-1.5"><Label htmlFor="displayName">姓名</Label><Input id="displayName" name="displayName" autoComplete="name" maxLength={100} /></div>}
        <div className="grid gap-1.5"><Label htmlFor="email">邮箱</Label><Input id="email" name="email" type="email" autoComplete="email" required autoFocus maxLength={254} /></div>
        <div className="grid gap-1.5"><Label htmlFor="password">密码</Label><Input id="password" name="password" type="password" autoComplete={register ? "new-password" : "current-password"} required minLength={register ? 10 : undefined} maxLength={1024} /></div>
        {register && <div className="grid gap-1.5"><Label htmlFor="confirmPassword">确认密码</Label><Input id="confirmPassword" name="confirmPassword" type="password" autoComplete="new-password" required minLength={10} maxLength={1024} /></div>}
      </div>
      {register && <p className="mt-3 text-xs text-muted-foreground">密码至少 10 个字符。当前不验证邮箱，暂不提供密码找回；Google 账户不会按同名邮箱自动合并。</p>}
      {error && <p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}
      <Button type="submit" className="mt-5 w-full" disabled={busy}>{busy ? <LoaderCircle className="animate-spin" /> : <ArrowRight />}{busy ? "请稍候…" : register ? "注册" : "登录"}</Button>
      <Button type="button" variant="outline" className="mt-3 w-full" onClick={() => router.push("/api/auth/google")}>使用 Google 登录</Button>
      <button type="button" className="mt-4 w-full text-sm text-muted-foreground hover:underline" onClick={() => { setRegister(!register); setError(""); }}>{register ? "已有账户？登录" : "没有账户？注册"}</button>
    </form>
  </div></main>;
}
