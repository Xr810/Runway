import {randomUUID} from "node:crypto";
import {z} from "zod";
import {getUser} from "@/lib/auth";
import {validOrigin} from "@/lib/session";
import {rasterImage} from "@/lib/enrichment-contract";
import {pool} from "@/lib/postgres";
import {boundedJson,integrationJson as json,integrationFailure} from "@/lib/integration-http";
export async function POST(request:Request){try{if(!await getUser())return json({error:"请先登录"},401);if(!validOrigin(request))return json({error:"请求来源无效"},403);const parsed=z.object({imageDataUrl:z.string().max(710000)}).strict().safeParse(await boundedJson(request,720000));if(!parsed.success)return json({error:"图片格式无效"},400);let image;try{image=rasterImage(parsed.data.imageDataUrl)}catch(e){return json({error:(e as Error).message},400)}const id=randomUUID();await pool.query("INSERT INTO brand_assets(id,mime,bytes) VALUES($1,$2,$3)",[id,image.mime,image.bytes]);return json({url:"/api/brand-assets/"+id})}catch(e){return integrationFailure(e)}}
