import { Suspense } from "react";
import View from "@/components/app/views/insights";

export const metadata = { title: "洞察" };

export default function Page() { return <Suspense><View /></Suspense>; }
