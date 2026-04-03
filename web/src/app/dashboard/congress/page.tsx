"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface CongressTrade {
  name: string;
  ticker: string;
  txn_type: string;
  amounts: string;
  transaction_date: string;
  filed_at_date: string;
  member_type: string;
  notes: string;
  issuer: string;
}

export default function CongressPage() {
  const [trades, setTrades] = useState<CongressTrade[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");

  useEffect(() => {
    async function load() {
      try {
        const resp = await fetch("/api/congress");
        if (resp.ok) {
          const data = await resp.json();
          setTrades(data.trades ?? []);
        }
      } catch {
        // API route may not exist yet, try direct UW call from client
      }
      setLoading(false);
    }
    load();
  }, []);

  // Also load from signals table for congressional signals we've created
  const supabase = createClient();
  const [signals, setSignals] = useState<Record<string, unknown>[]>([]);

  useEffect(() => {
    async function loadSignals() {
      const { data } = await supabase
        .from("signals")
        .select("*")
        .eq("source", "congressional")
        .order("created_at", { ascending: false })
        .limit(20);
      if (data) setSignals(data);
    }
    loadSignals();
  }, []);

  const filteredTrades =
    filter === "all"
      ? trades
      : filter === "buy"
        ? trades.filter((t) => t.txn_type?.toLowerCase().includes("buy") || t.txn_type?.toLowerCase().includes("purchase"))
        : trades.filter((t) => t.txn_type?.toLowerCase().includes("sell"));

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Congressional Trades</h2>
        <p className="text-muted-foreground">
          Recent stock trades by members of Congress
        </p>
      </div>

      {/* AI-generated congressional signals */}
      {signals.length > 0 && (
        <Card className="bg-card border-border border-gold/20">
          <CardContent className="p-5">
            <h3 className="text-[11px] font-medium tracking-[0.15em] uppercase text-gold mb-3">
              AI Congressional Signals
            </h3>
            <div className="space-y-2">
              {signals.map((sig: Record<string, unknown>) => (
                <div
                  key={sig.id as string}
                  className="flex items-center justify-between rounded-lg bg-[oklch(0.97_0.003_90)] border border-border px-3 py-2.5"
                >
                  <div className="flex items-center gap-2">
                    <Badge
                      variant="outline"
                      className={`text-[9px] ${sig.direction === "bullish" ? "border-profit text-profit" : "border-loss text-loss"}`}
                    >
                      {(sig.direction as string)?.toUpperCase()}
                    </Badge>
                    <span className="text-sm font-semibold">{sig.ticker as string}</span>
                    <span className="text-xs text-muted-foreground">
                      {((sig.source_data as Record<string, unknown>)?.representative as string) ?? ""}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-mono text-gold">
                      {(sig.confidence_score as number)?.toFixed(0)}
                    </span>
                    <Badge variant="outline" className="text-[9px] border-muted-foreground text-muted-foreground">
                      {sig.status as string}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Filters */}
      <div className="flex gap-2">
        {[
          { key: "all", label: "All Trades" },
          { key: "buy", label: "Buys" },
          { key: "sell", label: "Sells" },
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

      {/* Trades list */}
      {loading ? (
        <Card className="bg-card border-border">
          <CardContent className="py-12 text-center">
            <p className="text-muted-foreground">Loading congressional trades...</p>
          </CardContent>
        </Card>
      ) : trades.length === 0 ? (
        <Card className="bg-card border-border">
          <CardContent className="py-12 text-center">
            <p className="text-muted-foreground">Congressional trades load from the API route. Start the bot to populate this data.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {filteredTrades.map((trade, i) => {
            const isBuy = trade.txn_type?.toLowerCase().includes("buy") || trade.txn_type?.toLowerCase().includes("purchase");
            return (
              <div
                key={`${trade.ticker}-${trade.name}-${i}`}
                className="flex items-center justify-between rounded-lg bg-card border border-border px-4 py-3 hover:border-[oklch(0.82_0.01_175)] transition-colors"
              >
                <div className="flex items-center gap-3">
                  <div
                    className={`w-8 h-8 rounded-md flex items-center justify-center text-[10px] font-mono font-bold border ${
                      isBuy
                        ? "bg-[oklch(0.50_0.20_155_/_0.08)] text-profit border-[oklch(0.50_0.20_155_/_0.2)]"
                        : "bg-[oklch(0.52_0.22_25_/_0.08)] text-loss border-[oklch(0.52_0.22_25_/_0.2)]"
                    }`}
                  >
                    {isBuy ? "B" : "S"}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold">{trade.ticker}</span>
                      <Badge variant="outline" className="text-[9px] border-muted-foreground text-muted-foreground">
                        {trade.member_type}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {trade.name} · {trade.txn_type}
                    </p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-sm font-mono font-medium">{trade.amounts}</p>
                  <p className="text-[10px] text-muted-foreground">
                    traded {trade.transaction_date} · filed {trade.filed_at_date}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
