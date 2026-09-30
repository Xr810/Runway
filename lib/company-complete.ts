import { z } from "zod";
import { pool } from "./postgres";
import { companyTypes, type Entry } from "./model";
import { identity, directorySchema } from "./journey";
import { getDirectory, saveDirectory } from "./directory-storage";
import { listEntries, patchEntry, EntryError } from "./entries";
import { allWatches } from "./watch-storage";
import { aiJson } from "./ai-client";
import { publicFetch } from "./web";
import { claimEnrichment, completeEnrichment, enrichmentFeed, failEnrichment, localActor, queueEnrichment, syncEnrichment } from "./enrichment";
import { officialIconParserVersion, scanOfficialLogo } from "./brand-scan";
import { notify } from "./notifications";

// Hosts that belong to job boards and applicant-tracking systems, never to the employer itself.
const recruitingHosts = /(greenhouse\.io|lever\.co|ashbyhq\.com|myworkdayjobs\.com|workday\.com|smartrecruiters\.com|tal\.net|oraclecloud\.com|successfactors|icims\.com|taleo\.net|jobvite\.com|linkedin\.com|indeed\.|jobsdb\.|glassdoor\.|bamboohr\.com|workable\.com|recruitee\.com|teamtailor\.com|mokahr\.com|hotjob\.cn|zhiye\.com|liepin\.com|zhipin\.com|51job\.com|feishu\.cn|lagou\.com|nowcoder\.com|avature\.net|brassring\.com|eightfold\.ai|phenom|hirevue\.com|google\.com)/i;
const stateKey = "company-completion-v1";
type Attempt = { at: string; website?: string; note: string; failed?: boolean };

async function attempts(): Promise<Record<string, Attempt>> { const row = (await pool.query("SELECT value FROM meta WHERE key=$1", [stateKey])).rows[0]; return row ? JSON.parse(row.value) : {}; }
async function remember(id: string, attempt: Attempt) {
  await pool.query("INSERT INTO meta(key,value) VALUES($1,$2::jsonb::text) ON CONFLICT(key) DO UPDATE SET value=(meta.value::jsonb || $2::jsonb)::text", [stateKey, JSON.stringify({ [id]: attempt })]);
}
/** A homepage counts only if it answers with HTML. */
async function reachable(url: string) { try { const page = await publicFetch(url, { signal: AbortSignal.timeout(15000), maxBytes: 3 * 1024 * 1024 }); return page.mime.includes("html") ? page.url : null; } catch { return null; } }

async function findWebsite(name: string, jobs: Entry[], signal: AbortSignal) {
  for (const job of jobs) for (const link of [job.applicationUrl, job.url, job.companySource]) {
    if (!link) continue;
    try { const host = new URL(link).hostname; if (!recruitingHosts.test(host)) { const home = await reachable(`https://${host.replace(/^(careers?|jobs|apply|recruit(ing)?|talent|hr)\./, "")}/`); if (home) return { website: new URL(home).origin, note: "来自岗位链接的域名" }; } } catch { /* try the next link */ }
  }
  const guess = await aiJson("company-website", "给出公司的官方网站首页（公司主页，不是招聘平台或第三方页面）。不确定就返回 null，不要猜。", `公司名称：${name}\n相关岗位：${jobs.slice(0, 3).map(j => `${j.title}（${j.location}）${j.url}`).join("；") || "无"}\n输出 {"website":"https://…" 或 null}`,
    z.object({ website: z.string().url().nullable() }), { signal, maxTokens: 300 });
  if (!guess.website || recruitingHosts.test(new URL(guess.website).hostname)) return null;
  const home = await reachable(guess.website);
  return home ? { website: new URL(home).origin, note: "AI 推断，已确认网站可访问" } : null;
}
const typeSchema = z.object({ companyType: z.string(), basis: z.string().max(400), confidence: z.enum(["high", "medium", "low"]) });
async function classify(name: string, website: string, signal: AbortSignal) {
  const result = await aiJson("company-type", `按集团背景给公司归类，只能是 ${JSON.stringify(companyTypes.filter(t => t !== "待核实"))} 之一。依据写一句中文（总部所在地、所属集团）。不确定时 confidence=low。`,
    `公司：${name}\n官网：${website || "未知"}\n输出 {"companyType","basis","confidence"}`, typeSchema, { signal, maxTokens: 300 });
  return companyTypes.includes(result.companyType) && result.companyType !== "待核实" && result.confidence !== "low" ? result : null;
}

