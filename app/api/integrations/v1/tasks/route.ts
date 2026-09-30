import {authenticateIntegration} from "@/lib/integrations";
import {enrichmentFeed,claimEnrichment,completeEnrichment,failEnrichment} from "@/lib/enrichment";
import {taskCommandSchema} from "@/lib/enrichment-contract";
import {boundedJson,integrationJson as json,integrationFailure} from "@/lib/integration-http";
export const dynamic="force-dynamic";
export async function GET(request:Request){try{await authenticateIntegration(request);const feed=await enrichmentFeed();return json({tasks:feed.tasks,rubric:feed.rubric,profile:feed.profile,instructions:"评估需分别覆盖岗位匹配、职业路径成长、Return Offer/转正、学术升学帮助、公司行业前景。Return Offer只能根据官方机制/数据或可核验往届去向评估；学术帮助需岗位研究内容等可靠依据。资料不足必须用 null，不可臆测。用 POST action=claim 领取任务，15 分钟内带 leaseToken 完成。图标上传官方来源的 PNG/JPEG/WebP/ICO，不能生成品牌标志。"})}catch(e){return integrationFailure(e)}}
export async function POST(request:Request){try{const actor=await authenticateIntegration(request);const parsed=taskCommandSchema.safeParse(await boundedJson(request,800000));if(!parsed.success)return json({error:parsed.error.issues[0].message,code:"invalid_request"},400);const p=parsed.data;return json(p.action==="claim"?await claimEnrichment(actor,p.kinds,p.limit):p.action==="complete"?await completeEnrichment(actor,p.taskId,p.leaseToken,p.result):await failEnrichment(actor,p.taskId,p.leaseToken,p.error))}catch(e){return integrationFailure(e)}}
