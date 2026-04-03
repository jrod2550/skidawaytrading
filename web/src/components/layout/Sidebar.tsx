"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { Profile, BotHeartbeat } from "@/lib/types/trading";
import { cn } from "@/lib/utils";

const navItems = [
  { label: "Overview", href: "/dashboard", icon: LayoutIcon },
  { label: "Positions", href: "/dashboard/positions", icon: TrendingUpIcon },
  { label: "Signals", href: "/dashboard/signals", icon: ZapIcon },
  { label: "Trades", href: "/dashboard/trades", icon: ArrowRightLeftIcon },
  { label: "Members", href: "/dashboard/members", icon: UsersIcon },
  { label: "Expenses", href: "/dashboard/expenses", icon: ReceiptIcon },
];

const adminItems = [
  { label: "Settings", href: "/dashboard/settings", icon: SettingsIcon },
];

interface SidebarProps {
  profile: Profile | null;
  heartbeat: BotHeartbeat | null;
}

export default function Sidebar({ profile, heartbeat }: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();

  const isAdmin = profile?.role === "admin";
  const items = isAdmin ? [...navItems, ...adminItems] : navItems;

  const botStatus = heartbeat?.status ?? "unknown";
  const botColor =
    botStatus === "healthy"
      ? "bg-profit"
      : botStatus === "degraded"
        ? "bg-gold"
        : "bg-[oklch(0.40_0.01_250)]";
  const botLabel =
    botStatus === "healthy"
      ? "Online"
      : botStatus === "degraded"
        ? "Degraded"
        : "Offline";

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <aside className="flex h-full w-[220px] flex-col bg-sidebar border-r border-sidebar-border">
      {/* Logo */}
      <div className="px-5 pt-6 pb-5">
        <div className="flex items-center gap-2.5">
          <Image
            src="/logo.webp"
            alt="Skidaway Trading"
            width={36}
            height={36}
            className="rounded-lg"
          />
          <div>
            <p className="text-[13px] font-semibold tracking-[-0.02em] text-sidebar-foreground">
              Skidaway
            </p>
            <p className="text-[9px] font-medium tracking-[0.15em] uppercase text-[oklch(0.40_0.01_250)]">
              Trading
            </p>
          </div>
        </div>
      </div>

      {/* Bot status pill */}
      <div className="mx-4 mb-4">
        <div className="flex items-center gap-2 rounded-md bg-[oklch(0.10_0.010_250)] border border-sidebar-border px-3 py-2">
          <div className={cn("h-1.5 w-1.5 rounded-full", botColor, botStatus === "healthy" && "animate-pulse-live")} />
          <span className="text-[10px] font-mono text-[oklch(0.50_0.01_250)]">
            Bot: <span className={botStatus === "healthy" ? "text-profit" : botStatus === "degraded" ? "text-gold" : "text-[oklch(0.40_0.01_250)]"}>{botLabel}</span>
          </span>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 space-y-0.5">
        {items.map((item) => {
          const isActive =
            item.href === "/dashboard"
              ? pathname === "/dashboard"
              : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-2.5 rounded-md px-3 py-2 text-[13px] font-medium transition-all duration-150",
                isActive
                  ? "bg-sidebar-accent text-teal"
                  : "text-[oklch(0.50_0.015_250)] hover:text-sidebar-foreground hover:bg-[oklch(0.12_0.010_250)]"
              )}
            >
              <item.icon className="h-[15px] w-[15px]" />
              {item.label}
              {item.label === "Signals" && (
                <span className="ml-auto text-[9px] font-mono text-gold bg-[oklch(0.78_0.14_85_/_0.08)] border border-[oklch(0.78_0.14_85_/_0.2)] rounded px-1 py-0.5 leading-none">
                  AI
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      {/* User footer */}
      <div className="border-t border-sidebar-border px-4 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="flex-shrink-0 w-7 h-7 rounded-md bg-[oklch(0.72_0.15_175_/_0.10)] border border-[oklch(0.72_0.15_175_/_0.2)] flex items-center justify-center">
              <span className="text-[10px] font-bold text-teal">
                {profile?.display_name?.[0]?.toUpperCase() ?? "?"}
              </span>
            </div>
            <div className="min-w-0">
              <p className="text-[12px] font-medium text-sidebar-foreground truncate">
                {profile?.display_name ?? "User"}
              </p>
              <p className="text-[9px] font-mono text-[oklch(0.40_0.01_250)] uppercase">
                {profile?.role ?? "viewer"}
              </p>
            </div>
          </div>
          <button
            onClick={handleSignOut}
            className="text-[10px] text-[oklch(0.40_0.01_250)] hover:text-sidebar-foreground transition-colors"
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <polyline points="16 17 21 12 16 7" />
              <line x1="21" x2="9" y1="12" y2="12" />
            </svg>
          </button>
        </div>
      </div>
    </aside>
  );
}

/* ── Inline Icons (tight, 15px) ─────────────────────────── */

function LayoutIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect width="18" height="18" x="3" y="3" rx="2" ry="2" />
      <line x1="3" x2="21" y1="9" y2="9" />
      <line x1="9" x2="9" y1="21" y2="9" />
    </svg>
  );
}

function TrendingUpIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="22 7 13.5 15.5 8.5 10.5 2 17" />
      <polyline points="16 7 22 7 22 13" />
    </svg>
  );
}

function ZapIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
    </svg>
  );
}

function ArrowRightLeftIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m16 3 4 4-4 4" />
      <path d="M20 7H4" />
      <path d="m8 21-4-4 4-4" />
      <path d="M4 17h16" />
    </svg>
  );
}

function UsersIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

function ReceiptIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z" />
      <path d="M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8" />
      <path d="M12 17.5v-11" />
    </svg>
  );
}

function SettingsIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}
