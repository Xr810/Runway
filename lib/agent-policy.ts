import { agentCommands, type AgentCommand } from "./agent-commands";
import type { AiConfig } from "./ai-config";

/** Server-owned grants, never accepted from a message, browser or MCP tool annotation. */
export type AgentPolicy = {
  enabled: boolean;
  commands: readonly AgentCommand[];
};

/**
 * Current account policy. An admin/entitlement resolver can narrow these grants
 * here without changing the graph, model adapter or business handlers.
 * There is deliberately no permission to execute arbitrary external tools.
 */
export function agentPolicy(config: Pick<AiConfig, "enabled" | "mode">): AgentPolicy {
  const enabled = config.enabled !== false;
  return {
    enabled,
    commands: !enabled
      ? []
      : config.mode === "managed"
        ? agentCommands.filter((command) => command !== "model")
        : agentCommands,
  };
}

export function assertAgentCommand(policy: AgentPolicy, command: AgentCommand) {
  if (!policy.enabled || !policy.commands.includes(command)) {
    throw Error("当前账户的 AI 权限不允许此操作，请联系管理员。");
  }
}
