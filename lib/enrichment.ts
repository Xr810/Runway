import {createHash,randomUUID} from "node:crypto";
import type {PoolClient} from "pg";
import {pool,tx,locks,type Db} from "./postgres";
import {entrySchema,type Entry} from "./model";
import {directorySchema,identity,allChannels} from "./journey";
import {profileSchema,rubric,rubricFor,resultSchema,rasterImage,type EnrichmentTarget,type EvaluationProfile} from "./enrichment-contract";
import {IntegrationError} from "./integration-contract";
import {notify} from "./notifications";
import type {IntegrationClient} from "./integrations";

const profileKey="evaluation-profile-v1",directoryKey="company-channel-directory-v1";
export const localActor={id:"00000000-0000-4000-8000-000000000001",name:"Runway"};
const hash=(value:unknown)=>createHash("sha256").update(JSON.stringify(value)).digest("hex");
type JobInput=Pick<Entry,"title"|"organization"|"location"|"employmentType"|"workMode"|"schedule"|"url"|"jd"|"summary"|"salary">;
export type TaskInput={target:EnrichmentTarget;name:string;website?:string;manualLogo?:string;job?:JobInput;profile?:EvaluationProfile;rubric:typeof rubric};
type Task={id:string;kind:EnrichmentTarget["kind"];target_id:string;input_hash:string;payload:TaskInput;status:string;actor_id:string|null;lease_token:string|null;lease_until:string|null;attempts:number;result_hash:string|null};
const key=(kind:string,id:string)=>kind+":"+id;
function fail(status:number,code:string,message:string):never{throw new IntegrationError(status,code,message)}
const transaction=<T>(run:(client:PoolClient)=>Promise<T>)=>tx(run,{lock:locks.enrichment});

export async function evaluationProfile(db:Db=pool){const r=await db.query("SELECT value FROM meta WHERE key=$1",[profileKey]);return profileSchema.parse(r.rows[0]?JSON.parse(r.rows[0].value):{})}
export async function saveEvaluationProfile(value:unknown){
 const parsed=profileSchema.safeParse(value);if(!parsed.success)fail(400,"invalid_profile","个人背景格式无效："+parsed.error.issues[0].message);
 const saved=await transaction(async c=>{const r=await c.query("SELECT value FROM meta WHERE key=$1 FOR UPDATE",[profileKey]);const old=profileSchema.parse(r.rows[0]?JSON.parse(r.rows[0].value):{});if(old.revision!==parsed.data.revision)fail(409,"profile_conflict","背景已更新，请刷新后再保存");const next={...parsed.data,revision:old.revision+1};await c.query("INSERT INTO meta(key,value) VALUES($1,$2) ON CONFLICT(user_id,key) DO UPDATE SET value=EXCLUDED.value",[profileKey,JSON.stringify(next)]);return next});
 await syncEnrichment();return saved;
}

