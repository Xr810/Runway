import { agentCapabilities } from "./agent-capabilities";
import { recentRuns, scanOverview } from "./scanner";
import { completionState } from "./company-complete";
import { agentReadSchema, type AgentRead, type AgentSnapshot } from "./agent-contract";
import { getVersion, listDeleted, listVersions } from "./entries";
import { getDirectory } from "./directory-storage";
import { scanSettings } from "./scanner";
import { listNotifications } from "./notifications";
import { enrichmentFeed } from "./enrichment";
import { cachedBrief } from "./brief";
import { pool } from "./postgres";
import { today } from "./model";
import { aiReplySchema } from "./ai-contract";
import { getReminderPreferences } from "./reminder-preferences";
import { timelineEvents } from "./journey";

export async function loadAgentSnapshot(
  base: Omit<AgentSnapshot, "deleted" | "directory" | "scanSettings">,
): Promise<AgentSnapshot> {
  const [deleted, directory, settings] = await Promise.all([
    listDeleted(),
    getDirectory(),
    scanSettings(),
  ]);
  return { ...base, deleted, directory, scanSettings: settings };
}

/** Load only explicitly requested restore bodies, not the entire account's history. */
export async function loadProposalVersions(raw: unknown, snapshot: AgentSnapshot) {
  const reply = aiReplySchema.parse(raw);
  const ids = [
    ...new Set(
      reply.actions.filter((action) => action.module === "version").map((action) => action.itemId),
    ),
  ];
  if (!ids.length) return;
  const versions = await Promise.all(ids.map((id) => getVersion(id)));
  snapshot.versions = versions.filter((version) => version !== null);
}
/** Only explicit read operations. No HTTP forwarding, arbitrary SQL, credentials or writes. */
export async function readAgentData(raw: AgentRead, s: AgentSnapshot) {
  const r = agentReadSchema.parse(raw);
  let value: unknown;
  switch (r.module) {
    case "entries": {
      const preferences = await getReminderPreferences();
      value = s.entries.map((entry) => ({
        ...entry,
        derivedSchedule: timelineEvents([entry], preferences).map(
          ({ id, date, time, label, type, detail }) => ({ id, date, time, label, type, detail }),
        ),
      }));
      break;
    }
    case "deleted":
      value = s.deleted;
      break;
    case "directory":
      value = [
        ...s.directory.companies.map((c) => ({ ...c, kind: "company" })),
        ...s.directory.channels.map((c) => ({ ...c, kind: "channel" })),
      ];
      break;
    case "gigs":
      value = s.gigs;
      break;
    case "watches":
      value = s.watches;
      break;
    case "reminders": {
      // Carry the completion state for the requested day (default today) so the agent
      // never reports a finished reminder as pending (#16).
      const day = r.day ?? today();
      const rows = await pool.query<{ reminder_id: string }>(
        "SELECT reminder_id FROM reminder_done WHERE day=$1::date",
        [day],
      );
      const done = new Set(rows.rows.map((row) => row.reminder_id));
      value = s.reminders.map((reminder) => ({ ...reminder, day, done: done.has(reminder.id) }));
      break;
    }
    case "profile":
      value = s.profile;
      break;
    case "settings":
      value = { ai: s.ai, scan: s.scanSettings, recruiting: await getReminderPreferences() };
      break;
    case "notifications":
      value = await listNotifications(true, r.before ?? null);
      break;
    case "evaluations":
      value = await enrichmentFeed(r.id ? { kind: r.kind ?? "job", id: r.id } : undefined);
      break;
    case "versions": {
      if (!r.id) return { error: "读取历史版本需要岗位/项目/比赛 ID" };
      // A version ID returns that snapshot's full body, paged by offset; an entry ID
      // lists its versions. A wrong ID matches nothing and never reads another record (#17).
      value = (await getVersion(r.id)) ?? (await listVersions(r.id));
      break;
    }
    case "files":
      value = (
        await pool.query(
          "SELECT id,entry_id,name,type,size,created FROM files WHERE ($1::text IS NULL OR entry_id=$1) ORDER BY created DESC",
          [r.id ?? null],
        )
      ).rows;
      break;
    case "brief":
      value = await cachedBrief();
      break;
    case "scan":
      value = { ...(await scanOverview()), runs: await recentRuns() };
      break;
    case "companyCompletion":
      value = await completionState();
      break;
    case "capabilities":
      value = agentCapabilities;
      break;
  }
  if (Array.isArray(value)) {
    if (r.id && !["files", "versions"].includes(r.module))
      value = value.find((v) => v.id === r.id || v.name === r.id) ?? { error: "未找到目标" };
    else {
      const rows = r.query
        ? value.filter((v) => JSON.stringify(v).toLowerCase().includes(r.query!.toLowerCase()))
        : value;
      // List reads return summaries; use id to fetch every field of a record.
      return {
        total: rows.length,
        nextOffset: r.offset + 20 < rows.length ? r.offset + 20 : null,
        items: rows.slice(r.offset, r.offset + 20).map((v) =>
          JSON.stringify(v).length > 6000
            ? {
                id: v.id,
                name: v.name,
                title: v.title,
                organization: v.organization,
                status: v.status,
                archived: v.archived,
                revision: v.revision,
                entry_id: v.entry_id,
                created: v.created,
                detailRequired: true,
              }
            : v,
        ),
      };
    }
  }
  const text = JSON.stringify(value);
  return text.length > 40000
    ? {
        format: "json-text-chunk",
        text: text.slice(r.offset, r.offset + 40000),
        totalChars: text.length,
        nextOffset: r.offset + 40000 < text.length ? r.offset + 40000 : null,
      }
    : value;
}
