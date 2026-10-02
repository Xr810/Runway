import { requireUser } from "@/lib/auth";
import { DeskProvider } from "@/components/app/store";
import Shell from "@/components/app/shell";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  return <DeskProvider key={user.userId}><Shell userId={user.userId}>{children}</Shell></DeskProvider>;
}
