"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { Trade } from "@/lib/types/trading";

const statusColors: Record<string, string> = {
  pending: "border-gold text-gold",
  filled: "border-profit text-profit",
  partial: "border-teal text-teal",
  cancelled: "border-muted-foreground text-muted-foreground",
  failed: "border-loss text-loss",
};

export default function TradesPage() {
  const supabase = createClient();
  const [trades, setTrades] = useState<Trade[]>([]);

  useEffect(() => {
    async function load() {
      const { data } = await supabase
        .from("trades")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(100);
      if (data) setTrades(data);
    }

    load();

    const channel = supabase
      .channel("trades-page")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "trades" },
        () => load()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Trade Log</h2>
        <p className="text-muted-foreground">
          History of all executed and pending trades
        </p>
      </div>

      <Card>
        <CardContent className="pt-6">
          {trades.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              No trades recorded yet
            </p>
          ) : (
            <div className="overflow-x-auto -mx-2">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Ticker</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Strike</TableHead>
                  <TableHead>Expiry</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead className="text-right">Fill Price</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {trades.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell className="text-xs">
                      {new Date(t.created_at).toLocaleDateString()}
                    </TableCell>
                    <TableCell className="font-medium">{t.ticker}</TableCell>
                    <TableCell className="uppercase text-xs font-mono">
                      {t.action}
                    </TableCell>
                    <TableCell className="uppercase text-xs">
                      {t.call_put ?? "EQ"}
                    </TableCell>
                    <TableCell>{t.strike ?? "--"}</TableCell>
                    <TableCell>{t.expiry ?? "--"}</TableCell>
                    <TableCell className="text-right">{t.quantity}</TableCell>
                    <TableCell className="text-right font-mono">
                      {t.fill_price ? `$${t.fill_price.toFixed(2)}` : "--"}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={statusColors[t.status] ?? ""}
                      >
                        {t.status.toUpperCase()}
                      </Badge>
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
