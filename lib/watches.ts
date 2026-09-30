import { z } from "zod";
import { regions,workModes,employmentTypes,schedules } from "./model";

const choices=(options:string[])=>z.array(z.string().refine(v=>options.includes(v))).max(options.length).default([]);
export const watchSchema=z.object({
 id:z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/),
 // "company": a company's own careers page. "board": a search results page on a job site.
 kind:z.enum(["company","board"]).default("company"),
 company:z.string().trim().min(1,"请填写名称").max(200),
 url:z.string().trim().max(4000).refine(v=>URL.canParse(v)&&/^https?:\/\//i.test(v),"请填写有效的招聘页面链接"),
 enabled:z.boolean().default(true),
 regions:choices(regions.filter(v=>v!=="待核实")),
 workModes:choices(workModes.filter(v=>v!=="待核实")),
 employmentTypes:choices(employmentTypes.filter(v=>v!=="待核实")),
 schedules:choices(schedules.filter(v=>v!=="待核实")),
 keywords:z.string().max(2000).default(""),
 excludeKeywords:z.string().max(2000).default(""),
 notes:z.string().max(10000).default(""),
 revision:z.number().int().min(0).default(0),
});
export type CompanyWatch=z.infer<typeof watchSchema>;
export const blankWatch=(kind:CompanyWatch["kind"]="company"):CompanyWatch=>({id:crypto.randomUUID(),kind,company:"",url:"",enabled:true,regions:[],workModes:[],employmentTypes:[],schedules:[],keywords:"",excludeKeywords:"",notes:"",revision:0});
