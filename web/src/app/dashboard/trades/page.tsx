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
      // IBKR trades from Supabase
      const { data } = await supabase
        .from("trades")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(100);
      if (data) setIbkrTrades(data);

      // Kalshi from API
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

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Trade Log</h2>
        <p className="text-muted-foreground">All trades across IBKR and Kalshi</p>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card className="bg-card border-border">
          <CardContent className="p-4">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">IBKR Trades</p>
            <p className="text-xl font-bold font-mono">{ibkrTrades.length}</p>
          </CardContent>
        </Card>
        <Card className="bg-card border-border">
          <CardContent className="p-4">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Kalshi Fills</p>
            <p className="text-xl font-bold font-mono text-gold">{kalshiFills.length}</p>
          </CardContent>
        </Card>
        <Card className="bg-card border-border">
          <CardContent className="p-4">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Kalshi Settled</p>
            <p className="text-xl font-bold font-mono">{kalshiSettlements.length}</p>
          </CardContent>
        </Card>
        <Card className="bg-card border-border">
          <CardContent className="p-4">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Kalshi P&L</p>
            <p className={`text-xl font-bold font-mono ${kalshiPnl >= 0 ? "text-profit" : "text-loss"}`}>
              {kalshiPnl !== 0 ? `$${kalshiPnl.toFixed(2)}` : "—"}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Active Kalshi Positions */}
      {kalshiPositions.length > 0 && (
        <Card className="bg-card border-border border-l-4 border-l-gold">
          <CardContent className="p-5">
            <h3 className="text-sm font-semibold mb-3">Active Kalshi Positions</h3>
            <div className="space-y-2">
              {kalshiPositions.map((pos, i) => (
                <div key={`${pos.ticker}-${i}`} className="flex items-center justify-between rounded-lg bg-muted px-4 py-3">
                  <div>
                    <p className="text-sm font-semibold">{pos.market_title}</p>
                    <p className="text-[10px] font-mono text-muted-foreground">{pos.ticker}</p>
                  </div>
                  <div className="flex items-center gap-4 text-right">
                    <Badge variant="outline" className={`text-xs ${pos.side === "YES" ? "border-profit text-profit" : "border-loss text-loss"}`}>
                      {pos.side} x{Math.abs(pos.position)}
                    </Badge>
                    <span className="text-sm font-mono">${pos.exposure_dollars.toFixed(2)}</span>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Tabs */}
      <div className="flex gap-2">
        {[
          { key: "all", label: "All Trades" },
          { key: "ibkr", label: "IBKR" },
          { key: "kalshi", label: "Kalshi" },
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

      {/* Trade List */}
      <div className="space-y-2">
        {/* IBKR Trades */}
        {(tab === "all" || tab === "ibkr") && ibkrTrades.map((t) => (
          <div key={t.id} className="rounded-xl bg-card border border-border px-5 py-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-[oklch(0.50_0.20_155_/_0.08)] border border-[oklch(0.50_0.20_155_/_0.15)] flex items-center justify-center text-xs font-bold text-profit">IB</div>
                <div>
                  <p className="text-sm font-semibold">{t.ticker} — {t.action}</p>
                  <p className="text-[10px] text-muted-foreground font-mono">
                    {t.call_put ? `${t.strike} ${t.call_put} exp ${t.expiry}` : "Equity"} · x{t.quantity} · {timeAgo(t.created_at)}
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

        {/* Kalshi Fills */}
        {(tab === "all" || tab === "kalshi") && kalshiFills.map((f, i) => (
          <div key={`fill-${f.fill_id || i}`} className="rounded-xl bg-card border border-border px-5 py-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-[oklch(0.65_0.16_85_/_0.08)] border border-[oklch(0.65_0.16_85_/_0.15)] flex items-center justify-center text-xs font-bold text-gold">K</div>
                <div>
                  <p className="text-sm font-semibold">
                    {f.action.toUpperCase()} {f.side.toUpperCase()} — {f.ticker.length > 30 ? f.ticker.substring(0, 30) + "..." : f.ticker}
                  </p>
                  <p className="text-[10px] text-muted-foreground font-mono">
                    {f.count}x @ {f.side === "yes" ? f.yes_price_cents : f.no_price_cents}¢ · fee: ${f.fee.toFixed(2)} · {timeAgo(f.created_at)}
                  </p>
                </div>
              </div>
              <div className="text-right">
                <p className="text-sm font-mono font-semibold">
                  ${((f.count * (f.side === "yes" ? f.yes_price_cents : f.no_price_cents)) / 100).toFixed(2)}
                </p>
                <Badge variant="outline" className="text-[9px] border-profit text-profit">FILLED</Badge>
              </div>
            </div>
          </div>
        ))}

        {/* Kalshi Settlements (won/lost) */}
        {(tab === "all" || tab === "kalshi") && kalshiSettlements.map((s, i) => (
          <div key={`settle-${i}`} className={`rounded-xl bg-card border px-5 py-4 ${
            s.result === "WON" ? "border-profit/30" : "border-loss/30"
          }`}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className={`w-10 h-10 rounded-lg flex items-center justify-center text-xs font-bold border ${
                  s.result === "WON"
                    ? "bg-[oklch(0.50_0.20_155_/_0.08)] border-[oklch(0.50_0.20_155_/_0.15)] text-profit"
                    : "bg-[oklch(0.52_0.22_25_/_0.08)] border-[oklch(0.52_0.22_25_/_0.15)] text-loss"
                }`}>
                  {s.result === "WON" ? "W" : "L"}
                </div>
                <div>
                  <p className="text-sm font-semibold">{s.ticker.length > 30 ? s.ticker.substring(0, 30) + "..." : s.ticker}</p>
                  <p className="text-[10px] text-muted-foreground font-mono">
                    Settled {timeAgo(s.settled_at)}
                  </p>
                </div>
              </div>
              <div className="text-right">
                <p className={`text-sm font-mono font-bold ${s.pnl >= 0 ? "text-profit" : "text-loss"}`}>
                  {s.pnl >= 0 ? "+" : ""}${s.pnl.toFixed(2)}
                </p>
                <Badge variant="outline" className={`text-[9px] ${s.result === "WON" ? "border-profit text-profit" : "border-loss text-loss"}`}>
                  {s.result}
                </Badge>
              </div>
            </div>
          </div>
        ))}

        {/* Empty state */}
        {ibkrTrades.length === 0 && kalshiFills.length === 0 && kalshiSettlements.length === 0 && (
          <Card className="bg-card border-border">
            <CardContent className="py-12 text-center">
              <p className="text-muted-foreground">No trades yet. The bot will execute trades during market hours.</p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