let running: Promise<{ updated: number }> | null = null;
let run: { id: string; status: "running" | "completed" | "failed"; error?: string; updated?: number } | null = null;
export const completionRunning = () => !!running;
/**
 * Fills in missing company details: official website, icon, and the company type of jobs still
 * marked 待核实. Each company is tried at most once a week unless `force` is set.
 */
export function completeCompanies(options: { names?: string[]; force?: boolean; refreshLogo?: boolean; limit?: number } = {}) {
  if (running) return running;
  run = { id: crypto.randomUUID(), status: "running" };
  running = (async () => {
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
      try {
        let saved = directory.companies.find(c => identity(c.name) === id), website = saved?.website ?? "";
        if (!website) {
          const found = await findWebsite(name, companyJobs, signal);
          if (found) {
            for (let attempt = 0; attempt < 3; attempt++) {
              try { directory = directorySchema.parse(await saveDirectory({ ...directory, companies: [...directory.companies.filter(c => identity(c.name) !== id), { name: saved?.name ?? name, website: found.website, logoUrl: saved?.logoUrl ?? "" }] })); break; }
              catch { directory = await getDirectory(); saved = directory.companies.find(c => identity(c.name) === id); }
            }
            website = found.website; notes.push(`官网 ${found.website}（${found.note}）`);
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
        if (!website) throw Error("没有找到可确认的官网，无法完成公司资料补全。");
        const unverified = companyJobs.filter(j => j.companyType === "待核实");
        if (unverified.length) {
          const type = await classify(name, website, signal);
          if (type) {
            for (const job of unverified) { try { await patchEntry(job.id, job.revision, { companyType: type.companyType, companyBasis: "AI 推断（未人工核实）：" + type.basis, companySource: job.companySource || website }); } catch (e) { if (!(e instanceof EntryError)) throw e; } }
            notes.push(`公司类型：${type.companyType}`);
          }
        }
        if (notes.some(n => /^官网|^已缓存|^公司类型/.test(n))) done.push(`${name}：${notes.join("；")}`);
        await remember(id, { at: new Date().toISOString(), website, note: notes.join("；") });
      } catch (e) { failed++; await remember(id, { at: new Date().toISOString(), failed: true, note: "失败：" + (e as Error).message }); }
    }
        if(options.names){
          const failedNames=new Set(Object.entries(await attempts()).filter(([id,a])=>options.names!.some(name=>identity(name)===id)&&a.failed).map(([id])=>id));
          const incomplete=options.names.filter(name=>{const id=identity(name),saved=directory.companies.find(c=>identity(c.name)===id),brand=feed.states.find(s=>s.kind==="company"&&s.target_id===id&&s.result?.kind==="brand")?.result;const logoCurrent=brand?.kind==="brand"&&brand.model===officialIconParserVersion;return failedNames.has(id)||!saved?.website||(!saved.logoUrl&&!logoCurrent)});
          if(incomplete.length)throw Error(`以下公司仍未补全官网或官方图标：${incomplete.join("、")}。请查看公司资料补全记录中的失败原因后重试。`);
        }
    if (done.length) { await syncEnrichment(); await notify({ actor: "Runway AI", action: "company", summary: `补全了 ${done.length} 家公司的资料`, title: "公司资料补全", changes: [{ field: "companies", before: null, after: done.join("\n") }] }); }
    if (failed) throw Error(`${failed} 家公司的资料补全失败，将稍后重试`);
    return { updated: done.length };
  })().then(result => { if (run) run = { ...run, status: "completed", updated: result.updated }; return result; }, error => { if (run) run = { ...run, status: "failed", error: (error as Error).message }; throw error; }).finally(() => { running = null; });
  return running;
}
export async function completionState() { return { running: completionRunning(), run, attempts: await attempts() }; }
