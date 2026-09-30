"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, LoaderCircle } from "lucide-react";
import { APP_NAME, APP_TAGLINE } from "@/lib/brand";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Logo } from "@/components/app/logo";

export default function LoginForm() {
  const router = useRouter();
  const [error, setError] = useState(""), [busy, setBusy] = useState(false);
  return <main className="flex min-h-dvh items-center justify-center bg-background px-4">
    <div className="w-full max-w-[360px]">
      <div className="mb-8 flex flex-col items-center text-center">
        <Logo className="size-10 rounded-xl [&_svg]:size-5" />
        <h1 className="mt-4 text-xl font-semibold tracking-tight">{APP_NAME}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{APP_TAGLINE}</p>
      </div>
      <form className="rounded-xl border bg-card p-6 shadow-sm" onSubmit={async event => {
        event.preventDefault(); setBusy(true); setError("");
        const password = new FormData(event.currentTarget).get("password");
        try {
          const response = await fetch("/api/auth", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password }) });
          const data = await response.json(); if (!response.ok) throw Error(data.error);
          router.replace("/"); router.refresh();
        } catch (e) { setError((e as Error).message || "登录失败"); setBusy(false); }
      }}>
        <div className="grid gap-1.5"><Label htmlFor="password">访问密码</Label>
          <Input id="password" name="password" type="password" autoComplete="current-password" required autoFocus maxLength={1024} aria-invalid={!!error || undefined} /></div>
        {error && <p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}
        <Button type="submit" className="mt-5 w-full" disabled={busy}>{busy ? <LoaderCircle className="animate-spin" /> : <ArrowRight />}{busy ? "正在登录…" : "登录"}</Button>
      </form>
    </div>
  </main>;
}
