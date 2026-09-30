import { Suspense } from "react";
import View from "@/components/app/views/projects";

export const metadata = { title: "项目与比赛" };

export default function Page() { return <Suspense><View /></Suspense>; }
