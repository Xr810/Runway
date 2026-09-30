import {IntegrationError} from "./integration-contract";
export function integrationJson(data:unknown,status=200){return Response.json(data,{status,headers:{"Cache-Control":"no-store","X-Content-Type-Options":"nosniff"}})}
export async function boundedJson(request:Request,max=512*1024){
 if(!request.headers.get("content-type")?.includes("application/json"))throw new IntegrationError(415,"json_required","请使用 application/json");
 const reader=request.body?.getReader();if(!reader)throw new IntegrationError(400,"empty_body","请求内容为空");
 const chunks:Uint8Array[]=[];let size=0;
 try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>max){await reader.cancel();throw new IntegrationError(413,"body_too_large","请求过大");}chunks.push(value);}}finally{reader.releaseLock()}
 try{return JSON.parse(Buffer.concat(chunks).toString("utf8"));}catch{throw new IntegrationError(400,"invalid_json","JSON 格式无效")}
}
export function integrationFailure(error:unknown){
 if(error instanceof IntegrationError)return integrationJson({error:error.message,code:error.code,...(error.details?{details:error.details}:{})},error.status);
 console.error("Integration request failed",(error as {code?:string}).code||"internal");return integrationJson({error:"服务暂时不可用，请用同一个 requestId 重试",code:"unavailable"},503);
}
