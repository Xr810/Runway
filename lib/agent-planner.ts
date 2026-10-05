import type { z } from "zod";
import type { aiRequestSchema } from "./ai-contract";
import { askAi, readLinks, readWebSearch } from "./ai-provider";
import { getAiConfig } from "./ai-config";
import { listEntries } from "./entries";
import { listReminders } from "./reminders";
import { listGigs } from "./part-time";
import { allWatches } from "./watch-storage";
import { evaluationProfile } from "./enrichment";
import { loadAgentSnapshot, loadProposalVersions, readAgentData } from "./agent-context";
import { centralizeReply } from "./agent-legacy";
import { routeCompanyLogoCompletion } from "./agent-intents";
import { agentPolicy, assertAgentCommand } from "./agent-policy";
import { capabilitiesForPolicy } from "./agent-capabilities";
import { draftCommand } from "./agent-commands";

/**
 * Request-scoped planning boundary. No graph/checkpoint IDs or business writes.
 * A future model/MCP adapter belongs behind this boundary, not in HTTP handlers.
 */
export async function planAgentRequest(
  input: z.infer<typeof aiRequestSchema>,
  signal?: AbortSignal,
) {
  const settings = await getAiConfig();
  const policy = agentPolicy(settings);
  if (!policy.enabled) throw Error("此账户未启用 AI。");
  const text = input.messages.at(-1)!.text;
  const [entries, reminders, gigs, watches, profile, pages, search] = await Promise.all([
    listEntries(),
    listReminders(),
    listGigs(),
    allWatches(),
    evaluationProfile(),
    readLinks(text, signal),
    readWebSearch(text, settings.tavilyKey, signal),
  ]);
  const snapshot = await loadAgentSnapshot({
    entries,
    reminders: reminders.reminders,
    gigs,
    watches,
    profile,
    ai: { base: settings.base, model: settings.model, revision: settings.revision },
  });
  const reply = await askAi(
    input,
    entries,
    {
      agent: snapshot,
      read: (request) =>
        request.module === "capabilities"
          ? Promise.resolve(capabilitiesForPolicy(policy))
          : readAgentData(request, snapshot),
      prepare: (raw) => loadProposalVersions(raw, snapshot),
      reminders: snapshot.reminders,
      gigs,
      watches,
      profile,
      pages: [...pages, ...search.pages],
      search,
    },
    signal,
    settings,
  );
  const result = centralizeReply(routeCompanyLogoCompletion(reply, snapshot, text), snapshot);
  // Also covers legacy response fields and server-side intent routing.
  for (const draft of result.actions ?? []) assertAgentCommand(policy, draftCommand(draft));
  return result;
}
