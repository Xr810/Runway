// The checkpoint store is shared infrastructure. Always derive its identity
// from the owner already verified against agent_runs, never ambient context.
export const agentCheckpointConfig = (id: string, owner: string) => ({
  configurable: { thread_id: `${owner}:${id}` },
  recursionLimit: 50,
});
