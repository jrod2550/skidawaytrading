"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface KalshiActivity {
  id: string;
  event_type: string;
  ticker: string | null;
  details: Record<string, unknown>;
  ai_reasoning: string | null;
  confidence_score: number | null;
  created_at: string;
}

function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default function KalshiPage() {
  const supabase = createClient();
  const [activity, setActivity] = useState<KalshiActivity[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    async function load() {
      const { data } = await supabase
        .from("ai_activity")
        .select("*")
        .like("ticker", "KALSHI%")
        .order("created_at", { ascending: false })
        .limit(100);
      if (data) setActivity(data);
    }
    load();

    const channel = supabase
      .channel("kalshi-activity")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "ai_activity" },
        (payload) => {
          const row = payload.new as KalshiActivity;
          if (row.ticker?.startsWith("KALSHI")) {
            setActivity((prev) => [row, ...prev].slice(0, 100));
          }
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, []);

  const trades = activity.filter((a) => a.event_type === "trade_executed");
  const scans = activity.filter((a) => a.event_type === "scan_started");
  const totalContracts = trades.reduce((sum, t) => {
    const contracts = Number((t.details as Record<string, unknown>)?.contracts ?? 0);
    return sum + contracts;
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
      <div className="flex items-center gap-3">
        <Image src="/kalshi.png" alt="Kalshi" width={36} height={36} className="rounded-lg" />
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Kalshi Predictions</h2>
          <p className="text-muted-foreground">
            AI-powered prediction market trading — crypto, climate, economics
          </p>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card className="bg-card border-border">
          <CardContent className="p-4">
            <p className="text-[10px] font-medium tracking-[0.1em] uppercase text-muted-foreground mb-1">
              Scans
            </p>
            <p className="text-xl font-bold font-mono">{scans.length}</p>
          </CardContent>
        </Card>
        <Card className="bg-card border-border">
          <CardContent className="p-4">
            <p className="text-[10px] font-medium tracking-[0.1em] uppercase text-muted-foreground mb-1">
              Trades
            </p>
            <p className="text-xl font-bold font-mono text-teal">{trades.length}</p>
          </CardContent>
        </Card>
        <Card className="bg-card border-border">
          <CardContent className="p-4">
            <p className="text-[10px] font-medium tracking-[0.1em] uppercase text-muted-foreground mb-1">
              Contracts
            </p>
            <p className="text-xl font-bold font-mono text-gold">{totalContracts}</p>
          </CardContent>
        </Card>
        <Card className="bg-card border-border">
          <CardContent className="p-4">
            <p className="text-[10px] font-medium tracking-[0.1em] uppercase text-muted-foreground mb-1">
              Mode
            </p>
            <p className="text-sm font-bold font-mono text-gold">LIVE</p>
          </CardContent>
        </Card>
      </div>

      {/* How it works */}
      <Card className="bg-card border-border border-teal/20">
        <CardContent className="p-5">
          <h3 className="text-sm font-semibold mb-2">How Kalshi Integration Works</h3>
          <div className="text-xs text-muted-foreground space-y-1.5 leading-relaxed">
            <p>The AI scans Kalshi prediction markets (crypto, climate, economics) and cross-references with Unusual Whales options flow data to find mispricings.</p>
            <p>Example: If massive call sweeps hit SPY and the Kalshi "S&P above 5200" market is priced at 50¢, the AI sees an edge — institutions are betting up, but the prediction market hasn't caught on yet.</p>
            <p>Trades auto-execute on Kalshi when edge exceeds 10% and AI confidence is 60+.</p>
          </div>
        </CardContent>
      </Card>

      {/* Activity feed */}
      {activity.length === 0 ? (
        <Card className="bg-card border-border">
          <CardContent className="py-12 text-center">
            <p className="text-muted-foreground">
              No Kalshi activity yet. The bot scans prediction markets every 5 minutes during trading hours.
            </p>
            <p className="text-xs text-muted-foreground mt-2">
              Set up your Kalshi API key in the .env file to get started.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {activity.map((event) => {
            const isExpanded = expanded.has(event.id);
            const details = event.details as Record<string, unknown>;
            const isTrade = event.event_type === "trade_executed";
            const isFailed = event.event_type === "trade_failed";

            return (
              <div
                key={event.id}
                className={`rounded-xl bg-card border transition-all ${
                  isTrade ? "border-teal/30" : isFailed ? "border-loss/30" : "border-border"
                }`}
              >
                <button
                  onClick={() => toggleExpand(event.id)}
                  className="w-full text-left px-5 py-4"
                >
                  <div className="flex items-center gap-3">
                    {/* Icon */}
                    <div className={`flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center text-xs font-mono font-bold border ${
                      isTrade ? "bg-[oklch(0.55_0.18_175_/_0.06)] border-[oklch(0.55_0.18_175_/_0.15)] text-teal" :
                      isFailed ? "bg-[oklch(0.52_0.22_25_/_0.06)] border-[oklch(0.52_0.22_25_/_0.15)] text-loss" :
                      "bg-[oklch(0.94_0.006_90)] border-border text-muted-foreground"
                    }`}>
                      {isTrade ? "K" : isFailed ? "!" : "S"}
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-semibold">
                          {event.ticker?.replace("KALSHI:", "") ?? "Kalshi"}
                        </span>
                        <Badge variant="outline" className={`text-[9px] ${
                          isTrade ? "border-teal text-teal" :
                          isFailed ? "border-loss text-loss" :
                          "border-muted-foreground text-muted-foreground"
                        }`}>
                          {event.event_type.replace(/_/g, " ").toUpperCase()}
                        </Badge>
                        {typeof details.side === "string" && (
                          <Badge variant="outline" className={`text-[9px] ${
                            details.side === "yes" ? "border-profit text-profit" : "border-loss text-loss"
                          }`}>
                            {details.side.toUpperCase()}
                          </Badge>
                        )}
                        {typeof details.category === "string" && (
                          <Badge variant="outline" className="text-[9px] border-gold text-gold">
                            {details.category}
                          </Badge>
                        )}
                        {event.confidence_score != null && (
                          <span className="text-[10px] font-mono text-gold">
                            conf: {event.confidence_score}
                          </span>
                        )}
                      </div>
                      {event.ai_reasoning && (
                        <p className="text-xs text-muted-foreground mt-1 truncate">
                          {event.ai_reasoning}
                        </p>
                      )}
                    </div>

                    <div className="flex items-center gap-2 flex-shrink-0">
                      {details.contracts != null && (
                        <span className="text-sm font-mono font-semibold">
                          {String(details.contracts ?? "")}x
                        </span>
                      )}
                      {details.price_cents != null && (
                        <span className="text-sm font-mono text-gold">
                          {String(details.price_cents ?? "")}¢
                        </span>
                      )}
                      <span className="text-[10px] text-muted-foreground">
                        {timeAgo(event.created_at)}
                      </span>
                    </div>
                  </div>
                </button>

                {isExpanded && (
                  <div className="px-5 pb-5 pt-0 border-t border-border mt-0 pt-4 space-y-4">
                    {/* AI Analysis / Cross-Reference Insights */}
                    {event.ai_reasoning && (
                      <div className="rounded-lg bg-[oklch(0.97_0.003_90)] border border-[oklch(0.92_0.006_90)] p-4">
                        <p className="text-[10px] uppercase tracking-wide text-teal font-semibold mb-2">AI Analysis</p>
                        <div className="text-sm leading-relaxed space-y-2">
                          {event.ai_reasoning.split("\n").filter(Boolean).map((paragraph, i) => {
                            // Check if it starts with "Cross-reference:"
                            if (paragraph.trim().startsWith("Cross-reference:") || paragraph.trim().startsWith("Cross-Reference:")) {
                              return (
                                <div key={i} className="rounded-md bg-[oklch(0.55_0.18_175_/_0.04)] border border-teal/15 p-3 mt-2">
                                  <p className="text-[9px] uppercase tracking-wide text-teal font-semibold mb-1">Cross-Reference Intelligence</p>
                                  <p className="text-xs leading-relaxed">{paragraph.replace(/^Cross-[Rr]eference:\s*/, "")}</p>
                                </div>
                              );
                            }
                            return <p key={i}>{paragraph}</p>;
                          })}
                        </div>
                      </div>
                    )}

                    {/* Trade Metrics */}
                    {(details.edge_pct != null || details.estimated_prob != null || details.price_cents != null) && (
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                        {details.edge_pct != null && (
                          <div className="rounded-md bg-muted px-3 py-2 text-center">
                            <p className="text-[9px] uppercase text-muted-foreground">Edge</p>
                            <p className="text-sm font-mono font-bold text-profit">{String(details.edge_pct)}%</p>
                          </div>
                        )}
                        {details.estimated_prob != null && (
                          <div className="rounded-md bg-muted px-3 py-2 text-center">
                            <p className="text-[9px] uppercase text-muted-foreground">AI Estimate</p>
                            <p className="text-sm font-mono font-bold">{String(details.estimated_prob)}%</p>
                          </div>
                        )}
                        {details.price_cents != null && (
                          <div className="rounded-md bg-muted px-3 py-2 text-center">
                            <p className="text-[9px] uppercase text-muted-foreground">Market Price</p>
                            <p className="text-sm font-mono font-bold text-gold">{String(details.price_cents)}¢</p>
                          </div>
                        )}
                        {details.contracts != null && (
                          <div className="rounded-md bg-muted px-3 py-2 text-center">
                            <p className="text-[9px] uppercase text-muted-foreground">Contracts</p>
                            <p className="text-sm font-mono font-bold">{String(details.contracts)}x</p>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Suggested Trade Card */}
                    {(typeof details.side === "string" || typeof details.recommendation === "string") && (
                      <div className={`rounded-lg border-2 p-4 ${
                        details.side === "yes" || String(details.recommendation ?? "").includes("YES")
                          ? "border-profit/30 bg-[oklch(0.50_0.20_155_/_0.03)]"
                          : "border-loss/30 bg-[oklch(0.52_0.22_25_/_0.03)]"
                      }`}>
                        <p className="text-[9px] uppercase tracking-wide text-gold font-semibold mb-2">Suggested Trade</p>
                        <div className="flex items-center gap-3 flex-wrap">
                          <Badge variant="outline" className={`text-xs px-2 py-0.5 ${
                            details.side === "yes" || String(details.recommendation ?? "").includes("YES")
                              ? "border-profit text-profit"
                              : "border-loss text-loss"
                          }`}>
                            {String(details.recommendation || `BUY ${String(details.side ?? "").toUpperCase()}`)}
                          </Badge>
                          {details.contracts != null && (
                            <span className="text-sm font-mono">{String(details.contracts)}x contracts</span>
                          )}
                          {details.price_cents != null && (
                            <span className="text-sm font-mono">@ {String(details.price_cents)}¢</span>
                          )}
                          {typeof details.category === "string" && (
                            <Badge variant="outline" className="text-[9px] border-gold text-gold">{details.category}</Badge>
                          )}
                        </div>
                        {typeof details.cross_reference === "string" && details.cross_reference && (
                          <p className="text-[10px] text-muted-foreground mt-2">
                            UW Cross-ref: {details.cross_reference}
                          </p>
                        )}
                      </div>
                    )}

                    {/* Signal Created — show market summary for scan results */}
                    {event.event_type === "signal_created" && details.markets_scanned != null && (
                      <div className="text-xs font-mono text-muted-foreground flex flex-wrap gap-3">
                        <span>Scanned: {String(details.markets_scanned ?? "")}</span>
                        <span>Analyzed: {String(details.markets_analyzed ?? "")}</span>
                        <span>Trades: {String(details.trades_placed ?? "0")}</span>
                        <span>Recs: {String(details.recommendations ?? "0")}</span>
                        {Array.isArray(details.categories_found) && (
                          <span>Categories: {(details.categories_found as string[]).join(", ")}</span>
                        )}
                        {typeof details.model === "string" && (
                          <span>Model: <span className="text-teal">{details.model}</span></span>
                        )}
                      </div>
                    )}

                    {/* Raw details for other event types */}
                    {event.event_type === "error" && Object.keys(details).length > 0 && (
                      <div>
                        <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Error Details</p>
                        <div className="text-xs font-mono bg-muted rounded-md px-3 py-2 space-y-0.5">
                          {Object.entries(details).filter(([k]) => k !== "traceback").map(([k, v]) => (
                            <div key={k} className="flex justify-between gap-4">
                              <span className="text-muted-foreground flex-shrink-0">{k.replace(/_/g, " ")}</span>
                              <span className="text-right truncate">{String(v ?? "")}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
