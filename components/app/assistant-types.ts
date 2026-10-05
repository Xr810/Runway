import type { AgentRunReply } from "@/lib/agent-runtime-contract";

export type AssistantPicture = { id: string; name: string; original: string; dataUrl: string };
export type AssistantMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  images?: AssistantPicture[];
  runId?: string;
  run?: AgentRunReply;
};
export type AssistantCapability = {
  module: string;
  label: string;
  operations: string[];
  fields: string[];
};
export type AssistantRunSummary = { id: string; status: string; prompt: string; error: string };
