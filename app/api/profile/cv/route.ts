import { getUser } from "@/lib/auth";
import { validOrigin } from "@/lib/session";
import { localFiles } from "@/lib/files";
import { evaluationProfile } from "@/lib/enrichment";
import { CvError, cvDocument, cvTypes, maxCvBytes, removeCv, saveCv } from "@/lib/cv";
import { extractCvProfile } from "@/lib/cv-profile";
export const dynamic = "force-dynamic";
const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { "Cache-Control": "no-store" } });

/** Downloads the current CV file. */
export async function GET() {
  if (!await getUser()) return json({ error: "请先登录" }, 401);
  const cv = (await evaluationProfile()).cv; if (!cv) return json({ error: "还没有上传简历" }, 404);
  const [doc, file] = await Promise.all([cvDocument(cv.id), localFiles.get(cv.id)]); if (!doc || !file) return json({ error: "简历文件缺失" }, 404);
  return new Response(file.body, { headers: { "Content-Type": "application/octet-stream", "Content-Disposition": "attachment; filename*=UTF-8''" + encodeURIComponent(doc.name), "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
}
export async function POST(request: Request) {
  if (!await getUser()) return json({ error: "请先登录" }, 401);
  if (!validOrigin(request)) return json({ error: "请求来源无效" }, 403);
  if (!request.headers.get("content-type")?.includes("multipart/form-data")) {
    try {
      const body = await request.json();
      if (body?.action === "remove") { await removeCv(); return json({ ok: true }); }
      if (body?.action === "extract") return json({ profile: await extractCvProfile() });
      return json({ error: "未知操作" }, 400);
    }
    catch (e) { return json({ error: e instanceof Error ? e.message : "简历处理失败" }, 503); }
  }
  const length = Number(request.headers.get("content-length") || 0);
  if (!length || length > maxCvBytes + 64 * 1024) return json({ error: "简历文件需小于 5 MB" }, 413);
  try {
    const file = (await request.formData()).get("file");
    if (!(file instanceof File) || !file.size || file.size > maxCvBytes) return json({ error: "简历文件需小于 5 MB" }, 400);
    const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
    if (!cvTypes[extension]) return json({ error: "支持 PDF、Word（.docx）、Markdown 和纯文本文件" }, 400);
    return json(await saveCv(file.name, extension, new Uint8Array(await file.arrayBuffer())));
  } catch (e) {
    if (e instanceof CvError) return json({ error: e.message }, 422);
    console.error(e); return json({ error: "简历解析失败，请换一个文件格式再试" }, 422);
  }
}
