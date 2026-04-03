"use client";

import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface WhaleAlert {
  ticker: string;
  strike: number;
  call_put: string;
  expiry: string;
  premium: number;
  volume: number;
  open_interest: number;
  sentiment: string;
  is_sweep: boolean;
  is_block: boolean;
  underlying_price: number;
  timestamp: string;
}

function fmtPremium(n: number) {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  return `$${(n / 1000).toFixed(0)}k`;
}

export default function WhaleAlertsPage() {
  const [alerts, setAlerts] = useState<WhaleAlert[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const resp = await fetch("/api/whale-alerts");
        if (resp.ok) {
          const data = await resp.json();
          setAlerts(data.alerts ?? []);
        }
      } catch {
        // silently fail
      }
      setLoading(false);
    }
    load();

    // Auto-refresh every 30 seconds
    const interval = setInterval(load, 30000);
    return () => clearInterval(interval);
  }, []);

  const totalPremium = alerts.reduce((sum, a) => sum + a.premium, 0);
  const bullishCount = alerts.filter((a) => a.sentiment === "bullish" || String(a.call_put).toLowerCase().includes("call")).length;
  const bearishCount = alerts.length - bullishCount;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Whale Alerts</h2>
        <p className="text-muted-foreground">
          $100k+ options trades — institutional and smart money flow
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card className="bg-card border-border">
          <CardContent className="p-4">
            <p className="text-[10px] font-medium tracking-[0.1em] uppercase text-muted-foreground mb-1">
              Whale Trades
            </p>
            <p className="text-xl font-bold font-mono">{alerts.length}</p>
          </CardContent>
        </Card>
        <Card className="bg-card border-border">
          <CardContent className="p-4">
            <p className="text-[10px] font-medium tracking-[0.1em] uppercase text-muted-foreground mb-1">
              Total Premium
            </p>
            <p className="text-xl font-bold font-mono text-gold">{fmtPremium(totalPremium)}</p>
          </CardContent>
        </Card>
        <Card className="bg-card border-border">
          <CardContent className="p-4">
            <p className="text-[10px] font-medium tracking-[0.1em] uppercase text-muted-foreground mb-1">
              Bullish
            </p>
            <p className="text-xl font-bold font-mono text-profit">{bullishCount}</p>
          </CardContent>
        </Card>
        <Card className="bg-card border-border">
          <CardContent className="p-4">
            <p className="text-[10px] font-medium tracking-[0.1em] uppercase text-muted-foreground mb-1">
              Bearish
            </p>
            <p className="text-xl font-bold font-mono text-loss">{bearishCount}</p>
          </CardContent>
        </Card>
      </div>

      {/* Alerts feed */}
      {loading ? (
        <Card className="bg-card border-border">
          <CardContent className="py-12 text-center">
            <div className="inline-flex items-center gap-2">
              <svg className="h-4 w-4 animate-spin text-teal" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              <span className="text-muted-foreground">Loading whale alerts...</span>
            </div>
          </CardContent>
        </Card>
      ) : alerts.length === 0 ? (
        <Card className="bg-card border-border">
          <CardContent className="py-12 text-center">
            <p className="text-muted-foreground">No whale alerts right now. Check back during market hours.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {alerts.map((alert, i) => {
            const isCall = String(alert.call_put).toLowerCase().includes("call");
            const isBullish = alert.sentiment === "bullish" || isCall;

            return (
              <div
                key={`${alert.ticker}-${alert.strike}-${i}`}
                className="group rounded-xl bg-card border border-border hover:border-teal/30 transition-all duration-200 overflow-hidden"
              >
                <div className="flex items-center gap-4 px-5 py-4">
                  {/* Premium badge — the eye-catcher */}
                  <div className={`flex-shrink-0 w-20 h-14 rounded-lg flex flex-col items-center justify-center ${
                    isBullish
                      ? "bg-[oklch(0.50_0.20_155_/_0.06)] border border-[oklch(0.50_0.20_155_/_0.15)]"
                      : "bg-[oklch(0.52_0.22_25_/_0.06)] border border-[oklch(0.52_0.22_25_/_0.15)]"
                  }`}>
                    <span className={`text-lg font-mono font-bold ${isBullish ? "text-profit" : "text-loss"}`}>
                      {fmtPremium(alert.premium)}
                    </span>
                    <span className={`text-[9px] font-mono uppercase ${isBullish ? "text-profit" : "text-loss"}`}>
                      {isBullish ? "bullish" : "bearish"}
                    </span>
                  </div>

                  {/* Main info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-lg font-bold tracking-tight">{alert.ticker}</span>
                      <span className="text-sm font-mono text-muted-foreground">
                        ${alert.strike} {isCall ? "Call" : "Put"}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        exp {alert.expiry}
                      </span>
                      {alert.is_sweep && (
                        <Badge variant="outline" className="text-[9px] px-1.5 py-0 h-4 border-gold text-gold bg-[oklch(0.65_0.16_85_/_0.06)]">
                          SWEEP
                        </Badge>
                      )}
                      {alert.is_block && (
                        <Badge variant="outline" className="text-[9px] px-1.5 py-0 h-4 border-teal text-teal bg-[oklch(0.55_0.18_175_/_0.06)]">
                          BLOCK
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-4 mt-1 text-xs font-mono text-muted-foreground">
                      <span>Vol: {alert.volume.toLocaleString()}</span>
                      <span>OI: {alert.open_interest.toLocaleString()}</span>
                      {alert.underlying_price > 0 && (
                        <span>Stock: ${alert.underlying_price.toFixed(2)}</span>
                      )}
                      {alert.volume > 0 && alert.open_interest > 0 && (
                        <span className={alert.volume / alert.open_interest > 1 ? "text-gold" : ""}>
                          V/OI: {(alert.volume / alert.open_interest).toFixed(1)}x
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
