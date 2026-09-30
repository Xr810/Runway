import { getUser } from "@/lib/auth";
import { validOrigin } from "@/lib/session";
import { allWatches, saveWatch, WatchError } from "@/lib/watch-storage";
import { watchSchema } from "@/lib/watches";
import { syncEnrichment } from "@/lib/enrichment";
export const dynamic="force-dynamic";
const json=(data:unknown,status=200)=>Response.json(data,{status,headers:{"Cache-Control":"no-store"}});
export async function GET(){if(!await getUser())return json({error:"请先登录"},401);try{return json({watches:await allWatches()})}catch(e){console.error(e);return json({error:"关注名单读取失败，请稍后重试"},503)}}
export async function POST(request:Request){
 if(!await getUser())return json({error:"请先登录"},401);
 if(!validOrigin(request))return json({error:"请求来源无效"},403);
 const text=await request.text();if(text.length>50000)return json({error:"内容过长"},413);
 let body;try{body=JSON.parse(text)}catch{return json({error:"无效请求"},400)}
 if(!body||!["save","restore","delete"].includes(body.action))return json({error:"未知操作"},400);
 const parsed=watchSchema.safeParse(body.watch);if(!parsed.success)return json({error:parsed.error.issues[0].message},400);
 try{const result=await saveWatch(parsed.data,body.action);await syncEnrichment();return json(result)}
 catch(e){if(e instanceof WatchError)return json({error:e.message},e.status);console.error(e);return json({error:"保存失败，请稍后重试"},503)}
}
