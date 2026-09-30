import { Suspense } from "react";
import View from "@/components/app/views/schedule";

export const metadata = { title: "日程" };

export default function Page() { return <Suspense><View /></Suspense>; }
