"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { PoolSnapshot, Position, Signal, Trade } from "@/lib/types/trading";

/* ── Formatters ─────────────────────────────────────────── */

function fmtCurrency(n: number | null, compact = false) {
  if (n == null) return "—";
  if (compact && Math.abs(n) >= 1000) {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      notation: "compact",
      maximumFractionDigits: 1,
    }).format(n);
  }
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(n);
}

function fmtPct(n: number | null) {
  if (n == null) return "—";
  const sign = n >= 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}%`;
}

function fmtGreek(n: number | null) {
  if (n == null) return "—";
  return n.toFixed(2);
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

/* ── Mini Sparkline ─────────────────────────────────────── */

function Sparkline({ data, color = "teal" }: { data: number[]; color?: string }) {
  if (data.length < 2) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const w = 120;
  const h = 32;
  const points = data
    .map((v, i) => {
      const x = (i / (data.length - 1)) * w;
      const y = h - ((v - min) / range) * h;
      return `${x},${y}`;
    })
    .join(" ");

  const strokeColor =
    color === "profit"
      ? "oklch(0.70 0.22 155)"
      : color === "loss"
        ? "oklch(0.62 0.22 25)"
        : "oklch(0.72 0.15 175)";

  const lastPoint = data[data.length - 1];
  const firstPoint = data[0];
  const fillColor =
    lastPoint >= firstPoint
      ? "oklch(0.70 0.22 155 / 0.08)"
      : "oklch(0.62 0.22 25 / 0.08)";

  return (
    <svg width={w} height={h} className="overflow-visible">
      <defs>
        <linearGradient id={`grad-${color}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={fillColor} />
          <stop offset="100%" stopColor="transparent" />
        </linearGradient>
      </defs>
      <polyline
        points={`0,${h} ${points} ${w},${h}`}
        fill={`url(#grad-${color})`}
      />
      <polyline
        points={points}
        fill="none"
        stroke={strokeColor}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle
        cx={w}
        cy={parseFloat(points.split(" ").pop()?.split(",")[1] ?? "0")}
        r="2"
        fill={strokeColor}
      />
    </svg>
  );
}

/* ── Confidence Ring ────────────────────────────────────── */

function ConfidenceRing({ score }: { score: number }) {
  const radius = 18;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (score / 100) * circumference;
  const color =
    score >= 80
      ? "oklch(0.70 0.22 155)"
      : score >= 60
        ? "oklch(0.78 0.14 85)"
        : "oklch(0.55 0.015 250)";

  return (
    <div className="relative inline-flex items-center justify-center">
      <svg width="44" height="44" className="-rotate-90">
        <circle
          cx="22"
          cy="22"
          r={radius}
          fill="none"
          stroke="oklch(0.20 0.012 250)"
          strokeWidth="3"
        />
        <circle
          cx="22"
          cy="22"
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className="transition-all duration-700 ease-out"
        />
      </svg>
      <span
        className="absolute text-[11px] font-mono font-bold"
        style={{ color }}
      >
        {score.toFixed(0)}
      </span>
    </div>
  );
}

/* ── Source Icon ─────────────────────────────────────────── */

function SourceIcon({ source }: { source: string }) {
  const icons: Record<string, string> = {
    congressional: "C",
    flow: "F",
    polymarket: "P",
    manual: "M",
  };
  const colors: Record<string, string> = {
    congressional: "bg-[oklch(0.72_0.15_175_/_0.12)] text-teal border-[oklch(0.72_0.15_175_/_0.25)]",
    flow: "bg-[oklch(0.78_0.14_85_/_0.12)] text-gold border-[oklch(0.78_0.14_85_/_0.25)]",
    polymarket: "bg-[oklch(0.60_0.12_200_/_0.12)] text-[oklch(0.65_0.12_200)] border-[oklch(0.60_0.12_200_/_0.25)]",
    manual: "bg-[oklch(0.55_0.015_250_/_0.12)] text-muted-foreground border-[oklch(0.30_0.01_250)]",
  };

  return (
    <div
      className={`flex items-center justify-center w-7 h-7 rounded-md border text-[10px] font-mono font-bold ${colors[source] ?? colors.manual}`}
    >
      {icons[source] ?? "?"}
    </div>
  );
}

/* ── Dashboard Page ─────────────────────────────────────── */

