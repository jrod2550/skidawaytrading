"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface TokenUsage {
  model: string;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  cost_usd: number;
  session_cost_usd: number;
}

interface ActivityEvent {
  id: string;
  event_type: string;
  ticker: string | null;
  details: Record<string, unknown> & { token_usage?: TokenUsage };
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
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

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

  const totalTokenCost = events.reduce((sum, e) => {
    const cost = (e.details?.token_usage as TokenUsage | undefined)?.cost_usd ?? 0;
    return sum + cost;
  }, 0);
  const totalTokens = events.reduce((sum, e) => {
    const tokens = (e.details?.token_usage as TokenUsage | undefined)?.total_tokens ?? 0;
    return sum + tokens;
  }, 0);

  function toggleExpand(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">AI Activity</h2>
        <p className="text-muted-foreground">
          Real-time feed of everything the AI is doing
        </p>
      </div>

      {/* Stats strip */}
      <div className="grid grid-cols-3 lg:grid-cols-6 gap-3">
        <Card className="bg-card border-border">
          <CardContent className="p-3">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Events</p>
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
        <Card className="bg-card border-border">
          <CardContent className="p-3">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">AI Tokens</p>
            <p className="text-lg font-bold font-mono">{totalTokens > 0 ? `${(totalTokens / 1000).toFixed(1)}k` : "—"}</p>
          </CardContent>
        </Card>
        <Card className="bg-card border-border">
          <CardContent className="p-3">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">AI Cost</p>
            <p className="text-lg font-bold font-mono">{totalTokenCost > 0 ? `$${totalTokenCost.toFixed(4)}` : "—"}</p>
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
            const isExpanded = expanded.has(event.id);
            const tokenUsage = event.details?.token_usage as TokenUsage | undefined;
            const hasDetails = event.ai_reasoning || tokenUsage || Object.keys(event.details ?? {}).length > 1;

            return (
              <div
                key={event.id}
                className="rounded-lg bg-card border border-border hover:border-[oklch(0.82_0.01_175)] transition-colors"
              >
                <button
                  onClick={() => hasDetails && toggleExpand(event.id)}
                  className="flex items-start gap-3 w-full text-left px-4 py-3"
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
                      {tokenUsage && (
                        <span className="text-[10px] font-mono text-muted-foreground">
                          {tokenUsage.total_tokens}tok · ${tokenUsage.cost_usd.toFixed(4)}
                        </span>
                      )}
                      <span className="text-[10px] text-muted-foreground ml-auto flex-shrink-0 flex items-center gap-1">
                        {timeAgo(event.created_at)}
                        {hasDetails && (
                          <svg className={`w-3 h-3 transition-transform ${isExpanded ? "rotate-180" : ""}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="m6 9 6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        )}
                      </span>
                    </div>
                    {!isExpanded && event.ai_reasoning && (
                      <p className="text-xs text-muted-foreground mt-1 leading-relaxed truncate">
                        {event.ai_reasoning}
                      </p>
                    )}
                  </div>
                </button>

                {isExpanded && (
                  <div className="px-4 pb-4 pt-0 ml-8 space-y-3 border-t border-border mt-0 pt-3">
                    {event.ai_reasoning && (
                      <div>
                        <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">AI Reasoning</p>
                        <p className="text-sm leading-relaxed">{event.ai_reasoning}</p>
                      </div>
                    )}

                    {Array.isArray(event.details?.risk_factors) && (event.details.risk_factors as string[]).length > 0 && (
                      <div>
                        <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Risk Factors</p>
                        <ul className="text-xs text-muted-foreground space-y-0.5">
                          {(event.details.risk_factors as string[]).map((r: string, i: number) => (
                            <li key={i} className="flex items-center gap-1.5">
                              <span className="text-loss">-</span> {String(r)}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {event.details?.recommended_trade != null && typeof event.details.recommended_trade === "object" && (
                      <div>
                        <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Recommended Trade</p>
                        <div className="text-xs font-mono bg-muted rounded-md px-3 py-2 space-y-0.5">
                          {Object.entries(event.details.recommended_trade as Record<string, unknown>).map(([k, v]) => (
                            <div key={k} className="flex justify-between">
                              <span className="text-muted-foreground">{k.replace(/_/g, " ")}</span>
                              <span>{String(v)}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {tokenUsage && (
                      <div>
                        <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Token Usage</p>
                        <div className="flex gap-4 text-xs font-mono">
                          <span>Model: <span className="text-teal">{tokenUsage.model.split("-").slice(-1)[0]}</span></span>
                          <span>In: {tokenUsage.input_tokens.toLocaleString()}</span>
                          <span>Out: {tokenUsage.output_tokens.toLocaleString()}</span>
                          <span>Cost: <span className="text-gold">${tokenUsage.cost_usd.toFixed(4)}</span></span>
                        </div>
                      </div>
                    )}

                    {event.details?.premium != null && (
                      <div className="text-xs font-mono text-muted-foreground">
                        Premium: ${Number(event.details.premium).toLocaleString()}
                        {event.details?.haiku_score != null && ` · Haiku: ${event.details.haiku_score}`}
                        {event.details?.sonnet_confidence != null && ` · Sonnet: ${event.details.sonnet_confidence}`}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
