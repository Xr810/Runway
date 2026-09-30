import { getUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import LoginForm from "./form";
export const dynamic = "force-dynamic";
export default async function Login() { if (await getUser()) redirect("/"); return <LoginForm/>; }
