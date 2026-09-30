// Destructive fixture setup is restricted to the explicitly named disposable database.
import assert from "node:assert/strict";
import http from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
const url = new URL(process.env.DATABASE_URL ?? "");
assert.equal(url.hostname, "127.0.0.1"); assert.equal(url.pathname, "/runway_agent_test");
const { pool, atomicAgentWrite } = await import("../lib/postgres");
const { startAgentRun, advanceAgentRun, getAgentRun } = await import("../lib/agent-runtime");
if (process.argv[2] === "resume") {
  const run = await advanceAgentRun(process.argv[3], "owner", { proposalId: process.argv[4], approved: true, allowDuplicate: false });
  assert.equal(run.outcomes[process.argv[4]].status, "done"); await pool.end(); process.exit(0);
}
const { saveEntry, getEntry } = await import("../lib/entries");
const { blankEntry, today } = await import("../lib/model");
const { executeAgentDraft } = await import("../lib/agent-executor");
const { prepareAgentActions } = await import("../lib/agent-contract");
const { loadAgentSnapshot } = await import("../lib/agent-context");
const { evaluationProfile } = await import("../lib/enrichment");
const { allWatches } = await import("../lib/watch-storage");
const { listReminders } = await import("../lib/reminders");
const { listEntries } = await import("../lib/entries");
const { listGigs } = await import("../lib/part-time");
let response: unknown = { reply: "fixture", actions: [] };
const mock = http.createServer((req, res) => { req.resume(); req.on("end",()=>{res.setHeader("Content-Type","application/json");res.end(JSON.stringify({choices:[{message:{content:JSON.stringify(response)}}]}));}); });
await new Promise<void>(resolve=>mock.listen(0,"127.0.0.1",resolve));
const address=mock.address() as {port:number}; process.env.AI_BASE_URL=`http://127.0.0.1:${address.port}/v1`; process.env.AI_API_KEY="fixture-only";process.env.AI_MODEL="fixture";
const input = {messages:[{role:"user" as const,text:"fixture request"}],images:[]};
const snapshot=async()=>loadAgentSnapshot({entries:await listEntries(),gigs:await listGigs(),watches:await allWatches(),reminders:(await listReminders()).reminders,profile:await evaluationProfile(),ai:{base:process.env.AI_BASE_URL!,model:"fixture",revision:0}});
const seedRun=async()=>{const id=randomUUID();await pool.query("INSERT INTO agent_runs(id,owner_id,input) VALUES($1,'owner',$2)",[id,JSON.stringify(input)]);return id;};
try {
  response={reply:"confirm reminder",actions:[{module:"reminder",operation:"add",fields:{title:"[agent-test] Reminder",schedule:{type:"daily",time:"09:00",until:""}}}]};
  const runId=randomUUID(), run=await startAgentRun(runId,"owner",input);
  assert.equal(run.runtime,"langgraph");assert.equal(run.actions!.length,1);
  const draft=run.actions![0], reminderId=(draft.body as {reminder:{id:string}}).reminder.id;
  assert.equal((await pool.query("SELECT 1 FROM reminders WHERE id=$1",[reminderId])).rowCount,0);
  await assert.rejects(getAgentRun(runId,"different-user"),/不存在/);
  await assert.rejects(advanceAgentRun(runId,"owner",{proposalId:randomUUID(),approved:true,allowDuplicate:false}),/不属于/);
  await promisify(execFile)(process.execPath,["--import","tsx","tests/agent-runtime.integration.ts","resume",runId,draft.id],{env:process.env,timeout:30000});
  const resumed=await getAgentRun(runId,"owner");assert.equal(resumed.outcomes[draft.id].status,"done");
  await advanceAgentRun(runId,"owner",{proposalId:draft.id,approved:true,allowDuplicate:false});
  assert.equal((await pool.query("SELECT revision FROM reminders WHERE id=$1",[reminderId])).rows[0].revision,1);
  assert.equal((await pool.query("SELECT 1 FROM agent_operations WHERE run_id=$1",[runId])).rowCount,1);
  console.log("PASS real model adapter (mock), durable confirmation, fresh-process resume, repeat decision, owner checks");
  const rejected=await startAgentRun(randomUUID(),"owner",input);const rejectDraft=rejected.actions![0];
  await advanceAgentRun(rejected.runId,"owner",{proposalId:rejectDraft.id,approved:false,allowDuplicate:false});
  assert.equal((await pool.query("SELECT 1 FROM reminders WHERE id=$1",[(rejectDraft.body as {reminder:{id:string}}).reminder.id])).rowCount,0);
  console.log("PASS rejection has no business side effects");
  const original=(await saveEntry({...blankEntry("job"),title:"[agent-test] Original"})).entry;
  const stale=prepareAgentActions([{module:"entry",operation:"update",targetId:original.id,fields:{title:"Stale write"}}],await snapshot())[0];
  await saveEntry({...original,title:"Concurrent edit"});
  const staleRun=await seedRun(); await assert.rejects(executeAgentDraft(staleRun,stale,{proposalId:stale.id,approved:true,allowDuplicate:false}),/已更新/);
  assert.equal((await getEntry(original.id))!.title,"Concurrent edit");
  assert.equal((await pool.query("SELECT 1 FROM agent_operations WHERE id=$1",[stale.id])).rowCount,0);
  const before=(await getEntry(original.id))!;
  await assert.rejects(atomicAgentWrite(async()=>{await saveEntry({...before,title:"Must rollback"});throw Error("fault-after-business-write");}),/fault-after/);
  assert.equal((await getEntry(original.id))!.title,"Concurrent edit");
  const change=prepareAgentActions([{module:"entry",operation:"update",targetId:original.id,fields:{notes:"confirmed"}}],await snapshot())[0];const changeRun=await seedRun();
  await Promise.all([executeAgentDraft(changeRun,change,{proposalId:change.id,approved:true,allowDuplicate:false}),executeAgentDraft(changeRun,change,{proposalId:change.id,approved:true,allowDuplicate:false})]);
  assert.equal((await getEntry(original.id))!.revision,before.revision+1);
  console.log("PASS stale revision, transaction rollback, concurrent duplicate receipts");
  for (const action of [
    {module:"company",operation:"add",fields:{name:"[agent-test] Company",website:"https://example.com"}},
    {module:"gig",operation:"add",fields:{title:"[agent-test] Gig"}},
    {module:"watch",operation:"add",fields:{company:"[agent-test] Watch",url:"https://example.com/jobs"}},
    {module:"profile",operation:"update",fields:{goals:"fixture"}},
    {module:"scanSettings",operation:"update",fields:{enabled:false}},
  ]) { const d=prepareAgentActions([action],await snapshot())[0];const id=await seedRun();const result=await executeAgentDraft(id,d,{proposalId:d.id,approved:true,allowDuplicate:false});assert.equal(result.status,"done"); }
  const gig=(await listGigs())[0];
  const payment=prepareAgentActions([{module:"payment",operation:"add",targetId:gig.id,fields:{amountMinor:5000,currency:"HKD",status:"received",date:today()}}],await snapshot())[0];
  assert.equal((await executeAgentDraft(await seedRun(),payment,{proposalId:payment.id,approved:true,allowDuplicate:false})).status,"done");
  assert.equal((await listGigs())[0].payments.length,1);
  const job=prepareAgentActions([{module:"brief",operation:"refresh"}],await snapshot())[0];const jobRun=await seedRun();
  await executeAgentDraft(jobRun,job,{proposalId:job.id,approved:true,allowDuplicate:false});
  await executeAgentDraft(jobRun,job,{proposalId:job.id,approved:true,allowDuplicate:false});
  assert.equal((await pool.query("SELECT 1 FROM agent_jobs WHERE id=$1 AND status='pending'",[job.id])).rowCount,1);
  console.log("PASS directory, gig, income, watch, profile, settings and exactly-once job enqueue");
} finally { mock.close();await pool.end(); }
