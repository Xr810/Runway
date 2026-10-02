import { z } from "zod";
import { getUser } from "@/lib/auth";
import { validOrigin } from "@/lib/session";
import { getAiConfig, publicAiConfig, resolveConfig, saveAiConfig } from "@/lib/ai-config";
import { aiFetch, apiError, checkEndpoint } from "@/lib/ai-http";
import { hit } from "@/lib/rate-limit";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const json = (data: unknown, status=200) => Response.json(data, {status,headers:{"Cache-Control":"no-store"}});
const schema = z.object({ action:z.enum(["models","test","save"]), base:z.string().min(1).max(2000), apiKey:z.string().max(8000).regex(/^[^\r\n]*$/).optional(), tavilyApiKey:z.string().max(8000).regex(/^[^\r\n]*$/).optional(), model:z.string().trim().max(250).default(""), revision:z.number().int().min(0) }).strict();
export async function GET() {
  if (!await getUser()) return json({error:"请先登录"},401);
  try { return json(publicAiConfig(await getAiConfig())); } catch { return json({error:"读取 AI 设置失败，请稍后重试。"},503); }
}
export async function POST(request:Request) {
  if (!await getUser()) return json({error:"请先登录"},401);
  if (!validOrigin(request)) return json({error:"请求来源无效"},403);
  const policy=await getAiConfig().catch(()=>null);
  if(!policy)return json({error:"读取 AI 策略失败，请稍后重试。"},503);
  if(!policy.enabled)return json({error:"此账户未启用 AI。"},403);
  if(policy.mode!=="personal")return json({error:"托管 AI 配置由部署管理员维护。"},403);
  let input;
  try { const reader=request.body?.getReader(); if(!reader)throw Error(); const chunks:Uint8Array[]=[];let bytes=0;
    while(true){const {value,done}=await reader.read();if(done)break;bytes+=value.length;if(bytes>16000){await reader.cancel();return json({error:"请求过大"},413)}chunks.push(value)}
    input=schema.parse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
  } catch {return json({error:"设置格式无效，请检查输入。"},400)}
  try {
    const current=policy;
    if(input.revision!==current.revision)return json({error:"设置已在其他窗口更新，请重新加载。"},409);
    const config=resolveConfig(input,current);
    if(input.action!=="models"&&!config.model)return json({error:"请选择模型或填写模型 ID。"},400);
    if(input.action==="save"){
      if(!config.model)return json({error:"请选择模型或填写模型 ID。"},400);
      await checkEndpoint(config.base);
      return json(publicAiConfig(await saveAiConfig(config,input.revision)));
    }
    const allowed=await hit("ai-settings",60,3600);
    if(!allowed)return json({error:"读取/测试次数过多，请稍后再试。"},429);
    const response=await aiFetch(config.base,config.key,input.action==="models"?"/models":"/chat/completions",{signal:request.signal,timeout:input.action==="models"?15000:45000,
      ...(input.action==="test"?{body:JSON.stringify({model:config.model,messages:[{role:"user",content:'Reply with this JSON only: {"ok":true}'}],max_tokens:128,response_format:{type:"json_object"}})}:{})});
    if(!response.ok)return json({error:apiError(response.status)},502);
    let data;try{data=await response.json()}catch{return json({error:"接口未返回 JSON，请确认填写的是 API 地址而非网页地址。"},502)}
    if(input.action==="models"){
      if(!Array.isArray(data.data))return json({error:"该接口不支持标准 /models 列表，可手动填写模型 ID。"},422);
      const models=[...new Set<string>(data.data.filter((m:unknown)=>!!m&&typeof m==="object"&&"id" in m&&typeof m.id==="string"&&m.id.length<=250).map((m:{id:string})=>m.id))].sort();
      return json({models:models.slice(0,5000)});
    }
    const content=data.choices?.[0]?.message?.content;
    try {if(typeof content!=="string"||JSON.parse(content.replace(/^```(?:json)?\s*/,"").replace(/\s*```$/,""))?.ok!==true)throw Error();}catch{return json({error:"模型已响应，但结构化输出测试未通过，暂不适合当前助手。"},422)}
    return json({ok:true,message:"连接与结构化输出测试通过。图片识别能力取决于所选模型。"});
  }catch(error){const message=error instanceof Error?error.message:"";
    return json({error:/^(API |更换|设置已|自定义|该 API|无法解析|模型)/.test(message)?message:"AI 设置操作失败，请稍后重试。"},/设置已/.test(message)?409:400);
  }
}