export default function DashboardOverview() {
  const supabase = createClient();
  const [snapshot, setSnapshot] = useState<PoolSnapshot | null>(null);
  const [snapHistory, setSnapHistory] = useState<number[]>([]);
  const [positions, setPositions] = useState<Position[]>([]);
  const [pendingSignals, setPendingSignals] = useState<Signal[]>([]);
  const [recentTrades, setRecentTrades] = useState<Trade[]>([]);

  useEffect(() => {
    async function load() {
      const [snapRes, histRes, posRes, sigRes, tradeRes] = await Promise.all([
        supabase
          .from("pool_snapshots")
          .select("*")
          .order("snapshot_at", { ascending: false })
          .limit(1)
          .single(),
        supabase
          .from("pool_snapshots")
          .select("total_value")
          .order("snapshot_at", { ascending: false })
          .limit(30),
        supabase
          .from("positions")
          .select("*")
          .eq("is_open", true)
          .order("market_value", { ascending: false }),
        supabase
          .from("signals")
          .select("*")
          .eq("status", "pending")
          .order("created_at", { ascending: false })
          .limit(6),
        supabase
          .from("trades")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(5),
      ]);

      if (snapRes.data) setSnapshot(snapRes.data);
      if (histRes.data)
        setSnapHistory(histRes.data.map((s: { total_value: number }) => s.total_value).reverse());
      if (posRes.data) setPositions(posRes.data);
      if (sigRes.data) setPendingSignals(sigRes.data);
      if (tradeRes.data) setRecentTrades(tradeRes.data);
    }

    load();

    const channel = supabase
      .channel("dashboard-overview")
      .on("postgres_changes", { event: "*", schema: "public", table: "pool_snapshots" }, () => load())
      .on("postgres_changes", { event: "*", schema: "public", table: "positions" }, () => load())
      .on("postgres_changes", { event: "*", schema: "public", table: "signals" }, () => load())
      .on("postgres_changes", { event: "*", schema: "public", table: "trades" }, () => load())
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const totalPnl = positions.reduce((sum, p) => sum + (p.unrealized_pnl ?? 0), 0);
  const portfolioDelta = positions.reduce((sum, p) => sum + (p.delta ?? 0) * p.quantity, 0);
  const portfolioTheta = positions.reduce((sum, p) => sum + (p.theta ?? 0) * p.quantity, 0);

  return (
    <div className="space-y-6">
      {/* Header row with wave accent */}
      <div className="relative overflow-hidden rounded-xl bg-[oklch(0.12_0.010_250)] border border-border p-6">
        {/* Background wave */}
        <svg
          className="absolute right-0 top-0 h-full w-1/2 opacity-[0.04]"
          viewBox="0 0 400 200"
          preserveAspectRatio="none"
          fill="none"
        >
          <path
            d="M0 100 Q50 40 100 80 Q150 120 200 60 Q250 0 300 80 Q350 160 400 100 L400 200 L0 200Z"
            fill="oklch(0.72 0.15 175)"
          />
        </svg>

        <div className="relative z-10 flex items-end justify-between">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <h2 className="text-[11px] font-medium tracking-[0.15em] uppercase text-sand">
                Pool Value
              </h2>
              <div className="flex items-center gap-1.5">
                <div className="h-1.5 w-1.5 rounded-full bg-teal animate-pulse-live" />
                <span className="text-[10px] text-teal font-mono">LIVE</span>
              </div>
            </div>
            <p className="text-[2.5rem] font-semibold tracking-[-0.03em] leading-none animate-count font-mono">
              {fmtCurrency(snapshot?.total_value ?? null)}
            </p>
            <div className="mt-2 flex items-center gap-4">
              <span
                className={`text-sm font-mono font-medium ${(snapshot?.daily_pnl ?? 0) >= 0 ? "text-profit" : "text-loss"}`}
              >
                {fmtCurrency(snapshot?.daily_pnl ?? null)} today
              </span>
              <span className="text-[oklch(0.30_0.01_250)]">|</span>
              <span
                className={`text-sm font-mono font-medium ${totalPnl >= 0 ? "text-profit" : "text-loss"}`}
              >
                {fmtCurrency(totalPnl)} unrealized
              </span>
            </div>
          </div>

          <div className="hidden md:block">
            <Sparkline
              data={snapHistory.length > 1 ? snapHistory : [15000, 15000]}
              color={
                snapHistory.length > 1 && snapHistory[snapHistory.length - 1] >= snapHistory[0]
                  ? "profit"
                  : "loss"
              }
            />
          </div>
        </div>
      </div>

      {/* Metric strip */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        {[
          { label: "Cash", value: fmtCurrency(snapshot?.cash_balance ?? null), mono: true },
          { label: "Positions", value: `${positions.length}`, mono: true },
          { label: "Signals", value: `${pendingSignals.length} pending`, color: pendingSignals.length > 0 ? "text-gold" : undefined },
          { label: "Net Delta", value: fmtGreek(portfolioDelta), mono: true },
          { label: "Daily Theta", value: `$${portfolioTheta.toFixed(0)}`, mono: true, color: portfolioTheta < 0 ? "text-loss" : "text-profit" },
        ].map((m, i) => (
          <div
            key={m.label}
            className="animate-fade-up rounded-lg bg-card border border-border px-4 py-3"
            style={{ animationDelay: `${i * 60}ms` }}
          >
            <p className="text-[10px] font-medium tracking-[0.1em] uppercase text-muted-foreground mb-1">
              {m.label}
            </p>
            <p className={`text-lg font-semibold tracking-tight ${m.mono ? "font-mono" : ""} ${m.color ?? ""}`}>
              {m.value}
            </p>
          </div>
        ))}
      </div>

      {/* Three-column grid */}
      <div className="grid gap-4 lg:grid-cols-3">
        {/* ── Positions Column ─────────────────────── */}
        <Card className="lg:col-span-1 bg-card border-border">
          <CardContent className="p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-[11px] font-medium tracking-[0.15em] uppercase text-sand">
                Positions
              </h3>
              <span className="text-[10px] font-mono text-muted-foreground">
                {positions.length} open
              </span>
            </div>

            {positions.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 text-center">
                <div className="w-10 h-10 rounded-full bg-[oklch(0.14_0.012_250)] border border-border flex items-center justify-center mb-3">
                  <svg className="w-5 h-5 text-muted-foreground" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path d="M22 7 13.5 15.5 8.5 10.5 2 17" strokeLinecap="round" strokeLinejoin="round" />
                    <path d="M16 7h6v6" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>
                <p className="text-xs text-muted-foreground">No open positions</p>
                <p className="text-[10px] text-[oklch(0.35_0.01_250)] mt-1">
                  Signals will generate positions automatically
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {positions.slice(0, 6).map((pos) => (
                  <div
                    key={pos.id}
                    className="group flex items-center justify-between rounded-lg bg-[oklch(0.11_0.010_250)] border border-[oklch(0.18_0.012_250)] px-3 py-2.5 hover:border-[oklch(0.25_0.012_250)] transition-colors"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="flex-shrink-0">
                        <div
                          className={`w-8 h-8 rounded-md flex items-center justify-center text-[10px] font-mono font-bold border ${
                            pos.call_put === "call"
                              ? "bg-[oklch(0.70_0.22_155_/_0.08)] text-profit border-[oklch(0.70_0.22_155_/_0.2)]"
                              : pos.call_put === "put"
                                ? "bg-[oklch(0.62_0.22_25_/_0.08)] text-loss border-[oklch(0.62_0.22_25_/_0.2)]"
                                : "bg-[oklch(0.18_0.012_250)] text-muted-foreground border-border"
                          }`}
                        >
                          {pos.call_put ? pos.call_put[0].toUpperCase() : "EQ"}
                        </div>
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-semibold tracking-tight truncate">
                          {pos.ticker}
                        </p>
                        <p className="text-[10px] text-muted-foreground font-mono">
                          {pos.call_put
                            ? `${pos.strike} · ${pos.expiry} · x${pos.quantity}`
                            : `x${pos.quantity}`}
                        </p>
                      </div>
                    </div>
                    <div className="text-right flex-shrink-0 ml-2">
                      <p className="text-sm font-mono font-medium">
                        {fmtCurrency(pos.market_value)}
                      </p>
                      <p
                        className={`text-[11px] font-mono ${
                          (pos.pnl_pct ?? 0) >= 0 ? "text-profit" : "text-loss"
                        }`}
                      >
                        {fmtPct(pos.pnl_pct)}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* ── Signals Column ──────────────────────── */}
        <Card className="lg:col-span-1 bg-card border-border">
          <CardContent className="p-5">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <h3 className="text-[11px] font-medium tracking-[0.15em] uppercase text-sand">
                  AI Signals
                </h3>
                {pendingSignals.length > 0 && (
                  <div className="flex items-center gap-1 rounded-full bg-[oklch(0.78_0.14_85_/_0.10)] border border-[oklch(0.78_0.14_85_/_0.25)] px-2 py-0.5">
                    <div className="h-1 w-1 rounded-full bg-gold animate-pulse-live" />
                    <span className="text-[9px] font-mono font-bold text-gold">
                      {pendingSignals.length}
                    </span>
                  </div>
                )}
              </div>
              <span className="text-[10px] font-mono text-muted-foreground">
                pending review
              </span>
            </div>

            {pendingSignals.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 text-center">
                <div className="w-10 h-10 rounded-full bg-[oklch(0.14_0.012_250)] border border-border flex items-center justify-center mb-3">
                  <svg className="w-5 h-5 text-muted-foreground" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>
                <p className="text-xs text-muted-foreground">No pending signals</p>
                <p className="text-[10px] text-[oklch(0.35_0.01_250)] mt-1">
                  Claude AI is monitoring flow data
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {pendingSignals.map((sig) => (
                  <div
                    key={sig.id}
                    className="group rounded-lg bg-[oklch(0.11_0.010_250)] border border-[oklch(0.18_0.012_250)] px-3 py-2.5 hover:border-[oklch(0.25_0.012_250)] transition-colors"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2.5">
                        <SourceIcon source={sig.source} />
                        <div>
                          <div className="flex items-center gap-1.5">
                            <span className="text-sm font-semibold tracking-tight">
                              {sig.ticker}
                            </span>
                            <Badge
                              variant="outline"
                              className={`text-[9px] px-1.5 py-0 h-4 font-mono ${
                                sig.direction === "bullish"
                                  ? "border-[oklch(0.70_0.22_155_/_0.3)] text-profit bg-[oklch(0.70_0.22_155_/_0.06)]"
                                  : "border-[oklch(0.62_0.22_25_/_0.3)] text-loss bg-[oklch(0.62_0.22_25_/_0.06)]"
                              }`}
                            >
                              {sig.direction === "bullish" ? "LONG" : "SHORT"}
                            </Badge>
                          </div>
                          <p className="text-[10px] text-muted-foreground">
                            {sig.suggested_action ?? sig.source} · {timeAgo(sig.created_at)}
                          </p>
                        </div>
                      </div>
                      <ConfidenceRing score={sig.confidence_score ?? 0} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* ── Activity Feed Column ────────────────── */}
        <Card className="lg:col-span-1 bg-card border-border">
          <CardContent className="p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-[11px] font-medium tracking-[0.15em] uppercase text-sand">
                Recent Activity
              </h3>
              <span className="text-[10px] font-mono text-muted-foreground">
                trades
              </span>
            </div>

            {recentTrades.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 text-center">
                <div className="w-10 h-10 rounded-full bg-[oklch(0.14_0.012_250)] border border-border flex items-center justify-center mb-3">
                  <svg className="w-5 h-5 text-muted-foreground" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path d="m16 3 4 4-4 4" strokeLinecap="round" strokeLinejoin="round" />
                    <path d="M20 7H4" strokeLinecap="round" strokeLinejoin="round" />
                    <path d="m8 21-4-4 4-4" strokeLinecap="round" strokeLinejoin="round" />
                    <path d="M4 17h16" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>
                <p className="text-xs text-muted-foreground">No trades yet</p>
                <p className="text-[10px] text-[oklch(0.35_0.01_250)] mt-1">
                  Approved signals will execute here
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {recentTrades.map((trade) => {
                  const isBuy = trade.action.toLowerCase().includes("buy") || trade.action.toLowerCase().includes("bto");
                  return (
                    <div
                      key={trade.id}
                      className="rounded-lg bg-[oklch(0.11_0.010_250)] border border-[oklch(0.18_0.012_250)] px-3 py-2.5"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2.5">
                          <div
                            className={`w-7 h-7 rounded-md flex items-center justify-center border text-[10px] font-mono font-bold ${
                              isBuy
                                ? "bg-[oklch(0.70_0.22_155_/_0.08)] text-profit border-[oklch(0.70_0.22_155_/_0.2)]"
                                : "bg-[oklch(0.62_0.22_25_/_0.08)] text-loss border-[oklch(0.62_0.22_25_/_0.2)]"
                            }`}
                          >
                            {isBuy ? "B" : "S"}
                          </div>
                          <div>
                            <p className="text-sm font-semibold tracking-tight">
                              {trade.ticker}
                            </p>
                            <p className="text-[10px] text-muted-foreground font-mono">
                              {trade.action} · x{trade.quantity}
                              {trade.strike ? ` · ${trade.strike}${trade.call_put?.[0]?.toUpperCase() ?? ""}` : ""}
                            </p>
                          </div>
                        </div>
                        <div className="text-right">
                          <Badge
                            variant="outline"
                            className={`text-[9px] px-1.5 py-0 h-4 font-mono ${
                              trade.status === "filled"
                                ? "border-[oklch(0.70_0.22_155_/_0.3)] text-profit"
                                : trade.status === "failed"
                                  ? "border-[oklch(0.62_0.22_25_/_0.3)] text-loss"
                                  : "border-[oklch(0.78_0.14_85_/_0.3)] text-gold"
                            }`}
                          >
                            {trade.status.toUpperCase()}
                          </Badge>
                          <p className="text-[10px] text-muted-foreground mt-0.5">
                            {timeAgo(trade.created_at)}
                          </p>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
