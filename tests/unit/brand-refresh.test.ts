import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import * as model from "../../lib/model";
import * as journey from "../../lib/journey";
import { loadModule } from "../helpers/load-module";

test("official header logo precedes old touch icons, with fallback for unsupported images", async () => {
  const urls: string[] = [];
  let rejectLogo = false;
  const scanner = loadModule<{ scanOfficialLogo(url: string): Promise<{ imageUrl: string }> }>(new URL("../../lib/brand-scan.ts", import.meta.url), {
    "./web": { publicFetch: async (url: string) => {
      urls.push(url);
      if (url === "https://example.org") return { url, mime: "text/html", bytes: Buffer.from('<link rel="apple-touch-icon" href="/old.png"><img src="/logo.png" alt="logo">') };
      if (rejectLogo && url.endsWith("logo.png")) throw Error("unsupported");
      return { url, mime: "image/png", bytes: Buffer.from([137,80,78,71,13,10,26,10,0,0,0,0]) };
    } }, "./enrichment-contract": { rasterImage: () => {} },
    sharp: Object.assign((bytes: Buffer, options?: {limitInputPixels?:number}) => options?{metadata:async()=>({width:64,height:64,format:"png"})}:{ resize: () => ({ png: () => ({ toBuffer: async () => bytes }) }) }, { default: undefined }),
  });
  assert.equal((await scanner.scanOfficialLogo("https://example.org")).imageUrl, "https://example.org/logo.png");
  rejectLogo = true; urls.length = 0;
  assert.equal((await scanner.scanOfficialLogo("https://example.org")).imageUrl, "https://example.org/old.png");
  assert.deepEqual(urls.slice(1), ["https://example.org/logo.png", "https://example.org/old.png"]);
});

test("official logos hosted on a public HTTPS CDN are fetched safely", async () => {
  const urls: string[] = [];
  const scanner = loadModule<{ scanOfficialLogo(url: string): Promise<{ imageUrl: string }> }>(new URL("../../lib/brand-scan.ts", import.meta.url), {
    "./web": { publicFetch: async (url: string) => {
      urls.push(url);
      if (url === "https://xiaopeng.example/") return { url, mime: "text/html", bytes: Buffer.from('<img class="logo" src="https://assets.example/brand/logo.svg" alt="">') };
      return { url, mime: "image/png", bytes: Buffer.from([137,80,78,71,13,10,26,10,0,0,0,0]) };
    } }, "./enrichment-contract": { rasterImage: () => {} },
    sharp: Object.assign((bytes: Buffer, options?: {limitInputPixels?:number}) => options?{metadata:async()=>({width:64,height:64,format:"png"})}:{resize:()=>({png:()=>({toBuffer:async()=>bytes})})},{default:undefined}),
  });
  assert.equal((await scanner.scanOfficialLogo("https://xiaopeng.example/")).imageUrl, "https://assets.example/brand/logo.svg");
  assert.deepEqual(urls, ["https://xiaopeng.example/", "https://assets.example/brand/logo.svg"]);
});

test("official SVG wordmarks are rasterized to PNG for safe storage", async () => {
  let converted = false, recoloured = false;
  const sharpMock = (input: Buffer, options?: { raw?: unknown; limitInputPixels?: number; density?: number }) => {
    if(options?.raw)return {png:()=>({toBuffer:async()=>{converted=true;recoloured=input[0]===17&&input[1]===24&&input[2]===39&&input[7]===0;return Buffer.from([137,80,78,71,13,10,26,10,0,0,0,0])}})};
    if(options?.density) return {
      resize: () => ({
        ensureAlpha: () => ({
          raw: () => ({ toBuffer: async () => ({
            data: Buffer.from([255,255,255,255,255,255,255,0]),
            info: { width: 2, height: 1, channels: 4 },
          }) }),
        }),
      }),
    };
    return {metadata:async()=>({width:64,height:64,format:"png"})};
  };
  const scanner = loadModule<{ scanOfficialLogo(url: string): Promise<{ imageDataUrl: string }> }>(new URL("../../lib/brand-scan.ts", import.meta.url), {
    "./web": { publicFetch: async (url: string) => url === "https://example.org"
      ? { url, mime: "text/html", bytes: Buffer.from('<img src="/logo.svg" alt="logo">') }
      : { url, mime: "image/svg+xml", bytes: Buffer.from("<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 1 1\"><path d=\"M0 0h1v1H0z\"/></svg>") } },
    "./enrichment-contract": { rasterImage: (data: string) => { assert.match(data, /^data:image\/png;base64,/); } },
    sharp: Object.assign(sharpMock, { default: undefined }),
  });
  const result = await scanner.scanOfficialLogo("https://example.org");
  assert(converted);
  assert(recoloured, "visible white pixels are darkened while transparent pixels stay untouched");
  assert.match(result.imageDataUrl, /^data:image\/png;base64,/);
});

