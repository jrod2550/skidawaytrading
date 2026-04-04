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

      {/* AI Brain Flow Diagram */}
      <Card className="bg-card border-border">
        <CardContent className="p-6">
          <h3 className="text-sm font-semibold mb-6">AI Brain — How Data Flows to Trades</h3>

          {/* Visual flow */}
          <div className="space-y-3">
            {/* Data Sources Row */}
            <div className="text-center">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-2">Data Sources</p>
              <div className="flex flex-wrap justify-center gap-2">
                {["Options Flow", "Dark Pool", "GEX/Gamma", "IV Rank", "Congress", "Insiders", "Econ Calendar", "Earnings", "Market Tide"].map((s) => (
                  <span key={s} className="text-[10px] font-mono px-2 py-1 rounded-md bg-[oklch(0.55_0.18_175_/_0.06)] border border-[oklch(0.55_0.18_175_/_0.15)] text-teal">{s}</span>
                ))}
              </div>
            </div>

            {/* Arrow */}
            <div className="flex justify-center"><svg className="w-4 h-6 text-muted-foreground" viewBox="0 0 16 24"><path d="M8 0v20M3 15l5 5 5-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg></div>

            {/* Unusual Whales */}
            <div className="mx-auto max-w-md rounded-xl border-2 border-teal/20 bg-[oklch(0.55_0.18_175_/_0.03)] p-4 text-center">
              <p className="text-xs font-semibold text-teal">UNUSUAL WHALES API</p>
              <p className="text-[10px] text-muted-foreground mt-1">25+ endpoints, $300/yr subscription</p>
              <p className="text-[10px] text-muted-foreground">9 data streams per signal analysis</p>
            </div>

            <div className="flex justify-center"><svg className="w-4 h-6 text-muted-foreground" viewBox="0 0 16 24"><path d="M8 0v20M3 15l5 5 5-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg></div>

            {/* AI Brain */}
            <div className="mx-auto max-w-lg rounded-xl border-2 border-gold/30 bg-[oklch(0.65_0.16_85_/_0.04)] p-5 text-center">
              <p className="text-sm font-bold text-gold mb-2">CLAUDE AI BRAIN</p>
              <div className="grid grid-cols-2 gap-3 text-left">
                <div className="rounded-lg bg-card border border-border p-3">
                  <p className="text-[10px] font-semibold text-teal">TIER 1: HAIKU</p>
                  <p className="text-[10px] text-muted-foreground">Fast screen every flow alert</p>
                  <p className="text-[10px] text-muted-foreground">~$0.001/call, ~390/day</p>
                  <p className="text-[10px] text-muted-foreground">Institutional or retail? Hedge or directional?</p>
                </div>
                <div className="rounded-lg bg-card border border-border p-3">
                  <p className="text-[10px] font-semibold text-gold">TIER 2: SONNET</p>
                  <p className="text-[10px] text-muted-foreground">Deep analysis with all 9 data streams</p>
                  <p className="text-[10px] text-muted-foreground">~$0.03/call, ~5-15/day</p>
                  <p className="text-[10px] text-muted-foreground">Thesis, risk factors, trade recommendation</p>
                </div>
              </div>
              <p className="text-[10px] text-muted-foreground mt-3">Considers: V/OI ratios, sweep urgency, dark pool alignment, GEX positioning, IV rank, earnings dates, FOMC/CPI events, congressional filing delays</p>
            </div>

            <div className="flex justify-center"><svg className="w-4 h-6 text-muted-foreground" viewBox="0 0 16 24"><path d="M8 0v20M3 15l5 5 5-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg></div>

            {/* Risk Manager */}
            <div className="mx-auto max-w-md rounded-xl border-2 border-loss/20 bg-[oklch(0.52_0.22_25_/_0.03)] p-4 text-center">
              <p className="text-xs font-semibold text-loss">RISK MANAGER</p>
              <p className="text-[10px] text-muted-foreground mt-1">7 checks: confidence, position size, portfolio risk, daily loss, delta, excluded tickers, bot paused</p>
              <p className="text-[10px] text-muted-foreground">Controlled by YOUR settings on this page</p>
            </div>

            <div className="flex justify-center"><svg className="w-4 h-6 text-muted-foreground" viewBox="0 0 16 24"><path d="M8 0v20M3 15l5 5 5-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg></div>

            {/* Two execution paths */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="rounded-xl border-2 border-profit/20 bg-[oklch(0.50_0.20_155_/_0.03)] p-4">
                <p className="text-xs font-semibold text-profit mb-2">IBKR OPTIONS</p>
                <div className="space-y-1 text-[10px] text-muted-foreground">
                  <p>Account: DU8395165 (paper)</p>
                  <p>Port: 4002 (paper) / 4001 (live)</p>
                  <p>Pool: $10,000 paper</p>
                  <p>Jarrett: $5k / Jack: $5k / Craig: $0</p>
                  <p>Max position: {maxPositionPct}% of portfolio</p>
                  <p>Trades: Options (calls, puts)</p>
                  <p>Mode: {botMode === "full_auto" ? "Full Auto" : botMode === "semi_auto" ? "Semi-Auto (85+ auto)" : "Manual Review"}</p>
                </div>
              </div>
              <div className="rounded-xl border-2 border-gold/20 bg-[oklch(0.65_0.16_85_/_0.03)] p-4">
                <p className="text-xs font-semibold text-gold mb-2">KALSHI PREDICTIONS</p>
                <div className="space-y-1 text-[10px] text-muted-foreground">
                  <p>Account: Production (real money)</p>
                  <p>Markets: Crypto, Climate, Economics</p>
                  <p>Max per trade: $50</p>
                  <p>Max contracts: 10 per market</p>
                  <p>Auto-executes: edge 10%+ &amp; confidence 60+</p>
                  <p>Scan frequency: Every 5 minutes</p>
                  <p>Uses UW flow data for edge detection</p>
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* What Each Agent Does */}
      <Card className="bg-card border-border">
        <CardContent className="p-6">
          <h3 className="text-sm font-semibold mb-4">What Each Agent Does &amp; Doesn't Do</h3>
          <div className="space-y-4">
            <div className="rounded-lg border border-teal/20 p-4">
              <p className="text-sm font-semibold text-teal mb-2">Haiku Screener</p>
              <div className="grid grid-cols-2 gap-4 text-xs">
                <div>
                  <p className="font-medium text-profit mb-1">DOES:</p>
                  <ul className="space-y-0.5 text-muted-foreground">
                    <li>- Screen every flow alert in seconds</li>
                    <li>- Classify institutional vs retail</li>
                    <li>- Identify hedges vs directional bets</li>
                    <li>- Score 0-100 for quick filtering</li>
                    <li>- Filter ~95% of noise before Sonnet</li>
                  </ul>
                </div>
                <div>
                  <p className="font-medium text-loss mb-1">DOESN'T:</p>
                  <ul className="space-y-0.5 text-muted-foreground">
                    <li>- See dark pool, GEX, or earnings data</li>
                    <li>- Generate trade recommendations</li>
                    <li>- Execute any trades</li>
                    <li>- Consider portfolio context</li>
                  </ul>
                </div>
              </div>
            </div>

            <div className="rounded-lg border border-gold/20 p-4">
              <p className="text-sm font-semibold text-gold mb-2">Sonnet Analyst</p>
              <div className="grid grid-cols-2 gap-4 text-xs">
                <div>
                  <p className="font-medium text-profit mb-1">DOES:</p>
                  <ul className="space-y-0.5 text-muted-foreground">
                    <li>- Analyze all 9 data streams simultaneously</li>
                    <li>- Cross-reference dark pool with options flow</li>
                    <li>- Check GEX for dealer positioning</li>
                    <li>- Evaluate IV rank (buy vs sell premium)</li>
                    <li>- Flag earnings and macro events</li>
                    <li>- Generate thesis + trade recommendation</li>
                    <li>- Identify risk factors</li>
                  </ul>
                </div>
                <div>
                  <p className="font-medium text-loss mb-1">DOESN'T:</p>
                  <ul className="space-y-0.5 text-muted-foreground">
                    <li>- Execute trades directly</li>
                    <li>- Override risk manager limits</li>
                    <li>- Monitor open positions</li>
                    <li>- Enforce stop-losses (not yet)</li>
                    <li>- Place multi-leg spread orders (not yet)</li>
                  </ul>
                </div>
              </div>
            </div>

            <div className="rounded-lg border border-loss/20 p-4">
              <p className="text-sm font-semibold text-loss mb-2">Risk Manager</p>
              <div className="grid grid-cols-2 gap-4 text-xs">
                <div>
                  <p className="font-medium text-profit mb-1">DOES:</p>
                  <ul className="space-y-0.5 text-muted-foreground">
                    <li>- Block trades below confidence threshold</li>
                    <li>- Enforce position size limits</li>
                    <li>- Check daily loss circuit breaker</li>
                    <li>- Monitor portfolio delta exposure</li>
                    <li>- Respect excluded tickers list</li>
                    <li>- Honor bot paused flag</li>
                  </ul>
                </div>
                <div>
                  <p className="font-medium text-loss mb-1">DOESN'T:</p>
                  <ul className="space-y-0.5 text-muted-foreground">
                    <li>- Auto-close losing positions (not yet)</li>
                    <li>- Enforce take-profit exits (not yet)</li>
                    <li>- Monitor weekly loss limits (not yet)</li>
                    <li>- Check theta decay exposure</li>
                    <li>- Manage Kalshi position limits</li>
                  </ul>
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Fund Control */}
      <Card className="bg-card border-border">
        <CardContent className="p-6">
          <h3 className="text-sm font-semibold mb-4">How You Control the Money</h3>
          <div className="space-y-3 text-sm text-foreground/80 leading-relaxed">
            <div className="flex gap-3">
              <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-[oklch(0.55_0.18_175_/_0.08)] border border-[oklch(0.55_0.18_175_/_0.2)] flex items-center justify-center text-xs font-mono font-bold text-teal">$</div>
              <div>
                <p className="font-semibold text-foreground">IBKR Pool: You control deposits/withdrawals</p>
                <p className="text-muted-foreground">Real money only enters when YOU fund the IBKR account. The bot can only trade what's in the account. Switch from paper (4002) to live (4001) when ready.</p>
              </div>
            </div>
            <div className="flex gap-3">
              <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-[oklch(0.65_0.16_85_/_0.08)] border border-[oklch(0.65_0.16_85_/_0.2)] flex items-center justify-center text-xs font-mono font-bold text-gold">K</div>
              <div>
                <p className="font-semibold text-foreground">Kalshi: Separate balance, auto-trades production</p>
                <p className="text-muted-foreground">Kalshi has its own balance. Deposit via kalshi.com. Bot is capped at $50 per market. You can adjust this or pause via the Strategy page.</p>
              </div>
            </div>
            <div className="flex gap-3">
              <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-[oklch(0.52_0.22_25_/_0.08)] border border-[oklch(0.52_0.22_25_/_0.2)] flex items-center justify-center text-xs font-mono font-bold text-loss">!</div>
              <div>
                <p className="font-semibold text-foreground">Emergency Stop: 4 ways to halt trading instantly</p>
                <p className="text-muted-foreground">1) Dashboard: toggle Bot Paused in Settings. 2) SSH: sudo systemctl stop skidaway-bot. 3) IBKR: cancel all orders in the app. 4) Kalshi: cancel orders at kalshi.com.</p>
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
