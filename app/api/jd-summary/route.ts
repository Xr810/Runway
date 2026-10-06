import { z } from "zod";
import { getUser } from "@/lib/auth";
import { validOrigin } from "@/lib/session";
import { boundedJson, integrationJson as json } from "@/lib/integration-http";
import { generateJdSummary, readJdSummary } from "@/lib/jd-summary-service";
import { hit } from "@/lib/rate-limit";

const id = z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/);
export async function GET(request: Request) {
  if (!(await getUser())) return json({ error: "请先登录" }, 401);
  const parsed = id.safeParse(new URL(request.url).searchParams.get("id"));
  if (!parsed.success) return json({ error: "记录 ID 无效" }, 400);
  try {
    return json(await readJdSummary(parsed.data));
  } catch {
    return json({ error: "读取摘要失败，请重试。" }, 503);
  }
}
export async function POST(request: Request) {
  if (!(await getUser())) return json({ error: "请先登录" }, 401);
  if (!validOrigin(request)) return json({ error: "请求来源无效" }, 403);
  try {
    const parsed = z
      .object({ entryId: id })
      .strict()
      .safeParse(await boundedJson(request, 1024));
    if (!parsed.success) return json({ error: "记录 ID 无效" }, 400);
    if (!(await hit("jd-summary", 30, 3600)))
      return json({ error: "摘要请求过于频繁，请稍后重试。" }, 429);
    return json(await generateJdSummary(parsed.data.entryId));
  } catch {
    return json({ error: "无法整理摘要，请核对 AI 设置、权限及 JD 原文后重试。" }, 409);
  }
}
