import { z } from "zod";
import { getUser } from "@/lib/auth";
import { validOrigin } from "@/lib/session";
import { boundedJson, integrationJson as json } from "@/lib/integration-http";
import { getAssessmentAccess, saveAssessmentAccess } from "@/lib/assessment-access";
import { EntryError } from "@/lib/entries";
import { IntegrationError } from "@/lib/integration-contract";

const query = z.object({
  entryId: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/),
  appointmentId: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/),
});
function failure(error: unknown) {
  // Never log credential payloads or decryption exceptions.
  const known = error instanceof EntryError || error instanceof IntegrationError;
  return json(
    { error: known ? error.message : "访问资料操作失败，请重试。" },
    known ? error.status : 503,
  );
}
export async function GET(request: Request) {
  if (!(await getUser())) return json({ error: "请先登录" }, 401);
  const input = query.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!input.success) return json({ error: "测评 ID 无效" }, 400);
  try {
    return json(await getAssessmentAccess(input.data.entryId, input.data.appointmentId));
  } catch (error) {
    return failure(error);
  }
}
export async function POST(request: Request) {
  if (!(await getUser())) return json({ error: "请先登录" }, 401);
  if (!validOrigin(request)) return json({ error: "请求来源无效" }, 403);
  try {
    return json(await saveAssessmentAccess(await boundedJson(request, 16000)));
  } catch (error) {
    return failure(error);
  }
}
