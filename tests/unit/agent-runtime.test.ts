import { test } from "node:test";
import assert from "node:assert/strict";
import { MemorySaver, Command } from "@langchain/langgraph";
import { createRunwayGraph } from "../../lib/agent-graph";
import { runModelGraph } from "../../lib/agent-model-loop";
import { prepareAgentActions, type AgentSnapshot } from "../../lib/agent-contract";
import { agentCapabilities, agentCapabilityPrompt } from "../../lib/agent-capabilities";
import { blankEntry, today } from "../../lib/model";
import { profileSchema } from "../../lib/enrichment-contract";
import { newGig } from "../../lib/part-time-contract";
import { prepareAiReply } from "../../lib/ai-contract";
import { centralizeReply } from "../../lib/agent-legacy";
const entry = { ...blankEntry("job"), title: "Fixture", revision: 2 };
const gig = { ...newGig(), title: "Fixture gig", revision: 1 };
const snapshot: AgentSnapshot = { entries:[entry], deleted:[], gigs:[gig], directory:{revision:0,companies:[],channels:[]}, watches:[],reminders:[],profile:profileSchema.parse({}),scanSettings:{enabled:true,time:"08:00",maxAddPerWatch:5},ai:{base:"https://example.com",model:"m",revision:0} };
const reply = () => ({ ...prepareAiReply({ reply: "请确认", actions:[{module:"entry",operation:"update",targetId:entry.id,fields:{title:"Changed"}},{module:"gig",operation:"update",targetId:gig.id,fields:{archived:true}}] },snapshot.entries,[],"m",{agent:snapshot,reminders:[],watches:[],gigs:[gig]}),pages:[] });
test("durable graph pauses with zero writes and supports individual decisions in any order", async () => {
  const saver = new MemorySaver(); let calls=0;
  const deps={plan:async()=>reply(),execute:async(_id:string,_draft:unknown,d:{approved:boolean})=>{if(d.approved)calls++;return{status:d.approved?"done" as const:"rejected" as const,message:"ok"};}};
  let g=createRunwayGraph(saver,deps);const c={configurable:{thread_id:crypto.randomUUID()}};
  await g.invoke({runId:c.configurable.thread_id},c);assert.equal(calls,0);
  const actions=(await g.getState(c)).values.reply.actions!;
  g=createRunwayGraph(saver,deps);
  await g.invoke(new Command({resume:{proposalId:actions[1].id,approved:false}}),c);assert.equal(calls,0);
  assert((await g.getState(c)).next.includes("approval"));
  await g.invoke(new Command({resume:{proposalId:actions[0].id,approved:true}}),c);assert.equal(calls,1);
  assert.deepEqual((await g.getState(c)).next,[]);
});
test("unrelated proposal id cannot authorize any mutation", async () => {
  let writes=0;const g=createRunwayGraph(new MemorySaver(),{plan:async()=>reply(),execute:async()=>{writes++;return{status:"done",message:""};}});const c={configurable:{thread_id:crypto.randomUUID()}};
  await g.invoke({runId:c.configurable.thread_id},c);
  await assert.rejects(g.invoke(new Command({resume:{proposalId:crypto.randomUUID(),approved:true}}),c),/不属于/);assert.equal(writes,0);
});
test("model graph feeds tool results back and enforces a finite read budget", async () => {
  let calls=0,reads=0;
  const answer=await runModelGraph([{role:"user",content:"test"}],{call:async messages=>{calls++;if(calls===1)return '{"reads":[{"module":"entries"}]}';assert.match(String(messages.at(-1)?.content),/fixture/);return '{"reply":"ok"}';},read:async()=>{reads++;return{title:"fixture"};},prepare:raw=>raw});
  assert.deepEqual(answer,{reply:"ok"});assert.equal(reads,1);
  calls=0;await assert.rejects(runModelGraph([],{call:async()=>{calls++;return '{"reads":[{"module":"entries"}]}';},read:async()=>[],prepare:raw=>raw}),/读取预算/);assert(calls<=12);
});
test("agent instructions map application events to structured fields and reserve notes for explicit notes", () => {
  assert.match(agentCapabilityPrompt, /candidate\/application/);
  assert.match(agentCapabilityPrompt, /用户明确要求添加备注或提供独立的备注文本时才写notes/);
  assert.match(agentCapabilityPrompt, /申请人专属.*applicationUrl/);
  assert.match(agentCapabilityPrompt, /无法确定目标记录.*先询问/);
});

test("new unified actions cover creation, income, background jobs and historic restore without system-field writes",()=>{
  for(const capabilityModule of ["entry","gig","watch","reminder","payment","assessment","scan","companyCompletion","version"])assert(agentCapabilities.some(c=>c.module===capabilityModule));
  const created=prepareAgentActions([{module:"entry",operation:"add",fields:{title:"New",extra:{custom:"yes"}}},{module:"gig",operation:"add",fields:{title:"Gig"}}],snapshot);
  assert.equal(created.length,2);
  const income=prepareAgentActions([{module:"payment",operation:"add",targetId:gig.id,fields:{amountMinor:30000,currency:"HKD",status:"received",date:today()}}],snapshot)[0];
  assert.equal((income.body as typeof gig).payments[0].amountMinor,30000);
  assert.throws(()=>prepareAgentActions([{module:"reminder",operation:"add",fields:{id:"forged",title:"x",schedule:{type:"daily",time:"08:00",until:""}}}],snapshot));
  assert.throws(()=>prepareAgentActions([{module:"scan",operation:"run",watchIds:["not-found"]}],snapshot),/不能扩大/);
  assert.throws(()=>prepareAgentActions([{module:"entry",operation:"add",fields:{id:"forged",title:"x"}}],snapshot));
  const s={...snapshot,versions:[{id:"v1",entry_id:entry.id,data:JSON.stringify({jd:"Old JD",jdStatus:"complete",summary:"old",url:""})}]};
  const version=prepareAgentActions([{module:"version",operation:"restore",targetId:entry.id,itemId:"v1"}],s)[0];
  assert.equal((version.body as {entry:typeof entry}).entry.revision,2);
});
test("legacy proposal formats converge and conflicting dual-format writes are refused",()=>{
  const prepared=prepareAiReply({reply:"ok",drafts:[{operation:"add",fields:{title:"Test"}}]},[],[],"m");
  const unified=centralizeReply({...prepared,pages:[]},snapshot);assert.equal(unified.drafts.length,0);assert.equal(unified.actions?.length,1);
  const conflict=reply();conflict.actions!.push(conflict.actions![0]);assert.throws(()=>centralizeReply(conflict,snapshot),/同一记录/);
});
