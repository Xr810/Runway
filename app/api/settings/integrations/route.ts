import {z} from "zod";
import {getUser} from "@/lib/auth";
import {validOrigin} from "@/lib/session";
import {pool} from "@/lib/postgres";
import {createIntegration} from "@/lib/integrations";
import {boundedJson,integrationJson as json,integrationFailure} from "@/lib/integration-http";
export const dynamic="force-dynamic";
export async function GET(){try{if(!await getUser())return json({error:"请先登录"},401);const result=await pool.query("SELECT id,name,token_hint,created,revoked_at,last_used_at FROM integration_clients WHERE token_hint <> 'internal' ORDER BY created DESC");return json({clients:result.rows});}catch(error){return integrationFailure(error)}}
export async function POST(request:Request){try{
 if(!await getUser())return json({error:"请先登录"},401);if(!validOrigin(request))return json({error:"请求来源无效"},403);
 const parsed=z.discriminatedUnion("action",[z.object({action:z.literal("create"),name:z.string().trim().min(1).max(80)}).strict(),z.object({action:z.literal("revoke"),id:z.string().uuid()}).strict()]).safeParse(await boundedJson(request,4096));
 if(!parsed.success)return json({error:"请求格式无效"},400);
 if(parsed.data.action==="create")return json(await createIntegration(parsed.data.name));
 await pool.query("UPDATE integration_clients SET revoked_at=now() WHERE id=$1 AND revoked_at IS NULL",[parsed.data.id]);return json({ok:true});
 }catch(error){return integrationFailure(error)}}
