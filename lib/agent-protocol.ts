/** Some compatible providers concatenate a read request and an imagined final answer.
 * Consume only the read request; never execute the imagined answer before reading real data.
 * Multiple final answers are rejected rather than guessing which write the user should see.
 */
export function parseAgentResponse(content: string): unknown {
  const text = content.trim().replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");
  try { return JSON.parse(text); } catch { /* Look for a complete first read-only envelope. */ }
  if (!text.startsWith("{")) throw Error("Expected one JSON object");
  let depth = 0, quoted = false, escaped = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) { if (escaped) escaped = false; else if (c === "\\") escaped = true; else if (c === '"') quoted = false; continue; }
    if (c === '"') quoted = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) {
      const first = JSON.parse(text.slice(0, i + 1));
      if (Object.keys(first).length === 1 && Array.isArray(first.reads) && first.reads.length) return first;
      break;
    }
  }
  throw Error("Expected one JSON object");
}
