import { randomUUID } from "node:crypto";
import { pool, tx, locks } from "./postgres";
import { localFiles } from "./files";
import { profileSchema } from "./enrichment-contract";
import { syncEnrichment } from "./enrichment";

export const cvTypes: Record<string, string> = { pdf: "application/pdf", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", md: "text/markdown", txt: "text/plain" };
export const maxCvBytes = 5 * 1024 * 1024;
export class CvError extends Error {}

/** Plain text from a CV file. Scanned PDFs without a text layer yield nothing and are rejected. */
export async function extractCvText(bytes: Uint8Array, extension: string) {
  let text = "";
  if (extension === "md" || extension === "txt") text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  else if (extension === "docx") { const mammoth = await import("mammoth"); text = (await mammoth.extractRawText({ buffer: Buffer.from(bytes) })).value; }
  else if (extension === "pdf") { const { extractText, getDocumentProxy } = await import("unpdf"); text = (await extractText(await getDocumentProxy(new Uint8Array(bytes)), { mergePages: true })).text as string; }
  else throw new CvError("支持 PDF、Word（.docx）、Markdown 和纯文本文件");
  text = text.replace(/\r\n?/g, "\n").replace(/[ \t ]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  if (text.length < 40) throw new CvError(extension === "pdf" ? "没有从 PDF 里读到文字，可能是扫描件。请上传含文字层的 PDF 或 Word 文件。" : "文件里几乎没有文字");
  return text.slice(0, 60000);
}

const profileKey = "evaluation-profile-v1";
export async function saveCv(name: string, extension: string, bytes: Uint8Array) {
  const text = await extractCvText(bytes, extension), id = "cv_" + randomUUID();
  await localFiles.put(id, new Blob([bytes as BlobPart]).stream(), maxCvBytes);
  const cv = { id, name: name.slice(0, 300), mime: cvTypes[extension], size: bytes.length, chars: text.length, uploadedAt: new Date().toISOString() };
  const old = await tx(async client => {
    await client.query("INSERT INTO documents(id,kind,name,mime,size,text) VALUES($1,'cv',$2,$3,$4,$5)", [id, cv.name, cv.mime, cv.size, text]);
    const row = (await client.query("SELECT value FROM meta WHERE key=$1 FOR UPDATE", [profileKey])).rows[0];
    const profile = profileSchema.parse(row ? JSON.parse(row.value) : {});
    await client.query("INSERT INTO meta(key,value) VALUES($1,$2) ON CONFLICT(user_id,key) DO UPDATE SET value=EXCLUDED.value", [profileKey, JSON.stringify({ ...profile, cv, cvText: text, revision: profile.revision + 1 })]);
    if (profile.cv) await client.query("DELETE FROM documents WHERE id=$1", [profile.cv.id]);
    return profile.cv;
  }, { lock: locks.enrichment });
  if (old) await localFiles.delete(old.id);
  await syncEnrichment();
  return { cv, preview: text.slice(0, 600) };
}
export async function removeCv() {
  const old = await tx(async client => {
    const row = (await client.query("SELECT value FROM meta WHERE key=$1 FOR UPDATE", [profileKey])).rows[0];
    const profile = profileSchema.parse(row ? JSON.parse(row.value) : {});
    if (!profile.cv) return null;
    await client.query("UPDATE meta SET value=$2 WHERE key=$1", [profileKey, JSON.stringify({ ...profile, cv: null, cvText: "", revision: profile.revision + 1 })]);
    await client.query("DELETE FROM documents WHERE id=$1", [profile.cv.id]);
    return profile.cv;
  }, { lock: locks.enrichment });
  if (old) await localFiles.delete(old.id);
  await syncEnrichment();
}
export async function cvDocument(id: string) { return (await pool.query<{ name: string; mime: string }>("SELECT name, mime FROM documents WHERE id=$1 AND kind='cv'", [id])).rows[0] ?? null; }
