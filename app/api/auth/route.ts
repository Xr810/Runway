import { NextResponse } from "next/server";
import { authenticatePassword, authRateLimit, createDbSession, registerPassword, revokeAllSessions, revokeSession } from "@/lib/accounts";
import { getUser } from "@/lib/auth";
import { clientIp, cookieName, cookieOptions, sessionSeconds, validOrigin } from "@/lib/session";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!validOrigin(request)) return NextResponse.json({ error: "请求来源无效" }, { status: 403 });
  try {
    const text = await request.text();
    if (text.length > 4096) return NextResponse.json({ error: "请求过大" }, { status: 413 });
    let body: Record<string, unknown>; try { body = JSON.parse(text); } catch { return NextResponse.json({ error: "请求格式无效" }, { status: 400 }); }
    if (typeof body !== "object" || body === null || Array.isArray(body)) return NextResponse.json({ error: "请求格式无效" }, { status: 400 });
    const oldToken = request.headers.get("cookie")?.match(new RegExp(`(?:^|; )${cookieName}=([^;]+)`))?.[1];
    if (body.action === "logout" || body.action === "logout-all") {
      const user = await getUser();
      if (body.action === "logout-all" && !user) return NextResponse.json({ error: "请先登录" }, { status: 401 });
      if (body.action === "logout-all") await revokeAllSessions(user!.userId); else await revokeSession(oldToken);
      const response = NextResponse.json({ ok: true }); response.cookies.set(cookieName, "", { ...cookieOptions(), maxAge: 0 }); return response;
    }
    const ip = clientIp(request);
    if (!await authRateLimit(`password:${ip}`, 10, 900) || !await authRateLimit("password:global", 200, 3600)) return NextResponse.json({ error: "尝试次数过多，请稍后重试" }, { status: 429, headers: { "Retry-After": "900" } });
    let user;
    if (body.action === "register") user = await registerPassword(body.email, body.password, body.displayName);
    else if (body.action === "login") user = await authenticatePassword(body.email, body.password);
    else return NextResponse.json({ error: "请求格式无效" }, { status: 400 });
    if (!user) return NextResponse.json({ error: "邮箱或密码不正确" }, { status: 401 });
    const response = NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
    response.cookies.set(cookieName, await createDbSession(user.userId), { ...cookieOptions(), maxAge: sessionSeconds });
    return response;
  } catch (error) {
    const message = error instanceof Error && /邮箱|密码/.test(error.message) ? error.message : "登录暂时不可用";
    if (message === "登录暂时不可用") console.error(error);
    return NextResponse.json({ error: message }, { status: message.includes("已注册") ? 409 : message.includes("有效") ? 400 : 503 });
  }
}
