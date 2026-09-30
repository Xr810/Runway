import {getUser} from "@/lib/auth";
import {validOrigin} from "@/lib/session";
import {directorySchema,identity} from "@/lib/journey";
import {getDirectory,saveDirectory} from "@/lib/directory-storage";
import {syncEnrichment} from "@/lib/enrichment";
export const dynamic="force-dynamic";
const json=(data:unknown,status=200)=>Response.json(data,{status,headers:{"Cache-Control":"no-store"}});
export async function GET(){if(!await getUser())return json({error:"请先登录"},401);try{return json(await getDirectory())}catch{return json({error:"目录读取失败"},503)}}
export async function POST(request:Request){
 if(!await getUser())return json({error:"请先登录"},401);if(!validOrigin(request))return json({error:"请求来源无效"},403);
 try{const reader=request.body?.getReader();if(!reader)return json({error:"空请求"},400);let bytes=0;const chunks:Uint8Array[]=[];
  while(true){const{done,value}=await reader.read();if(done)break;bytes+=value.length;if(bytes>512000){await reader.cancel();return json({error:"目录过大"},413)}chunks.push(value)}
  let body;try{body=JSON.parse(Buffer.concat(chunks).toString());}catch{return json({error:"格式无效"},400)}
  if(!["save","restore"].includes(body.action))return json({error:"未知操作"},400);
  const parsed=directorySchema.safeParse(body.directory);if(!parsed.success)return json({error:parsed.error.issues[0].message},400);
  let value=parsed.data;
  if(body.action==="restore"){const current=await getDirectory();value={revision:current.revision,channels:[...current.channels,...value.channels.filter(c=>!current.channels.some(old=>identity(old.name)===identity(c.name)))],companies:[...current.companies,...value.companies.filter(c=>!current.companies.some(old=>identity(old.name)===identity(c.name)))]};value=directorySchema.parse(value)}
  const saved=await saveDirectory(value);await syncEnrichment();return json(saved);
 }catch(error){const message=error instanceof Error?error.message:"";return json({error:/^(目录已|名称重复)/.test(message)?message:"目录保存失败，请刷新后重试"},message.startsWith("目录已")?409:400)}
}
