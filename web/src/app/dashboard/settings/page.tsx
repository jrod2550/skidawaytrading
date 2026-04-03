"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";

interface RiskLimits {
  max_position_pct: number;
  max_open_positions: number;
  daily_loss_pct: number;
  weekly_loss_pct: number;
  max_portfolio_delta: number;
  min_portfolio_theta: number;
  min_confidence_score: number;
  position_stop_loss_pct: number;
  position_take_profit_pct: number;
}

const defaultLimits: RiskLimits = {
  max_position_pct: 5,
  max_open_positions: 10,
  daily_loss_pct: 3,
  weekly_loss_pct: 7,
  max_portfolio_delta: 500,
  min_portfolio_theta: -200,
  min_confidence_score: 70,
  position_stop_loss_pct: 30,
  position_take_profit_pct: 100,
};

export default function SettingsPage() {
  const supabase = createClient();
  const [limits, setLimits] = useState<RiskLimits>(defaultLimits);
  const [botMode, setBotMode] = useState("manual_review");
  const [botPaused, setBotPaused] = useState(false);
  const [saving, setSaving] = useState(false);
  const [watchedReps, setWatchedReps] = useState("");

  useEffect(() => {
    async function load() {
      const { data } = await supabase
        .from("bot_config")
        .select("*");

      if (data) {
        for (const row of data) {
          if (row.key === "risk_limits") setLimits(row.value as unknown as RiskLimits);
          if (row.key === "bot_mode") setBotMode(row.value as unknown as string);
          if (row.key === "bot_paused") setBotPaused(row.value as unknown as boolean);
          if (row.key === "watched_representatives")
            setWatchedReps((row.value as unknown as string[]).join(", "));
        }
      }
    }
    load();
  }, []);

  async function handleSave() {
    setSaving(true);
    await Promise.all([
      supabase
        .from("bot_config")
        .upsert({ key: "risk_limits", value: limits as unknown as Record<string, unknown>, updated_at: new Date().toISOString() }),
      supabase
        .from("bot_config")
        .upsert({ key: "bot_mode", value: botMode as unknown as Record<string, unknown>, updated_at: new Date().toISOString() }),
      supabase
        .from("bot_config")
        .upsert({
          key: "watched_representatives",
          value: watchedReps.split(",").map((s) => s.trim()).filter(Boolean) as unknown as Record<string, unknown>,
          updated_at: new Date().toISOString(),
        }),
    ]);
    setSaving(false);
  }

  async function togglePause() {
    const newVal = !botPaused;
    setBotPaused(newVal);
    await supabase
      .from("bot_config")
      .upsert({ key: "bot_paused", value: newVal as unknown as Record<string, unknown>, updated_at: new Date().toISOString() });
  }

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Settings</h2>
        <p className="text-muted-foreground">
          Bot configuration and risk controls (admin only)
        </p>
      </div>

      {/* Bot Control */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Bot Control</CardTitle>
            <Badge
              variant="outline"
              className={
                botPaused
                  ? "border-loss text-loss"
                  : "border-profit text-profit"
              }
            >
              {botPaused ? "PAUSED" : "RUNNING"}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-4">
            <Button
              onClick={togglePause}
              variant={botPaused ? "default" : "destructive"}
              className={botPaused ? "bg-profit hover:bg-profit/90" : ""}
            >
              {botPaused ? "Resume Bot" : "Pause Bot"}
            </Button>
          </div>

          <div className="space-y-2">
            <Label>Approval Mode</Label>
            <div className="flex gap-2">
              {["manual_review", "semi_auto", "full_auto"].map((mode) => (
                <Button
                  key={mode}
                  variant={botMode === mode ? "default" : "outline"}
                  size="sm"
                  className={
                    botMode === mode ? "bg-teal text-teal-foreground" : ""
                  }
                  onClick={() => setBotMode(mode)}
                >
                  {mode.replace("_", " ")}
                </Button>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Watched Representatives */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Watched Representatives</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            <Label htmlFor="reps">
              Comma-separated list of representatives to track
            </Label>
            <Input
              id="reps"
              value={watchedReps}
              onChange={(e) => setWatchedReps(e.target.value)}
              placeholder="Pelosi, Tuberville, Crenshaw"
            />
          </div>
        </CardContent>
      </Card>

      {/* Risk Limits */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Risk Controls</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {[
              {
                key: "max_position_pct" as const,
                label: "Max Position Size (%)",
              },
              {
                key: "max_open_positions" as const,
                label: "Max Open Positions",
              },
              { key: "daily_loss_pct" as const, label: "Daily Loss Limit (%)" },
              {
                key: "weekly_loss_pct" as const,
                label: "Weekly Loss Limit (%)",
              },
              {
                key: "max_portfolio_delta" as const,
                label: "Max Portfolio Delta",
              },
              {
                key: "min_portfolio_theta" as const,
                label: "Min Portfolio Theta ($/day)",
              },
              {
                key: "min_confidence_score" as const,
                label: "Min Confidence Score",
              },
              {
                key: "position_stop_loss_pct" as const,
                label: "Stop Loss (%)",
              },
              {
                key: "position_take_profit_pct" as const,
                label: "Take Profit (%)",
              },
            ].map(({ key, label }) => (
              <div key={key} className="space-y-2">
                <Label htmlFor={key} className="text-xs">
                  {label}
                </Label>
                <Input
                  id={key}
                  type="number"
                  value={limits[key]}
                  onChange={(e) =>
                    setLimits((prev) => ({
                      ...prev,
                      [key]: parseFloat(e.target.value) || 0,
                    }))
                  }
                />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Button
        onClick={handleSave}
        disabled={saving}
        className="bg-teal text-teal-foreground hover:bg-teal/90"
      >
        {saving ? "Saving..." : "Save Settings"}
      </Button>
    </div>
  );
}
