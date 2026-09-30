import { Annotation, StateGraph, START, END, interrupt } from "@langchain/langgraph";
import type { BaseCheckpointSaver } from "@langchain/langgraph-checkpoint";
import type { AiReply } from "./ai-contract";
import { agentDecisionSchema, type AgentDecision, type AgentOutcome } from "./agent-runtime-contract";
import type { AgentDraft } from "./agent-contract";
const State = Annotation.Root({ runId: Annotation<string>(), reply: Annotation<AiReply>(), decision: Annotation<AgentDecision>(), outcomes: Annotation<Record<string, AgentOutcome>>() });
export function createRunwayGraph(checkpointer: BaseCheckpointSaver, dependencies: {
  plan: (runId: string) => Promise<AiReply>;
  execute: (runId: string, draft: AgentDraft, decision: AgentDecision) => Promise<AgentOutcome>;
}) {
  const pending = (s: typeof State.State) => (s.reply.actions ?? []).filter(a => !s.outcomes[a.id]);
  return new StateGraph(State)
    .addNode("plan", async s => ({ reply: await dependencies.plan(s.runId), outcomes: {} }))
    .addNode("approval", s => {
      const decision = agentDecisionSchema.parse(interrupt({ proposals: pending(s).map(a => ({ id: a.id, title: a.title, changes: a.changes, warnings: a.warnings })) }));
      if (!pending(s).some(a => a.id === decision.proposalId)) throw Error("提案已处理或不属于本次运行。");
      return { decision };
    })
    .addNode("execute", async s => {
      const draft = s.reply.actions!.find(a => a.id === s.decision.proposalId)!;
      let outcome: AgentOutcome;
      try { outcome = await dependencies.execute(s.runId, draft, s.decision); }
      catch (e) { outcome = { status: "error", message: (e as Error).message.slice(0, 1000) }; }
      return { outcomes: { ...s.outcomes, [draft.id]: outcome } };
    })
    .addEdge(START, "plan")
    .addConditionalEdges("plan", s => pending(s).length ? "approval" : END)
    .addEdge("approval", "execute")
    .addConditionalEdges("execute", s => pending(s).length ? "approval" : END)
    .compile({ checkpointer });
}
