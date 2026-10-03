import { z } from "zod";
import { currentUserId, pool, runAsUser } from "./postgres";
import { companyTypes, type Entry } from "./model";
import { identity, directorySchema } from "./journey";
import { getDirectory, saveDirectory } from "./directory-storage";
import { listEntries, patchEntry, EntryError } from "./entries";
import { allWatches } from "./watch-storage";
import { aiJson } from "./ai-client";
import { readPage, type ReadablePage } from "./web";
import { getAiConfig } from "./ai-config";
import { searchTavily } from "./tavily";
import { claimEnrichment, completeEnrichment, enrichmentFeed, failEnrichment, localActor, queueEnrichment, syncEnrichment } from "./enrichment";
import { officialIconParserVersion, scanOfficialLogo } from "./brand-scan";
import { notify } from "./notifications";

// Hosts that belong to job boards and applicant-tracking systems, never to the employer itself.
const recruitingHosts = /(greenhouse\.io|lever\.co|ashbyhq\.com|myworkdayjobs\.com|workday\.com|smartrecruiters\.com|tal\.net|oraclecloud\.com|successfactors|icims\.com|taleo\.net|jobvite\.com|linkedin\.com|indeed\.|jobsdb\.|glassdoor\.|bamboohr\.com|workable\.com|recruitee\.com|teamtailor\.com|mokahr\.com|hotjob\.cn|zhiye\.com|liepin\.com|zhipin\.com|51job\.com|feishu\.cn|lagou\.com|nowcoder\.com|avature\.net|brassring\.com|eightfold\.ai|phenom|hirevue\.com|google\.com)/i;
const stateKey = "company-completion-v1";
type Attempt = { at: string; website?: string; evidenceUrl?: string; evidenceReason?: string; note: string; failed?: boolean };

async function attempts(): Promise<Record<string, Attempt>> { const row = (await pool.query("SELECT value FROM meta WHERE key=$1", [stateKey])).rows[0]; return row ? JSON.parse(row.value) : {}; }
async function remember(id: string, attempt: Attempt) {
  const userId = await currentUserId();
  await pool.query("INSERT INTO meta(user_id,key,value) VALUES($1,$2,$3::jsonb::text) ON CONFLICT(user_id,key) DO UPDATE SET value=(meta.value::jsonb || $3::jsonb)::text", [userId, stateKey, JSON.stringify({ [id]: attempt })]);
}
function officialIdentity(page: ReadablePage, name: string) {
  const normalized = name.toLocaleLowerCase().replace(/[^a-z0-9\p{L}]/gu, "");
  if (!normalized) return null;
  const compact = (value: string) => value.toLocaleLowerCase().replace(/[^a-z0-9\p{L}]/gu, "");
  // Third-party job boards also publish JobPosting.organization. Neither that nor
  // an article title mentioning the employer establishes site ownership.
  if (recruitingHosts.test(new URL(page.url).hostname)) return null;
  if (!page.title.split(/[|｜–—:：]/).some(part => compact(part) === normalized)) return null;
  const origin = new URL(page.url).origin;
  const firstPartyNavigation = page.links.some(link => {
    try { return new URL(link.url).origin === origin && compact(link.text).includes(normalized) && /about|careers?|contact|关于|招聘|联系/i.test(link.text); }
    catch { return false; }
  });
  const ownershipText = new RegExp(`(?:©|copyright)[^\\n]{0,80}${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}|${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[^\\n]{0,50}(?:official (?:site|website)|官网)`, "i").test(page.text);
  return firstPartyNavigation || ownershipText ? `页面标题标明 ${name}，并有同站公司导航或官方版权标识` : null;
}

export async function findWebsite(name: string, jobs: Entry[], signal: AbortSignal) {
  const verify = async (link: string) => {
    if (recruitingHosts.test(new URL(link).hostname)) return null;
    const page = await readPage(link, signal), reason = officialIdentity(page, name);
    if (!reason) return null;
    const website = new URL(page.url).origin;
    // A directory can dedicate an entire page and navigation to one employer.
    // The site's own homepage must identify the same company as well.
    const home = new URL(page.url).pathname === "/" ? page : await readPage(website, signal);
    if (new URL(home.url).origin !== website || !officialIdentity(home, name)) return null;
    return { website, evidenceUrl: page.url, reason: `${reason}；站点首页亦确认同一公司身份` };
  };
  for (const job of jobs) for (const link of [job.applicationUrl, job.url, job.companySource]) {
    if (!link) continue;
    try { const found = await verify(link); if (found) return found; } catch { /* try the next link */ }
  }
  const key = (await getAiConfig()).tavilyKey;
  if (!key) return null;
  const results = await searchTavily(`${name} official website company`, key, signal).catch(() => []);
  for (const result of results) {
    try {
      const found = await verify(result.url); if (found) return found;
    } catch { /* an unreadable search result is not evidence */ }
  }
  return null;
}
const typeSchema = z.object({ companyType: z.string(), basis: z.string().max(400), confidence: z.enum(["high", "medium", "low"]) });
async function classify(name: string, website: string, signal: AbortSignal) {
  if (!website) return null;
  let page: ReadablePage; try { page = await readPage(website, signal); } catch { return null; }
  const result = await aiJson("company-type", `只根据提供的官网页面事实按集团背景归类，只能是 ${JSON.stringify(companyTypes.filter(t => t !== "待核实"))} 之一。用简洁中文说明页面中的明确依据；不知道就 confidence=low，严禁用常识猜测。`,
    `公司：${name}\n官网：${page.url}\n页面标题：${page.title}\n页面正文：${page.text.slice(0, 10000)}\n输出 {"companyType","basis","confidence"}`, typeSchema, { signal, maxTokens: 300 });
  return companyTypes.includes(result.companyType) && result.companyType !== "待核实" && result.confidence !== "low" ? result : null;
}

