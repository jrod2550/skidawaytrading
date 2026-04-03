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

export default function PositionsPage() {
  const supabase = createClient();
  const [positions, setPositions] = useState<Position[]>([]);

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

  // Portfolio-level Greeks
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

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Positions</h2>
        <p className="text-muted-foreground">
          Current holdings and portfolio Greeks
        </p>
      </div>

      {/* Portfolio Greeks Summary */}
      <div className="grid gap-4 grid-cols-2 sm:grid-cols-3 lg:grid-cols-6">
        <Card>
          <CardHeader className="pb-1">
            <CardTitle className="text-xs text-muted-foreground">
              Total Value
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-lg font-bold">{fmtCurrency(totals.value)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-1">
            <CardTitle className="text-xs text-muted-foreground">
              Unrealized P&L
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
        {(
          [
            ["Delta", totals.delta],
            ["Gamma", totals.gamma],
            ["Theta", totals.theta],
            ["Vega", totals.vega],
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

      {/* Positions Table */}
      <Card>
        <CardContent className="pt-6">
          {positions.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              No open positions
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
  );
}
