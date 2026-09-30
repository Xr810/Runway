import {z} from "zod";
export const appointmentSchema=z.object({
 id:z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/),
 title:z.string().trim().min(1).max(300),
 type:z.enum(["interview","assessment","followup"]),
 startsAt:z.string().datetime({offset:true}),
 endsAt:z.string().datetime({offset:true}).optional(),
 location:z.string().max(2000).default(""),
 url:z.string().max(4000).refine(v=>!v||URL.canParse(v)&&/^https?:\/\//i.test(v),"日程链接无效").default(""),
 status:z.enum(["scheduled","completed","cancelled"]).default("scheduled"),
}).strict().refine(v=>!v.endsAt||Date.parse(v.endsAt)>Date.parse(v.startsAt),"结束时间必须晚于开始时间");
export type Appointment=z.infer<typeof appointmentSchema>;
export const appointmentDate=(value:string)=>new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Singapore",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date(value));
export const appointmentTime=(value:string)=>new Intl.DateTimeFormat("zh-CN",{timeZone:"Asia/Singapore",hour:"2-digit",minute:"2-digit",hour12:false}).format(new Date(value));
