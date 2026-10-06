import type { JdSummary } from "../../lib/jd-summary";

export const jd = `Team A builds APIs; Team B analyses markets. Associate level may be considered.
Python is required. C++ is a plus.
Bachelor or Master students graduating between June 2027 and July 2028.
10-week summer internship, June to August 2027, in Hong Kong.
Round 1 deadline: 15 October 2026. Round 2 deadline: 20 November 2026. Rolling recruitment may close early.
Application, online assessment, then two interviews.`;
export const summary: JdSummary = {
  responsibilities: [
    {
      text: "A 团队开发 API；B 团队分析市场。",
      quote: "Team A builds APIs; Team B analyses markets.",
    },
    { text: "也可能考虑 Associate 职级。", quote: "Associate level may be considered." },
  ],
  required: [{ text: "必须掌握 Python。", quote: "Python is required." }],
  preferred: [{ text: "C++ 是加分项，并非必备。", quote: "C++ is a plus." }],
  education: [
    {
      text: "本科或硕士在读；毕业时间为 2027 年 6 月至 2028 年 7 月。",
      quote: "Bachelor or Master students graduating between June 2027 and July 2028.",
    },
  ],
  internship: [
    {
      text: "2027 年 6—8 月期间，10 周暑期实习。",
      quote: "10-week summer internship, June to August 2027",
    },
  ],
  locations: [{ text: "香港。", quote: "in Hong Kong." }],
  deadlines: [
    { text: "第一轮：2026-10-15。", quote: "Round 1 deadline: 15 October 2026." },
    { text: "第二轮：2026-11-20。", quote: "Round 2 deadline: 20 November 2026." },
    { text: "滚动招聘，可能提前截止。", quote: "Rolling recruitment may close early." },
  ],
  process: [
    {
      text: "申请 → 在线测评 → 两轮面试；这是通用流程，不代表已完成。",
      quote: "Application, online assessment, then two interviews.",
    },
  ],
  questions: ["原文未说明薪资和办公模式，是否有补充信息？"],
};
