/** Stable business commands. HTTP routes and model SDKs are adapters, not command IDs. */
export const agentCommands = [
  "entries",
  "directory",
  "gigs",
  "watches",
  "reminders",
  "profile",
  "scanSettings",
  "model",
  "notifications",
  "evaluation",
  "scan",
  "companyCompletion",
  "assessment",
  "brief",
] as const;
export type AgentCommand = (typeof agentCommands)[number];

// Read compatibility for already-persisted checkpoints and browser chat caches.
// New proposals never store an HTTP path. Remove only after old runs/caches expire.
export const legacyAgentPaths = [
  "/api/desk",
  "/api/directory",
  "/api/part-time",
  "/api/watches",
  "/api/reminders",
  "/api/enrichment",
  "/api/scan",
  "/api/settings/ai",
  "/api/notifications",
  "/api/brief",
  "/api/companies/complete",
] as const;
export type AgentDestination =
  | { command: AgentCommand; path?: never }
  | { command?: never; path: (typeof legacyAgentPaths)[number] };

export function draftCommand(draft: AgentDestination & { body: unknown }): AgentCommand {
  if (draft.command !== undefined) {
    if (draft.path !== undefined || !agentCommands.includes(draft.command)) {
      throw Error("无效的 AI 业务操作。");
    }
    return draft.command;
  }
  const action = (draft.body as { action?: unknown } | null)?.action;
  switch (draft.path) {
    case "/api/desk":
      return "entries";
    case "/api/directory":
      return "directory";
    case "/api/part-time":
      return "gigs";
    case "/api/watches":
      return "watches";
    case "/api/reminders":
      return "reminders";
    case "/api/settings/ai":
      return "model";
    case "/api/notifications":
      return "notifications";
    case "/api/brief":
      return "brief";
    case "/api/companies/complete":
      return "companyCompletion";
    case "/api/scan":
      if (action === "run") return "scan";
      if (action === "settings") return "scanSettings";
      break;
    case "/api/enrichment":
      if (action === "run") return "assessment";
      if (action === "profile") return "profile";
      if (action === "lock") return "evaluation";
      break;
  }
  throw Error("不支持的旧版 AI 操作，请重新生成提案。");
}

export const agentJobCommands = ["scan", "companyCompletion", "assessment", "brief"] as const;
export type AgentJobCommand = (typeof agentJobCommands)[number];
export function isAgentJob(command: AgentCommand): command is AgentJobCommand {
  return agentJobCommands.some((job) => job === command);
}
