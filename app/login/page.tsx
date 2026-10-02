import { getUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import LoginForm from "./form";
export const dynamic = "force-dynamic";
export default async function Login({ searchParams }: { searchParams: Promise<{ error?: string }> }) { if (await getUser()) redirect("/"); return <LoginForm oauthError={(await searchParams).error === "oauth"}/>; }
