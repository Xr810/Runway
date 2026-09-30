import type { AiReply } from "./ai-contract";
import { prepareAgentActions, type AgentSnapshot } from "./agent-contract";

export function requestsCompanyLogoCompletion(text: string) {
  return /(?:图标|logo|徽标|标志)/i.test(text)
    && /(?:公司|企业|company|companies|mlabs|m-labs|oliver\s*wyman|goldman|摩根士丹利|高盛)/i.test(text)
    && /(?:补|填|更|修|完善|获取|找|换|刷新|重新|不对|还是|依旧|问题|错误|replace|refresh|wrong|still|issue)/i.test(text);
}

function isReadOnlyCompanyRequest(text: string) {
  return /(?:只(?:想)?(?:查看|看|查询|了解)|仅(?:查看|查询)|不要修改|无需修改|只读|read\s*only|just\s*(?:check|view|look)|don't\s*(?:change|update)|do\s*not\s*(?:change|update))/i.test(text);
}

function companyNames(snapshot: AgentSnapshot) {
  return [...new Map([
    ...snapshot.directory.companies.map(c => [c.name.trim().toLowerCase().replace(/[^a-z0-9\u3400-\u9fff]/g, ""), c.name.trim()] as const),
    ...snapshot.entries.filter(e => e.kind === "job" && e.organization.trim()).map(e => [e.organization.trim().toLowerCase().replace(/[^a-z0-9\u3400-\u9fff]/g, ""), e.organization.trim()] as const),
  ]).values()];
}

function namedCompanies(text: string, snapshot: AgentSnapshot) {
  const normalized = text.toLowerCase().replace(/[^a-z0-9\u3400-\u9fff]/g, "");
  const companies = companyNames(snapshot);
  const aliases = new Map<string, number>();
  for (const name of companies) for (const alias of name.match(/[a-z0-9]{4,}/gi) ?? []) {
    const key = alias.toLowerCase(); aliases.set(key, (aliases.get(key) ?? 0) + 1);
  }
  return companies.filter(name => {
    const key = name.toLowerCase().replace(/[^a-z0-9\u3400-\u9fff]/g, "");
    if (key.length > 1 && normalized.includes(key)) return true;
    return (name.match(/[a-z0-9]{4,}/gi) ?? []).some(alias => aliases.get(alias.toLowerCase()) === 1 && normalized.includes(alias.toLowerCase()));
  });
}

/** Route this explicit in-product task to the available company completion action. */
export function routeCompanyLogoCompletion(reply: AiReply, snapshot: AgentSnapshot, text: string): AiReply {
  if (isReadOnlyCompanyRequest(text)) return reply;
  const mentionsSavedCompany = namedCompanies(text, snapshot).length > 0;
  const logoIntent=/(?:图标|logo|徽标|标志)/i.test(text)&&/(?:补|填|更|修|完善|获取|找|换|刷新|重新|不对|还是|依旧|问题|错误|替|每家|都|全部|replace|refresh|wrong|still|issue)/i.test(text);
  const companyCompletionIntent=/(?:公司|企业|company|companies)/i.test(text)&&/(?:补|填|更|修|完善|资料|信息|官网|图标|logo|徽标|标志|complete|enrich|update|fix|refresh)/i.test(text);
  const unresolvedNamedCompanies=mentionsSavedCompany&&/(?:没|未|不|无|失败|错误|问题|缺|漏|没有|还|仍|复现)/.test(text);
  if (!requestsCompanyLogoCompletion(text)&&!(mentionsSavedCompany&&(logoIntent||companyCompletionIntent||unresolvedNamedCompanies))) return reply;
  const names = namedCompanies(text, snapshot);
  const action = prepareAgentActions([{ module: "companyCompletion", operation: "run", ...(names.length?{names}:{}), refreshLogo: /(?:图标|logo|徽标|标志)/i.test(text) }], snapshot);
  return {
    ...reply,
    reply: names.length?`我会检查并更新${names.join("、")}的公司资料${logoIntent?"和官方图标":""}，确认后开始。`:`我会检查公司目录，补全缺失的官网与官方图标；如果你要替换现有图标，请在请求中注明公司名称。确认后开始。`,
    actions: [...(reply.actions ?? []).filter(item => item.path !== "/api/companies/complete"), ...action],
  };
}
