// Starts background jobs (daily scan, company completion, cleanup) in the Node.js server process.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    (await import("./lib/scheduler")).startScheduler();
    if (process.env.SCHEDULER !== "off") (await import("./lib/agent-jobs")).startAgentWorker();
  }
}
