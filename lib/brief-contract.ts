import { z } from "zod";

export const briefSchema = z.object({
  headline: z.string().max(120),
  items: z.array(z.object({
    text: z.string().max(200),
    entryId: z.string().max(100).nullable().default(null),
    // Providers sometimes use the usual high/medium/low scale despite the prompt.
    priority: z.enum(["high", "normal", "medium", "low"]).default("normal")
      .transform(value => value === "high" ? "high" as const : "normal" as const),
  })).max(5),
});
export type Brief = z.infer<typeof briefSchema> & { day: string; created: string };