type Run = { id: string; status: "running" | "completed" | "no_updates" | "failed"; error?: string; updated?: number };
const running = new Map<string, Promise<{ updated: number }>>(), runs = new Map<string, Run>();
export const completionRunning = async () => running.has(await currentUserId());
/**
 * Fills in missing company details: official website, icon, and the company type of jobs still
 * marked 待核实. Each company is tried at most once a week unless `force` is set.
 */
export async function completeCompanies(options: { names?: string[]; force?: boolean; refreshLogo?: boolean; limit?: number } = {}) {
  const userId = await currentUserId(), active = running.get(userId);
  if (active) return active;
  runs.set(userId, { id: crypto.randomUUID(), status: "running" });
  const promise = runAsUser(userId, async () => {
    const signal = AbortSignal.timeout(10 * 60 * 1000);
    const [entries, watches, tried] = await Promise.all([listEntries(), allWatches(), attempts()]);
    let feed=await enrichmentFeed();
    let directory = await getDirectory();
    const jobs = entries.filter(e => e.kind === "job"), names = new Map<string, string>();
    for (const n of [...jobs.map(e => e.organization), ...directory.companies.map(c => c.name), ...watches.filter(w => w.kind === "company").map(w => w.company)]) if (n.trim()) names.set(identity(n), n.trim());
    if (options.names?.some(n => !names.has(identity(n)))) throw Error("未找到指定公司，请使用公司目录里的名称。");
    const logo = (id: string) => feed.states.find(s => s.kind === "company" && s.target_id === id && s.result);
    const obsoleteLogo = (id:string) => { const result=logo(id)?.result; return result?.kind==="brand"&&result.model!==officialIconParserVersion; };
    const done: string[] = []; let failed = 0;
    const retryDue = (attempt: Attempt | undefined) => !attempt || Date.parse(attempt.at) <= Date.now() - (attempt.failed || attempt.note.startsWith("失败：") ? 15 * 60 * 1000 : 7 * 86400000);
    const targets = [...names].filter(([id, name]) => (!options.names || options.names.some(n => identity(n) === id)) && (options.force || retryDue(tried[id]) || obsoleteLogo(id)) && (() => {
      const saved = directory.companies.find(c => identity(c.name) === id);
      if (options.refreshLogo) return true;
      const automaticLogo=logo(id)?.result;
      return !saved?.website || !saved.logoUrl && !automaticLogo || obsoleteLogo(id) || jobs.some(j => identity(j.organization) === id && j.companyType === "待核实");
    })() && name).slice(0, options.limit ?? 8);
    for (const [id, name] of targets) {
      const notes: string[] = [], companyJobs = jobs.filter(j => identity(j.organization) === id);
      let evidence: { website: string; evidenceUrl: string; evidenceReason: string } | undefined;
      try {
        let saved = directory.companies.find(c => identity(c.name) === id), website = saved?.website ?? "";
        if (!website) {
          const found = await findWebsite(name, companyJobs, signal);
          if (found) {
            for (let attempt = 0; attempt < 3; attempt++) {
              try { directory = directorySchema.parse(await saveDirectory({ ...directory, companies: [...directory.companies.filter(c => identity(c.name) !== id), { name: saved?.name ?? name, website: found.website, logoUrl: saved?.logoUrl ?? "" }] })); break; }
              catch {
                directory = await getDirectory(); saved = directory.companies.find(c => identity(c.name) === id);
                // A concurrent/manual edit is authoritative; never replace it with discovery.
                if (saved?.website) break;
              }
            }
            website = saved?.website || found.website;
            if (!saved?.website) evidence = { website: found.website, evidenceUrl: found.evidenceUrl, evidenceReason: found.reason };
            notes.push(saved?.website ? `保留手动官网 ${saved.website}` : `官网 ${found.website}（依据：${found.reason}；证据：${found.evidenceUrl}）`);
          } else notes.push("没有找到可确认的官网");
        }
        const currentLogo=logo(id)?.result;
        const obsoleteAutomaticLogo=currentLogo?.kind==="brand"&&currentLogo.model!==officialIconParserVersion;
        if (website && (options.refreshLogo || obsoleteAutomaticLogo || !saved?.logoUrl && !currentLogo)) {
          await syncEnrichment();
          const queued = await queueEnrichment("brand", { kind: "company", id }, !!options.refreshLogo||obsoleteAutomaticLogo);
          if (options.refreshLogo && saved?.logoUrl && queued.skipped) throw Error("当前图标是手动设置的，请先在公司资料中清空图标地址后重试。");
          if (queued.skipped && options.refreshLogo) throw Error("图标已锁定，请先解除锁定再重新获取。");
          const taskId = (await pool.query("SELECT id FROM enrichment_tasks WHERE kind='company' AND target_id=$1 AND status='pending' ORDER BY created DESC LIMIT 1", [id])).rows[0]?.id;
          if (!taskId) throw Error("图标任务正在由其他任务处理，请稍后重试。");
          const { tasks } = await claimEnrichment(localActor, ["company"], 1, taskId);
          if (!tasks[0]) throw Error("图标任务未能领取，请稍后重试。");
          try { await completeEnrichment(localActor, tasks[0].id, tasks[0].leaseToken, await scanOfficialLogo(tasks[0].payload.website || website)); notes.push("已缓存官方图标"); }
          catch (e) { await failEnrichment(localActor, tasks[0].id, tasks[0].leaseToken, (e as Error).message); throw e; }
          feed=await enrichmentFeed();
        }
        if (options.refreshLogo && !website) throw Error("没有找到可确认的官网，无法更新图标。");
        const unverified = companyJobs.filter(j => j.companyType === "待核实");
        if (unverified.length) {
          const type = await classify(name, website, signal);
          if (type) {
            for (const job of unverified) { try { await patchEntry(job.id, job.revision, { companyType: type.companyType, companyBasis: "AI 推断（未人工核实）：" + type.basis, companySource: job.companySource || website }); } catch (e) { if (!(e instanceof EntryError)) throw e; } }
            notes.push(`公司类型：${type.companyType}`);
          }
        }
        const profile = directory.companies.find(company => identity(company.name) === id);
        const missing = [!website && "官网", !profile?.logoUrl && !logo(id)?.result && "官方图标",
          (await listEntries()).some(job => job.kind === "job" && identity(job.organization) === id && job.companyType === "待核实") && "公司类型依据"].filter(Boolean);
        if (missing.length) throw Error(`仍待核实：${missing.join("、")}。${notes.join("；")}`);
        if (notes.some(n => /^官网|^已缓存|^公司类型/.test(n))) done.push(`${name}：${notes.join("；")}`);
        await remember(id, { ...tried[id], ...evidence, at: new Date().toISOString(), website, failed: undefined, note: notes.join("；") });
      } catch (e) { failed++; await remember(id, { ...tried[id], ...evidence, at: new Date().toISOString(), failed: true, note: "失败：" + (e as Error).message }); }
    }
        if(options.names){
          const failedNames=new Set(Object.entries(await attempts()).filter(([id,a])=>options.names!.some(name=>identity(name)===id)&&a.failed).map(([id])=>id));
          const incomplete=options.names.filter(name=>{const id=identity(name),saved=directory.companies.find(c=>identity(c.name)===id),brand=feed.states.find(s=>s.kind==="company"&&s.target_id===id&&s.result?.kind==="brand")?.result;const logoCurrent=brand?.kind==="brand"&&brand.model===officialIconParserVersion;return failedNames.has(id)||!saved?.website||(!saved.logoUrl&&!logoCurrent)});
          if(incomplete.length)throw Error(`以下公司仍未补全官网或官方图标：${incomplete.join("、")}。请查看公司资料补全记录中的失败原因后重试。`);
        }
    if (done.length) { await syncEnrichment(); await notify({ actor: "Runway AI", action: "company", summary: `补全了 ${done.length} 家公司的资料`, title: "公司资料补全", changes: [{ field: "companies", before: null, after: done.join("\n") }] }); }
    if (failed) throw Error(`${failed} 家公司的资料补全失败${done.length ? `，已补全 ${done.length} 家` : ""}，将稍后重试`);
    return { updated: done.length };
  }).then(result => { const run = runs.get(userId); if (run) runs.set(userId, { ...run, status: result.updated ? "completed" : "no_updates", updated: result.updated }); return result; }, error => { const run = runs.get(userId); if (run) runs.set(userId, { ...run, status: "failed", error: (error as Error).message }); throw error; }).finally(() => { running.delete(userId); });
  running.set(userId, promise);
  return promise;
}
export async function completionState() { const userId = await currentUserId(); return { running: running.has(userId), run: runs.get(userId) ?? null, attempts: await attempts() }; }
