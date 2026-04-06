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
  fee_dollars: number;
  total_cost_dollars: number;
  created_at: string;
}

interface KalshiSettlement {
  ticker: string;
  event_ticker: string;
  settled_at: string;
  market_result: string;
  revenue_dollars: number;
  cost_dollars: number;
  profit_dollars: number;
  yes_count: number;
  no_count: number;
  outcome: string;
  had_conflict: boolean;
}

interface KalshiPosition {
  ticker: string;
  market_title: string;
  side: string;
  position: number;
  exposure_dollars: number;
  total_cost_dollars: number;
}

function fmtTime(dateStr: string) {
  const d = new Date(dateStr);
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

function fmtDate(dateStr: string) {
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" }) + " " + fmtTime(dateStr);
}

function shortTicker(ticker: string) {
  // KXBTC15M-26APR061215-15 -> BTC 12:15
  const m = ticker.match(/KXBTC15M-\d+[A-Z]+(\d{2})(\d{2})/);
  if (m) return `BTC ${m[1]}:${m[2]}`;
  if (ticker.length > 30) return ticker.substring(0, 30) + "...";
  return ticker;
}

export default function TradesPage() {
  const supabase = createClient();
  const [ibkrTrades, setIbkrTrades] = useState<Trade[]>([]);
  const [kalshiFills, setKalshiFills] = useState<KalshiFill[]>([]);
  const [kalshiSettlements, setKalshiSettlements] = useState<KalshiSettlement[]>([]);
  const [kalshiPositions, setKalshiPositions] = useState<KalshiPosition[]>([]);
  const [kalshiBalance, setKalshiBalance] = useState<number | null>(null);
  const [kalshiPnl, setKalshiPnl] = useState(0);
  const [kalshiWins, setKalshiWins] = useState(0);
  const [kalshiLosses, setKalshiLosses] = useState(0);
  const [kalshiWinRate, setKalshiWinRate] = useState(0);
  const [kalshiSpent, setKalshiSpent] = useState(0);
  const [tab, setTab] = useState<"all" | "ibkr" | "kalshi">("all");

  useEffect(() => {
    async function load() {
      const { data } = await supabase
        .from("trades")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(100);
      if (data) setIbkrTrades(data);

      // Read Kalshi snapshot from Supabase (synced by bot on NUC every 5 min)
      const { data: configRow } = await supabase
        .from("bot_config")
        .select("value")
        .eq("key", "kalshi_snapshot")
        .single();
      if (configRow?.value) {
        const kd = configRow.value as Record<string, unknown>;
        setKalshiBalance((kd.balance_dollars as number) ?? null);
        setKalshiFills((kd.fills as KalshiFill[]) ?? []);
        setKalshiSettlements((kd.settlements as KalshiSettlement[]) ?? []);
        setKalshiPositions((kd.positions as KalshiPosition[]) ?? []);
        setKalshiPnl((kd.total_pnl as number) ?? 0);
        setKalshiWins((kd.wins as number) ?? 0);
        setKalshiLosses((kd.losses as number) ?? 0);
        setKalshiWinRate((kd.win_rate as number) ?? 0);
        setKalshiSpent((kd.total_spent as number) ?? 0);
      }
    }
    load();
  }, []);

  const kalshiExposure = kalshiPositions.reduce((s, p) => s + p.exposure_dollars, 0);

  // BTC-specific stats
  const btcSettlements = kalshiSettlements.filter((s) => s.ticker.includes("BTC15M") || s.ticker.includes("KXBTC15M"));
  const btcPnl = btcSettlements.reduce((s, x) => s + x.profit_dollars, 0);
  const btcWins = btcSettlements.filter((s) => s.outcome === "WON").length;
  const btcLosses = btcSettlements.filter((s) => s.outcome === "LOST").length;
  const btcConflicts = btcSettlements.filter((s) => s.had_conflict).length;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Trade Log</h2>
        <p className="text-muted-foreground">Live P&L across Kalshi and IBKR</p>
      </div>

      {/* ── Kalshi Account Overview ── */}
      <div className="rounded-xl border-2 border-gold/20 bg-card p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-[oklch(0.65_0.16_85_/_0.12)] border border-gold/20 flex items-center justify-center text-sm font-bold text-gold">K</div>
            <h3 className="text-sm font-bold tracking-wide uppercase">Kalshi Account</h3>
          </div>
          <div className="text-right">
            <p className="text-[9px] uppercase text-muted-foreground">Balance</p>
            <p className="text-2xl font-bold font-mono">{kalshiBalance != null ? `$${kalshiBalance.toFixed(2)}` : "--"}</p>
          </div>
        </div>
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
          <div className="rounded-lg bg-muted px-3 py-2.5">
            <p className="text-[9px] uppercase tracking-wide text-muted-foreground">Net P&L</p>
            <p className={`text-lg font-bold font-mono ${kalshiPnl >= 0 ? "text-profit" : "text-loss"}`}>
              {kalshiPnl >= 0 ? "+" : ""}${kalshiPnl.toFixed(2)}
            </p>
          </div>
          <div className="rounded-lg bg-muted px-3 py-2.5">
            <p className="text-[9px] uppercase tracking-wide text-muted-foreground">Record</p>
            <p className="text-lg font-bold font-mono">
              <span className="text-profit">{kalshiWins}W</span>
              {" "}
              <span className="text-loss">{kalshiLosses}L</span>
            </p>
            <p className={`text-[9px] font-mono ${kalshiWinRate >= 50 ? "text-profit" : "text-loss"}`}>
              {kalshiWinRate}% win rate
            </p>
          </div>
          <div className="rounded-lg bg-muted px-3 py-2.5">
            <p className="text-[9px] uppercase tracking-wide text-muted-foreground">Total Spent</p>
            <p className="text-lg font-bold font-mono">${kalshiSpent.toFixed(2)}</p>
          </div>
          <div className="rounded-lg bg-muted px-3 py-2.5">
            <p className="text-[9px] uppercase tracking-wide text-muted-foreground">Open</p>
            <p className="text-lg font-bold font-mono text-gold">{kalshiPositions.length}</p>
            {kalshiExposure > 0 && <p className="text-[9px] font-mono text-muted-foreground">${kalshiExposure.toFixed(2)}</p>}
          </div>
          <div className="rounded-lg bg-muted px-3 py-2.5">
            <p className="text-[9px] uppercase tracking-wide text-muted-foreground">Fills</p>
            <p className="text-lg font-bold font-mono">{kalshiFills.length}</p>
          </div>
          <div className="rounded-lg bg-muted px-3 py-2.5">
            <p className="text-[9px] uppercase tracking-wide text-muted-foreground">Settled</p>
            <p className="text-lg font-bold font-mono">{kalshiSettlements.length}</p>
          </div>
        </div>
      </div>

      {/* ── BTC 15-min Performance ── */}
      {btcSettlements.length > 0 && (
        <div className="rounded-xl border border-[oklch(0.65_0.16_85_/_0.3)] bg-card p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-bold tracking-wide uppercase flex items-center gap-2">
              BTC 15-min Agent
              <Badge variant="outline" className="text-[9px] border-gold text-gold">crypto</Badge>
            </h3>
            <p className={`text-xl font-bold font-mono ${btcPnl >= 0 ? "text-profit" : "text-loss"}`}>
              {btcPnl >= 0 ? "+" : ""}${btcPnl.toFixed(2)}
            </p>
          </div>
          <div className="grid grid-cols-4 gap-3 mb-4">
            <div className="rounded-lg bg-muted px-3 py-2">
              <p className="text-[9px] uppercase text-muted-foreground">Record</p>
              <p className="text-sm font-bold font-mono">
                <span className="text-profit">{btcWins}W</span> <span className="text-loss">{btcLosses}L</span>
              </p>
            </div>
            <div className="rounded-lg bg-muted px-3 py-2">
              <p className="text-[9px] uppercase text-muted-foreground">Win Rate</p>
              <p className={`text-sm font-bold font-mono ${btcSettlements.length > 0 && btcWins / btcSettlements.length >= 0.5 ? "text-profit" : "text-loss"}`}>
                {btcSettlements.length > 0 ? Math.round((btcWins / btcSettlements.length) * 100) : 0}%
              </p>
            </div>
            <div className="rounded-lg bg-muted px-3 py-2">
              <p className="text-[9px] uppercase text-muted-foreground">Windows</p>
              <p className="text-sm font-bold font-mono">{btcSettlements.length}</p>
            </div>
            {btcConflicts > 0 && (
              <div className="rounded-lg bg-muted px-3 py-2">
                <p className="text-[9px] uppercase text-loss">Conflicts</p>
                <p className="text-sm font-bold font-mono text-loss">{btcConflicts}</p>
              </div>
            )}
          </div>
          {/* BTC settlement rows */}
          <div className="space-y-1">
            {btcSettlements.slice(0, 10).map((s, i) => (
              <div key={`btc-${i}`} className={`flex items-center justify-between rounded-lg px-3 py-2 text-xs ${
                s.outcome === "WON" ? "bg-[oklch(0.50_0.20_155_/_0.04)]" :
                s.outcome === "LOST" ? "bg-[oklch(0.52_0.22_25_/_0.04)]" : "bg-muted"
              }`}>
                <div className="flex items-center gap-2">
                  <span className={`font-bold w-5 text-center ${s.outcome === "WON" ? "text-profit" : s.outcome === "LOST" ? "text-loss" : "text-muted-foreground"}`}>
                    {s.outcome === "WON" ? "W" : s.outcome === "LOST" ? "L" : "-"}
                  </span>
                  <span className="font-mono">{shortTicker(s.ticker)}</span>
                  <span className="text-muted-foreground">{s.market_result === "yes" ? "went UP" : "went DOWN"}</span>
                  {s.had_conflict && <Badge variant="outline" className="text-[8px] border-loss/50 text-loss">YES+NO</Badge>}
                  {s.yes_count > 0 && <span className="text-profit font-mono">Y:{s.yes_count}</span>}
                  {s.no_count > 0 && <span className="text-loss font-mono">N:{s.no_count}</span>}
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-muted-foreground font-mono">cost ${s.cost_dollars.toFixed(2)}</span>
                  <span className={`font-bold font-mono ${s.profit_dollars >= 0 ? "text-profit" : "text-loss"}`}>
                    {s.profit_dollars >= 0 ? "+" : ""}${s.profit_dollars.toFixed(2)}
                  </span>
                  <span className="text-muted-foreground">{fmtTime(s.settled_at)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── IBKR Summary ── */}
      <div className="rounded-xl border-2 border-teal/20 bg-card p-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-[oklch(0.55_0.18_175_/_0.08)] border border-teal/20 flex items-center justify-center text-sm font-bold text-teal">IB</div>
            <h3 className="text-sm font-bold tracking-wide uppercase">IBKR Paper</h3>
          </div>
          <div className="flex items-center gap-4">
            <div className="text-right">
              <p className="text-[9px] uppercase text-muted-foreground">Trades</p>
              <p className="text-lg font-bold font-mono">{ibkrTrades.length}</p>
            </div>
            <div className="text-right">
              <p className="text-[9px] uppercase text-muted-foreground">Filled</p>
              <p className="text-lg font-bold font-mono text-profit">{ibkrTrades.filter((t) => t.status === "filled").length}</p>
            </div>
          </div>
        </div>
      </div>

      {/* ── Tabs ── */}
      <div className="flex gap-2">
        {(["all", "kalshi", "ibkr"] as const).map((key) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
              tab === key ? "bg-teal text-teal-foreground" : "bg-card border border-border text-muted-foreground hover:text-foreground"
            }`}
          >
            {key === "all" ? "All" : key === "kalshi" ? "Kalshi" : "IBKR"}
          </button>
        ))}
      </div>

      {/* ── Open Positions ── */}
      {(tab === "all" || tab === "kalshi") && kalshiPositions.length > 0 && (
        <div className="space-y-1.5">
          <h4 className="text-[10px] font-semibold uppercase tracking-widest text-gold">Open Kalshi Positions</h4>
          {kalshiPositions.map((pos, i) => (
            <div key={`pos-${i}`} className="flex items-center justify-between rounded-lg bg-card border border-gold/20 px-4 py-3">
              <div className="flex items-center gap-2 min-w-0">
                <Badge variant="outline" className={`text-xs ${pos.side === "YES" ? "border-profit text-profit" : "border-loss text-loss"}`}>
                  {pos.side} x{pos.position}
                </Badge>
                <span className="text-sm font-semibold truncate">{pos.market_title}</span>
              </div>
              <span className="text-sm font-mono font-bold text-gold">${pos.exposure_dollars.toFixed(2)}</span>
            </div>
          ))}
        </div>
      )}

      {/* ── All Kalshi Settlements ── */}
      {(tab === "all" || tab === "kalshi") && kalshiSettlements.length > 0 && (
        <div className="space-y-1.5">
          <h4 className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Kalshi Settled Bets</h4>
          {kalshiSettlements.map((s, i) => (
            <div key={`s-${i}`} className={`flex items-center justify-between rounded-lg px-4 py-3 border ${
              s.outcome === "WON" ? "bg-card border-profit/20" :
              s.outcome === "LOST" ? "bg-card border-loss/20" : "bg-card border-border"
            }`}>
              <div className="flex items-center gap-3 min-w-0">
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold ${
                  s.outcome === "WON" ? "bg-[oklch(0.50_0.20_155_/_0.1)] text-profit" :
                  s.outcome === "LOST" ? "bg-[oklch(0.52_0.22_25_/_0.1)] text-loss" : "bg-muted text-muted-foreground"
                }`}>
                  {s.outcome === "WON" ? "W" : s.outcome === "LOST" ? "L" : "-"}
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold truncate">{shortTicker(s.ticker)}</p>
                  <p className="text-[10px] text-muted-foreground font-mono">
                    {s.market_result === "yes" ? "YES won" : "NO won"} ·
                    {s.yes_count > 0 && ` ${s.yes_count} YES`}{s.no_count > 0 && ` ${s.no_count} NO`} ·
                    {" "}{fmtDate(s.settled_at)}
                    {s.had_conflict && " · CONFLICT"}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-4 flex-shrink-0">
                <div className="text-right">
                  <p className="text-[9px] uppercase text-muted-foreground">Cost</p>
                  <p className="text-sm font-mono">${s.cost_dollars.toFixed(2)}</p>
                </div>
                <div className="text-right">
                  <p className="text-[9px] uppercase text-muted-foreground">P&L</p>
                  <p className={`text-sm font-mono font-bold ${s.profit_dollars >= 0 ? "text-profit" : "text-loss"}`}>
                    {s.profit_dollars >= 0 ? "+" : ""}${s.profit_dollars.toFixed(2)}
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Kalshi Fills ── */}
      {(tab === "all" || tab === "kalshi") && kalshiFills.length > 0 && (
        <div className="space-y-1.5">
          <h4 className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Recent Kalshi Fills</h4>
          {kalshiFills.slice(0, 20).map((f, i) => (
            <div key={`f-${i}`} className="flex items-center justify-between rounded-lg bg-card border border-border px-4 py-2.5">
              <div className="flex items-center gap-2 min-w-0">
                <Badge variant="outline" className={`text-[9px] ${f.side === "yes" ? "border-profit text-profit" : "border-loss text-loss"}`}>
                  {f.side.toUpperCase()}
                </Badge>
                <span className="text-sm font-mono truncate">{shortTicker(f.ticker)}</span>
                <span className="text-[10px] text-muted-foreground">{f.count}x @ {f.price_cents}c</span>
              </div>
              <div className="flex items-center gap-3 flex-shrink-0">
                <span className="text-sm font-mono">${f.total_cost_dollars.toFixed(2)}</span>
                <span className="text-[10px] text-muted-foreground">{fmtTime(f.created_at)}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── IBKR Trades ── */}
      {(tab === "all" || tab === "ibkr") && ibkrTrades.length > 0 && (
        <div className="space-y-1.5">
          <h4 className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">IBKR Trades</h4>
          {ibkrTrades.map((t) => (
            <div key={t.id} className="flex items-center justify-between rounded-lg bg-card border border-border px-4 py-3">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-[oklch(0.55_0.18_175_/_0.08)] flex items-center justify-center text-xs font-bold text-teal">IB</div>
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
                  t.status === "failed" ? "border-loss text-loss" : "border-gold text-gold"
                }`}>{t.status.toUpperCase()}</Badge>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Empty */}
      {ibkrTrades.length === 0 && kalshiFills.length === 0 && kalshiSettlements.length === 0 && (
        <Card className="bg-card border-border">
          <CardContent className="py-12 text-center">
            <p className="text-muted-foreground">No trades yet.</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
