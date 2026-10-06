import { z } from "zod";
import type { AgentCommand } from "./agent-commands";
import { entrySchema } from "./model";
import { directorySchema } from "./journey";
import { gigSchema } from "./part-time-contract";
import { watchSchema } from "./watches";
import { reminderSaveSchema } from "./reminder-schema";
import { profileSchema, targetSchema } from "./enrichment-contract";

const id = z.string().min(1).max(2000);
const revision = z.number().int().min(0);
export const scanFields = z
  .object({
    enabled: z.boolean(),
    time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    maxAddPerWatch: z.number().int().min(1).max(20),
  })
  .strict();

/** Persisted payloads are untrusted. Unknown legacy envelope fields are discarded,
 * while business schemas retain their own validation/compatibility rules. */
export const agentPayloadSchemas = {
  entries: z.discriminatedUnion("action", [
    z.object({ action: z.literal("save"), entry: entrySchema }),
    z.object({ action: z.literal("delete"), id, revision }),
    z.object({ action: z.literal("undelete"), id, revision }),
  ]),
  directory: z.object({ action: z.literal("save"), directory: directorySchema }),
  gigs: gigSchema,
  watches: z.object({ action: z.enum(["save", "delete"]), watch: watchSchema }),
  reminders: z.discriminatedUnion("action", [
    z.object({ action: z.literal("save"), reminder: reminderSaveSchema }),
    z.object({ action: z.literal("delete"), id, revision }),
    z.object({
      action: z.literal("done"),
      id,
      revision,
      day: z.string().date(),
      done: z.boolean(),
    }),
  ]),
  profile: z.object({ action: z.literal("profile"), profile: profileSchema }),
  scanSettings: z.object({
    action: z.literal("settings"),
    settings: scanFields,
    before: scanFields,
  }),
  model: z.object({
    action: z.literal("save"),
    base: z.string(),
    model: z.string().min(1).max(250),
    revision,
  }),
  notifications: z.object({
    action: z.enum(["read", "dismiss"]),
    ids: z.array(z.string().uuid()).min(1).max(100),
  }),
  evaluation: z.object({ action: z.literal("lock"), target: targetSchema, locked: z.boolean() }),
  scan: z.object({ action: z.literal("run"), watchIds: z.array(id).min(1).max(100).optional() }),
  companyCompletion: z.object({
    names: z.array(id).min(1).max(50).optional(),
    refreshLogo: z.boolean().default(false),
  }),
  assessment: z.object({
    action: z.literal("run"),
    scope: z.enum(["job", "brand", "all"]),
    target: targetSchema.optional(),
    force: z.boolean().default(false),
  }),
  brief: z.object({}),
} satisfies Record<AgentCommand, z.ZodTypeAny>;

export type AgentPayloads = { [K in AgentCommand]: z.input<(typeof agentPayloadSchemas)[K]> };
export type AgentOperation = {
  [K in AgentCommand]: { command: K; body: z.output<(typeof agentPayloadSchemas)[K]> };
}[AgentCommand];

export function parseAgentOperation<C extends AgentCommand>(
  command: C,
  body: unknown,
): Extract<AgentOperation, { command: C }> {
  // Indexing a heterogeneous schema map loses correlation in TypeScript; the
  // runtime lookup guarantees the command and its parsed payload correspond.
  return { command, body: agentPayloadSchemas[command].parse(body) } as Extract<
    AgentOperation,
    { command: C }
  >;
}
