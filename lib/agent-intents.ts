import type { AiReply } from "./ai-contract";
import { prepareAgentActions, type AgentSnapshot } from "./agent-contract";

export function requestsCompanyLogoCompletion(text: string) {
  return /(?:图标|logo|徽标|标志)/i.test(text)
    && /(?:公司|企业|company|companies|mlabs|m-labs|oliver\s*wyman|goldman|摩根士丹利|高盛)/i.test(text)
    && /(?:补|填|更|修|完善|获取|找|换|刷新|重新|不对|还是|依旧|问题|错误|replace|refresh|wrong|still|issue)/i.test(text);
}

const normalizeCompany = (value: string) => value.trim().toLowerCase().replace(/[^a-z0-9\u3400-\u9fff]/g, "");
/** A distinctive leading word ("oliver" in "Oliver Wyman"); never a shared word like "research". */
const leadingToken = (value: string) => (value.match(/[a-z0-9]{3,}/gi)?.[0] ?? "").toLowerCase();
function mentionsCompany(name: string, normalizedText: string) {
  const key = normalizeCompany(name);
  if (key.length > 1 && normalizedText.includes(key)) return true;
  const lead = leadingToken(name);
  return lead.length >= 3 && normalizedText.includes(lead);
}
/** A request that explicitly asks to look only must never become a write proposal (#13). */
const readOnlyRequest = /(?<![不])(?:只|仅)\s*(?:查看|查询|看|读|了解|检查|核对)|(?:不要|别|不用|无需|请勿|勿)\s*(?:修改|更改|改动|改|写|保存|提交|动|编辑)|只读|read[- ]?only|do not (?:change|modify|edit|write)|don't (?:change|modify|edit|write)/i;

/** Route this explicit in-product task to the available company completion action. */
export function routeCompanyLogoCompletion(reply: AiReply, snapshot: AgentSnapshot, text: string): AiReply {
  if (readOnlyRequest.test(text)) return reply;
  const mentionedText = normalizeCompany(text);
  const companyNames = [...new Map(
    [...snapshot.directory.companies.map(c => c.name), ...snapshot.entries.filter(e => e.kind === "job").map(e => e.organization)]
      .filter(name => name.trim())
      .map(name => [normalizeCompany(name), name] as const),
  ).values()];
  const mentionsSavedCompany = companyNames.some(name => mentionsCompany(name, mentionedText));
  const logoIntent = /(?:图标|logo|徽标|标志)/i.test(text) && /(?:补|填|更|修|完善|获取|找|换|刷新|重新|不对|还是|依旧|问题|错误|替|每家|都|全部|replace|refresh|wrong|still|issue)/i.test(text);
  const companyCompletionIntent = /(?:公司|企业|company|companies)/i.test(text) && /(?:补|填|更|修|完善|资料|信息|官网|图标|logo|徽标|标志|complete|enrich|update|fix|refresh)/i.test(text);
  const unresolvedNamedCompanies = mentionsSavedCompany && /(?:没|未|不|无|失败|错误|问题|缺|漏|没有|还|仍|复现)/.test(text);
  if (!requestsCompanyLogoCompletion(text) && !(mentionsSavedCompany && (logoIntent || companyCompletionIntent || unresolvedNamedCompanies))) return reply;
  const names = companyNames.filter(name => mentionsCompany(name, mentionedText));
  const action = prepareAgentActions([{ module: "companyCompletion", operation: "run", ...(names.length ? { names } : {}), refreshLogo: /(?:图标|logo|徽标|标志)/i.test(text) }], snapshot);
  return {
    ...reply,
    reply: names.length ? `我会检查并更新${names.join("、")}的公司资料${logoIntent ? "和官方图标" : ""}，确认后开始。` : `我会检查公司目录，补全缺失的官网与官方图标；如果你要替换现有图标，请在请求中注明公司名称。确认后开始。`,
    actions: [...(reply.actions ?? []).filter(item => item.path !== "/api/companies/complete"), ...action],
  };
}
