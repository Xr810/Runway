import { Suspense } from "react";
import View from "@/components/app/views/companies";

export const metadata = { title: "公司" };

export default function Page() { return <Suspense><View /></Suspense>; }
