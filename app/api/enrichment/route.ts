import { startBuiltinEnrichment } from "@/lib/builtin-enrichment";
import {z} from "zod";
import {getUser} from "@/lib/auth";
import {validOrigin} from "@/lib/session";
import {enrichmentFeed,saveEvaluationProfile,queueEnrichment,lockEnrichment} from "@/lib/enrichment";
import {profileSchema,targetSchema} from "@/lib/enrichment-contract";
import {boundedJson,integrationJson as json,integrationFailure} from "@/lib/integration-http";
export const dynamic="force-dynamic";
const schema=z.discriminatedUnion("action",[
 z.object({action:z.literal("run"),scope:z.enum(["job","brand","all"]),target:targetSchema.optional(),force:z.boolean().default(false)}).strict(),
 z.object({action:z.literal("profile"),profile:profileSchema}).strict(),
 z.object({action:z.literal("queue"),scope:z.enum(["job","brand","all"]),target:targetSchema.optional(),force:z.boolean().default(false)}).strict(),
 z.object({action:z.literal("lock"),target:targetSchema,locked:z.boolean()}).strict(),
]);
export async function GET(request:Request){try{if(!await getUser())return json({error:"请先登录"},401);const params=new URL(request.url).searchParams;const target=params.has("kind")?targetSchema.safeParse({kind:params.get("kind"),id:params.get("id")}):null;const offset=Number(params.get("offset")||0);if(target&&!target.success||!Number.isInteger(offset)||offset<0||offset>100000)return json({error:"查询参数无效"},400);return json(await enrichmentFeed(target?.data,offset))}catch(e){if(e instanceof Error && /^(内置评估|AI 尚未)/.test(e.message))return json({error:e.message},409);return integrationFailure(e)}}
export async function POST(request:Request){try{if(!await getUser())return json({error:"请先登录"},401);if(!validOrigin(request))return json({error:"请求来源无效"},403);const parsed=schema.safeParse(await boundedJson(request,512*1024));if(!parsed.success)return json({error:parsed.error.issues[0].message},400);const p=parsed.data;return json(p.action==="profile"?await saveEvaluationProfile(p.profile):p.action==="lock"?await lockEnrichment(p.target,p.locked):p.action==="run"?await startBuiltinEnrichment(p.scope,p.target,p.force):await queueEnrichment(p.scope,p.target,p.force))}catch(e){if(e instanceof Error && /^(内置评估|AI 尚未)/.test(e.message))return json({error:e.message},409);return integrationFailure(e)}}
