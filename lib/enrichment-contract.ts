import {z} from "zod";

export const weightKeys=["fit","career","returnOffer","academic","outlook"] as const;
export type EvaluationWeights=Record<typeof weightKeys[number],number>;
export const weightPresets={
 balanced:{label:"均衡（默认）",weights:{fit:25,career:25,returnOffer:20,academic:15,outlook:15}},
 academic:{label:"偏学术 / 升学",weights:{fit:20,career:15,returnOffer:10,academic:40,outlook:15}},
 internship:{label:"偏实习成长",weights:{fit:20,career:40,returnOffer:20,academic:10,outlook:10}},
 returnOffer:{label:"偏 Return Offer",weights:{fit:20,career:20,returnOffer:40,academic:10,outlook:10}},
} satisfies Record<string,{label:string;weights:EvaluationWeights}>;
const weightsSchema=z.object({fit:z.number().min(0).max(100),career:z.number().min(0).max(100),returnOffer:z.number().min(0).max(100),academic:z.number().min(0).max(100),outlook:z.number().min(0).max(100)}).strict().refine(w=>Object.values(w).reduce((a,b)=>a+b,0)===100,"权重总和必须为 100%");
export const rubricFor=(preset:keyof typeof weightPresets|"custom"="balanced",weights?:EvaluationWeights)=>({version:"2026-09-student-v1",preset,weights:weights||weightPresets[preset as keyof typeof weightPresets].weights,scale:"0–10。0–2 明显不符，3–4 较弱，5–6 部分匹配，7–8 较好，9–10 有充分证据。信息不足用 null，不猜测。",dimensions:{fit:"个人背景与岗位要求匹配。",career:"实习内容与培养质量、导师及项目，以及对未来职业路径和技能积累的帮助。",returnOffer:"转正或 return offer 机制、官方披露数据或可核实的往届实习生去向；没有数据必须为 null，不推测概率。",academic:"研究型工作、导师/推荐信机会、可形成的研究成果，以及与目标硕博方向的关联；没有证据必须为 null。",outlook:"公司及行业前景，只作为背景参考。"}});
export const rubric=rubricFor();
export const cvSchema=z.object({id:z.string(),name:z.string().max(300),mime:z.string().max(200),size:z.number().int(),chars:z.number().int(),uploadedAt:z.string()}).strict();
export const profileSchema=z.object({revision:z.number().int().min(0).default(0),background:z.string().max(20000).default(""),goals:z.string().max(10000).default(""),preferences:z.string().max(10000).default(""),evaluationPreset:z.enum(["balanced","academic","internship","returnOffer","custom"]).default("balanced"),evaluationWeights:weightsSchema.default(weightPresets.balanced.weights),
 // Target fields such as "量化研究" or "数据分析"; used by evaluation, scanning and the assistant.
 targets:z.array(z.string().trim().min(1).max(60)).max(30).default([]),
 cv:cvSchema.nullable().default(null),cvText:z.string().max(60000).default("")}).strict();
type ParsedEvaluationProfile=z.infer<typeof profileSchema>;
export type EvaluationProfile=Omit<ParsedEvaluationProfile,"evaluationPreset"|"evaluationWeights"> & Partial<Pick<ParsedEvaluationProfile,"evaluationPreset"|"evaluationWeights">>;
export const targetSchema=z.object({kind:z.enum(["job","company","channel"]),id:z.string().min(1).max(2000)}).strict();
export type EnrichmentTarget=z.infer<typeof targetSchema>;
const web=z.string().max(4000).url().refine(v=>{const u=new URL(v);return u.protocol==="https:"&&!u.username&&!u.password},"来源须为 HTTPS 链接");
const reason=z.string().trim().min(1).max(4000);
const factor=z.object({score:z.number().min(0).max(10).nullable(),reason,confidence:z.enum(["high","medium","low"]),evidence:z.array(z.string().min(1).max(4000)).max(20)}).strict();
export const assessmentSchema=z.object({kind:z.literal("assessment"),model:z.string().trim().min(1).max(200),summary:reason,fit:factor,career:factor,returnOffer:factor.default({score:null,reason:"暂无 return offer 资料。",confidence:"low",evidence:[]}),academic:factor.default({score:null,reason:"暂无学术 / 升学相关资料。",confidence:"low",evidence:[]}),outlook:factor,hardConstraints:z.array(z.object({label:z.string().min(1).max(200),status:z.enum(["met","unmet","unknown"]),reason}).strict()).max(30),missing:z.array(z.string().min(1).max(1000)).max(30),sources:z.array(z.object({title:z.string().min(1).max(500),url:web,checkedAt:z.string().datetime({offset:true})}).strict()).max(30)}).strict();
type ParsedAssessment=z.infer<typeof assessmentSchema>;
export type Assessment=Omit<ParsedAssessment,"returnOffer"|"academic"> & Partial<Pick<ParsedAssessment,"returnOffer"|"academic">>;
export const brandSchema=z.object({kind:z.literal("brand"),model:z.string().min(1).max(200),summary:reason,website:web,sourceUrl:web,imageUrl:web,imageDataUrl:z.string().max(710000)}).strict();
export const resultSchema=z.discriminatedUnion("kind",[assessmentSchema,brandSchema]);
export const taskCommandSchema=z.discriminatedUnion("action",[
 z.object({action:z.literal("claim"),kinds:z.array(z.enum(["job","company","channel"])).min(1).max(3).default(["job","company","channel"]),limit:z.number().int().min(1).max(10).default(1)}).strict(),
 z.object({action:z.literal("complete"),taskId:z.string().uuid(),leaseToken:z.string().uuid(),result:resultSchema}).strict(),
 z.object({action:z.literal("fail"),taskId:z.string().uuid(),leaseToken:z.string().uuid(),error:z.string().min(1).max(2000)}).strict(),
]);
export function rasterImage(value:string){
 const m=/^data:image\/(png|jpeg|webp|x-icon);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
 if(!m||m[2].length%4)throw Error("图标须为 PNG、JPEG、WebP 或 ICO");
 const bytes=Buffer.from(m[2],"base64");if(bytes.length<12||bytes.length>512*1024)throw Error("图标大小需为 12 字节至 512 KB");
 const valid=m[1]==="png"?bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):m[1]==="jpeg"?bytes[0]===255&&bytes[1]===216&&bytes[2]===255:m[1]==="webp"?bytes.toString("ascii",0,4)==="RIFF"&&bytes.toString("ascii",8,12)==="WEBP":bytes.readUInt32LE(0)===65536&&bytes.readUInt16LE(4)>0;
 if(!valid)throw Error("图片内容与类型不符");return {mime:"image/"+m[1],bytes};
}
