import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeEntities, htmlToText, isAccessChallenge, isLoginPage, jobPostings, pageLinks } from "../../lib/web";
import { detectSource, keywordFilter } from "../../lib/scanner";
import { blankWatch } from "../../lib/watches";

test("HTML becomes readable text", () => {
  const text = htmlToText("<html><head><style>p{}</style><script>alert(1)</script></head><body><h1>Quant&nbsp;Intern</h1><p>Hong Kong &amp; Remote</p><ul><li>Python</li><li>C&#43;&#x2B;</li></ul></body></html>");
  assert.equal(text, "Quant Intern\n\nHong Kong & Remote\n\n• Python\n\n• C++");
  assert(!text.includes("alert"));
  assert.equal(decodeEntities("&lt;b&gt; &#20013;&#25991;"), "<b> 中文");
});
test("login shells are reported as protected pages instead of job descriptions", () => {
  const html = `<html><head><title>Log in - Morgan Stanley Campus</title></head><body><form><input name="username"><input type="password" name="password"><button>Log in</button></form></body></html>`;
  assert(isLoginPage(html, "Log in - Morgan Stanley Campus"));
  assert(!isLoginPage("<title>Jobs</title><p>Sign in for alerts</p>", "Jobs"));
});
test("bot checks are reported as access challenges", () => {
  assert(isAccessChallenge("<title>Quick Check Needed</title><p>captcha challenge</p>", "Quick Check Needed"));
  assert(!isAccessChallenge("<title>Quant Intern</title><p>Research role</p>", "Quant Intern"));
});
test("JSON-LD job postings are extracted, including @graph", () => {
  const html = `<script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"Organization","name":"X"},{"@type":"JobPosting","title":"Quant Research Intern","hiringOrganization":{"name":"Acme"},"jobLocation":{"@type":"Place","address":{"addressLocality":"Hong Kong","addressCountry":"HK"}},"description":"&lt;p&gt;Build models&lt;/p&gt;","datePosted":"2026-09-01T00:00:00Z","url":"/jobs/1"}]}</script><script type="application/ld+json">{broken</script>`;
  const [posting] = jobPostings(html, "https://careers.acme.com/list");
  assert.equal(posting.title, "Quant Research Intern"); assert.equal(posting.organization, "Acme"); assert.equal(posting.location, "Hong Kong, HK");
  assert.equal(posting.url, "https://careers.acme.com/jobs/1"); assert.equal(posting.description, "Build models"); assert.equal(posting.datePosted, "2026-09-01");
});
test("links are absolute, https only and de-duplicated", () => {
  const links = pageLinks(`<a href="/jobs/1">Quant Intern</a><a href='/jobs/1#x'>again</a><a href="http://x.com/a">Plain http</a><a href="mailto:a@b">Mail</a><a href="https://y.com/b"><span>Data</span> Scientist</a>`, "https://acme.com/careers");
  assert.deepEqual(links, [{ text: "Quant Intern", url: "https://acme.com/jobs/1" }, { text: "Data Scientist", url: "https://y.com/b" }]);
});
test("applicant-tracking systems are recognised from their URLs", () => {
  assert.deepEqual(detectSource("https://job-boards.greenhouse.io/anthropic"), { type: "greenhouse", token: "anthropic" });
  assert.deepEqual(detectSource("https://boards.greenhouse.io/embed/job_board?for=stripe"), { type: "greenhouse", token: "stripe" });
  assert.deepEqual(detectSource("https://jobs.lever.co/palantir"), { type: "lever", token: "palantir" });
  assert.deepEqual(detectSource("https://jobs.ashbyhq.com/openai"), { type: "ashby", token: "openai" });
  assert.deepEqual(detectSource("https://careers.smartrecruiters.com/Visa"), { type: "smartrecruiters", token: "Visa" });
  assert.deepEqual(detectSource("https://ms.wd5.myworkdayjobs.com/en-US/External"), { type: "workday", token: "External", tenant: "ms", host: "ms.wd5.myworkdayjobs.com" });
  assert.equal(detectSource("https://www.hsbc.com/careers").type, "page");
});
test("keyword filters include and exclude", () => {
  const watch = { ...blankWatch(), company: "A", url: "https://a.example", keywords: "quant, 量化", excludeKeywords: "senior" };
  const c = (title: string) => ({ key: title, title, organization: "", location: "", url: "", description: "", postedAt: "" });
  assert(keywordFilter(watch, c("Quant Research Intern"))); assert(keywordFilter(watch, c("量化研究实习生")));
  assert(!keywordFilter(watch, c("Senior Quant"))); assert(!keywordFilter(watch, c("Marketing Intern")));
  assert(keywordFilter({ ...watch, keywords: "", excludeKeywords: "" }, c("Anything")));
});
