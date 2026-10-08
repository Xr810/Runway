import { z } from "zod";
import { runAsUser } from "@/lib/postgres";
import { chatGptPairingOwner, processChatGptPairing } from "@/lib/chatgpt";
import { ChatGptError } from "@/lib/chatgpt-oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const json = (data: unknown, status = 200) =>
  Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
const schema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("start"),
      host: z.string().regex(/^urn:uuid:[a-f0-9-]{36}$/),
      port: z.number().int().min(1024).max(65535),
    })
    .strict(),
  z.object({ action: z.literal("finish"), callback: z.string().url().max(12000) }).strict(),
]);

// No cookies or caller-supplied owner. Only an authenticated, unexpired pairing ticket
// can establish a user context; it cannot authorize any other Runway operation.
export async function POST(request: Request) {
  const authorization = request.headers.get("authorization") ?? "";
  if (!authorization.startsWith("Bearer ") || authorization.length > 2048)
    return json({ error: "请使用设置页生成的配对码。" }, 401);
  const ticket = authorization.slice(7);
  let owner: string;
  try {
    owner = chatGptPairingOwner(ticket);
  } catch {
    return json({ error: "配对码无效或已过期，请重新生成。" }, 401);
  }
  let input: z.infer<typeof schema>;
  try {
    if (!request.headers.get("content-type")?.startsWith("application/json"))
      return json({ error: "请使用 JSON" }, 415);
    const reader = request.body?.getReader();
    if (!reader) throw Error();
    let size = 0;
    const chunks: Uint8Array[] = [];
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 16384) {
        await reader.cancel();
        return json({ error: "请求过大" }, 413);
      }
      chunks.push(value);
    }
    input = schema.parse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
  } catch {
    return json({ error: "配对请求格式无效。" }, 400);
  }
  try {
    return json(await runAsUser(owner, () => processChatGptPairing(ticket, input)));
  } catch (error) {
    return json(
      { error: error instanceof ChatGptError ? error.message : "配对失败，请重新生成配对码。" },
      400,
    );
  }
}
