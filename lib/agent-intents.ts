import type { AiReply } from "./ai-contract";
import { prepareAgentActions, type AgentSnapshot } from "./agent-contract";

export function requestsCompanyLogoCompletion(text: string) {
  return /(?:图标|logo|徽标|标志)/i.test(text)
    && /(?:公司|企业|company|companies|mlabs|m-labs|oliver\s*wyman|goldman|摩根士丹利|高盛)/i.test(text)
    && /(?:补|填|更|修|完善|获取|找|换|刷新|重新|不对|还是|依旧|问题|错误|replace|refresh|wrong|still|issue)/i.test(text);
}

/** Route this explicit in-product task to the available company completion action. */
export function routeCompanyLogoCompletion(reply: AiReply, snapshot: AgentSnapshot, text: string): AiReply {
  const mentionedText=text.toLowerCase().replace(/[^a-z0-9\u3400-\u9fff]/g,"");
  const mentionsSavedCompany=[...snapshot.directory.companies.map(c=>c.name),...snapshot.entries.filter(e=>e.kind==="job").map(e=>e.organization)].some(name=>{
    const key=name.trim().toLowerCase().replace(/[^a-z0-9\u3400-\u9fff]/g,"");
    const aliases=name.match(/[a-z0-9]{4,}/gi)||[];
    return key.length>1&&(mentionedText.includes(key)||aliases.some(alias=>mentionedText.includes(alias.toLowerCase())));
  });
  const logoIntent=/(?:图标|logo|徽标|标志)/i.test(text)&&/(?:补|填|更|修|完善|获取|找|换|刷新|重新|不对|还是|依旧|问题|错误|替|每家|都|全部|replace|refresh|wrong|still|issue)/i.test(text);
  const companyCompletionIntent=/(?:公司|企业|company|companies)/i.test(text)&&/(?:补|填|更|修|完善|资料|信息|官网|图标|logo|徽标|标志|complete|enrich|update|fix|refresh)/i.test(text);
  const unresolvedNamedCompanies=mentionsSavedCompany&&/(?:没|未|不|无|失败|错误|问题|缺|漏|没有|还|仍|复现)/.test(text);
  if (!requestsCompanyLogoCompletion(text)&&!(mentionsSavedCompany&&(logoIntent||companyCompletionIntent||unresolvedNamedCompanies))) return reply;
  const companies=[...new Map([
    ...snapshot.directory.companies.map(c=>[c.name.trim().toLowerCase().replace(/[^a-z0-9\u3400-\u9fff]/g,""),c.name] as const),
    ...snapshot.entries.filter(e=>e.kind==="job"&&e.organization.trim()).map(e=>[e.organization.trim().toLowerCase().replace(/[^a-z0-9\u3400-\u9fff]/g,""),e.organization.trim()] as const),
  ]).values()];
  const normalized=text.toLowerCase().replace(/[^a-z0-9\u3400-\u9fff]/g,"");
  const names=companies.filter(name=>{
    const key=name.toLowerCase().replace(/[^a-z0-9\u3400-\u9fff]/g,"");
    if(key&&normalized.includes(key))return true;
    const aliases=name.match(/[a-z0-9]{4,}/gi)||[];
    if(aliases.some(alias=>normalized.includes(alias.toLowerCase())))return true;
    // Common short form for M-Labs; company records retain the official spelling.
    return key==="mlabs"&&normalized.includes("mlabs");
  });
  const action = prepareAgentActions([{ module: "companyCompletion", operation: "run", ...(names.length?{names}:{}), refreshLogo: /(?:图标|logo|徽标|标志)/i.test(text) }], snapshot);
  return {
    ...reply,
    reply: names.length?`我会检查并更新${names.join("、")}的公司资料${logoIntent?"和官方图标":""}，确认后开始。`:`我会检查公司目录，补全缺失的官网与官方图标；如果你要替换现有图标，请在请求中注明公司名称。确认后开始。`,
    actions: [...(reply.actions ?? []).filter(item => item.path !== "/api/companies/complete"), ...action],
  };
}
