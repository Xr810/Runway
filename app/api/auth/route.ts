import { NextResponse } from "next/server";
import { bumpSessionVersion, getUser, sessionVersion } from "@/lib/auth";
import { hit, reset } from "@/lib/rate-limit";
import { appOrigin, clientIp, cookieName, createSession, sessionSeconds, validOrigin, validPassword } from "@/lib/session";
export const dynamic = "force-dynamic";
const cookieOptions = () => ({ httpOnly: true, sameSite: "lax" as const, secure: appOrigin().startsWith("https:"), path: "/" });
export async function POST(request: Request) {
  if (!validOrigin(request)) return NextResponse.json({ error: "请求来源无效" }, { status: 403 });
  try {
    const text = await request.text();
    if (text.length > 4096) return NextResponse.json({ error: "请求过大" }, { status: 413 });
    let body; try { body = JSON.parse(text); } catch { return NextResponse.json({ error: "请求格式无效" }, { status: 400 }); }
    if (body.action === "logout" || body.action === "logout-all") {
      if (body.action === "logout-all") { if (!await getUser()) return NextResponse.json({ error: "请先登录" }, { status: 401 }); await bumpSessionVersion(); }
      const response = NextResponse.json({ ok: true });
      response.cookies.set(cookieName, "", { ...cookieOptions(), maxAge: 0 });
      return response;
    }
    // Per-address limit, plus a generous global ceiling against distributed guessing.
    const ip = clientIp(request);
    if (!await hit("login:ip:" + ip, 10, 900) || !await hit("login:all", 100, 3600)) return NextResponse.json({ error: "尝试次数过多，请在 15 分钟后重试" }, { status: 429, headers: { "Retry-After": "900" } });
    if (!await validPassword(body.password)) return NextResponse.json({ error: "密码不正确" }, { status: 401 });
    await reset("login:ip:" + ip);
    const response = NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
    response.cookies.set(cookieName, createSession(await sessionVersion(true)), { ...cookieOptions(), maxAge: sessionSeconds });
    return response;
  } catch (e) { console.error(e); return NextResponse.json({ error: "登录暂时不可用" }, { status: 503 }); }
}
