import { controlPool } from "@/lib/postgres";
import { access } from "node:fs/promises";
import { constants } from "node:fs";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    await controlPool.query("SELECT id FROM accounts LIMIT 0");
    await access(process.env.ATTACHMENTS_DIR || "data/attachments", constants.R_OK | constants.W_OK);
    return Response.json({status: "ok"}, {headers: {"Cache-Control": "no-store"}});
  } catch { return Response.json({status: "unavailable"}, {status: 503}); }
}
