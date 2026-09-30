import {authenticateIntegration} from "@/lib/integrations";
import {integrationJson,integrationFailure} from "@/lib/integration-http";
import {IntegrationError} from "@/lib/integration-contract";
import {listEntries} from "@/lib/entries";
export const dynamic="force-dynamic";
export async function GET(request:Request){try{
 await authenticateIntegration(request);const params=new URL(request.url).searchParams;
 const limit=Number(params.get("limit")||50),offset=Number(params.get("offset")||0);
 if(!Number.isInteger(limit)||limit<1||limit>100||!Number.isInteger(offset)||offset<0)throw new IntegrationError(400,"invalid_pagination","limit 为 1–100，offset 为非负整数");
 const query=(params.get("q")||"").toLowerCase(),id=params.get("id"),company=params.get("company")?.toLowerCase();
 const entries=(await listEntries()).filter(entry=>entry.kind==="job"&&(!id||entry.id===id)&&(!company||entry.organization.toLowerCase()===company)&&(!query||[entry.organization,entry.title,entry.url,entry.applicationUrl].join(" ").toLowerCase().includes(query))).sort((a,b)=>a.id.localeCompare(b.id));
 return integrationJson({entries:entries.slice(offset,offset+limit),total:entries.length,nextOffset:offset+limit<entries.length?offset+limit:null});
 }catch(error){return integrationFailure(error)}}
