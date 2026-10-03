import {createHash,randomBytes,randomUUID} from "node:crypto";
import {pool,locks} from "./postgres";
import {notify} from "./notifications";
import {syncEnrichment} from "./enrichment";
import {blankEntry,defaultNextAction,entrySchema,type Entry} from "./model";
import {normalizeStageStates} from "./appointments";
import {type IntegrationEvent,IntegrationError,canonicalUrl,changedFields,guardStatus,validateJob} from "./integration-contract";
const hash=(value:string)=>createHash("sha256").update(value).digest("hex");
export type IntegrationClient={id:string;name:string};
export async function authenticateIntegration(request:Request):Promise<IntegrationClient>{
 const authorization=request.headers.get("authorization")||"";
 if(!/^Bearer od_[A-Za-z0-9_-]{43}$/.test(authorization))throw new IntegrationError(401,"invalid_token","需要有效的集成 Bearer API Key");
 const result=await pool.query("UPDATE integration_clients SET last_used_at=now() WHERE token_hash=$1 AND revoked_at IS NULL RETURNING id,name",[hash(authorization.slice(7))]);
 if(!result.rowCount)throw new IntegrationError(401,"invalid_token","API Key 无效或已撤销");
 return result.rows[0];
}
export async function createIntegration(name:string){
 const id=randomUUID(),token="od_"+randomBytes(32).toString("base64url");
 await pool.query("INSERT INTO integration_clients(id,name,token_hash,token_hint) VALUES($1,$2,$3,$4)",[id,name,hash(token),token.slice(-6)]);
 return {id,name,token};
}
export async function applyIntegrationEvent(actor:IntegrationClient,event:IntegrationEvent){
 const client=await pool.connect(),fingerprint=hash(JSON.stringify(event));
 try{
  await client.query("BEGIN");
  // Serializing a client's requests also makes retries race-safe. Revocation uses the same row lock.
  const credential=await client.query("SELECT id FROM integration_clients WHERE id=$1 AND revoked_at IS NULL FOR UPDATE",[actor.id]);
  if(!credential.rowCount)throw new IntegrationError(401,"invalid_token","API Key 已撤销");
  const prior=await client.query("SELECT request_hash,result FROM integration_events WHERE client_id=$1 AND request_id=$2",[actor.id,event.requestId]);
  if(prior.rowCount){if(prior.rows[0].request_hash!==fingerprint)throw new IntegrationError(409,"idempotency_conflict","相同 requestId 已用于不同内容");await client.query("COMMIT");return {...prior.rows[0].result,replayed:true};}
  let before:Entry|null=null,entry:Entry|null=null;
  const now=new Date().toISOString();
  if(event.action==="create_job"){
   if(!event.job.url)throw new IntegrationError(400,"job_url_required","新增岗位需提供具体岗位链接");
   // Shared lock avoids duplicate creations from two different integrations.
   await client.query("SELECT pg_advisory_xact_lock($1)",[locks.integrationCreate]);
   const ref=await client.query("SELECT entry_id FROM integration_job_refs WHERE client_id=$1 AND external_id=$2",[actor.id,event.externalId]);
   if(ref.rowCount)throw new IntegrationError(409,"job_exists","该外部岗位已导入，请先读取现有记录",{entryId:ref.rows[0].entry_id});
   const rows=await client.query("SELECT data,revision FROM entries WHERE deleted_at IS NULL AND kind='job'");
   const duplicates=rows.rows.map(row=>entrySchema.parse({...row.data,revision:row.revision})).filter(old=>old.kind==="job"&&(canonicalUrl(old.url)===canonicalUrl(event.job.url)||old.organization.trim().toLowerCase()===event.job.organization.trim().toLowerCase()&&old.title.trim().toLowerCase()===event.job.title.trim().toLowerCase()&&old.location.trim().toLowerCase()===(event.job.location||"").trim().toLowerCase()));
   if(duplicates.length)throw new IntegrationError(409,"possible_duplicate","发现已有岗位，请核对后更新该记录",{candidates:duplicates.map(({id,title,organization,revision})=>({id,title,organization,revision}))});
   entry=validateJob({...blankEntry("job"),...event.job,revision:1,jdStatus:event.job.jd||event.job.summary?"partial":"missing",jdSavedAt:event.job.jd?now:""});
   await client.query("INSERT INTO entries(id,data,revision,updated) VALUES($1,$2,1,$3)",[entry.id,JSON.stringify(entry),now]);
   await client.query("INSERT INTO integration_job_refs(client_id,external_id,entry_id) VALUES($1,$2,$3)",[actor.id,event.externalId,entry.id]);
  }else if(event.entryId){
   const rows=await client.query("SELECT data,revision FROM entries WHERE id=$1 AND deleted_at IS NULL FOR UPDATE",[event.entryId]);
   if(!rows.rowCount)throw new IntegrationError(404,"entry_not_found","未找到指定岗位");
   before=entrySchema.parse({...rows.rows[0].data,revision:rows.rows[0].revision});
   if(before.kind!=="job")throw new IntegrationError(400,"job_required","当前接口只操作求职岗位");
   entry=before;
   if(event.action==="update_job"){
    if(before.revision!==event.expectedRevision)throw new IntegrationError(409,"revision_conflict","记录已改变，请重新读取后核对",{revision:before.revision,entryId:before.id});
    const newer=await client.query("SELECT 1 FROM integration_events WHERE entry_id=$1 AND action='update_job' AND source_kind=$2 AND occurred_at>$3::timestamptz LIMIT 1",[before.id,event.source.kind,event.source.occurredAt]);
    if(newer.rowCount)throw new IntegrationError(409,"older_source","该岗位已有更新的同类来源消息，请用 notify 留待核对");
    guardStatus(before,event.patch.status);
    // Only status given: follow the editor's linkage so closed stages drop the stale action (#23).
    const patch=event.patch.status!==undefined&&event.patch.nextAction===undefined?{...event.patch,nextAction:defaultNextAction(event.patch.status)}:event.patch;
    const appointments=normalizeStageStates(event.appointment?[...before.appointments.filter(item=>item.id!==event.appointment!.id),event.appointment]:before.appointments);
    const notes=event.note?`${before.notes}${before.notes?"\n\n":""}[${actor.name} · ${event.source.occurredAt}] ${event.note}`:before.notes;
    entry=validateJob({...before,...patch,appointments,notes,revision:before.revision+1,...(event.patch.jd!==undefined&&event.patch.jd!==before.jd?{jdStatus:event.patch.jd||event.patch.summary||before.summary?"partial":"missing"}:{})});
    if(event.patch.jd!==undefined&&event.patch.jd!==before.jd){entry.jdStatus=entry.jd?"partial":entry.summary?"partial":"missing";entry.jdSavedAt=entry.jd?now:"";await client.query("INSERT INTO versions(id,entry_id,data,created) VALUES($1,$2,$3,$4)",[randomUUID(),entry.id,JSON.stringify({jd:before.jd,jdStatus:before.jdStatus,jdSavedAt:before.jdSavedAt,summary:before.summary,url:before.url}),now]);}
    if(!changedFields(before,entry).length)throw new IntegrationError(400,"no_changes","未产生变更，可使用 notify 记录消息");
    await client.query("UPDATE entries SET data=$1,revision=$2,updated=$3 WHERE id=$4",[JSON.stringify(entry),entry.revision,now,entry.id]);
   }
  }
  const changes=entry&&event.action!=="notify"?changedFields(before,entry):[];
  const notificationId=await notify({actor:actor.name,action:event.action,summary:event.summary,source:event.source,entryId:entry?.id??null,title:entry?.title??"待核对更新",organization:entry?.organization??"",changes},client);
  const result={ok:true,notificationId,entryId:entry?.id??null,revision:entry?.revision??null,replayed:false};
  await client.query("INSERT INTO integration_events(id,client_id,request_id,request_hash,result,entry_id,action,source_kind,occurred_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",[randomUUID(),actor.id,event.requestId,fingerprint,JSON.stringify(result),entry?.id??null,event.action,event.source.kind,event.source.occurredAt]);
  await client.query("COMMIT");
  if(entry)await syncEnrichment();
  return result;
 }catch(error){await client.query("ROLLBACK");throw error;}finally{client.release()}
}
