import { z } from "zod";
import type { AiReply } from "./ai-contract";
export const agentDecisionSchema = z.object({ proposalId: z.string().uuid(), approved: z.boolean(), allowDuplicate: z.boolean().default(false) }).strict();
export type AgentDecision = z.infer<typeof agentDecisionSchema>;
export type AgentOutcome = { status: "done" | "rejected" | "queued" | "error"; result?: unknown; message: string };
export type AgentRunReply = AiReply & { runId: string; runtime: "langgraph"; runStatus: string; outcomes: Record<string, AgentOutcome>; runError?: string };