/** Everything an assessment or icon task depends on, computed from current data. Read-only. */
async function inputs(c:Db):Promise<TaskInput[]>{
 const [rows,meta,watches]=await Promise.all([c.query("SELECT data,revision FROM entries WHERE deleted_at IS NULL ORDER BY id"),c.query("SELECT key,value FROM meta WHERE key=ANY($1::text[])",[[profileKey,directoryKey]]),c.query("SELECT data FROM company_watches WHERE data->>'kind' IS DISTINCT FROM 'board' ORDER BY id")]);
 const entries:Entry[]=rows.rows.map(r=>entrySchema.parse({...r.data,revision:r.revision})),values=new Map(meta.rows.map(r=>[r.key,JSON.parse(r.value)]));
 const profile=profileSchema.parse(values.get(profileKey)||{}),directory=directorySchema.parse(values.get(directoryKey)||{});
 const jobs=entries.filter(e=>e.kind==="job"),companies=new Map<string,string>();
 for(const name of [...jobs.map(e=>e.organization),...directory.companies.map(c=>c.name),...watches.rows.map(r=>r.data.company as string)])if(name.trim())companies.set(identity(name),name);
 const activeRubric=rubricFor(profile.evaluationPreset,profile.evaluationWeights);
 const jobInputs:TaskInput[]=jobs.map(e=>{const {title,organization,location,employmentType,workMode,schedule,url,jd,summary,salary}=e;return{target:{kind:"job",id:e.id},name:organization+" · "+title,job:{title,organization,location,employmentType,workMode,schedule,url,jd,summary,salary},profile,rubric:activeRubric}});
 return [...jobInputs,...[...companies].map(([id,name]):TaskInput=>{const saved=directory.companies.find(p=>identity(p.name)===id);return{target:{kind:"company",id},name,website:saved?.website||"",manualLogo:saved?.logoUrl||"",rubric}}),...allChannels(jobs,directory).filter(p=>p.name!=="公司官网").map(p=>({target:{kind:"channel" as const,id:identity(p.name)},name:p.name,website:p.url,manualLogo:p.logoUrl||"",rubric}))];
}
async function latestTasks(c:Db){return new Map((await c.query<Task>("SELECT DISTINCT ON (kind,target_id) * FROM enrichment_tasks ORDER BY kind,target_id,created DESC,id DESC")).rows.map(t=>[key(t.kind,t.target_id),t]))}
async function lockedTargets(c:Db){return new Set((await c.query("SELECT kind,target_id FROM enrichment_state WHERE locked")).rows.map(s=>key(s.kind,s.target_id)))}

/** Brings the task queue in line with current data: new or changed inputs get a pending task. */
async function sync(c:PoolClient){
 const live=await inputs(c),keys=new Set(live.map(p=>key(p.target.kind,p.target.id)));
 const [latest,locked]=await Promise.all([latestTasks(c),lockedTargets(c)]);
 const supersede=(id:string)=>c.query("UPDATE enrichment_tasks SET status='superseded',lease_token=NULL,updated=now() WHERE id=$1",[id]);
 for(const task of latest.values())if(["pending","running"].includes(task.status)&&!keys.has(key(task.kind,task.target_id)))await supersede(task.id);
 for(const payload of live){
  const {kind,id}=payload.target,inputHash=hash(payload),old=latest.get(key(kind,id));
  if(locked.has(key(kind,id))||payload.manualLogo){if(old&&["pending","running"].includes(old.status))await supersede(old.id);continue}
  if(old?.input_hash===inputHash&&old.status!=="superseded"){if(old.status==="running"&&old.lease_until&&Date.parse(old.lease_until)<Date.now())await c.query("UPDATE enrichment_tasks SET status=$2,error=$3,lease_token=NULL,lease_until=NULL,updated=now() WHERE id=$1",[old.id,old.attempts>=3?"failed":"pending",old.attempts>=3?"连续三次领取超时，请手动重试":"上次领取超时，等待重新处理"]);continue}
  if(old&&["pending","running"].includes(old.status))await supersede(old.id);
  await c.query("INSERT INTO enrichment_tasks(id,kind,target_id,input_hash,payload) VALUES($1,$2,$3,$4,$5)",[randomUUID(),kind,id,inputHash,JSON.stringify(payload)]);
 }
 return live;
}
/** Call after writes that change task inputs (records, directory, profile, watches). Never throws. */
export async function syncEnrichment(){try{await transaction(sync)}catch(e){console.error("Enrichment sync failed",(e as Error).message)}}

