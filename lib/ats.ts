import { fetchJson, htmlToText, type Posting } from "./web";

/** Recognises applicant-tracking systems that publish a public JSON feed. */
export function detectSource(address: string) {
  const url = new URL(address), host = url.hostname.toLowerCase(), parts = url.pathname.split("/").filter(Boolean);
  if (/(^|\.)greenhouse\.io$/.test(host)) { const token = url.searchParams.get("for") || parts[0]; if (token && token !== "embed") return { type: "greenhouse" as const, token }; }
  if (host === "jobs.lever.co" && parts[0]) return { type: "lever" as const, token: parts[0] };
  if (host === "jobs.ashbyhq.com" && parts[0]) return { type: "ashby" as const, token: parts[0] };
  if (/^(jobs|careers)\.smartrecruiters\.com$/.test(host) && parts[0]) return { type: "smartrecruiters" as const, token: parts[0] };
  if (/\.myworkdayjobs\.com$/.test(host)) { const site = parts.find(p => !/^[a-z]{2}-[A-Z]{2}$/.test(p)); if (site) return { type: "workday" as const, token: site, tenant: host.split(".")[0], host }; }
  return { type: "page" as const, token: "" };
}

/**
 * Structured data for a single posting URL on a known applicant-tracking system, read from the
 * system's public API. Returns null for other sites; callers fall back to reading the page.
 */
export async function postingFromUrl(address: string, signal?: AbortSignal): Promise<Posting | null> {
  const url = new URL(address), host = url.hostname.toLowerCase(), parts = url.pathname.split("/").filter(Boolean);
  const base = { organization: "", location: "", url: address, description: "", employmentType: "", datePosted: "", validThrough: "" };
  if (/(^|\.)greenhouse\.io$/.test(host)) {
    const at = parts.indexOf("jobs"), token = parts[0], id = at > 0 ? parts[at + 1] : url.searchParams.get("gh_jid");
    if (!token || !id || !/^\d+$/.test(id)) return null;
    const j = await fetchJson<{ title: string; absolute_url: string; location?: { name?: string }; content?: string; company_name?: string; updated_at?: string }>(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(token)}/jobs/${id}`, { signal });
    return { ...base, title: j.title, organization: j.company_name ?? "", location: j.location?.name ?? "", url: j.absolute_url, description: htmlToText(htmlToText(j.content ?? "", 60000), 30000), datePosted: (j.updated_at ?? "").slice(0, 10) };
  }
  if (host === "jobs.lever.co" && parts.length >= 2) {
    const j = await fetchJson<{ text: string; hostedUrl: string; categories?: { location?: string; commitment?: string }; descriptionPlain?: string; lists?: { text: string; content: string }[]; additionalPlain?: string }>(`https://api.lever.co/v0/postings/${encodeURIComponent(parts[0])}/${encodeURIComponent(parts[1])}`, { signal });
    return { ...base, title: j.text, organization: parts[0], location: j.categories?.location ?? "", url: j.hostedUrl, employmentType: j.categories?.commitment ?? "",
      description: [j.descriptionPlain, ...(j.lists ?? []).map(l => l.text + "\n" + htmlToText(l.content, 6000)), j.additionalPlain].filter(Boolean).join("\n\n").slice(0, 30000) };
  }
  if (host === "jobs.ashbyhq.com" && parts.length >= 2) {
    const board = await fetchJson<{ jobs: { id: string; title: string; location?: string; jobUrl: string; descriptionPlain?: string; publishedAt?: string; employmentType?: string }[] }>(`https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(parts[0])}`, { signal, maxBytes: 24 * 1024 * 1024 });
    const j = board.jobs.find(job => job.id === parts[1]); if (!j) return null;
    return { ...base, title: j.title, organization: parts[0], location: j.location ?? "", url: j.jobUrl, employmentType: j.employmentType ?? "", description: (j.descriptionPlain ?? "").slice(0, 30000), datePosted: (j.publishedAt ?? "").slice(0, 10) };
  }
  if (/\.myworkdayjobs\.com$/.test(host)) {
    const at = parts.indexOf("job"), site = parts.find(p => !/^[a-z]{2}-[A-Z]{2}$/.test(p));
    if (at < 1 || !site) return null;
    const j = await fetchJson<{ jobPostingInfo?: { title: string; jobDescription?: string; location?: string; startDate?: string; timeType?: string; externalUrl?: string }; hiringOrganization?: { name?: string } }>(`https://${host}/wday/cxs/${host.split(".")[0]}/${site}/${parts.slice(at).join("/")}`, { signal });
    if (!j.jobPostingInfo) return null;
    return { ...base, title: j.jobPostingInfo.title, organization: j.hiringOrganization?.name ?? "", location: j.jobPostingInfo.location ?? "", url: j.jobPostingInfo.externalUrl ?? address, employmentType: j.jobPostingInfo.timeType ?? "", description: htmlToText(j.jobPostingInfo.jobDescription ?? "", 30000), datePosted: j.jobPostingInfo.startDate ?? "" };
  }
  return null;
}
