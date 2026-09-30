import { cn } from "@/lib/utils";

export function Logo({ className }: { className?: string }) {
  return <span className={cn("inline-flex size-7 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm", className)} aria-hidden>
    <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M5.5 19 L12 5 L18.5 19" /><path d="M8.6 13.5h6.8" /></svg>
  </span>;
}
