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
  yes_price_cents: number;
  no_price_cents: number;
  fee: number;
  created_at: string;
}

interface KalshiSettlement {
  ticker: string;
  settled_at: string;
  revenue: number;
  pnl: number;
  result: string;
}

interface KalshiPosition {
  ticker: string;
  market_title: string;
  side: string;
  position: number;
  exposure_dollars: number;
  pnl_dollars: number;
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
  const [kalshiPnl, setKalshiPnl] = useState(0);
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
        const resp = await fetch("/api/kalshi?action=positions");
        if (resp.ok) {
          const kd = await resp.json();
          if (!kd.error) {
            setKalshiFills(kd.fills ?? []);
            setKalshiSettlements(kd.settlements ?? []);
            setKalshiPositions(kd.positions ?? []);
            setKalshiPnl(kd.total_pnl ?? 0);
          }
        }
      } catch { /* */ }
    }
    load();
  }, []);

  const kalshiWins = kalshiSettlements.filter((s) => s.result === "WON").length;
  const kalshiLosses = kalshiSettlements.filter((s) => s.result === "LOST").length;
  const kalshiWinRate = kalshiSettlements.length > 0
    ? Math.round((kalshiWins / kalshiSettlements.length) * 100)
    : 0;
  const kalshiTotalSpent = kalshiFills.reduce((sum, f) => {
    const price = f.side === "yes" ? f.yes_price_cents : f.no_price_cents;
    return sum + (f.count * price) / 100 + f.fee;
  }, 0);
  const kalshiTotalRevenue = kalshiSettlements.reduce((s, x) => s + Math.max(0, x.revenue), 0);
  const kalshiExposure = kalshiPositions.reduce((s, p) => s + Math.abs(p.exposure_dollars), 0);

  const ibkrFilled = ibkrTrades.filter((t) => t.status === "filled");
  const ibkrPnl = ibkrFilled.reduce((sum, t) => sum + (t.fill_price ?? 0) * t.quantity * (t.action.includes("SELL") ? 1 : -1), 0);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Trade Log</h2>
        <p className="text-muted-foreground">All trades across IBKR and Kalshi with P&L tracking</p>
      </div>

      {/* ── Kalshi P&L Dashboard ── */}
      <div className="rounded-xl border-2 border-gold/20 bg-card p-5 space-y-4">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-[oklch(0.65_0.16_85_/_0.12)] border border-gold/20 flex items-center justify-center text-sm font-bold text-gold">K</div>
          <h3 className="text-sm font-bold tracking-wide uppercase">Kalshi P&L</h3>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <div className="rounded-lg bg-muted px-4 py-3">
            <p className="text-[9px] uppercase tracking-wide text-muted-foreground">Net P&L</p>
            <p className={`text-xl font-bold font-mono ${kalshiPnl >= 0 ? "text-profit" : "text-loss"}`}>
              {kalshiPnl !== 0 ? `${kalshiPnl >= 0 ? "+" : ""}$${kalshiPnl.toFixed(2)}` : "$0.00"}
            </p>
          </div>
          <div className="rounded-lg bg-muted px-4 py-3">
            <p className="text-[9px] uppercase tracking-wide text-muted-foreground">Win Rate</p>
            <p className={`text-xl font-bold font-mono ${kalshiWinRate >= 50 ? "text-profit" : "text-loss"}`}>
              {kalshiSettlements.length > 0 ? `${kalshiWinRate}%` : "--"}
            </p>
            <p className="text-[9px] font-mono text-muted-foreground">{kalshiWins}W / {kalshiLosses}L</p>
          </div>
          <div className="rounded-lg bg-muted px-4 py-3">
            <p className="text-[9px] uppercase tracking-wide text-muted-foreground">Total Spent</p>
            <p className="text-xl font-bold font-mono">${kalshiTotalSpent.toFixed(2)}</p>
          </div>
          <div className="rounded-lg bg-muted px-4 py-3">
            <p className="text-[9px] uppercase tracking-wide text-muted-foreground">Revenue</p>
            <p className="text-xl font-bold font-mono text-profit">${kalshiTotalRevenue.toFixed(2)}</p>
          </div>
          <div className="rounded-lg bg-muted px-4 py-3">
            <p className="text-[9px] uppercase tracking-wide text-muted-foreground">Open Exposure</p>
            <p className="text-xl font-bold font-mono text-gold">${kalshiExposure.toFixed(2)}</p>
          </div>
          <div className="rounded-lg bg-muted px-4 py-3">
            <p className="text-[9px] uppercase tracking-wide text-muted-foreground">Fills / Settled</p>
            <p className="text-xl font-bold font-mono">{kalshiFills.length} / {kalshiSettlements.length}</p>
          </div>
        </div>
      </div>

      {/* ── IBKR Summary ── */}
      <div className="rounded-xl border-2 border-teal/20 bg-card p-5 space-y-4">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-[oklch(0.55_0.18_175_/_0.08)] border border-teal/20 flex items-center justify-center text-sm font-bold text-teal">IB</div>
          <h3 className="text-sm font-bold tracking-wide uppercase">IBKR Paper Trades</h3>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="rounded-lg bg-muted px-4 py-3">
            <p className="text-[9px] uppercase tracking-wide text-muted-foreground">Trades</p>
            <p className="text-xl font-bold font-mono">{ibkrTrades.length}</p>
          </div>
          <div className="rounded-lg bg-muted px-4 py-3">
            <p className="text-[9px] uppercase tracking-wide text-muted-foreground">Filled</p>
            <p className="text-xl font-bold font-mono text-profit">{ibkrFilled.length}</p>
          </div>
          <div className="rounded-lg bg-muted px-4 py-3">
            <p className="text-[9px] uppercase tracking-wide text-muted-foreground">Failed</p>
            <p className="text-xl font-bold font-mono text-loss">{ibkrTrades.filter((t) => t.status === "failed").length}</p>
          </div>
          <div className="rounded-lg bg-muted px-4 py-3">
            <p className="text-[9px] uppercase tracking-wide text-muted-foreground">Pending</p>
            <p className="text-xl font-bold font-mono text-gold">{ibkrTrades.filter((t) => t.status === "pending").length}</p>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2">
        {[
          { key: "all", label: "All Trades" },
          { key: "kalshi", label: `Kalshi (${kalshiFills.length + kalshiSettlements.length})` },
          { key: "ibkr", label: `IBKR (${ibkrTrades.length})` },
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

      {/* ── Active Kalshi Positions ── */}
      {(tab === "all" || tab === "kalshi") && kalshiPositions.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-gold">Open Kalshi Positions</h4>
          {kalshiPositions.map((pos, i) => (
            <div key={`pos-${pos.ticker}-${i}`} className="rounded-xl bg-card border border-gold/20 px-5 py-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-10 h-10 rounded-lg bg-[oklch(0.65_0.16_85_/_0.08)] border border-[oklch(0.65_0.16_85_/_0.15)] flex items-center justify-center text-xs font-bold text-gold flex-shrink-0">
                    K
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold truncate">{pos.market_title}</p>
                    <p className="text-[10px] text-muted-foreground font-mono">{pos.ticker}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3 flex-shrink-0">
                  <Badge variant="outline" className={`text-xs ${pos.side === "YES" ? "border-profit text-profit" : "border-loss text-loss"}`}>
                    {pos.side} x{Math.abs(pos.position)}
                  </Badge>
                  <span className="text-sm font-mono font-semibold">${Math.abs(pos.exposure_dollars).toFixed(2)}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Kalshi Settlements (P&L per bet) ── */}
      {(tab === "all" || tab === "kalshi") && kalshiSettlements.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Kalshi Settled Bets</h4>
          {kalshiSettlements.map((s, i) => (
            <div key={`settle-${i}`} className={`rounded-xl bg-card border px-5 py-4 ${
              s.result === "WON" ? "border-profit/30" : "border-loss/30"
            }`}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3 min-w-0">
                  <div className={`w-10 h-10 rounded-lg flex items-center justify-center text-sm font-bold border ${
                    s.result === "WON"
                      ? "bg-[oklch(0.50_0.20_155_/_0.08)] border-[oklch(0.50_0.20_155_/_0.15)] text-profit"
                      : "bg-[oklch(0.52_0.22_25_/_0.08)] border-[oklch(0.52_0.22_25_/_0.15)] text-loss"
                  }`}>
                    {s.result === "WON" ? "W" : "L"}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold truncate">{s.ticker}</p>
                    <p className="text-[10px] text-muted-foreground font-mono">{fmtDate(s.settled_at)}</p>
                  </div>
                </div>
                <div className="text-right flex items-center gap-3">
                  <p className={`text-lg font-mono font-bold ${s.pnl >= 0 ? "text-profit" : "text-loss"}`}>
                    {s.pnl >= 0 ? "+" : ""}${s.pnl.toFixed(2)}
                  </p>
                  <Badge variant="outline" className={`text-[9px] ${s.result === "WON" ? "border-profit text-profit" : "border-loss text-loss"}`}>
                    {s.result}
                  </Badge>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Kalshi Fills (recent trades) ── */}
      {(tab === "all" || tab === "kalshi") && kalshiFills.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Kalshi Fills</h4>
          {kalshiFills.map((f, i) => {
            const price = f.side === "yes" ? f.yes_price_cents : f.no_price_cents;
            const cost = (f.count * price) / 100;
            return (
              <div key={`fill-${f.fill_id || i}`} className="rounded-xl bg-card border border-border px-5 py-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-10 h-10 rounded-lg bg-[oklch(0.65_0.16_85_/_0.08)] border border-[oklch(0.65_0.16_85_/_0.15)] flex items-center justify-center text-xs font-bold text-gold flex-shrink-0">
                      K
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold truncate">
                        {f.action.toUpperCase()} {f.side.toUpperCase()} — {f.ticker}
                      </p>
                      <p className="text-[10px] text-muted-foreground font-mono">
                        {f.count}x @ {price}¢ · fee ${f.fee.toFixed(2)} · {fmtDate(f.created_at)}
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-mono font-semibold">${cost.toFixed(2)}</p>
                    <Badge variant="outline" className="text-[9px] border-profit text-profit">FILLED</Badge>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── IBKR Trades ── */}
      {(tab === "all" || tab === "ibkr") && (
        <div className="space-y-2">
          {tab === "all" && ibkrTrades.length > 0 && (
            <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">IBKR Trades</h4>
          )}
          {ibkrTrades.map((t) => (
            <div key={t.id} className="rounded-xl bg-card border border-border px-5 py-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-[oklch(0.50_0.20_155_/_0.08)] border border-[oklch(0.50_0.20_155_/_0.15)] flex items-center justify-center text-xs font-bold text-profit">IB</div>
                  <div>
                    <p className="text-sm font-semibold">{t.ticker} — {t.action}</p>
                    <p className="text-[10px] text-muted-foreground font-mono">
                      {t.call_put ? `${t.strike} ${t.call_put} exp ${t.expiry}` : "Equity"} · x{t.quantity} · {fmtDate(t.created_at)}
                    </p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-sm font-mono font-semibold">{t.fill_price ? `$${t.fill_price.toFixed(2)}` : "—"}</p>
                  <Badge variant="outline" className={`text-[9px] ${
                    t.status === "filled" ? "border-profit text-profit" :
                    t.status === "failed" ? "border-loss text-loss" :
                    "border-gold text-gold"
                  }`}>
                    {t.status.toUpperCase()}
                  </Badge>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Empty state */}
      {ibkrTrades.length === 0 && kalshiFills.length === 0 && kalshiSettlements.length === 0 && (
        <Card className="bg-card border-border">
          <CardContent className="py-12 text-center">
            <p className="text-muted-foreground">No trades yet. The bot will execute trades during market hours.</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
