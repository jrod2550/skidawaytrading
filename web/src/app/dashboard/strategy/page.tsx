"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface BotConfig {
  key: string;
  value: unknown;
}

interface Profile {
  id: string;
  role: string;
}

const BOT_MODES = [
  {
    value: "manual_review",
    label: "Manual Review",
    desc: "All signals require human approval before trading",
    color: "border-muted-foreground text-muted-foreground",
  },
  {
    value: "semi_auto",
    label: "Semi-Auto",
    desc: "High confidence signals (85+) auto-execute, rest need approval",
    color: "border-gold text-gold",
  },
  {
    value: "full_auto",
    label: "Full Auto",
    desc: "All signals above threshold auto-execute — use with caution",
    color: "border-loss text-loss",
  },
];

export default function StrategyPage() {
  const supabase = createClient();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [configs, setConfigs] = useState<Record<string, unknown>>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // Editable risk params
  const [botMode, setBotMode] = useState("manual_review");
  const [maxPositionPct, setMaxPositionPct] = useState("5");
  const [maxPortfolioRisk, setMaxPortfolioRisk] = useState("25");
  const [maxSingleLoss, setMaxSingleLoss] = useState("30");
  const [minConfidence, setMinConfidence] = useState("65");
  const [maxDailyTrades, setMaxDailyTrades] = useState("10");
  const [watchedReps, setWatchedReps] = useState("");
  const [excludedTickers, setExcludedTickers] = useState("");

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { data: prof } = await supabase
          .from("profiles")
          .select("id, role")
          .eq("id", user.id)
          .single();
        if (prof) setProfile(prof);
      }

      const { data: configData } = await supabase
        .from("bot_config")
        .select("key, value");

      if (configData) {
        const configMap: Record<string, unknown> = {};
        configData.forEach((c: BotConfig) => { configMap[c.key] = c.value; });
        setConfigs(configMap);

        // Populate form
        if (configMap.bot_mode) setBotMode(String(configMap.bot_mode).replace(/"/g, ""));
        if (configMap.max_position_pct) setMaxPositionPct(String(configMap.max_position_pct));
        if (configMap.max_portfolio_risk) setMaxPortfolioRisk(String(configMap.max_portfolio_risk));
        if (configMap.max_single_loss_pct) setMaxSingleLoss(String(configMap.max_single_loss_pct));
        if (configMap.min_confidence) setMinConfidence(String(configMap.min_confidence));
        if (configMap.max_daily_trades) setMaxDailyTrades(String(configMap.max_daily_trades));
        if (configMap.watched_representatives) {
          const reps = configMap.watched_representatives;
          setWatchedReps(Array.isArray(reps) ? reps.join(", ") : String(reps));
        }
        if (configMap.excluded_tickers) {
          const tickers = configMap.excluded_tickers;
          setExcludedTickers(Array.isArray(tickers) ? tickers.join(", ") : String(tickers));
        }
      }
    }
    load();
  }, []);

  const isAdmin = profile?.role === "admin";

  async function upsertConfig(key: string, value: unknown) {
    const { data: existing } = await supabase
      .from("bot_config")
      .select("key")
      .eq("key", key)
      .single();

    if (existing) {
      await supabase.from("bot_config").update({ value }).eq("key", key);
    } else {
      await supabase.from("bot_config").insert({ key, value });
    }
  }

  async function handleSave() {
    setSaving(true);
    await Promise.all([
      upsertConfig("bot_mode", botMode),
      upsertConfig("max_position_pct", parseFloat(maxPositionPct)),
      upsertConfig("max_portfolio_risk", parseFloat(maxPortfolioRisk)),
      upsertConfig("max_single_loss_pct", parseFloat(maxSingleLoss)),
      upsertConfig("min_confidence", parseInt(minConfidence)),
      upsertConfig("max_daily_trades", parseInt(maxDailyTrades)),
      upsertConfig("watched_representatives",
        watchedReps.trim() ? watchedReps.split(",").map((s) => s.trim()).filter(Boolean) : []
      ),
      upsertConfig("excluded_tickers",
        excludedTickers.trim() ? excludedTickers.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean) : []
      ),
    ]);
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Strategy & Risk</h2>
          <p className="text-muted-foreground">
            Control how the AI trades — risk limits, confidence thresholds, and execution mode
          </p>
        </div>
        {isAdmin && (
          <Button
            onClick={handleSave}
            disabled={saving}
            className="bg-teal text-teal-foreground hover:bg-teal/90"
          >
            {saving ? "Saving..." : saved ? "Saved" : "Save Changes"}
          </Button>
        )}
      </div>

      {/* Risk Profile Presets */}
      <Card className="bg-card border-border">
        <CardContent className="p-6">
          <h3 className="text-sm font-semibold mb-1">Risk Profile</h3>
          <p className="text-xs text-muted-foreground mb-4">
            Quick presets — or customize individual settings below
          </p>
          <div className="grid gap-3 sm:grid-cols-3">
            <button
              disabled={!isAdmin}
              onClick={() => { setMaxPositionPct("2"); setMaxPortfolioRisk("10"); setMaxSingleLoss("15"); setMinConfidence("75"); setMaxDailyTrades("5"); }}
              className="rounded-xl border-2 border-border hover:border-teal/30 p-4 text-left transition-all disabled:opacity-60"
            >
              <p className="text-sm font-semibold text-profit mb-1">Conservative</p>
              <p className="text-xs text-muted-foreground">2% max position, 10% portfolio risk, 75+ confidence only. Fewer trades, tighter stops.</p>
            </button>
            <button
              disabled={!isAdmin}
              onClick={() => { setMaxPositionPct("5"); setMaxPortfolioRisk("25"); setMaxSingleLoss("30"); setMinConfidence("65"); setMaxDailyTrades("10"); }}
              className="rounded-xl border-2 border-border hover:border-gold/30 p-4 text-left transition-all disabled:opacity-60"
            >
              <p className="text-sm font-semibold text-gold mb-1">Moderate</p>
              <p className="text-xs text-muted-foreground">5% max position, 25% portfolio risk, 65+ confidence. Balanced risk/reward.</p>
            </button>
            <button
              disabled={!isAdmin}
              onClick={() => { setMaxPositionPct("10"); setMaxPortfolioRisk("50"); setMaxSingleLoss("50"); setMinConfidence("55"); setMaxDailyTrades("20"); }}
              className="rounded-xl border-2 border-border hover:border-loss/30 p-4 text-left transition-all disabled:opacity-60"
            >
              <p className="text-sm font-semibold text-loss mb-1">Aggressive</p>
              <p className="text-xs text-muted-foreground">10% max position, 50% portfolio risk, 55+ confidence. More trades, wider stops. High risk.</p>
            </button>
          </div>
        </CardContent>
      </Card>

      {/* Trading Mode */}
      <Card className="bg-card border-border">
        <CardContent className="p-6">
          <h3 className="text-sm font-semibold mb-1">Trading Mode</h3>
          <p className="text-xs text-muted-foreground mb-4">
            Controls whether the AI needs your approval before executing trades
          </p>
          <div className="grid gap-3 sm:grid-cols-3">
            {BOT_MODES.map((mode) => (
              <button
                key={mode.value}
                onClick={() => isAdmin && setBotMode(mode.value)}
                disabled={!isAdmin}
                className={`rounded-xl border-2 p-4 text-left transition-all ${
                  botMode === mode.value
                    ? "border-teal bg-[oklch(0.55_0.18_175_/_0.04)]"
                    : "border-border hover:border-muted-foreground/30"
                } ${!isAdmin ? "opacity-60 cursor-not-allowed" : "cursor-pointer"}`}
              >
                <div className="flex items-center gap-2 mb-2">
                  <Badge variant="outline" className={`text-[9px] ${mode.color}`}>
                    {mode.label.toUpperCase()}
                  </Badge>
                  {botMode === mode.value && (
                    <div className="h-2 w-2 rounded-full bg-teal" />
                  )}
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">{mode.desc}</p>
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Risk Parameters */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="bg-card border-border">
          <CardContent className="p-6">
            <h3 className="text-sm font-semibold mb-4">Position Sizing</h3>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label className="text-xs uppercase tracking-wide text-sand">
                  Max Position Size (% of portfolio)
                </Label>
                <Input
                  type="number"
                  step="0.5"
                  value={maxPositionPct}
                  onChange={(e) => setMaxPositionPct(e.target.value)}
                  disabled={!isAdmin}
                  className="font-mono"
                />
                <p className="text-[10px] text-muted-foreground">
                  No single trade will exceed this % of total portfolio value
                </p>
              </div>
              <div className="space-y-2">
                <Label className="text-xs uppercase tracking-wide text-sand">
                  Max Portfolio Risk (% at risk)
                </Label>
                <Input
                  type="number"
                  step="1"
                  value={maxPortfolioRisk}
                  onChange={(e) => setMaxPortfolioRisk(e.target.value)}
                  disabled={!isAdmin}
                  className="font-mono"
                />
                <p className="text-[10px] text-muted-foreground">
                  Total portfolio exposure cap — bot stops opening positions beyond this
                </p>
              </div>
              <div className="space-y-2">
                <Label className="text-xs uppercase tracking-wide text-sand">
                  Max Single Trade Loss (%)
                </Label>
                <Input
                  type="number"
                  step="5"
                  value={maxSingleLoss}
                  onChange={(e) => setMaxSingleLoss(e.target.value)}
                  disabled={!isAdmin}
                  className="font-mono"
                />
                <p className="text-[10px] text-muted-foreground">
                  Stop-loss trigger — positions closed if they lose more than this %
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-card border-border">
          <CardContent className="p-6">
            <h3 className="text-sm font-semibold mb-4">AI Thresholds</h3>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label className="text-xs uppercase tracking-wide text-sand">
                  Min Confidence Score (0-100)
                </Label>
                <Input
                  type="number"
                  min="0"
                  max="100"
                  value={minConfidence}
                  onChange={(e) => setMinConfidence(e.target.value)}
                  disabled={!isAdmin}
                  className="font-mono"
                />
                <p className="text-[10px] text-muted-foreground">
                  Only create signals when Claude's confidence exceeds this. Default 65.
                </p>
              </div>
              <div className="space-y-2">
                <Label className="text-xs uppercase tracking-wide text-sand">
                  Max Daily Trades
                </Label>
                <Input
                  type="number"
                  min="1"
                  max="50"
                  value={maxDailyTrades}
                  onChange={(e) => setMaxDailyTrades(e.target.value)}
                  disabled={!isAdmin}
                  className="font-mono"
                />
                <p className="text-[10px] text-muted-foreground">
                  Maximum number of trades the bot will execute per day
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Watchlists & Filters */}
      <Card className="bg-card border-border">
        <CardContent className="p-6">
          <h3 className="text-sm font-semibold mb-4">Watchlists & Filters</h3>
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="space-y-2">
              <Label className="text-xs uppercase tracking-wide text-sand">
                Watched Congress Members
              </Label>
              <Input
                value={watchedReps}
                onChange={(e) => setWatchedReps(e.target.value)}
                placeholder="e.g. Pelosi, Tuberville, Crenshaw"
                disabled={!isAdmin}
              />
              <p className="text-[10px] text-muted-foreground">
                Comma-separated. Leave empty to watch all members.
              </p>
            </div>
            <div className="space-y-2">
              <Label className="text-xs uppercase tracking-wide text-sand">
                Excluded Tickers
              </Label>
              <Input
                value={excludedTickers}
                onChange={(e) => setExcludedTickers(e.target.value)}
                placeholder="e.g. MEME, GME, AMC"
                disabled={!isAdmin}
              />
              <p className="text-[10px] text-muted-foreground">
                Comma-separated. Bot will never trade these tickers.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* How It Works */}
      <Card className="bg-card border-border">
        <CardContent className="p-6">
          <h3 className="text-sm font-semibold mb-4">How the AI Trades</h3>
          <div className="space-y-4 text-sm text-foreground/80 leading-relaxed">
            <div className="flex gap-3">
              <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-[oklch(0.55_0.18_175_/_0.08)] border border-[oklch(0.55_0.18_175_/_0.2)] flex items-center justify-center text-xs font-mono font-bold text-teal">1</div>
              <div>
                <p className="font-semibold text-foreground">Scan — Every 60 seconds during market hours</p>
                <p className="text-muted-foreground">The bot pulls options flow alerts from Unusual Whales. Filters out noise (sub-$10k premium, index ETF hedging).</p>
              </div>
            </div>
            <div className="flex gap-3">
              <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-[oklch(0.55_0.18_175_/_0.08)] border border-[oklch(0.55_0.18_175_/_0.2)] flex items-center justify-center text-xs font-mono font-bold text-teal">2</div>
              <div>
                <p className="font-semibold text-foreground">Screen — Claude Haiku fast-screens each alert</p>
                <p className="text-muted-foreground">Cost: ~$0.001/call. Haiku decides in seconds: institutional or retail? Directional or hedge? Score 0-100. Alerts scoring 50+ escalate.</p>
              </div>
            </div>
            <div className="flex gap-3">
              <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-[oklch(0.65_0.16_85_/_0.08)] border border-[oklch(0.65_0.16_85_/_0.2)] flex items-center justify-center text-xs font-mono font-bold text-gold">3</div>
              <div>
                <p className="font-semibold text-foreground">Analyze — Claude Sonnet performs deep analysis</p>
                <p className="text-muted-foreground">Cost: ~$0.02/call. Cross-references congressional trades, related flow, market context. Generates a thesis, risk factors, and specific trade recommendation.</p>
              </div>
            </div>
            <div className="flex gap-3">
              <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-[oklch(0.50_0.20_155_/_0.08)] border border-[oklch(0.50_0.20_155_/_0.2)] flex items-center justify-center text-xs font-mono font-bold text-profit">4</div>
              <div>
                <p className="font-semibold text-foreground">Signal — Creates a trade signal if confidence exceeds threshold</p>
                <p className="text-muted-foreground">Signal includes: ticker, direction, strike, expiry, position size. In manual mode, it waits for your approval. In semi-auto, 85+ confidence auto-executes.</p>
              </div>
            </div>
            <div className="flex gap-3">
              <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-[oklch(0.50_0.20_155_/_0.08)] border border-[oklch(0.50_0.20_155_/_0.2)] flex items-center justify-center text-xs font-mono font-bold text-profit">5</div>
              <div>
                <p className="font-semibold text-foreground">Execute — Places order on IBKR via paper account</p>
                <p className="text-muted-foreground">Risk manager validates position size, portfolio exposure, and daily trade limits before sending order. Currently on paper account DU8395165.</p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {!isAdmin && (
        <p className="text-xs text-muted-foreground text-center">
          Only admins can modify strategy settings. Contact Jarrett for changes.
        </p>
      )}
    </div>
  );
}