test("only the confirmed M-Labs wordmark is reduced to its leading symbol",async()=>{
 const scanner=loadModule<{scanOfficialLogo(url:string):Promise<{imageDataUrl:string}>}>(new URL("../../lib/brand-scan.ts",import.meta.url),{
  "./web":{publicFetch:async(url:string)=>url==="https://m-labs.hk"?{url,mime:"text/html",bytes:Buffer.from('<img src="/logo.png" alt="logo">')}:{url,mime:"image/png",bytes:Buffer.from([137,80,78,71,13,10,26,10,0,0,0,0])}},
  "./enrichment-contract":{rasterImage:()=>{}},
  sharp:Object.assign((bytes:Buffer,options?:{limitInputPixels?:number})=>options?{metadata:async()=>({width:1000,height:100})}:{extract:(rect:{width:number;height:number})=>({trim:()=>({resize:(size:{width:number;height:number;fit:string;background:unknown})=>({png:()=>({toBuffer:async()=>Buffer.from(JSON.stringify({rect,size}))})})})})},{default:undefined})
 });
 const result=await scanner.scanOfficialLogo("https://m-labs.hk");
 const payload=Buffer.from(result.imageDataUrl.split(",")[1],"base64").toString();
 assert.match(payload,/"width":100,"height":100/);
});

test("refresh replaces an existing automatic icon and failures never become completed runs", async () => {
  const attempts: Record<string, unknown> = {};
  const states: {kind:string;target_id:string;result:unknown}[] = [];
  let scanFails = false, pending = true, scans = 0, claimed: unknown, forced = false;
  const loaded = loadModule<{
    completeCompanies(options: { names: string[]; force: boolean; refreshLogo: boolean }): Promise<{ updated: number }>;
    completionState(): Promise<{ run: { id: string; status: string }; attempts: Record<string, { failed?: boolean }> }>;
  }>(new URL("../../lib/company-complete.ts", import.meta.url), {
    zod: { z }, "./model": model, "./journey": journey,
    "./postgres": { pool: { query: async (sql: string, values: string[]) => {
      if (sql.includes("enrichment_tasks")) return { rows: pending ? [{ id: "specific-task" }] : [] };
      if (sql.startsWith("SELECT")) return { rows: [{ value: JSON.stringify(attempts) }] };
      Object.assign(attempts, JSON.parse(values[1])); return { rows: [] };
    } } },
    "./directory-storage": { getDirectory: async () => ({ revision: 1, companies: [{ name: "Example", website: "https://example.org", logoUrl: "" }], channels: [] }) },
    "./entries": { listEntries: async () => [] }, "./watch-storage": { allWatches: async () => [] },
    "./ai-client": {}, "./web": {}, "./notifications": { notify: async () => {} },
    "./brand-scan": { officialIconParserVersion:"official-icon-parser-v2",scanOfficialLogo: async () => { scans++; if (scanFails) throw Error("No usable logo"); return {kind:"brand",model:"official-icon-parser-v2"}; } },
    "./enrichment": {
      enrichmentFeed: async () => ({ states: states.length?states:[{ kind: "company", target_id: "example", result: { old: true } }] }),
      syncEnrichment: async () => {}, queueEnrichment: async (_scope: string, _target: unknown, force: boolean) => { forced = force; return { queued: 1, skipped: 0 }; },
      claimEnrichment: async (_actor: unknown, _kinds: unknown, _limit: number, id: string) => { claimed = id; return { tasks: [{ id, leaseToken: "lease", payload: { website: "https://example.org" } }] }; },
      completeEnrichment: async (_actor:unknown,_id:string,_lease:string,result:unknown) => { states.splice(0,states.length,{kind:"company",target_id:"example",result}); }, failEnrichment: async () => {}, localActor: {},
    },
  });
  const options = { names: ["Example"], force: true, refreshLogo: true };
  assert.equal((await loaded.completeCompanies(options)).updated, 1);
  assert.equal(scans, 1); assert.equal(claimed, "specific-task"); assert.equal(forced, true);
  const first = await loaded.completionState(); assert.equal(first.run.status, "completed");
  scanFails = true;
  await assert.rejects(loaded.completeCompanies(options));
  const failed = await loaded.completionState(); assert.equal(failed.run.status, "failed"); assert.notEqual(first.run.id, failed.run.id); assert.equal(failed.attempts.example.failed, true);
  pending = false; claimed = undefined;
  await assert.rejects(loaded.completeCompanies(options)); assert.equal(claimed, undefined, "never claim another company's pending task");
  await assert.rejects(loaded.completeCompanies({ ...options, names: ["Missing"] }), /未找到/);
});
