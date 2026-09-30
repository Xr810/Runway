import {z} from "zod";
import {getUser} from "@/lib/auth";
import {validOrigin} from "@/lib/session";
import {listNotifications,markNotifications} from "@/lib/notifications";
import {boundedJson,integrationJson as json,integrationFailure} from "@/lib/integration-http";
export const dynamic="force-dynamic";
export async function GET(request:Request){try{
 if(!await getUser())return json({error:"请先登录"},401);
 const params=new URL(request.url).searchParams,before=params.get("before");
 if(before&&!/^\d{1,18}$/.test(before))return json({error:"分页标记无效"},400);
 return json(await listNotifications(params.get("history")==="true",before));
 }catch(error){return integrationFailure(error)}}
export async function POST(request:Request){try{
 if(!await getUser())return json({error:"请先登录"},401);if(!validOrigin(request))return json({error:"请求来源无效"},403);
 const parsed=z.object({action:z.enum(["read","dismiss"]),ids:z.array(z.string().uuid()).min(1).max(100)}).strict().safeParse(await boundedJson(request,16384));
 if(!parsed.success)return json({error:"请求格式无效"},400);
 await markNotifications(parsed.data.action,parsed.data.ids);return json({ok:true});
 }catch(error){return integrationFailure(error)}}
