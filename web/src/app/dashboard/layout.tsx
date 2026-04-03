import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import DashboardShell from "./DashboardShell";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();

  const { data: heartbeat } = await supabase
    .from("bot_heartbeats")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  return (
    <DashboardShell profile={profile} heartbeat={heartbeat}>
      {children}
    </DashboardShell>
  );
}
