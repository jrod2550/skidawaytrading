"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import type { Position } from "@/lib/types/trading";

function fmt(n: number | null, decimals = 2) {
  if (n == null) return "--";
  return n.toFixed(decimals);
}

function fmtCurrency(n: number | null) {
  if (n == null) return "--";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(n);
}

interface KalshiPosition {
  ticker: string;
  market_title: string;
  side: string;
  position: number;
  exposure_dollars: number;
  pnl_dollars: number;
}

interface KalshiBalance {
  balance_dollars: number;
  portfolio_value_dollars: number;
}

export default function PositionsPage() {
  const supabase = createClient();
  const [positions, setPositions] = useState<Position[]>([]);
  const [kalshiPositions, setKalshiPositions] = useState<KalshiPosition[]>([]);
  const [kalshiBalance, setKalshiBalance] = useState<KalshiBalance | null>(null);
  const [kalshiLoading, setKalshiLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const { data } = await supabase
        .from("positions")
        .select("*")
        .eq("is_open", true)
        .order("market_value", { ascending: false });
      if (data) setPositions(data);
    }

    load();

    const channel = supabase
      .channel("positions-page")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "positions" },
        () => load()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  // Fetch Kalshi data from Supabase (synced by bot on NUC)
  useEffect(() => {
    async function loadKalshi() {
      try {
        const { data: configRow } = await supabase
          .from("bot_config")
          .select("value")
          .eq("key", "kalshi_snapshot")
          .single();
        if (configRow?.value) {
          const kd = configRow.value as Record<string, unknown>;
          setKalshiBalance({
            balance_dollars: (kd.balance_dollars as number) ?? 0,
            portfolio_value_dollars: (kd.portfolio_value_dollars as number) ?? 0,
          });
          setKalshiPositions((kd.positions as KalshiPosition[]) ?? []);
        }
      } catch { /* */ }
      setKalshiLoading(false);
    }
    loadKalshi();
  }, []);

  // Portfolio-level Greeks (IBKR only)
  const totals = positions.reduce(
    (acc, p) => ({
      delta: acc.delta + (p.delta ?? 0) * p.quantity,
      gamma: acc.gamma + (p.gamma ?? 0) * p.quantity,
      theta: acc.theta + (p.theta ?? 0) * p.quantity,
      vega: acc.vega + (p.vega ?? 0) * p.quantity,
      pnl: acc.pnl + (p.unrealized_pnl ?? 0),
      value: acc.value + (p.market_value ?? 0),
    }),
    { delta: 0, gamma: 0, theta: 0, vega: 0, pnl: 0, value: 0 }
  );

  const kalshiExposure = kalshiPositions.reduce((s, p) => s + Math.abs(p.exposure_dollars), 0);

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Positions</h2>
        <p className="text-muted-foreground">
          Current holdings across IBKR and Kalshi
        </p>
      </div>

      {/* Combined Summary */}
      <div className="grid gap-4 grid-cols-2 sm:grid-cols-3 lg:grid-cols-6">
        <Card>
          <CardHeader className="pb-1">
            <CardTitle className="text-xs text-muted-foreground">
              IBKR Value
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-lg font-bold">{fmtCurrency(totals.value)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-1">
            <CardTitle className="text-xs text-muted-foreground">
              IBKR P&L
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p
              className={`text-lg font-bold ${totals.pnl >= 0 ? "text-profit" : "text-loss"}`}
            >
              {fmtCurrency(totals.pnl)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-1">
            <CardTitle className="text-xs text-muted-foreground">
              Kalshi Balance
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-lg font-bold font-mono text-gold">
              {kalshiBalance ? fmtCurrency(kalshiBalance.balance_dollars) : "--"}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-1">
            <CardTitle className="text-xs text-muted-foreground">
              Kalshi Exposure
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-lg font-bold font-mono">
              {kalshiPositions.length > 0 ? fmtCurrency(kalshiExposure) : "--"}
            </p>
          </CardContent>
        </Card>
        {(
          [
            ["Delta", totals.delta],
            ["Theta", totals.theta],
          ] as const
        ).map(([label, val]) => (
          <Card key={label}>
            <CardHeader className="pb-1">
              <CardTitle className="text-xs text-muted-foreground">
                {label}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-lg font-bold font-mono">{fmt(val)}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Kalshi Positions */}
      <div>
        <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
          Kalshi Positions
          <Badge variant="outline" className="text-[10px] border-gold text-gold">
            {kalshiPositions.length} open
          </Badge>
        </h3>
        <Card>
          <CardContent className="pt-6">
            {kalshiLoading ? (
              <p className="text-sm text-muted-foreground text-center py-8">
                Loading Kalshi positions...
              </p>
            ) : kalshiPositions.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">
                No open Kalshi positions
              </p>
            ) : (
              <div className="space-y-2">
                {kalshiPositions.map((pos, i) => (
                  <div
                    key={`${pos.ticker}-${i}`}
                    className="flex items-center justify-between rounded-lg bg-muted px-4 py-3"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-9 h-9 rounded-lg bg-[oklch(0.65_0.16_85_/_0.08)] border border-[oklch(0.65_0.16_85_/_0.15)] flex items-center justify-center text-xs font-bold text-gold flex-shrink-0">
                        K
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-semibold truncate">{pos.market_title}</p>
                        <p className="text-[10px] font-mono text-muted-foreground">{pos.ticker}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-4 flex-shrink-0">
                      <Badge
                        variant="outline"
                        className={`text-xs ${
                          pos.side === "YES"
                            ? "border-profit text-profit"
                            : "border-loss text-loss"
                        }`}
                      >
                        {pos.side} x{Math.abs(pos.position)}
                      </Badge>
                      <span className="text-sm font-mono font-semibold">
                        ${Math.abs(pos.exposure_dollars).toFixed(2)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* IBKR Positions */}
      <div>
        <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
          IBKR Positions
          <Badge variant="outline" className="text-[10px] border-teal text-teal">
            {positions.length} open
          </Badge>
        </h3>
        <Card>
          <CardContent className="pt-6">
            {positions.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">
                No open IBKR positions
              </p>
            ) : (
              <div className="overflow-x-auto -mx-2">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Ticker</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Strike</TableHead>
                    <TableHead>Expiry</TableHead>
                    <TableHead className="text-right">Qty</TableHead>
                    <TableHead className="text-right">Avg Cost</TableHead>
                    <TableHead className="text-right">Price</TableHead>
                    <TableHead className="text-right">P&L</TableHead>
                    <TableHead className="text-right">IV</TableHead>
                    <TableHead className="text-right">Delta</TableHead>
                    <TableHead className="text-right">Theta</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {positions.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell className="font-medium">{p.ticker}</TableCell>
                      <TableCell className="uppercase text-xs">
                        {p.call_put ?? "EQ"}
                      </TableCell>
                      <TableCell>{p.strike ?? "--"}</TableCell>
                      <TableCell>{p.expiry ?? "--"}</TableCell>
                      <TableCell className="text-right">{p.quantity}</TableCell>
                      <TableCell className="text-right font-mono">
                        {fmtCurrency(p.avg_cost)}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {fmtCurrency(p.current_price)}
                      </TableCell>
                      <TableCell
                        className={`text-right font-mono ${
                          (p.unrealized_pnl ?? 0) >= 0
                            ? "text-profit"
                            : "text-loss"
                        }`}
                      >
                        {fmtCurrency(p.unrealized_pnl)}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {p.iv ? `${(p.iv * 100).toFixed(0)}%` : "--"}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {fmt(p.delta)}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {fmt(p.theta)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
