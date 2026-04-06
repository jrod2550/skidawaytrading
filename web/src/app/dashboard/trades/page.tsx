"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { Trade } from "@/lib/types/trading";

interface KalshiFill {
  fill_id: string;
  ticker: string;
  side: string;
  action: string;
  count: number;
  price_cents: number;
  cost_dollars: number;
  fee: number;
  total_cost_dollars: number;
  created_at: string;
}

interface KalshiSettlement {
  ticker: string;
  settled_at: string;
  revenue: number;
  cost: number;
  pnl: number;
  result: string;
}

interface KalshiPosition {
  ticker: string;
  market_title: string;
  side: string;
  position: number;
  exposure_dollars: number;
  realized_pnl_dollars: number;
  total_cost_dollars: number;
}

interface KalshiBalance {
  balance_dollars: number;
  portfolio_value_dollars: number;
  raw?: Record<string, unknown>;
}

interface UnifiedRow {
  id: string;
  platform: "kalshi" | "ibkr";
  type: "fill" | "settlement" | "position" | "trade";
  ticker: string;
  description: string;
  side?: string;
  quantity: number;
  cost: number;
  pnl: number | null;
  status: string;
  date: string;
  raw: unknown;
}

function fmtDate(dateStr: string) {
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" }) +
    " " + d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

export default function TradesPage() {
  const supabase = createClient();
  const [ibkrTrades, setIbkrTrades] = useState<Trade[]>([]);
  const [kalshiFills, setKalshiFills] = useState<KalshiFill[]>([]);
  const [kalshiSettlements, setKalshiSettlements] = useState<KalshiSettlement[]>([]);
  const [kalshiPositions, setKalshiPositions] = useState<KalshiPosition[]>([]);
  const [kalshiBalance, setKalshiBalance] = useState<KalshiBalance | null>(null);
  const [tab, setTab] = useState<"all" | "ibkr" | "kalshi">("all");

  useEffect(() => {
    async function load() {
      const { data } = await supabase
        .from("trades")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(100);
      if (data) setIbkrTrades(data);

      try {
        const [balResp, posResp] = await Promise.all([
          fetch("/api/kalshi?action=balance"),
          fetch("/api/kalshi?action=positions"),
        ]);
        if (balResp.ok) {
          const bd = await balResp.json();
          if (!bd.error) setKalshiBalance(bd);
        }
        if (posResp.ok) {
          const kd = await posResp.json();
          if (!kd.error) {
            setKalshiFills(kd.fills ?? []);
            setKalshiSettlements(kd.settlements ?? []);
            setKalshiPositions(kd.positions ?? []);
          }
        }
      } catch { /* */ }
    }
    load();
  }, []);

  // ── Unified timeline ──
  const rows: UnifiedRow[] = [];

  for (const f of kalshiFills) {
    rows.push({
      id: `fill-${f.fill_id}`,
      platform: "kalshi",
      type: "fill",
      ticker: f.ticker,
      description: `${f.action.toUpperCase()} ${f.side.toUpperCase()}`,
      side: f.side,
      quantity: f.count,
      cost: f.total_cost_dollars,
      pnl: null,
      status: "filled",
      date: f.created_at,
      raw: f,
    });
  }

  for (const s of kalshiSettlements) {
    rows.push({
      id: `settle-${s.ticker}-${s.settled_at}`,
      platform: "kalshi",
      type: "settlement",
      ticker: s.ticker,
      description: s.result === "WON" ? "SETTLED — WON" : s.result === "LOST" ? "SETTLED — LOST" : "SETTLED",
      quantity: 0,
      cost: s.cost,
      pnl: s.pnl,
      status: s.result.toLowerCase(),
      date: s.settled_at,
      raw: s,
    });
  }

  for (const t of ibkrTrades) {
    rows.push({
      id: `ibkr-${t.id}`,
      platform: "ibkr",
      type: "trade",
      ticker: t.ticker,
      description: `${t.action}${t.call_put ? ` ${t.strike} ${t.call_put}` : ""}`,
      quantity: t.quantity,
      cost: (t.fill_price ?? 0) * t.quantity * (t.call_put ? 100 : 1),
      pnl: null,
      status: t.status,
      date: t.created_at,
      raw: t,
    });
  }

  // Sort newest first
  rows.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  const filtered = tab === "all" ? rows : rows.filter((r) => r.platform === tab);

  // ── Stats ──
  const kalshiPnl = kalshiSettlements.reduce((s, x) => s + x.pnl, 0);
  const kalshiWins = kalshiSettlements.filter((s) => s.result === "WON").length;
  const kalshiLosses = kalshiSettlements.filter((s) => s.result === "LOST").length;
  const kalshiWinRate = kalshiSettlements.length > 0 ? Math.round((kalshiWins / kalshiSettlements.length) * 100) : 0;
  const kalshiTotalSpent = kalshiFills
    .filter((f) => f.action === "buy")
    .reduce((s, f) => s + f.total_cost_dollars, 0);
  const kalshiExposure = kalshiPositions.reduce((s, p) => s + p.exposure_dollars, 0);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Trade Log</h2>
        <p className="text-muted-foreground">All trades with cost and P&L — sorted newest first</p>
      </div>

      {/* ── Kalshi P&L Dashboard ── */}
      <div className="rounded-xl border-2 border-gold/20 bg-card p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-[oklch(0.65_0.16_85_/_0.12)] border border-gold/20 flex items-center justify-center text-sm font-bold text-gold">K</div>
            <h3 className="text-sm font-bold tracking-wide uppercase">Kalshi</h3>
          </div>
          {kalshiBalance && (
            <div className="text-right">
              <p className="text-xs text-muted-foreground">Account Balance</p>
              <p className="text-xl font-bold font-mono">${kalshiBalance.balance_dollars.toFixed(2)}</p>
            </div>
          )}
        </div>
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
          <div className="rounded-lg bg-muted px-3 py-2.5">
            <p className="text-[9px] uppercase tracking-wide text-muted-foreground">Net P&L</p>
            <p className={`text-lg font-bold font-mono ${kalshiPnl >= 0 ? "text-profit" : "text-loss"}`}>
              {kalshiPnl !== 0 ? `${kalshiPnl >= 0 ? "+" : ""}$${kalshiPnl.toFixed(2)}` : "$0.00"}
            </p>
          </div>
          <div className="rounded-lg bg-muted px-3 py-2.5">
            <p className="text-[9px] uppercase tracking-wide text-muted-foreground">Win Rate</p>
            <p className={`text-lg font-bold font-mono ${kalshiWinRate >= 50 ? "text-profit" : kalshiSettlements.length > 0 ? "text-loss" : ""}`}>
              {kalshiSettlements.length > 0 ? `${kalshiWinRate}%` : "--"}
            </p>
            {kalshiSettlements.length > 0 && (
              <p className="text-[9px] font-mono text-muted-foreground">{kalshiWins}W {kalshiLosses}L</p>
            )}
          </div>
          <div className="rounded-lg bg-muted px-3 py-2.5">
            <p className="text-[9px] uppercase tracking-wide text-muted-foreground">Spent</p>
            <p className="text-lg font-bold font-mono">${kalshiTotalSpent.toFixed(2)}</p>
          </div>
          <div className="rounded-lg bg-muted px-3 py-2.5">
            <p className="text-[9px] uppercase tracking-wide text-muted-foreground">Exposure</p>
            <p className="text-lg font-bold font-mono text-gold">${kalshiExposure.toFixed(2)}</p>
          </div>
          <div className="rounded-lg bg-muted px-3 py-2.5">
            <p className="text-[9px] uppercase tracking-wide text-muted-foreground">Open</p>
            <p className="text-lg font-bold font-mono">{kalshiPositions.length}</p>
          </div>
          <div className="rounded-lg bg-muted px-3 py-2.5">
            <p className="text-[9px] uppercase tracking-wide text-muted-foreground">Settled</p>
            <p className="text-lg font-bold font-mono">{kalshiSettlements.length}</p>
          </div>
        </div>
      </div>

      {/* ── IBKR Summary ── */}
      <div className="rounded-xl border-2 border-teal/20 bg-card p-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-[oklch(0.55_0.18_175_/_0.08)] border border-teal/20 flex items-center justify-center text-sm font-bold text-teal">IB</div>
            <h3 className="text-sm font-bold tracking-wide uppercase">IBKR Paper</h3>
          </div>
          <div className="flex items-center gap-4 text-right">
            <div>
              <p className="text-[9px] uppercase text-muted-foreground">Trades</p>
              <p className="text-lg font-bold font-mono">{ibkrTrades.length}</p>
            </div>
            <div>
              <p className="text-[9px] uppercase text-muted-foreground">Filled</p>
              <p className="text-lg font-bold font-mono text-profit">{ibkrTrades.filter((t) => t.status === "filled").length}</p>
            </div>
            <div>
              <p className="text-[9px] uppercase text-muted-foreground">Pending</p>
              <p className="text-lg font-bold font-mono text-gold">{ibkrTrades.filter((t) => t.status === "pending").length}</p>
            </div>
          </div>
        </div>
      </div>

      {/* ── Tabs ── */}
      <div className="flex gap-2">
        {[
          { key: "all", label: `All (${rows.length})` },
          { key: "kalshi", label: `Kalshi (${rows.filter((r) => r.platform === "kalshi").length})` },
          { key: "ibkr", label: `IBKR (${rows.filter((r) => r.platform === "ibkr").length})` },
        ].map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key as "all" | "ibkr" | "kalshi")}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
              tab === t.key ? "bg-teal text-teal-foreground" : "bg-card border border-border text-muted-foreground hover:text-foreground"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Open Kalshi Positions ── */}
      {(tab === "all" || tab === "kalshi") && kalshiPositions.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-[10px] font-semibold uppercase tracking-widest text-gold">Open Positions</h4>
          {kalshiPositions.map((pos, i) => (
            <div key={`pos-${pos.ticker}-${i}`} className="rounded-xl bg-card border border-gold/20 px-5 py-3">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <Badge variant="outline" className={`text-xs flex-shrink-0 ${pos.side === "YES" ? "border-profit text-profit" : "border-loss text-loss"}`}>
                    {pos.side}
                  </Badge>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold truncate">{pos.market_title}</p>
                    <p className="text-[10px] text-muted-foreground font-mono">{pos.ticker}</p>
                  </div>
                </div>
                <div className="flex items-center gap-4 flex-shrink-0 text-right">
                  <div>
                    <p className="text-[9px] uppercase text-muted-foreground">Qty</p>
                    <p className="text-sm font-mono font-bold">{pos.position}</p>
                  </div>
                  <div>
                    <p className="text-[9px] uppercase text-muted-foreground">Cost</p>
                    <p className="text-sm font-mono">${pos.total_cost_dollars.toFixed(2)}</p>
                  </div>
                  <div>
                    <p className="text-[9px] uppercase text-muted-foreground">Exposure</p>
                    <p className="text-sm font-mono font-bold text-gold">${pos.exposure_dollars.toFixed(2)}</p>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Unified Trade Timeline ── */}
      <div className="space-y-1.5">
        <h4 className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Trade History</h4>
        {filtered.length === 0 ? (
          <Card className="bg-card border-border">
            <CardContent className="py-12 text-center">
              <p className="text-muted-foreground">No trades yet.</p>
            </CardContent>
          </Card>
        ) : (
          filtered.map((row) => (
            <div
              key={row.id}
              className={`rounded-xl bg-card border px-5 py-3 ${
                row.type === "settlement" && row.status === "won" ? "border-profit/30" :
                row.type === "settlement" && row.status === "lost" ? "border-loss/30" :
                "border-border"
              }`}
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  {/* Platform badge */}
                  <div className={`w-9 h-9 rounded-lg flex items-center justify-center text-xs font-bold border flex-shrink-0 ${
                    row.platform === "kalshi"
                      ? row.type === "settlement"
                        ? row.status === "won"
                          ? "bg-[oklch(0.50_0.20_155_/_0.08)] border-[oklch(0.50_0.20_155_/_0.15)] text-profit"
                          : "bg-[oklch(0.52_0.22_25_/_0.08)] border-[oklch(0.52_0.22_25_/_0.15)] text-loss"
                        : "bg-[oklch(0.65_0.16_85_/_0.08)] border-[oklch(0.65_0.16_85_/_0.15)] text-gold"
                      : "bg-[oklch(0.55_0.18_175_/_0.08)] border-[oklch(0.55_0.18_175_/_0.15)] text-teal"
                  }`}>
                    {row.type === "settlement" ? (row.status === "won" ? "W" : "L") : row.platform === "kalshi" ? "K" : "IB"}
                  </div>

                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold truncate">
                        {row.ticker.length > 35 ? row.ticker.substring(0, 35) + "..." : row.ticker}
                      </p>
                      <Badge variant="outline" className="text-[8px] border-muted-foreground/30 text-muted-foreground flex-shrink-0">
                        {row.description}
                      </Badge>
                    </div>
                    <p className="text-[10px] text-muted-foreground font-mono">
                      {row.date ? fmtDate(row.date) : ""}
                      {row.quantity > 0 && ` · ${row.quantity}x`}
                      {row.type === "fill" && row.side && ` · ${row.side}`}
                    </p>
                  </div>
                </div>

                {/* Cost & P&L */}
                <div className="flex items-center gap-4 flex-shrink-0 text-right">
                  {row.cost > 0 && (
                    <div>
                      <p className="text-[9px] uppercase text-muted-foreground">Cost</p>
                      <p className="text-sm font-mono">${row.cost.toFixed(2)}</p>
                    </div>
                  )}
                  {row.pnl != null && (
                    <div>
                      <p className="text-[9px] uppercase text-muted-foreground">P&L</p>
                      <p className={`text-sm font-mono font-bold ${row.pnl >= 0 ? "text-profit" : "text-loss"}`}>
                        {row.pnl >= 0 ? "+" : ""}${row.pnl.toFixed(2)}
                      </p>
                    </div>
                  )}
                  <Badge variant="outline" className={`text-[9px] ${
                    row.status === "filled" || row.status === "won" ? "border-profit text-profit" :
                    row.status === "lost" || row.status === "failed" ? "border-loss text-loss" :
                    "border-gold text-gold"
                  }`}>
                    {row.status.toUpperCase()}
                  </Badge>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
