import { enrichmentFeed } from "./enrichment";
import { controlPool, pool, runAsUser } from "./postgres";
import { runScan } from "./scanner";
import { completeCompanies } from "./company-complete";
import { startBuiltinEnrichment, waitBuiltinEnrichment } from "./builtin-enrichment";
import { generateBrief } from "./brief";
import { z } from "zod";
import { targetSchema } from "./enrichment-contract";
import { agentJobCommands } from "./agent-commands";
import { agentPolicy, assertAgentCommand } from "./agent-policy";
import { getAiConfig } from "./ai-config";
const runtime = globalThis as unknown as {
  runwayAgentJobs?: boolean;
  runwayAgentTimer?: NodeJS.Timeout;
};
/** Durable outbox. A lost process marks an in-flight task uncertain instead of silently repeating it. */
export async function runAgentJobs() {
  if (runtime.runwayAgentJobs) return;
  runtime.runwayAgentJobs = true;
  const client = await controlPool.connect().catch((e) => {
    runtime.runwayAgentJobs = false;
    throw e;
  });
  let locked = false;
  try {
    locked = (await client.query("SELECT pg_try_advisory_lock(28402032) AS ok")).rows[0].ok;
    if (!locked) return;
    // Holding the session lock proves no other live worker owns these jobs.
    const users = (await client.query("SELECT id::text FROM accounts ORDER BY id")).rows;
    for (const user of users)
      await runAsUser(user.id, async () => {
        await pool.query(
          "UPDATE agent_jobs SET status='interrupted',error='服务重启时任务中断，请先查看业务结果，再重新发起未完成部分。',updated=now() WHERE status='running'",
        );
        const jobs = (
          await pool.query(
            "SELECT id,kind,payload FROM agent_jobs WHERE status='pending' ORDER BY created LIMIT 5",
          )
        ).rows;
        for (const job of jobs) {
          await pool.query("UPDATE agent_jobs SET status='running',updated=now() WHERE id=$1", [
            job.id,
          ]);
          try {
            const command = z.enum(agentJobCommands).parse(job.kind);
            assertAgentCommand(agentPolicy(await getAiConfig()), command);
            let result: unknown;
            switch (command) {
              case "scan":
                result = await runScan(
                  "manual",
                  z.array(z.string()).optional().parse(job.payload.watchIds),
                );
                break;
              case "companyCompletion":
                result = await completeCompanies({
                  names: z.array(z.string()).optional().parse(job.payload.names),
                  refreshLogo: !!job.payload.refreshLogo,
                  force: true,
                  limit: 20,
                });
                break;
              case "assessment": {
                const target = targetSchema.optional().parse(job.payload.target);
                const started = await startBuiltinEnrichment(
                  z.enum(["job", "brand", "all"]).parse(job.payload.scope),
                  target,
                  !!job.payload.force,
                );
                await waitBuiltinEnrichment();
                const tasks = (await enrichmentFeed(target)).tasks.filter((t) =>
                  started.taskIds.includes(t.id),
                );
                if (
                  tasks.some((t) => t.status !== "completed") ||
                  tasks.length !== started.taskIds.length
                )
                  throw Error("部分评估没有完成，请查看评估任务中的结果与失败原因。");
                result = { ...started, completed: tasks.length };
                break;
              }
              case "brief":
                result = await generateBrief();
                break;
              default: {
                const unhandled: never = command;
                throw Error(`未知任务类型：${unhandled}`);
              }
            }
            await pool.query(
              "UPDATE agent_jobs SET status='completed',result=$2,updated=now() WHERE id=$1",
              [job.id, JSON.stringify(result ?? { ok: true })],
            );
          } catch (e) {
            await pool.query(
              "UPDATE agent_jobs SET status='failed',error=$2,updated=now() WHERE id=$1",
              [job.id, (e as Error).message.slice(0, 1500)],
            );
          }
        }
      });
  } finally {
    if (locked) await client.query("SELECT pg_advisory_unlock(28402032)").catch(() => {});
    client.release();
    runtime.runwayAgentJobs = false;
  }
}
export function startAgentWorker() {
  if (runtime.runwayAgentTimer) return;
  const tick = () =>
    void runAgentJobs().catch((e) => console.error("Agent worker failed", (e as Error).name));
  runtime.runwayAgentTimer = setInterval(tick, 10000);
  runtime.runwayAgentTimer.unref();
  tick();
}
