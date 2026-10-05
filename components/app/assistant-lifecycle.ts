import type { AssistantMessage } from "./assistant-types";

/** Runs still capable of changing without a user decision. */
export function assistantPollingRunIds(messages: AssistantMessage[]): string[] {
  const assistantByRun = new Map(
    messages
      .filter((message) => message.role === "assistant" && message.runId)
      .map((message) => [message.runId!, message]),
  );
  const ids = new Set<string>();
  for (const message of messages) {
    if (!message.runId) continue;
    const tracked = message.role === "assistant" ? message : assistantByRun.get(message.runId);
    if (
      !tracked?.run ||
      tracked.run.runStatus !== "completed" ||
      Object.values(tracked.run.outcomes).some((outcome) => outcome.status === "queued")
    )
      ids.add(message.runId);
  }
  return [...ids].slice(-12);
}
