import {publicFetch} from "./web";
import {rasterImage} from "./enrichment-contract";
import sharp from "sharp";

export const officialIconParserVersion="official-icon-parser-v3";

async function imageBytes(bytes: Buffer, mime: string) {
 const isSvg = mime.includes("svg") || /^\s*(?:<\?xml[^>]*>\s*)?<svg\b/i.test(bytes.toString("utf8", 0, Math.min(bytes.length, 1024)));
 if (!isSvg) return { bytes, mime: bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])) ? "image/png" : bytes[0]===255&&bytes[1]===216 ? "image/jpeg" : bytes.toString("ascii",8,12)==="WEBP" ? "image/webp" : "image/x-icon" };
 const svg = bytes.toString("utf8");
 if (/<\s*(?:script|foreignObject)\b|(?:href|src)\s*=\s*["']\s*(?:https?:|\/\/|data:)|url\(\s*["']?\s*(?:https?:|\/\/|data:)/i.test(svg)) throw Error("SVG 图标包含外部引用，已拒绝处理");
 const rendered = await sharp(bytes, { density: 144, limitInputPixels: 4_000_000 })
  .resize({ width: 256, height: 256, fit: "inside", withoutEnlargement: true })
  .ensureAlpha().raw().toBuffer({ resolveWithObject: true });
 // Some official sites only publish a white wordmark for use on a dark header.
 // Company cards have a white surface, so recolour an all-white transparent
 // wordmark while preserving its antialiasing and transparency.
 let visible = 0, light = 0;
 for (let i = 0; i < rendered.data.length; i += 4) {
  if (rendered.data[i + 3] < 16) continue;
  visible++;
  if (rendered.data[i] > 220 && rendered.data[i + 1] > 220 && rendered.data[i + 2] > 220) light++;
 }
 if (visible > 0 && light / visible > 0.98) {
  for (let i = 0; i < rendered.data.length; i += 4) {
   if (rendered.data[i + 3] >= 16) { rendered.data[i] = 17; rendered.data[i + 1] = 24; rendered.data[i + 2] = 39; }
  }
 }
 const png = await sharp(rendered.data, { raw: rendered.info }).png().toBuffer();
 return { bytes: png, mime: "image/png" };
}

async function companyMark(bytes:Buffer,website:string){
 const image=sharp(bytes,{limitInputPixels:4_000_000}),meta=await image.metadata();
 const host=new URL(website).hostname.toLowerCase().replace(/^www\./,"");
 if(host==="m-labs.hk"&&meta.width&&meta.height&&meta.width/meta.height>2.2){
  // M-Labs' official 362×80 header mark has a distinct atom/mascot at left
  // followed by the M-LABS wordmark. Keep just that independent symbol.
  const width=Math.max(1,Math.min(meta.height,Math.round(meta.width*.15)));
  const cropped=await sharp(bytes).extract({left:0,top:0,width,height:meta.height}).trim().resize({width:220,height:220,fit:"contain",background:{r:255,g:255,b:255,alpha:0}}).png().toBuffer();
  return {bytes:cropped,mime:"image/png"};
 }
 return {bytes,mime:meta.format==="svg"?"image/svg+xml":meta.format?`image/${meta.format}`:"image/png"};
}

export async function scanOfficialLogo(website:string){
 const signal=AbortSignal.timeout(45000),page=await publicFetch(website,{signal});if(!page.mime.includes("html"))throw Error("官网没有返回网页");
 const html=page.bytes.toString("utf8"),candidates:string[]=[];
 const attr=(tag:string,key:string)=>{const m=new RegExp(`\\b${key}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`,"i").exec(tag);return (m?.[1]||m?.[2]||m?.[3]||"").replaceAll("&amp;","&")};
 // Prefer explicit brand logos over mobile home-screen icons, which can be obsolete.
 for(const tag of html.match(/<img\b[^>]{0,8000}>/gi)||[]){
  const src=attr(tag,"src"),label=[attr(tag,"alt"),attr(tag,"class"),attr(tag,"id")].join(" ");
  if(!/\blogo\b|品牌标志/i.test(label))continue;
  // Brand sites commonly host official logos on a separate public CDN. The
  // fetcher independently enforces HTTPS, DNS pinning, and public-IP checks.
  try{const url=new URL(src,page.url);if(src&&url.protocol==="https:"&&/\.(png|jpe?g|webp|svg)(?:\?|$)/i.test(url.href))candidates.push(url.href)}catch{}
 }
 const tags=html.match(/<link\b[^>]{0,8000}>/gi)||[];
 for(const apple of [true,false])for(const tag of tags){const rel=attr(tag,"rel");if(!/(^|\s)(icon|apple-touch-icon|shortcut)(\s|$)/i.test(rel)||/apple-touch-icon/i.test(rel)!==apple)continue;const href=attr(tag,"href");try{if(href&&!href.startsWith("data:"))candidates.push(new URL(href,page.url).href)}catch{}}
 candidates.push(new URL("/favicon.ico",page.url).href);
 for(const url of [...new Set(candidates)].slice(0,6)){
  try{const image=await publicFetch(url,{signal,accept:"image/*",maxBytes:1024*1024});const normalized=await imageBytes(image.bytes,image.mime);const mark=await companyMark(normalized.bytes,page.url);const imageDataUrl=`data:${mark.mime};base64,${mark.bytes.toString("base64")}`;rasterImage(imageDataUrl);return{kind:"brand" as const,model:officialIconParserVersion,summary:"已从官网获取并缓存官方图标。",website,sourceUrl:page.url,imageUrl:image.url,imageDataUrl};}catch{if(signal.aborted)break}
 }
 throw Error("未找到可缓存的官方图标，交由 Muse 查找官方品牌素材或手动上传。");
}
