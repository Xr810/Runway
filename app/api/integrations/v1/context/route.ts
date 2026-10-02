import {authenticateIntegration} from "@/lib/integrations";
import {integrationJson,integrationFailure} from "@/lib/integration-http";
import {evaluationProfile} from "@/lib/enrichment";
import {rubricFor} from "@/lib/enrichment-contract";
import {allWatches} from "@/lib/watch-storage";
import {getDirectory} from "@/lib/directory-storage";
import {jobStatuses,workModes,employmentTypes,schedules,companyTypes} from "@/lib/model";
export const dynamic="force-dynamic";
export async function GET(request:Request){try{const actor=await authenticateIntegration(request);const profile=await evaluationProfile();return integrationJson({version:1,client:actor,evaluationProfile:profile,evaluationRubric:rubricFor(profile.evaluationPreset,profile.evaluationWeights),taskEndpoint:"/api/integrations/v1/tasks",timeZone:"Asia/Singapore",watches:await allWatches(),directory:await getDirectory(),jobStatuses,fieldOptions:{workModes,employmentTypes,schedules,companyTypes},capabilities:["read_watches","read_jobs","create_job","update_job","upsert_appointment","notify","claim_enrichment_tasks","complete_assessment","cache_official_brand"],instructions:"只抓取 enabled=true 的关注公司。岗位 location 填实际工作城市或国家，不使用公司总部或企业性质。邮件匹配必须确认具体岗位；无法确认时用 notify。网站不运行爬虫，不读取邮箱。"});}catch(error){return integrationFailure(error)}}
