import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import * as model from "../../lib/model";
import * as journey from "../../lib/journey";
import { loadModule } from "../helpers/load-module";

type Page = { url: string; title: string; text: string; links: { text: string; url: string }[]; postings: { organization: string }[] };

function finder(pages: Record<string, Page>, results: { url: string }[] = [], key = "key") {
  return loadModule<{ findWebsite(name: string, jobs: model.Entry[], signal: AbortSignal): Promise<{ website: string; evidenceUrl: string; reason: string } | null> }>(new URL("../../lib/company-complete.ts", import.meta.url), {
    zod: { z }, "./model": model, "./journey": journey,
    "./postgres": {}, "./directory-storage": {}, "./entries": {}, "./watch-storage": {}, "./ai-client": {},
    "./web": { readPage: async (url: string) => { if (!pages[url]) throw Error("unreadable"); return pages[url]; } },
    "./ai-config": { getAiConfig: async () => ({ tavilyKey: key }) }, "./tavily": { searchTavily: async () => results },
    "./enrichment": {}, "./brand-scan": {}, "./notifications": {},
  }).findWebsite;
}

const page = (url: string, title: string, text: string, links: Page["links"] = [], postings: Page["postings"] = []): Page => ({ url, title, text, links, postings });

test("company mentions in news and directory bodies are not official-site evidence", async () => {
  const url = "https://news.example/story/acme";
  const findWebsite = finder({ [url]: page(url, "Funding news", "Acme raised a new round. Company directory: Acme") }, [{ url }]);
  assert.equal(await findWebsite("Acme", [], AbortSignal.timeout(1000)), null);
});

test("article titles, generic navigation and third-party job markup do not establish ownership", async () => {
  const url = "https://news.example/acme";
  for (const title of ["Acme raises funding | News", "Acme | Company directory"]) {
    const findWebsite = finder({ [url]: page(url, title, "Acme is hiring", [{ text: "About us", url: "https://news.example/about" }], [{ organization: "Acme" }]) }, [{ url }]);
    assert.equal(await findWebsite("Acme", [], AbortSignal.timeout(1000)), null);
  }
});

test("redirects to an ATS are rejected even when the original hostname was allowed", async () => {
  const url = "https://careers.example/acme";
  const findWebsite = finder({ [url]: page("https://boards.greenhouse.io/acme", "Acme", "© Acme") }, [{ url }]);
  assert.equal(await findWebsite("Acme", [], AbortSignal.timeout(1000)), null);
});

test("a dedicated company profile is not official when the site's homepage belongs to a directory", async () => {
  const url = "https://directory.example/acme";
  const findWebsite = finder({
    [url]: page(url, "Acme", "Acme", [{ text: "About Acme", url }]),
    "https://directory.example": page("https://directory.example/", "Company Directory", "Find companies"),
  }, [{ url }]);
  assert.equal(await findWebsite("Acme", [], AbortSignal.timeout(1000)), null);
});

test("ATS links are never treated as the employer website", async () => {
  const findWebsite = finder({}, [], "");
  const job = { ...model.blankEntry("job"), organization: "Acme", applicationUrl: "https://boards.greenhouse.io/acme/jobs/1" };
  assert.equal(await findWebsite("Acme", [job], AbortSignal.timeout(1000)), null);
});

test("an unverifiable page or guessed domain is not accepted", async () => {
  const url = "https://acme.example/";
  const findWebsite = finder({ [url]: page(url, "Welcome", "Acme") }, [{ url }]);
  assert.equal(await findWebsite("Acme", [], AbortSignal.timeout(1000)), null);
});

test("official page identity retains the exact evidence URL and reason", async () => {
  const candidate = "https://acme.example/about?ref=search", final = "https://www.acme.example/about-us";
  const findWebsite = finder({
    [candidate]: page(final, "Acme | Industrial systems", "Engineering for tomorrow", [{ text: "About Acme", url: final }]),
    "https://www.acme.example": page("https://www.acme.example/", "Acme | Home", "© 2026 Acme"),
  }, [{ url: candidate }]);
  const found = await findWebsite("Acme", [], AbortSignal.timeout(1000));
  assert.equal(found?.website, "https://www.acme.example");
  assert.equal(found?.evidenceUrl, final);
  assert.match(found?.reason ?? "", /标题.*同站/);
});

test("completion history retains official-site evidence, not only its origin", async () => {
  const attempts: Record<string, Record<string, unknown>> = {};
  const evidenceUrl = "https://acme.example/company/about";
  let directory = { companies: [{ name: "Acme", website: "", logoUrl: "" }], channels: [] };
  const entry = { ...model.blankEntry("job"), organization: "Acme", companyType: "外企" as const };
  const loaded = loadModule<{ completeCompanies(options: { force: boolean }): Promise<unknown>; completionState(): Promise<{ attempts: typeof attempts }> }>(new URL("../../lib/company-complete.ts", import.meta.url), {
    zod: { z }, "./model": model, "./journey": journey,
    "./postgres": { currentUserId: async () => "user", runAsUser: (_id: string, work: () => unknown) => work(), pool: { query: async (sql: string, values: string[]) => {
      if (sql.startsWith("SELECT")) return { rows: [{ value: JSON.stringify(attempts) }] };
      Object.assign(attempts, JSON.parse(values.at(-1)!)); return { rows: [] };
    } } },
    "./directory-storage": { getDirectory: async () => directory, saveDirectory: async (next: typeof directory) => (directory = next) },
    "./entries": { listEntries: async () => [entry] }, "./watch-storage": { allWatches: async () => [] }, "./ai-client": {},
    "./web": { readPage: async () => page(evidenceUrl, "Acme | Official", "Acme products", [{ text: "About Acme", url: evidenceUrl }]) },
    "./ai-config": { getAiConfig: async () => ({ tavilyKey: "key" }) }, "./tavily": { searchTavily: async () => [{ url: evidenceUrl }] },
    "./enrichment": { enrichmentFeed: async () => ({ states: [{ kind: "company", target_id: "acme", result: { kind: "brand", model: "v1" } }] }), syncEnrichment: async () => {} },
    "./brand-scan": { officialIconParserVersion: "v1" }, "./notifications": { notify: async () => {} },
  });
  await loaded.completeCompanies({ force: true });
  const attempt = (await loaded.completionState()).attempts.acme;
  assert.equal(attempt.website, "https://acme.example");
  assert.equal(attempt.evidenceUrl, evidenceUrl);
  assert.match(String(attempt.evidenceReason), /标题.*同站/);
});
