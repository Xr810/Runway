import { readFileSync } from "node:fs";
import ts from "typescript";

/** Execute the real module with explicit I/O substitutes; never load unstubbed services. */
export function loadModule<T>(file: URL, dependencies: Record<string, unknown>, globals: Record<string, unknown> = {}): T {
  const code = ts.transpileModule(readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const loaded = { exports: {} };
  const require = (name: string) => {
    if (!(name in dependencies)) throw Error(`Unstubbed dependency: ${name}`);
    return dependencies[name];
  };
  new Function("require", "module", "exports", ...Object.keys(globals), code)(require, loaded, loaded.exports, ...Object.values(globals));
  return loaded.exports as T;
}
