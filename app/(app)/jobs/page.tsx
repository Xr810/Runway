import { Suspense } from "react";
import View from "@/components/app/views/jobs";

export const metadata = { title: "岗位" };

export default function Page() { return <Suspense><View /></Suspense>; }
