// Run only inside the isolated test app. Never pointed at production.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
assert.equal(process.env.SCHEDULER, 'off');
assert.equal(new URL(process.env.DATABASE_URL).hostname, 'runway-parttime-test-db');
const base='http://127.0.0.1:3000';
// Register a throwaway account and use its real database session; the old forged
// HMAC cookie no longer authenticates (#30).
async function signIn() {
  const response=await fetch(base+'/api/auth',{method:'POST',headers:{origin:process.env.APP_ORIGIN,'Content-Type':'application/json'},body:JSON.stringify({action:'register',email:`parttime-${randomUUID()}@example.test`,password:'Runway-test-'+randomUUID()+'!',displayName:'Part-time test'})});
  assert.equal(response.status,200,'register failed: '+await response.text());
  return response.headers.get('set-cookie').split(';')[0];
}
const cookie=await signIn();
async function call(item, options={}) {
  const r=await fetch(base+'/api/part-time'+(options.restore?'?restore=1':''),{method:item?'POST':'GET',headers:{...(options.auth===false?{}:{cookie}),origin:options.origin??process.env.APP_ORIGIN,...(item?{'Content-Type':'application/json'}:{})},body:item?JSON.stringify(item):undefined});
  return {status:r.status,body:await r.json()};
}
const gig=(type='task')=>({id:randomUUID(),title:'[test] Paid interview',type,status:'待开始',revision:0,payments:[]});
const pay=(patch={})=>({id:randomUUID(),amountMinor:1029,currency:'HKD',status:'pending',date:'2026-01-10',period:'Test period',note:'',voided:false,...patch});
assert.equal((await call(null,{auth:false})).status,401);
assert.equal((await call(gig(),{origin:'https://evil.example'})).status,403);
const source=gig();
let created=await call(source);assert.equal(created.status,200);let item=created.body.item;
assert.equal(item.revision,1);assert.equal((await call(source)).status,409);
let updated=await call({...item,status:'进行中',payments:[pay()]});assert.equal(updated.status,200);item=updated.body.item;
assert.equal((await call({...item,payments:[...item.payments,item.payments[0]]})).status,400);
assert.equal((await call({...item,payments:[pay({amountMinor:-10})]})).status,400);
updated=await call({...item,payments:item.payments.map(p=>({...p,status:'received'}))});assert.equal(updated.status,200);item=updated.body.item;
assert.equal((await call({...item,payments:[...item.payments,pay({currency:'USD',amountMinor:999})]})).status,200);
let loaded=(await call()).body.items.find(i=>i.id===item.id);assert.equal(loaded.payments.length,2);
assert.equal(loaded.payments[0].status,'received');assert.equal(loaded.payments[0].amountMinor,1029);
const restored=await call({...loaded,title:'Must not overwrite existing'}, {restore:true});assert.equal(restored.body.item.title,source.title);
const newRestore={...gig('ongoing'),payments:[pay({status:'received'})],revision:50};
const imported=await call(newRestore,{restore:true});assert.equal(imported.status,200);assert.equal(imported.body.item.revision,1);
assert.equal((await call(newRestore,{restore:true})).body.item.payments.length,1);
let archive=await call({...loaded,archived:true});assert.equal(archive.status,200);
assert.equal((await call()).body.items.find(i=>i.id===loaded.id).payments.length,2);
const undo=await call({...archive.body.item,archived:false});assert.equal(undo.status,200);
const voided=await call({...undo.body.item,payments:undo.body.item.payments.map(p=>({...p,voided:true}))});assert.equal(voided.status,200);
assert.equal(voided.body.item.payments[0].voided,true);
const concurrency=gig('income');
const inserts=await Promise.all([call(concurrency),call(concurrency)]);assert.deepEqual(inserts.map(r=>r.status).sort(),[200,409]);
const latest=inserts.find(r=>r.status===200).body.item;
const writes=await Promise.all([call({...latest,title:'One'}),call({...latest,title:'Two'})]);assert.deepEqual(writes.map(r=>r.status).sort(),[200,409]);
assert.equal((await call()).body.items.length,3);
console.log('PASS: auth, origin, create/read/edit, exact amounts, pending-to-received, multiple currencies, void/archive/restore, additive backup restore, concurrent insert/update conflicts');
