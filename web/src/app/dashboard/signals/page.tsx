"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { Signal, Profile } from "@/lib/types/trading";

const statusColors: Record<string, string> = {
  pending: "border-gold text-gold",
  approved: "border-profit text-profit",
  rejected: "border-loss text-loss",
  expired: "border-muted-foreground text-muted-foreground",
  executed: "border-teal text-teal",
};

export default function SignalsPage() {
  const supabase = createClient();
  const [signals, setSignals] = useState<Signal[]>([]);
  const [profile, setProfile] = useState<Profile | null>(null);

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
        .limit(50);
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

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Signals</h2>
        <p className="text-muted-foreground">
          Trading signals from congressional trades, options flow, and
          predictions
        </p>
      </div>

      <div className="space-y-4">
        {signals.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <p className="text-muted-foreground">No signals yet</p>
            </CardContent>
          </Card>
        ) : (
          signals.map((sig) => (
            <Card key={sig.id}>
              <CardContent className="pt-6">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 space-y-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-lg font-bold">{sig.ticker}</span>
                      <Badge
                        variant="outline"
                        className={
                          sig.direction === "bullish"
                            ? "border-profit text-profit"
                            : "border-loss text-loss"
                        }
                      >
                        {sig.direction.toUpperCase()}
                      </Badge>
                      <Badge
                        variant="outline"
                        className={statusColors[sig.status] ?? ""}
                      >
                        {sig.status.toUpperCase()}
                      </Badge>
                      <Badge variant="secondary" className="capitalize">
                        {sig.source}
                      </Badge>
                    </div>

                    {sig.suggested_action && (
                      <p className="text-sm text-muted-foreground">
                        Suggested: {sig.suggested_action}
                        {sig.suggested_strike && ` @ ${sig.suggested_strike}`}
                        {sig.suggested_expiry && ` exp ${sig.suggested_expiry}`}
                        {sig.suggested_quantity &&
                          ` x${sig.suggested_quantity}`}
                      </p>
                    )}

                    <p className="text-xs text-muted-foreground">
                      {new Date(sig.created_at).toLocaleString()}
                    </p>
                  </div>

                  <div className="text-right space-y-2">
                    <div>
                      <p className="text-2xl font-bold text-gold">
                        {sig.confidence_score?.toFixed(0) ?? "--"}
                      </p>
                      <p className="text-[10px] text-muted-foreground uppercase tracking-wide">
                        confidence
                      </p>
                    </div>

                    {isAdmin && sig.status === "pending" && (
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          className="bg-profit text-profit-foreground hover:bg-profit/90"
                          onClick={() => handleApprove(sig.id)}
                        >
                          Approve
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="border-loss text-loss hover:bg-loss/10"
                          onClick={() => handleReject(sig.id)}
                        >
                          Reject
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
