import {getUser} from "@/lib/auth";
import {pool} from "@/lib/postgres";
export const dynamic="force-dynamic";
export async function GET(_request:Request,{params}:{params:Promise<{id:string}>}){
 if(!await getUser())return new Response(null,{status:401});const {id}=await params;if(!/^[a-f0-9-]{36}$/.test(id))return new Response(null,{status:404});
 const r=await pool.query("SELECT mime,bytes FROM brand_assets WHERE id=$1",[id]);if(!r.rowCount)return new Response(null,{status:404});
 return new Response(new Uint8Array(r.rows[0].bytes),{headers:{"Content-Type":r.rows[0].mime,"Cache-Control":"private,max-age=86400","X-Content-Type-Options":"nosniff","Content-Security-Policy":"default-src 'none'; sandbox"}});
}
