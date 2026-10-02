// OpenAI-compatible stand-in for local development and API tests. Never used in production.
// Replies are deterministic and keyed on the "[task:…]" marker the app puts in system prompts.
import http from "node:http";

const port = Number(process.env.MOCK_AI_PORT || 4010);
const text = content => typeof content === "string" ? content : content.filter(p => p.type === "text").map(p => p.text).join("\n");
const junior = /intern|graduate|new grad|campus|early career|student|research|quant|data|machine learning|engineer/i, senior = /senior|staff|principal|director|manager|lead|head of|vp/i;

function chat(user) {
  const reply = { reply: "收到。", drafts: [], filter: null, enrichment: null, reminders: [], profile: null, watches: [], scan: null, completeCompanies: null };
  if (/提醒/.test(user)) {
    const hour = /(\d{1,2})\s*点/.exec(user)?.[1] ?? "8";
    const title = user.replace(/^.*?提醒我/, "").replace(/^(每天|每日)?\s*\d{1,2}\s*点?/, "").trim() || "查看今日安排";
    reply.reminders.push({ operation: "add", title, schedule: { type: "daily", time: String(hour).padStart(2, "0") + ":00", until: "" }, url: /worldquant/i.test(user) ? "https://platform.worldquantbrain.com" : "" });
    reply.reply = `好的，每天 ${hour} 点提醒你${title}。确认后会出现在「今日」页。`;
  } else if (/方向|求职领域/.test(user)) {
    reply.profile = { targets: ["量化研究", "数据科学", "机器学习", "软件工程"].filter(t => user.includes(t.slice(0, 2))) };
    reply.reply = "我整理了你的期待方向，确认后保存到个人背景。";
  } else if (/扫描/.test(user)) { reply.scan = { watchIds: null }; reply.reply = "确认后开始扫描全部已开启的关注。"; }
  else if (/补全/.test(user)) { reply.completeCompanies = { names: null }; reply.reply = "确认后开始补全公司资料。"; }
  else if (/关注/.test(user) && /https:\/\//.test(user)) {
    const url = /https:\/\/[^\s]+/.exec(user)[0], host = new URL(url).hostname;
    reply.watches.push({ operation: "add", kind: /jobsdb|linkedin|indeed/.test(host) ? "board" : "company", company: host.split(".").at(-2), url });
    reply.reply = "确认后加入关注列表，每天自动扫描。";
  } else if (/https:\/\//.test(user)) {
    const posting = /结构化岗位数据：\n(\{.*\})/.exec(user);
    if (posting) { const p = JSON.parse(posting[1]); reply.drafts.push({ operation: "add", fields: { kind: "job", title: p.title, organization: p.organization, location: p.location, url: p.url, jd: p.description } }); reply.reply = `从链接里整理出「${p.title}」，请核对后确认。`; }
    else reply.reply = /读取失败/.test(user) ? "这个链接没能读取，请发截图或粘贴岗位文字。" : "链接里没有找到结构化的岗位信息，请补充截图或文字。";
  }
  return reply;
}
function task(name, user) {
  if (name === "scan-judge") {
    const candidates = user.split("\n").filter(l => l.startsWith('{"key"')).map(l => JSON.parse(l));
    let picked = 0;
    return { decisions: candidates.map(c => { const add = junior.test(c.title) && !senior.test(c.title) && picked++ < 3; return { key: c.key, add, reason: add ? "与期待方向相关，级别合适" : "级别或方向不匹配", location: c.location || "", workMode: /remote/i.test(c.location) ? "远程 Remote" : "待核实", employmentType: /intern/i.test(c.title) ? "实习 Internship" : "正式岗位", schedule: "全职 Full-time" }; }) };
  }
  if (name === "scan-extract") {
    const links = user.split("\n").map(l => /^(\d+)\. (.*) → (https:\/\/\S+)$/.exec(l)).filter(Boolean);
    return { jobs: links.filter(m => /job|position|opening|careers\/.+\/.+/i.test(m[3])).slice(0, 20).map(m => ({ index: Number(m[1]), title: m[2], location: "" })) };
  }
  if (name === "company-website") return { website: /test co/i.test(user) ? null : null };
  if (name === "company-type") return { companyType: "外企", basis: "（测试数据）集团总部位于海外", confidence: "medium" };
  if (name === "daily-brief") {
    const id = /\[([a-zA-Z0-9_-]{8,})\]/.exec(user)?.[1] ?? null;
    return { headline: "先处理最近的截止和面试准备", items: [{ text: "准备明天的面试，复习项目经历", entryId: id, priority: "high" }, { text: "完成今天的提醒事项", entryId: null, priority: "normal" }] };
  }
  return {};
}

http.createServer((request, response) => {
  let body = "";
  request.on("data", chunk => { body += chunk; });
  request.on("end", () => {
    response.setHeader("Content-Type", "application/json");
    if (request.url.endsWith("/models")) { response.end(JSON.stringify({ data: [{ id: "mock-model" }] })); return; }
    const payload = JSON.parse(body || "{}"), system = text(payload.messages?.[0]?.content ?? ""), user = text(payload.messages?.at(-1)?.content ?? "");
    const marker = /^\[task:([\w-]+)\]/.exec(system)?.[1];
    const content = marker ? task(marker, user) : /"ok":true/.test(user) ? { ok: true } : chat(user);
    response.end(JSON.stringify({ choices: [{ finish_reason: "stop", message: { role: "assistant", content: JSON.stringify(content) } }] }));
  });
}).listen(port, "127.0.0.1", () => console.log("Mock AI listening on " + port));
