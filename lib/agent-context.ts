import { agentCapabilities } from "./agent-capabilities";
import { recentRuns, scanOverview } from "./scanner";
import { completionState } from "./company-complete";
import { agentReadSchema, type AgentRead, type AgentSnapshot } from "./agent-contract";
import { listDeleted, listVersions } from "./entries";
import { listReminders } from "./reminders";
import { getDirectory } from "./directory-storage";
import { scanSettings } from "./scanner";
import { listNotifications } from "./notifications";
import { enrichmentFeed } from "./enrichment";
import { cachedBrief } from "./brief";
import { pool } from "./postgres";

export async function loadAgentSnapshot(base: Omit<AgentSnapshot, "deleted" | "directory" | "scanSettings">): Promise<AgentSnapshot> {
  const [deleted, directory, settings, versions] = await Promise.all([listDeleted(), getDirectory(), scanSettings(), listVersions(undefined, true)]);
  return { ...base, deleted, directory, scanSettings: settings, versions: versions as AgentSnapshot["versions"] };
}
/** Only explicit read operations. No HTTP forwarding, arbitrary SQL, credentials or writes. */
export async function readAgentData(raw: AgentRead, s: AgentSnapshot) {
  const r = agentReadSchema.parse(raw);
  let value: unknown;
  switch (r.module) {
    case "entries": value = s.entries; break;
    case "deleted": value = s.deleted; break;
    case "directory": value = [...s.directory.companies.map(c => ({ ...c, kind: "company" })), ...s.directory.channels.map(c => ({ ...c, kind: "channel" }))]; break;
    case "gigs": value = s.gigs; break;
    case "watches": value = s.watches; break;
    case "reminders": {
      const reminders = await listReminders(r.day);
      value = r.id ? {
        reminders: reminders.reminders.filter(item => item.id === r.id),
        today: reminders.today.filter(item => item.id === r.id),
      } : reminders;
      break;
    }
    case "profile": value = s.profile; break;
    case "settings": value = { ai: s.ai, scan: s.scanSettings }; break;
    case "notifications": value = await listNotifications(true, r.before ?? null); break;
    case "evaluations": value = await enrichmentFeed(r.id ? { kind: r.kind ?? "job", id: r.id } : undefined); break;
    case "versions": {
      if (!r.id) return { error: "读取历史版本需要岗位/项目/比赛 ID" };
      let versions = await listVersions(r.id, !!r.itemId) as { id: string; entry_id: string; created: string; data?: unknown }[];
      // Older agents sent the version ID in `id`; resolve that form without
      // allowing a version from another entry to be selected by accident.
      if (!versions.length && !r.itemId) {
        const metadata = await listVersions(undefined, false);
        const match = metadata.find(v => v.id === r.id);
        if (match) versions = await listVersions(match.entry_id, true) as { id: string; entry_id: string; created: string; data?: unknown }[];
        if (match) {
          const data = String(versions.find(v => v.id === match.id)?.data ?? ""), end = Math.min(data.length, r.offset + 40000);
          return { id: match.id, entry_id: match.entry_id, created: match.created, data: data.slice(r.offset, end), totalChars: data.length, nextOffset: end < data.length ? end : null };
        }
      }
      if (r.itemId) {
        const version = versions.find(v => v.id === r.itemId);
        if (!version) return { error: "历史版本不存在或不属于指定记录" };
        const data = String(version.data ?? ""), end = Math.min(data.length, r.offset + 40000);
        return { id: version.id, entry_id: version.entry_id, created: version.created, data: data.slice(r.offset, end), totalChars: data.length, nextOffset: end < data.length ? end : null };
      }
      value = versions;
      break;
    }
    case "files": value = (await pool.query("SELECT id,entry_id,name,type,size,created FROM files WHERE ($1::text IS NULL OR entry_id=$1) ORDER BY created DESC", [r.id ?? null])).rows; break;
    case "brief": value = await cachedBrief(); break;
    case "scan": value = { ...await scanOverview(), runs: await recentRuns() }; break;
    case "companyCompletion": value = await completionState(); break;
    case "capabilities": value = agentCapabilities; break;
  }
  if (Array.isArray(value)) {
    if (r.id && !["files", "versions"].includes(r.module)) value = value.find(v => v.id === r.id || v.name === r.id) ?? { error: "未找到目标" };
    else {
      const rows = r.query ? value.filter(v => JSON.stringify(v).toLowerCase().includes(r.query!.toLowerCase())) : value;
      // List reads return summaries; use id to fetch every field of a record.
      return { total: rows.length, nextOffset: r.offset + 20 < rows.length ? r.offset + 20 : null,
        items: rows.slice(r.offset, r.offset + 20).map(v => JSON.stringify(v).length > 6000 ? { id: v.id, name: v.name, title: v.title, organization: v.organization, status: v.status, archived: v.archived, revision: v.revision, detailRequired: true } : v) };
    }
  }
  const text = JSON.stringify(value);
  return text.length > 40000 ? { format: "json-text-chunk", text: text.slice(r.offset, r.offset + 40000), totalChars: text.length, nextOffset: r.offset + 40000 < text.length ? r.offset + 40000 : null } : value;
}
