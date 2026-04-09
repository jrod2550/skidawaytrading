"use client";

import Image from "next/image";
import Link from "next/link";
import { useState, useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { Profile, BotHeartbeat } from "@/lib/types/trading";
import { cn } from "@/lib/utils";

const navItems = [
  { label: "Overview", href: "/dashboard", icon: LayoutIcon },
  { label: "Strategy", href: "/dashboard/strategy", icon: StrategyIcon },
  { label: "AI Activity", href: "/dashboard/activity", icon: ActivityIcon },
  { label: "Positions", href: "/dashboard/positions", icon: TrendingUpIcon },
  { label: "Trades", href: "/dashboard/trades", icon: ArrowRightLeftIcon },
  { label: "Signals", href: "/dashboard/signals", icon: ZapIcon },
  { label: "AI Briefing", href: "/dashboard/briefing", icon: BriefingIcon },
  { label: "Whale Alerts", href: "/dashboard/whales", icon: WhaleIcon },
  { label: "Kalshi", href: "/dashboard/kalshi", icon: KalshiIcon },
  { label: "Congress", href: "/dashboard/congress", icon: CongressIcon },
  { label: "Members", href: "/dashboard/members", icon: UsersIcon },
  { label: "Expenses", href: "/dashboard/expenses", icon: ReceiptIcon },
];

const adminItems = [
  { label: "Settings", href: "/dashboard/settings", icon: SettingsIcon },
];

interface SidebarProps {
  profile: Profile | null;
  heartbeat: BotHeartbeat | null;
  onNavigate?: () => void;
}

export default function Sidebar({ profile, heartbeat, onNavigate }: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [paused, setPaused] = useState(false);
  const [pauseLoading, setPauseLoading] = useState(false);
  const [kalshiPaused, setKalshiPaused] = useState(false);
  const [kalshiPauseLoading, setKalshiPauseLoading] = useState(false);

  const isAdmin = profile?.role === "admin";
  const items = isAdmin ? [...navItems, ...adminItems] : navItems;

  const botStatus = heartbeat?.status ?? "unknown";
  const botColor =
    botStatus === "healthy"
      ? "bg-profit"
      : botStatus === "degraded"
        ? "bg-gold"
        : "bg-[oklch(0.70_0.01_250)]";
  const botLabel =
    botStatus === "healthy"
      ? "Online"
      : botStatus === "degraded"
        ? "Degraded"
        : "Offline";

  // Load pause state on mount
  useEffect(() => {
    const supabase = createClient();
    supabase
      .from("bot_config")
      .select("value")
      .eq("key", "bot_paused")
      .single()
      .then(({ data }) => {
        if (data) setPaused(Boolean(data.value));
      });
    supabase
      .from("bot_config")
      .select("value")
      .eq("key", "kalshi_paused")
      .single()
      .then(({ data }) => {
        if (data) setKalshiPaused(Boolean(data.value));
      });
  }, []);

  async function upsertBotConfig(key: string, value: boolean) {
    const supabase = createClient();
    const { data: existing } = await supabase
      .from("bot_config")
      .select("key")
      .eq("key", key)
      .single();
    if (existing) {
      await supabase.from("bot_config").update({ value }).eq("key", key);
    } else {
      await supabase.from("bot_config").insert({ key, value });
    }
  }

  async function handleTogglePause() {
    setPauseLoading(true);
    const newState = !paused;
    await upsertBotConfig("bot_paused", newState);
    setPaused(newState);
    setPauseLoading(false);
  }

  async function handleToggleKalshiPause() {
    setKalshiPauseLoading(true);
    const newState = !kalshiPaused;
    await upsertBotConfig("kalshi_paused", newState);
    setKalshiPaused(newState);
    setKalshiPauseLoading(false);
  }

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
            alt="Broken Omelette Trading"
            width={36}
            height={36}
            className="rounded-lg"
          />
          <div>
            <p className="text-[13px] font-semibold tracking-[-0.02em] text-sidebar-foreground">
              Broken Omelette
            </p>
            <p className="text-[9px] font-medium tracking-[0.15em] uppercase text-[oklch(0.60_0.01_250)]">
              Trading
            </p>
          </div>
        </div>
      </div>

      {/* Bot status pill */}
      <div className="mx-4 mb-4">
        <div className="flex items-center gap-2 rounded-md bg-[oklch(0.95_0.006_175)] border border-sidebar-border px-3 py-2">
          <div className={cn("h-1.5 w-1.5 rounded-full", botColor, botStatus === "healthy" && "animate-pulse-live")} />
          <span className="text-[10px] font-mono text-[oklch(0.50_0.01_250)]">
            Bot: <span className={botStatus === "healthy" ? "text-profit" : botStatus === "degraded" ? "text-gold" : "text-[oklch(0.60_0.01_250)]"}>{botLabel}</span>
          </span>
        </div>
      </div>

      {/* Pause buttons */}
      {isAdmin && (
        <div className="mx-4 mb-3 space-y-1.5">
          <button
            onClick={handleTogglePause}
            disabled={pauseLoading}
            className={cn(
              "w-full flex items-center justify-center gap-2 rounded-md px-3 py-2 text-[10px] font-semibold tracking-wide uppercase transition-all",
              paused
                ? "bg-loss/10 border border-loss/30 text-loss hover:bg-loss/20"
                : "bg-muted border border-border text-muted-foreground hover:border-loss/30 hover:text-loss"
            )}
          >
            {paused ? (
              <>
                <svg className="w-3 h-3" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                Resume All Trading
              </>
            ) : (
              <>
                <svg className="w-3 h-3" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
                Pause All Trading
              </>
            )}
          </button>
          <button
            onClick={handleToggleKalshiPause}
            disabled={kalshiPauseLoading}
            className={cn(
              "w-full flex items-center justify-center gap-2 rounded-md px-3 py-2 text-[10px] font-semibold tracking-wide uppercase transition-all",
              kalshiPaused
                ? "bg-gold/10 border border-gold/30 text-gold hover:bg-gold/20"
                : "bg-muted border border-border text-muted-foreground hover:border-gold/30 hover:text-gold"
            )}
          >
            {kalshiPaused ? (
              <>
                <svg className="w-3 h-3" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                Resume Kalshi
              </>
            ) : (
              <>
                <svg className="w-3 h-3" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
                Pause Kalshi Only
              </>
            )}
          </button>
        </div>
      )}

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
              onClick={onNavigate}
              className={cn(
                "flex items-center gap-2.5 rounded-md px-3 py-2 text-[13px] font-medium transition-all duration-150",
                isActive
                  ? "bg-sidebar-accent text-teal"
                  : "text-[oklch(0.55_0.015_250)] hover:text-sidebar-foreground hover:bg-[oklch(0.94_0.006_90)]"
              )}
            >
              <item.icon className="h-[15px] w-[15px]" />
              {item.label}
              {item.label === "Signals" && (
                <span className="ml-auto text-[9px] font-mono text-gold bg-[oklch(0.65_0.16_85_/_0.10)] border border-[oklch(0.65_0.16_85_/_0.25)] rounded px-1 py-0.5 leading-none">
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
            <div className="flex-shrink-0 w-7 h-7 rounded-md bg-[oklch(0.55_0.18_175_/_0.10)] border border-[oklch(0.55_0.18_175_/_0.25)] flex items-center justify-center">
              <span className="text-[10px] font-bold text-teal">
                {profile?.display_name?.[0]?.toUpperCase() ?? "?"}
              </span>
            </div>
            <div className="min-w-0">
              <p className="text-[12px] font-medium text-sidebar-foreground truncate">
                {profile?.display_name ?? "User"}
              </p>
              <p className="text-[9px] font-mono text-[oklch(0.60_0.01_250)] uppercase">
                {profile?.role ?? "viewer"}
              </p>
            </div>
          </div>
          <button
            onClick={handleSignOut}
            className="text-[10px] text-[oklch(0.60_0.01_250)] hover:text-sidebar-foreground transition-colors"
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

function ActivityIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
    </svg>
  );
}

function CongressIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 20h20" />
      <path d="M5 20V8l7-5 7 5v12" />
      <path d="M9 20v-4h6v4" />
      <path d="M9 12h.01" />
      <path d="M15 12h.01" />
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

function KalshiIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <path d="M12 6v6l4 2" />
    </svg>
  );
}

function StrategyIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 20V10" />
      <path d="M18 20V4" />
      <path d="M6 20v-4" />
      <path d="M2 20h20" />
    </svg>
  );
}

function BriefingIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
      <path d="M14 2v4a2 2 0 0 0 2 2h4" />
      <path d="M16 13H8" />
      <path d="M16 17H8" />
      <path d="M10 9H8" />
    </svg>
  );
}

function WhaleIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 6c-3.5 0-6.5 2-8 5 1.5 3 4.5 5 8 5s6.5-2 8-5c-1.5-3-4.5-5-8-5Z" />
      <circle cx="12" cy="11" r="2" />
      <path d="M2 11s1-2 3-2" />
      <path d="M22 11s-1-2-3-2" />
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
