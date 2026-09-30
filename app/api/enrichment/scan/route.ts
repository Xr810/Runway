import {z} from "zod";
import {getUser} from "@/lib/auth";
import {validOrigin} from "@/lib/session";
import {localActor,claimEnrichment,completeEnrichment,failEnrichment} from "@/lib/enrichment";
import {scanOfficialLogo} from "@/lib/brand-scan";
import {boundedJson,integrationJson as json,integrationFailure} from "@/lib/integration-http";
export const dynamic="force-dynamic";
export async function POST(request:Request){try{
 if(!await getUser())return json({error:"请先登录"},401);if(!validOrigin(request))return json({error:"请求来源无效"},403);
 const parsed=z.object({taskId:z.string().uuid()}).strict().safeParse(await boundedJson(request,2048));if(!parsed.success)return json({error:"任务 ID 无效"},400);
 const {tasks}=await claimEnrichment(localActor,["company","channel"],1,parsed.data.taskId);if(!tasks.length)return json({error:"任务已被领取、锁定或完成"},409);
 const task=tasks[0];try{if(!task.payload.website)throw Error("请先填写官网，或让内置助手补全公司资料。");const result=await scanOfficialLogo(task.payload.website);return json(await completeEnrichment(localActor,task.id,task.leaseToken,result));}catch(e){const message=(e as Error).message;await failEnrichment(localActor,task.id,task.leaseToken,message);return json({error:message},422)}
 }catch(e){return integrationFailure(e)}}
