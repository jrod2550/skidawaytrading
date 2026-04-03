"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface ActivityEvent {
  id: string;
  event_type: string;
  ticker: string | null;
  details: Record<string, unknown>;
  ai_reasoning: string | null;
  confidence_score: number | null;
  created_at: string;
}

const EVENT_CONFIG: Record<string, { label: string; color: string; icon: string }> = {
  scan_started: { label: "Scan Started", color: "text-muted-foreground border-muted-foreground", icon: "⟳" },
  flow_screened: { label: "Flow Screened", color: "text-muted-foreground border-muted-foreground", icon: "◎" },
  flow_escalated: { label: "Escalated", color: "text-gold border-gold", icon: "⬆" },
  flow_rejected: { label: "Rejected", color: "text-muted-foreground border-[oklch(0.80_0.01_250)]", icon: "✕" },
  deep_analysis: { label: "AI Analysis", color: "text-teal border-teal", icon: "◈" },
  signal_created: { label: "Signal Created", color: "text-gold border-gold", icon: "★" },
  signal_auto_approved: { label: "Auto Approved", color: "text-profit border-profit", icon: "✓" },
  trade_executed: { label: "Trade Executed", color: "text-profit border-profit", icon: "◆" },
  trade_failed: { label: "Trade Failed", color: "text-loss border-loss", icon: "✕" },
  risk_blocked: { label: "Risk Blocked", color: "text-loss border-loss", icon: "⊘" },
  congressional_scan: { label: "Congress Scan", color: "text-teal border-teal", icon: "◉" },
  position_sync: { label: "Position Sync", color: "text-muted-foreground border-muted-foreground", icon: "↻" },
  error: { label: "Error", color: "text-loss border-loss", icon: "⚠" },
};

function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const secs = Math.floor(diff / 1000);
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default function ActivityPage() {
  const supabase = createClient();
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [filter, setFilter] = useState<string>("all");

  useEffect(() => {
    async function load() {
      const { data } = await supabase
        .from("ai_activity")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(200);
      if (data) setEvents(data);
    }

    load();

    const channel = supabase
      .channel("ai-activity")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "ai_activity" },
        (payload) => {
          setEvents((prev) => [payload.new as ActivityEvent, ...prev].slice(0, 200));
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const filtered =
    filter === "all"
      ? events
      : filter === "important"
        ? events.filter((e) =>
            ["flow_escalated", "deep_analysis", "signal_created", "signal_auto_approved", "trade_executed", "trade_failed", "risk_blocked"].includes(e.event_type)
          )
        : events.filter((e) => e.event_type === filter);

  const signalCount = events.filter((e) => e.event_type === "signal_created").length;
  const tradeCount = events.filter((e) => e.event_type === "trade_executed").length;
  const blockedCount = events.filter((e) => e.event_type === "risk_blocked").length;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">AI Activity</h2>
        <p className="text-muted-foreground">
          Real-time feed of everything the AI is doing
        </p>
      </div>

      {/* Stats strip */}
      <div className="grid grid-cols-4 gap-3">
        <Card className="bg-card border-border">
          <CardContent className="p-3">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Total Events</p>
            <p className="text-lg font-bold font-mono">{events.length}</p>
          </CardContent>
        </Card>
        <Card className="bg-card border-border">
          <CardContent className="p-3">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Signals</p>
            <p className="text-lg font-bold font-mono text-gold">{signalCount}</p>
          </CardContent>
        </Card>
        <Card className="bg-card border-border">
          <CardContent className="p-3">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Trades</p>
            <p className="text-lg font-bold font-mono text-profit">{tradeCount}</p>
          </CardContent>
        </Card>
        <Card className="bg-card border-border">
          <CardContent className="p-3">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Blocked</p>
            <p className="text-lg font-bold font-mono text-loss">{blockedCount}</p>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex gap-2 flex-wrap">
        {[
          { key: "all", label: "All" },
          { key: "important", label: "Important" },
          { key: "signal_created", label: "Signals" },
          { key: "trade_executed", label: "Trades" },
          { key: "flow_escalated", label: "Escalated" },
          { key: "risk_blocked", label: "Blocked" },
        ].map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
              filter === f.key
                ? "bg-teal text-teal-foreground"
                : "bg-card border border-border text-muted-foreground hover:text-foreground"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Activity feed */}
      <div className="space-y-1.5">
        {filtered.length === 0 ? (
          <Card className="bg-card border-border">
            <CardContent className="py-12 text-center">
              <p className="text-muted-foreground">No activity yet — start the bot to see events flow in</p>
            </CardContent>
          </Card>
        ) : (
          filtered.map((event) => {
            const config = EVENT_CONFIG[event.event_type] ?? EVENT_CONFIG.error;
            return (
              <div
                key={event.id}
                className="flex items-start gap-3 rounded-lg bg-card border border-border px-4 py-3 hover:border-[oklch(0.82_0.01_175)] transition-colors"
              >
                <span className="text-base mt-0.5 w-5 text-center flex-shrink-0">{config.icon}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant="outline" className={`text-[9px] ${config.color}`}>
                      {config.label}
                    </Badge>
                    {event.ticker && (
                      <span className="text-sm font-semibold">{event.ticker}</span>
                    )}
                    {event.confidence_score != null && (
                      <span className="text-[10px] font-mono text-gold">
                        score: {event.confidence_score}
                      </span>
                    )}
                    <span className="text-[10px] text-muted-foreground ml-auto flex-shrink-0">
                      {timeAgo(event.created_at)}
                    </span>
                  </div>
                  {event.ai_reasoning && (
                    <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                      {event.ai_reasoning}
                    </p>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
