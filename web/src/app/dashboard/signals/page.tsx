"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { Signal, Profile } from "@/lib/types/trading";

const statusColors: Record<string, string> = {
  pending: "border-gold text-gold bg-[oklch(0.65_0.16_85_/_0.06)]",
  approved: "border-profit text-profit bg-[oklch(0.50_0.20_155_/_0.06)]",
  rejected: "border-loss text-loss bg-[oklch(0.52_0.22_25_/_0.06)]",
  expired: "border-muted-foreground text-muted-foreground",
  executed: "border-teal text-teal bg-[oklch(0.55_0.18_175_/_0.06)]",
};

function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export default function SignalsPage() {
  const supabase = createClient();
  const [signals, setSignals] = useState<Signal[]>([]);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [filter, setFilter] = useState("all");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    async function load() {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user) {
        const { data: prof } = await supabase
          .from("profiles")
          .select("*")
          .eq("id", user.id)
          .single();
        if (prof) setProfile(prof);
      }

      const { data } = await supabase
        .from("signals")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(100);
      if (data) setSignals(data);
    }

    load();

    const channel = supabase
      .channel("signals-page")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "signals" },
        () => load()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const isAdmin = profile?.role === "admin";

  const filtered =
    filter === "all"
      ? signals
      : filter === "actionable"
        ? signals.filter((s) => s.status === "pending" || s.status === "approved")
        : signals.filter((s) => s.status === filter);

  const pendingCount = signals.filter((s) => s.status === "pending").length;
  const approvedCount = signals.filter((s) => s.status === "approved").length;
  const executedCount = signals.filter((s) => s.status === "executed").length;
  const avgConfidence = signals.length > 0
    ? signals.reduce((sum, s) => sum + (s.confidence_score ?? 0), 0) / signals.length
    : 0;

  async function handleApprove(id: string) {
    await supabase
      .from("signals")
      .update({
        status: "approved",
        reviewed_by: profile?.id,
        reviewed_at: new Date().toISOString(),
      })
      .eq("id", id);
  }

  async function handleReject(id: string) {
    await supabase
      .from("signals")
      .update({
        status: "rejected",
        reviewed_by: profile?.id,
        reviewed_at: new Date().toISOString(),
      })
      .eq("id", id);
  }

  function toggleExpand(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Signals</h2>
        <p className="text-muted-foreground">
          AI-generated trading signals — approve, reject, or let semi-auto handle them
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card className="bg-card border-border">
          <CardContent className="p-4">
            <p className="text-[10px] font-medium tracking-[0.1em] uppercase text-muted-foreground mb-1">Pending</p>
            <p className="text-xl font-bold font-mono text-gold">{pendingCount}</p>
          </CardContent>
        </Card>
        <Card className="bg-card border-border">
          <CardContent className="p-4">
            <p className="text-[10px] font-medium tracking-[0.1em] uppercase text-muted-foreground mb-1">Approved</p>
            <p className="text-xl font-bold font-mono text-profit">{approvedCount}</p>
          </CardContent>
        </Card>
        <Card className="bg-card border-border">
          <CardContent className="p-4">
            <p className="text-[10px] font-medium tracking-[0.1em] uppercase text-muted-foreground mb-1">Executed</p>
            <p className="text-xl font-bold font-mono text-teal">{executedCount}</p>
          </CardContent>
        </Card>
        <Card className="bg-card border-border">
          <CardContent className="p-4">
            <p className="text-[10px] font-medium tracking-[0.1em] uppercase text-muted-foreground mb-1">Avg Confidence</p>
            <p className="text-xl font-bold font-mono">{avgConfidence > 0 ? avgConfidence.toFixed(0) : "—"}</p>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex gap-2 flex-wrap">
        {[
          { key: "all", label: "All" },
          { key: "actionable", label: "Actionable" },
          { key: "pending", label: "Pending" },
          { key: "approved", label: "Approved" },
          { key: "executed", label: "Executed" },
          { key: "rejected", label: "Rejected" },
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

      {/* Signals list */}
      {filtered.length === 0 ? (
        <Card className="bg-card border-border">
          <CardContent className="py-12 text-center">
            <p className="text-muted-foreground">
              {filter === "all" ? "No signals yet — the bot generates signals during market hours" : `No ${filter} signals`}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {filtered.map((sig) => {
            const isExpanded = expanded.has(sig.id);
            const scoring = (sig.scoring_factors ?? {}) as Record<string, unknown>;
            const sourceData = (sig.source_data ?? {}) as Record<string, unknown>;
            const analysis = (sourceData.ai_analysis ?? {}) as Record<string, unknown>;
            const hasTrade = sig.suggested_action || sig.suggested_strike;

            return (
              <div
                key={sig.id}
                className={`rounded-xl bg-card border transition-all ${
                  sig.status === "pending" ? "border-gold/30" : "border-border"
                }`}
              >
                {/* Main row */}
                <button
                  onClick={() => toggleExpand(sig.id)}
                  className="w-full text-left px-5 py-4"
                >
                  <div className="flex items-center gap-4">
                    {/* Confidence ring */}
                    <div className={`flex-shrink-0 w-14 h-14 rounded-xl flex flex-col items-center justify-center border ${
                      (sig.confidence_score ?? 0) >= 85 ? "bg-[oklch(0.50_0.20_155_/_0.06)] border-[oklch(0.50_0.20_155_/_0.15)]" :
                      (sig.confidence_score ?? 0) >= 70 ? "bg-[oklch(0.65_0.16_85_/_0.06)] border-[oklch(0.65_0.16_85_/_0.15)]" :
                      "bg-[oklch(0.94_0.006_90)] border-border"
                    }`}>
                      <span className={`text-lg font-mono font-bold ${
                        (sig.confidence_score ?? 0) >= 85 ? "text-profit" :
                        (sig.confidence_score ?? 0) >= 70 ? "text-gold" :
                        "text-muted-foreground"
                      }`}>
                        {sig.confidence_score?.toFixed(0) ?? "—"}
                      </span>
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-lg font-bold tracking-tight">{sig.ticker}</span>
                        <Badge variant="outline" className={
                          sig.direction === "bullish"
                            ? "text-[9px] border-profit text-profit bg-[oklch(0.50_0.20_155_/_0.06)]"
                            : "text-[9px] border-loss text-loss bg-[oklch(0.52_0.22_25_/_0.06)]"
                        }>
                          {sig.direction?.toUpperCase()}
                        </Badge>
                        <Badge variant="outline" className={`text-[9px] ${statusColors[sig.status] ?? ""}`}>
                          {sig.status.toUpperCase()}
                        </Badge>
                        <Badge variant="outline" className="text-[9px] border-muted-foreground text-muted-foreground capitalize">
                          {sig.source}
                        </Badge>
                        {(sig.confidence_score ?? 0) >= 85 && (
                          <Badge variant="outline" className="text-[8px] border-teal text-teal bg-[oklch(0.55_0.18_175_/_0.06)]">
                            AUTO-ELIGIBLE
                          </Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                        {hasTrade && (
                          <span className="font-mono">
                            {sig.suggested_action}
                            {sig.suggested_strike ? ` @ $${sig.suggested_strike}` : ""}
                            {sig.suggested_expiry ? ` exp ${sig.suggested_expiry}` : ""}
                          </span>
                        )}
                        <span>{timeAgo(sig.created_at)}</span>
                        {typeof scoring.thesis === "string" && (
                          <span className="truncate max-w-xs hidden sm:inline">
                            {scoring.thesis}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Actions */}
                    {isAdmin && sig.status === "pending" && (
                      <div className="flex gap-2 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
                        <Button
                          size="sm"
                          className="bg-profit text-white hover:bg-profit/90 h-8 px-3 text-xs"
                          onClick={() => handleApprove(sig.id)}
                        >
                          Approve
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="border-loss text-loss hover:bg-loss/10 h-8 px-3 text-xs"
                          onClick={() => handleReject(sig.id)}
                        >
                          Reject
                        </Button>
                      </div>
                    )}

                    {/* Chevron */}
                    <svg className={`w-4 h-4 text-muted-foreground transition-transform flex-shrink-0 ${isExpanded ? "rotate-180" : ""}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="m6 9 6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </div>
                </button>

                {/* Expanded detail */}
                {isExpanded && (
                  <div className="px-5 pb-5 pt-0 border-t border-border mt-0 pt-4 space-y-4">
                    {/* Thesis */}
                    {(typeof scoring.thesis === "string" || typeof analysis.thesis === "string" || typeof analysis.reasoning === "string") && (
                      <div>
                        <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">AI Thesis</p>
                        <p className="text-sm leading-relaxed">
                          {String(scoring.thesis || analysis.thesis || "")}
                        </p>
                        {typeof analysis.reasoning === "string" && analysis.reasoning !== String(scoring.thesis ?? "") && (
                          <p className="text-xs text-muted-foreground mt-2 leading-relaxed">
                            {analysis.reasoning}
                          </p>
                        )}
                      </div>
                    )}

                    <div className="grid gap-4 sm:grid-cols-2">
                      {/* Trade recommendation */}
                      {(analysis.recommended_trade || hasTrade) && (
                        <div>
                          <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Recommended Trade</p>
                          <div className="text-xs font-mono bg-muted rounded-md px-3 py-2 space-y-0.5">
                            {sig.suggested_action && <div className="flex justify-between"><span className="text-muted-foreground">action</span><span>{sig.suggested_action}</span></div>}
                            {sig.suggested_strike && <div className="flex justify-between"><span className="text-muted-foreground">strike</span><span>${sig.suggested_strike}</span></div>}
                            {sig.suggested_expiry && <div className="flex justify-between"><span className="text-muted-foreground">expiry</span><span>{sig.suggested_expiry}</span></div>}
                            {sig.suggested_quantity && <div className="flex justify-between"><span className="text-muted-foreground">quantity</span><span>x{sig.suggested_quantity}</span></div>}
                            {analysis.recommended_trade != null && typeof analysis.recommended_trade === "object" &&
                              Object.entries(analysis.recommended_trade as Record<string, unknown>)
                                .filter(([k]) => !["action", "strike_selection"].includes(k))
                                .map(([k, v]) => (
                                  <div key={k} className="flex justify-between">
                                    <span className="text-muted-foreground">{k.replace(/_/g, " ")}</span>
                                    <span>{String(v ?? "")}</span>
                                  </div>
                                ))
                            }
                          </div>
                        </div>
                      )}

                      {/* Scoring & metadata */}
                      <div>
                        <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Signal Details</p>
                        <div className="text-xs font-mono bg-muted rounded-md px-3 py-2 space-y-0.5">
                          <div className="flex justify-between"><span className="text-muted-foreground">source</span><span>{sig.source}</span></div>
                          <div className="flex justify-between"><span className="text-muted-foreground">confidence</span><span className="text-gold">{sig.confidence_score?.toFixed(0)}</span></div>
                          {scoring.haiku_initial != null && <div className="flex justify-between"><span className="text-muted-foreground">haiku screen</span><span>{String(scoring.haiku_initial ?? "")}</span></div>}
                          {scoring.sonnet_confidence != null && <div className="flex justify-between"><span className="text-muted-foreground">sonnet analysis</span><span>{String(scoring.sonnet_confidence ?? "")}</span></div>}
                          {typeof scoring.institutional_type === "string" && <div className="flex justify-between"><span className="text-muted-foreground">type</span><span>{scoring.institutional_type}</span></div>}
                          {typeof analysis.flow_quality === "string" && <div className="flex justify-between"><span className="text-muted-foreground">flow quality</span><span>{analysis.flow_quality}</span></div>}
                          {typeof analysis.iv_assessment === "string" && <div className="flex justify-between"><span className="text-muted-foreground">IV</span><span>{analysis.iv_assessment}</span></div>}
                          {typeof analysis.gex_context === "string" && <div className="flex justify-between"><span className="text-muted-foreground">GEX</span><span>{analysis.gex_context}</span></div>}
                          {analysis.dark_pool_alignment != null && <div className="flex justify-between"><span className="text-muted-foreground">dark pool</span><span>{String(analysis.dark_pool_alignment) === "true" ? "aligned" : "divergent"}</span></div>}
                          <div className="flex justify-between"><span className="text-muted-foreground">created</span><span>{new Date(sig.created_at).toLocaleString()}</span></div>
                          {sig.reviewed_at && <div className="flex justify-between"><span className="text-muted-foreground">reviewed</span><span>{new Date(sig.reviewed_at).toLocaleString()}</span></div>}
                        </div>
                      </div>
                    </div>

                    {/* Risk factors */}
                    {Array.isArray(analysis.risk_factors) && (analysis.risk_factors as string[]).length > 0 && (
                      <div>
                        <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Risk Factors</p>
                        <ul className="text-xs text-muted-foreground space-y-0.5">
                          {(analysis.risk_factors as string[]).map((r: string, i: number) => (
                            <li key={i} className="flex items-start gap-1.5">
                              <span className="text-loss mt-0.5">-</span> <span>{String(r)}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