/** Read-only view of tasks, current results and (for one target) its history. */
export async function enrichmentFeed(target?:EnrichmentTarget,offset=0){
 const [live,tasks,states,history,profile]=await Promise.all([
  inputs(pool),
  pool.query("SELECT id,kind,target_id,payload->>'name' AS name,status,attempts,error,created,updated,lease_until FROM enrichment_tasks WHERE ($1::text IS NULL OR kind=$1 AND target_id=$2) ORDER BY created DESC,id DESC LIMIT 500",[target?.kind||null,target?.id||null]),
  pool.query("SELECT s.*,r.result,r.input_hash,r.created,r.actor FROM enrichment_state s LEFT JOIN enrichment_results r ON s.result_id=r.id"),
  target?pool.query("SELECT id,kind,target_id,result,input,actor,created FROM enrichment_results WHERE kind=$1 AND target_id=$2 ORDER BY created DESC,id DESC LIMIT 21 OFFSET $3",[target.kind,target.id,offset]):Promise.resolve({rows:[]}),
  evaluationProfile(),
 ]);
 const liveHash=new Map(live.map(p=>[key(p.target.kind,p.target.id),hash(p)]));
 const stateMap=new Map(states.rows.map(s=>[key(s.kind,s.target_id),{...s,stale:!!s.result_id&&liveHash.get(key(s.kind,s.target_id))!==s.input_hash}]));
 return {tasks:tasks.rows,states:live.map(p=>({...stateMap.get(key(p.target.kind,p.target.id)),kind:p.target.kind,target_id:p.target.id,manualLogo:!!p.manualLogo})),history:history.rows.slice(0,20),nextOffset:history.rows.length>20?offset+20:null,profile,rubric:rubricFor(profile.evaluationPreset,profile.evaluationWeights)};
}
export async function queueEnrichment(scope:"job"|"brand"|"all",target?:EnrichmentTarget,force=false){return transaction(async c=>{
 const live=await sync(c);let queued=0,skipped=0;if(target&&!live.some(p=>p.target.kind===target.kind&&p.target.id===target.id))fail(404,"target_not_found","未找到指定公司、渠道或岗位");
 const [latest,locked]=await Promise.all([latestTasks(c),lockedTargets(c)]);
 for(const payload of live.filter(p=>target?p.target.kind===target.kind&&p.target.id===target.id:scope==="all"||scope==="job"&&p.target.kind==="job"||scope==="brand"&&p.target.kind!=="job")){
  const {kind,id}=payload.target;if(locked.has(key(kind,id))||payload.manualLogo){skipped++;continue}
  const current=latest.get(key(kind,id));
  if(current&&["pending","running"].includes(current.status)){queued++;continue}
  if(!force&&current?.status==="completed"){skipped++;continue}
  await c.query("INSERT INTO enrichment_tasks(id,kind,target_id,input_hash,payload) VALUES($1,$2,$3,$4,$5)",[randomUUID(),kind,id,hash(payload),JSON.stringify(payload)]);queued++;
 }
 return {ok:true,queued,skipped};
})}
export async function lockEnrichment(target:EnrichmentTarget,locked:boolean){return transaction(async c=>{
 await c.query("INSERT INTO enrichment_state(kind,target_id,locked) VALUES($1,$2,$3) ON CONFLICT(user_id,kind,target_id) DO UPDATE SET locked=EXCLUDED.locked",[target.kind,target.id,locked]);
 if(locked){await c.query("UPDATE enrichment_tasks SET status='superseded',lease_token=NULL,updated=now() WHERE kind=$1 AND target_id=$2 AND status IN ('pending','running')",[target.kind,target.id]);return{ok:true}}
 // Unlocking re-queues the target with its current inputs.
 const payload=(await inputs(c)).find(p=>p.target.kind===target.kind&&p.target.id===target.id);
 if(payload&&!payload.manualLogo)await c.query("INSERT INTO enrichment_tasks(id,kind,target_id,input_hash,payload) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING",[randomUUID(),target.kind,target.id,hash(payload),JSON.stringify(payload)]);
 return{ok:true};
})}
async function authorizeActor(c:PoolClient,actor:IntegrationClient){
 if(actor.id===localActor.id)return;
 const row=await c.query("SELECT id FROM integration_clients WHERE id=$1 AND revoked_at IS NULL FOR SHARE",[actor.id]);if(!row.rowCount)fail(401,"invalid_token","API Key 已撤销");
}
export async function claimEnrichment(actor:IntegrationClient,kinds:string[],limit:number,taskId?:string){return transaction(async c=>{
 await authorizeActor(c,actor);await sync(c);
 const tasks=(await c.query<Task>("SELECT * FROM enrichment_tasks WHERE status='pending' AND kind=ANY($1::text[]) AND ($2::text IS NULL OR id=$2) ORDER BY created,id LIMIT $3 FOR UPDATE",[kinds,taskId||null,limit])).rows;
 const result=[];for(const task of tasks){const leaseToken=randomUUID();await c.query("UPDATE enrichment_tasks SET status='running',actor_id=$2,lease_token=$3,lease_until=now()+interval '15 minutes',attempts=attempts+1,error='',updated=now() WHERE id=$1",[task.id,actor.id,leaseToken]);result.push({id:task.id,inputHash:task.input_hash,leaseToken,leaseSeconds:900,payload:task.payload})}return{tasks:result};
})}
export async function failEnrichment(actor:IntegrationClient,id:string,lease:string,error:string){return transaction(async c=>{await authorizeActor(c,actor);const r=await c.query("UPDATE enrichment_tasks SET status='failed',error=$4,lease_until=NULL,updated=now() WHERE id=$1 AND actor_id=$2 AND lease_token=$3 AND status='running' AND lease_until>now() RETURNING id",[id,actor.id,lease,error]);if(!r.rowCount)fail(409,"lease_conflict","任务已过期或不属于此客户端");return{ok:true}})}
export async function completeEnrichment(actor:IntegrationClient,id:string,lease:string,raw:unknown){
 const parsed=resultSchema.safeParse(raw);if(!parsed.success)fail(400,"invalid_result",parsed.error.issues[0].message);
 const result=parsed.data,resultHash=hash(result);
 return transaction(async c=>{
  await authorizeActor(c,actor);
  const task=(await c.query<Task>("SELECT * FROM enrichment_tasks WHERE id=$1 FOR UPDATE",[id])).rows[0];if(!task)fail(404,"task_not_found","任务不存在");
  if(task.actor_id!==actor.id||task.lease_token!==lease)fail(409,"lease_conflict","任务领取凭证不匹配");
  if(task.status==="completed"){if(task.result_hash!==resultHash)fail(409,"result_conflict","已完成任务不能更换结果");return{ok:true,replayed:true}}
  if(task.status!=="running"||!task.lease_until||Date.parse(task.lease_until)<Date.now())fail(409,"lease_conflict","任务已过期，请重新领取");
  // Lock edited rows before checking the snapshot, so unrelated changes are preserved.
  const entryRow=task.kind==="job"?(await c.query("SELECT data,revision FROM entries WHERE id=$1 AND deleted_at IS NULL FOR UPDATE",[task.target_id])).rows[0]:null;
  await c.query("SELECT key FROM meta WHERE key=ANY($1::text[]) ORDER BY key FOR SHARE",[[profileKey,directoryKey]]);
  const payload=(await inputs(c)).find(p=>p.target.kind===task.kind&&p.target.id===task.target_id);
  if(!payload||hash(payload)!==task.input_hash)fail(409,"stale_input","岗位、背景或官网已更新，请重新领取新任务");
  const state=(await c.query("SELECT locked FROM enrichment_state WHERE kind=$1 AND target_id=$2 FOR UPDATE",[task.kind,task.target_id])).rows[0];if(state?.locked||payload.manualLogo)fail(409,"result_locked","结果已手动锁定");
  const resultId=randomUUID();let stored:Record<string,unknown>=result,before:unknown=null,after:unknown=null;
  if(task.kind==="job"){
   if(result.kind!=="assessment"||!entryRow)fail(400,"wrong_result","岗位任务需要 assessment 结果");
   if(!payload.profile?.background.trim()&&!payload.profile?.cvText.trim()&&result.fit.score!==null)fail(400,"profile_required","没有个人背景或简历时匹配度必须为 null");
   if(!payload.job?.jd.trim()&&!payload.job?.summary.trim()&&(result.fit.score!==null||result.career.score!==null))fail(400,"jd_required","没有 JD 或摘要时，匹配度和发展评分必须为 null");
   if(!payload.profile?.goals.trim()&&!payload.profile?.targets.length&&result.career.score!==null)fail(400,"goals_required","没有职业目标时，发展评分必须为 null");
   if(result.outlook.score!==null&&!result.sources.length)fail(400,"sources_required","公司前景评分需要带日期的来源");
   for(const factor of [result.fit,result.career,result.outlook])if(factor.score!==null&&!factor.evidence.length)fail(400,"evidence_required","每个有效分数都需要证据");
   const e=entrySchema.parse({...entryRow.data,revision:entryRow.revision});before={fit:e.fit,career:e.career,outlook:e.outlook};after={fit:result.fit.score,career:result.career.score,outlook:result.outlook.score};
   const next={...e,...after as object,returnOffer:result.returnOffer.score,academic:result.academic.score,revision:e.revision+1};await c.query("SELECT set_config('opportunity.enrichment_write','on',true)");await c.query("UPDATE entries SET data=$2,revision=$3,updated=now() WHERE id=$1",[e.id,JSON.stringify(next),next.revision]);
  }else{
   if(result.kind!=="brand")fail(400,"wrong_result","图标任务需要 brand 结果");
   const host=(url:string)=>new URL(url).hostname.toLowerCase().replace(/^www\./,"");
   if(payload.website&&host(payload.website)!==host(result.website))fail(400,"website_mismatch","结果官网与公司资料不符，请先核对公司资料");
   if(host(result.sourceUrl)!==host(result.website))fail(400,"source_mismatch","请提供官网内引用该图标的来源页面");
   let image;try{image=rasterImage(result.imageDataUrl)}catch(e){fail(400,"invalid_image",(e as Error).message)}
   await c.query("INSERT INTO brand_assets(id,mime,bytes) VALUES($1,$2,$3)",[resultId,image!.mime,image!.bytes]);
   const {imageDataUrl,...metadata}=result;void imageDataUrl;stored={...metadata,assetUrl:"/api/brand-assets/"+resultId};after={source:result.sourceUrl,image:result.imageUrl};
  }
  await c.query("INSERT INTO enrichment_results(id,task_id,kind,target_id,input_hash,input,result,actor) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",[resultId,id,task.kind,task.target_id,task.input_hash,JSON.stringify(payload),JSON.stringify(stored),actor.name]);
  await c.query("INSERT INTO enrichment_state(kind,target_id,result_id) VALUES($1,$2,$3) ON CONFLICT(user_id,kind,target_id) DO UPDATE SET result_id=EXCLUDED.result_id",[task.kind,task.target_id,resultId]);
  await c.query("UPDATE enrichment_tasks SET status='completed',result_hash=$2,lease_until=NULL,error='',updated=now() WHERE id=$1",[id,resultHash]);
  // Icons fetched by Runway itself are routine; only assessments and Muse's work notify.
  if(task.kind==="job"||actor.id!==localActor.id)await notify({actor:actor.name,action:task.kind==="job"?"assessment":"brand",summary:result.summary,entryId:task.kind==="job"?task.target_id:null,title:payload.name,source:{kind:"manual",id,subject:task.kind==="job"?"岗位评估":"官方图标更新",url:result.kind==="brand"?result.sourceUrl:""},changes:[{field:task.kind==="job"?"evaluation":"logo",before,after}]},c);
  return{ok:true,resultId,replayed:false};
 });
}
