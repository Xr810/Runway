import { pool, tx } from "./postgres";
import { watchSchema, type CompanyWatch } from "./watches";

export async function allWatches(){
 const rows=await pool.query<{data:CompanyWatch;revision:number}>("SELECT data,revision FROM company_watches ORDER BY updated DESC");
 return rows.rows.map(row=>watchSchema.parse({...row.data,revision:row.revision}));
}
export class WatchError extends Error{constructor(public status:number,message:string){super(message)}}
/** Saves with an optimistic revision check. `restore` skips watches that already exist. */
export async function saveWatch(input:CompanyWatch,mode:"save"|"restore"|"delete"="save"){
 return tx(async client=>{
  const watch={...input};
  const old=(await client.query<{revision:number}>("SELECT revision FROM company_watches WHERE id=$1 FOR UPDATE",[watch.id])).rows[0];
  if(mode==="restore"&&old)return {skipped:true,watch};
  if((old?.revision||0)!==watch.revision)throw new WatchError(409,"关注记录已更新，请刷新后再试");
  if(mode==="delete"){if(!old)throw new WatchError(404,"记录已不存在");await client.query("DELETE FROM company_watches WHERE id=$1",[watch.id]);return {ok:true,watch};}
  watch.revision=(old?.revision||0)+1;
  await client.query("INSERT INTO company_watches(id,data,revision,updated) VALUES($1,$2,$3,now()) ON CONFLICT(id) DO UPDATE SET data=EXCLUDED.data,revision=EXCLUDED.revision,updated=now()",[watch.id,JSON.stringify(watch),watch.revision]);
  return {watch};
 });
}
