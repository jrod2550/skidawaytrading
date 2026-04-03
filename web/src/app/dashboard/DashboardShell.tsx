"use client";

import Sidebar from "@/components/layout/Sidebar";
import type { Profile, BotHeartbeat } from "@/lib/types/trading";

interface DashboardShellProps {
  children: React.ReactNode;
  profile: Profile | null;
  heartbeat: BotHeartbeat | null;
}

export default function DashboardShell({
  children,
  profile,
  heartbeat,
}: DashboardShellProps) {
  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar profile={profile} heartbeat={heartbeat} />
      <main className="flex-1 overflow-y-auto p-8">{children}</main>
    </div>
  );
}
