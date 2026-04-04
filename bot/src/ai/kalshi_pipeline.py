"""Kalshi Prediction Market AI Pipeline — Stream 2.

Scans ALL Kalshi prediction markets and finds edges using:
1. Kalshi market data (prices, volume, order books)
2. UW options flow data (institutional sentiment)
3. Cross-reference with IBKR Stream 1 signals

Categories: Crypto, Economics, Finance, Geopolitics, Sports,
Weather/Climate, Culture, Tech, and anything else tradeable.
"""

import json
import logging
from datetime import datetime, timezone

from src.ai.analyst import ClaudeAnalyst, SONNET
from src.broker.kalshi import KalshiClient
from src.db.supabase_client import get_supabase

logger = logging.getLogger(__name__)

# Broad categories — we want EVERYTHING
SCAN_ALL = True  # Scan all markets, let the AI decide what's interesting

KALSHI_SYSTEM_PROMPT = """You are a quantitative prediction market analyst at Skidaway Trading.
You trade binary outcome contracts on Kalshi — YES pays $1, NO pays $0. Price = implied probability.

YOU HAVE TWO UNIQUE EDGES:

1. UNUSUAL WHALES OPTIONS FLOW DATA
   You see what institutions are doing in real-time options markets. This is insider-adjacent intelligence.
   - Massive call sweeps on SPY = institutions expect market UP = Kalshi "above X" markets may be underpriced
   - Congressional trades on energy stocks = potential policy knowledge = energy/climate prediction edge
   - Dark pool accumulation in tech = institutional conviction = tech outcome markets underpriced
   - Put/call ratio extremes = fear/greed sentiment = contrarian prediction opportunities

2. IBKR SIGNAL INTELLIGENCE
   You see signals our options trading AI has generated. If our IBKR bot created a high-confidence
   bullish signal on NVDA, that's additional intelligence for any NVDA-related prediction markets.

MARKET CATEGORIES TO ANALYZE:

CRYPTO (15-min, hourly, daily):
- BTC/ETH price predictions. Use momentum, options flow on crypto ETFs (BITO, ETHE), and market tide.
- Fast-expiring markets reward conviction and timing.

ECONOMICS & FED:
- CPI, PPI, jobs, GDP, Fed rate decisions.
- Cross-reference with UW flow: massive SPY put buying before CPI = institutions expect bad print.
- Congressional committee activity on banking/finance = potential insider knowledge on policy.

FINANCE (S&P, VIX, individual stocks):
- S&P ranges, VIX levels, earnings outcomes.
- Direct cross-reference with UW options flow. If $5M in AAPL calls before earnings, the "AAPL beats estimates" market may be underpriced.

GEOPOLITICS:
- Sanctions, trade deals, elections, international events.
- Congressional trading patterns may signal policy knowledge.

WEATHER & CLIMATE:
- Temperature records, hurricane paths, seasonal patterns.
- Energy sector flow (XLE, XOP) may signal weather-related positioning.

SPORTS:
- Game outcomes, player props, championship futures.
- Look for sharp money patterns — high volume at specific prices signals informed betting.

CULTURE & TECH:
- Oscar predictions, tech launches, social media milestones.
- Often mispriced because most traders focus on finance.

PRICING & EDGE DETECTION:
- Kalshi price in cents (1-99). Price = market-implied probability.
- Your edge = your estimated probability - market price.
- Minimum edge for a trade: 8% on high-confidence, 12% on medium.
- Half-Kelly position sizing: bet proportional to edge.

POSITION LIMITS:
- Max $100 per single market position
- Max 15 simultaneous positions across all categories
- Max $25 per trade on sports/culture (lower conviction category)

Always respond in valid JSON."""

KALSHI_ANALYSIS_PROMPT = """Analyze these Kalshi prediction markets across ALL categories.

AVAILABLE MARKETS ({market_count} total):
{markets_data}

UNUSUAL WHALES INTELLIGENCE:
Market Tide (overall bullish/bearish): {market_tide}
Top Institutional Options Flow: {top_flow}
Upcoming Economic Events: {econ_calendar}

IBKR SIGNAL INTELLIGENCE (recent signals from our options bot):
{ibkr_signals}

YOUR TASK:
1. Scan every market. Estimate TRUE probability using all available data.
2. Compare your estimate to the market price.
3. For any market with edge >= 8%, recommend a trade.
4. Cross-reference categories: does options flow data inform any prediction markets? Do prediction market prices inform any options thesis?

Respond in JSON:
{{
  "cross_reference_insights": "2-3 sentences on how options flow and prediction markets inform each other right now",
  "analysis": [
    {{
      "ticker": "MARKET-TICKER",
      "title": "market description",
      "market_price_yes_cents": 65,
      "your_estimated_probability": 80,
      "edge_pct": 15,
      "recommendation": "BUY YES" or "BUY NO" or "SKIP",
      "contracts": 5,
      "max_cost_cents": 325,
      "reasoning": "2-3 sentences citing specific data — flow, signals, or market context",
      "confidence": 0-100,
      "category": "crypto" | "economics" | "finance" | "geopolitics" | "sports" | "weather" | "culture" | "tech",
      "cross_reference": "what options/flow data informed this prediction, if any"
    }}
  ],
  "market_summary": "2-3 sentence overall prediction market thesis across all categories"
}}"""


class KalshiPipeline:
    """Scans ALL Kalshi markets and executes AI-driven trades."""

    def __init__(self, kalshi: KalshiClient, analyst: ClaudeAnalyst) -> None:
        self.kalshi = kalshi
        self.analyst = analyst
        self.db = get_supabase()

    def _log_activity(
        self,
        event_type: str,
        ticker: str | None = None,
        details: dict | None = None,
        ai_reasoning: str | None = None,
        confidence_score: float | None = None,
    ) -> None:
        try:
            self.db.table("ai_activity").insert({
                "event_type": event_type,
                "ticker": f"KALSHI:{ticker}" if ticker else "KALSHI",
                "details": details or {},
                "ai_reasoning": ai_reasoning,
                "confidence_score": confidence_score,
            }).execute()
        except Exception:
            logger.warning("Failed to log Kalshi activity: %s %s", event_type, ticker)

    def _get_ibkr_signals(self) -> list[dict]:
        """Get recent IBKR signals to cross-reference with prediction markets."""
        try:
            result = (
                self.db.table("signals")
                .select("ticker, direction, confidence_score, source, scoring_factors, created_at")
                .gte("created_at", datetime.now(timezone.utc).strftime("%Y-%m-%dT00:00:00Z"))
                .order("created_at", desc=True)
                .limit(10)
                .execute()
            )
            return [
                {
                    "ticker": s.get("ticker"),
                    "direction": s.get("direction"),
                    "confidence": s.get("confidence_score"),
                    "source": s.get("source"),
                    "thesis": (s.get("scoring_factors") or {}).get("thesis", ""),
                }
                for s in (result.data or [])
            ]
        except Exception:
            return []

    async def scan_markets(self) -> int:
        """Scan ALL Kalshi markets, analyze with Claude, and execute trades.

        Returns number of trades placed.
        """
        logger.info("Running Kalshi market scan...")

        try:
            markets = await self.kalshi.get_markets(status="open", limit=1000)
        except Exception as e:
            logger.error("Failed to fetch Kalshi markets: %s", e)
            return 0

        if not markets:
            logger.info("No open Kalshi markets found")
            return 0

        # Format markets for analysis — take a representative sample
        formatted = []
        for m in markets:
            formatted.append({
                "ticker": m.get("ticker"),
                "title": m.get("title"),
                "subtitle": m.get("subtitle", ""),
                "yes_bid": m.get("yes_bid"),
                "no_bid": m.get("no_bid"),
                "yes_ask": m.get("yes_ask"),
                "no_ask": m.get("no_ask"),
                "volume": m.get("volume"),
                "open_interest": m.get("open_interest"),
                "close_time": m.get("close_time"),
                "category": m.get("category", ""),
            })

        # Limit to 30 most interesting (by volume) to keep prompt manageable
        formatted.sort(key=lambda x: int(x.get("volume") or 0), reverse=True)
        top_markets = formatted[:30]

        logger.info("Scanning %d Kalshi markets (%d by volume)", len(markets), len(top_markets))

        self._log_activity(
            "scan_started",
            details={
                "type": "kalshi",
                "total_markets": len(markets),
                "analyzed": len(top_markets),
            },
        )

        # Gather intelligence
        import asyncio
        from src.market_data.unusual_whales import UnusualWhalesClient

        uw = UnusualWhalesClient()
        market_tide = {}
        top_flow = []
        econ_calendar = []

        async def fetch_tide():
            try:
                return await uw.get_market_tide()
            except Exception:
                return {}

        async def fetch_flow():
            try:
                f = await uw.get_flow_alerts()
                return f[:10] if f else []
            except Exception:
                return []

        async def fetch_econ():
            try:
                e = await uw.get_economic_calendar()
                return e[:5] if e else []
            except Exception:
                return []

        results = await asyncio.gather(fetch_tide(), fetch_flow(), fetch_econ())
        market_tide = results[0]
        top_flow = results[1]
        econ_calendar = results[2]
        await uw.close()

        # Get IBKR signals for cross-reference
        ibkr_signals = self._get_ibkr_signals()

        # Claude analyzes ALL markets
        prompt = KALSHI_ANALYSIS_PROMPT.format(
            market_count=len(top_markets),
            markets_data=json.dumps(top_markets, indent=2),
            market_tide=json.dumps(market_tide, indent=2),
            top_flow=json.dumps(top_flow, indent=2),
            econ_calendar=json.dumps(econ_calendar, indent=2),
            ibkr_signals=json.dumps(ibkr_signals, indent=2) if ibkr_signals else "No IBKR signals today yet.",
        )

        try:
            MODELS = [SONNET, "claude-sonnet-4-5-20250929", "claude-sonnet-4-20250514", "claude-3-haiku-20240307"]
            data = None
            used_model = MODELS[0]

            for model in MODELS:
                try:
                    resp = await self.analyst._client.post(
                        "/v1/messages",
                        json={
                            "model": model,
                            "max_tokens": 3000,
                            "system": KALSHI_SYSTEM_PROMPT,
                            "messages": [{"role": "user", "content": prompt}],
                        },
                    )
                    resp.raise_for_status()
                    data = resp.json()
                    used_model = model
                    logger.info("Kalshi analysis using model: %s", model)
                    break
                except Exception as model_err:
                    if "not_found" in str(model_err).lower() or "404" in str(model_err):
                        logger.warning("Model %s not available, trying next...", model)
                        continue
                    raise

            if not data:
                raise ValueError("No Claude model available")

            text = data["content"][0]["text"]

            # Extract JSON
            if "```json" in text:
                text = text.split("```json")[1].split("```")[0]
            elif "```" in text:
                text = text.split("```")[1].split("```")[0]
            start = text.find("{")
            end = text.rfind("}")
            if start != -1 and end != -1:
                text = text[start:end + 1]

            analysis = json.loads(text.strip())
        except Exception as e:
            logger.error("Kalshi AI analysis failed: %s", e)
            self._log_activity("error", details={"error": str(e), "type": "kalshi_analysis"})
            return 0

        # Log cross-reference insights
        cross_insights = analysis.get("cross_reference_insights", "")
        if cross_insights:
            self._log_activity(
                "deep_analysis",
                details={
                    "platform": "kalshi",
                    "type": "cross_reference",
                    "model": used_model,
                    "markets_scanned": len(top_markets),
                },
                ai_reasoning=cross_insights,
            )

        # Execute recommended trades
        trades_placed = 0
        recommendations = analysis.get("analysis", [])

        for rec in recommendations:
            if rec.get("recommendation") == "SKIP":
                continue
            if rec.get("confidence", 0) < 55:
                continue
            if abs(rec.get("edge_pct", 0)) < 8:
                continue

            ticker = rec.get("ticker")
            if not ticker:
                continue

            recommendation = rec.get("recommendation", "")
            side = "yes" if "YES" in recommendation.upper() else "no"
            category = rec.get("category", "other")

            # Category-based position limits
            max_contracts = 10
            if category in ("sports", "culture"):
                max_contracts = 5

            contracts = min(rec.get("contracts", 1), max_contracts)
            price = rec.get("market_price_yes_cents") if side == "yes" else (100 - (rec.get("market_price_yes_cents", 50)))

            try:
                order = await self.kalshi.place_order(
                    ticker=ticker,
                    side=side,
                    action="buy",
                    count=contracts,
                    price_cents=price,
                )

                self._log_activity(
                    "trade_executed",
                    ticker=ticker,
                    details={
                        "platform": "kalshi",
                        "side": side,
                        "contracts": contracts,
                        "price_cents": price,
                        "edge_pct": rec.get("edge_pct"),
                        "estimated_prob": rec.get("your_estimated_probability"),
                        "category": category,
                        "order_id": order.get("order_id"),
                        "cross_reference": rec.get("cross_reference", ""),
                        "model": used_model,
                    },
                    ai_reasoning=rec.get("reasoning"),
                    confidence_score=rec.get("confidence"),
                )

                trades_placed += 1
                logger.info(
                    "Kalshi trade: BUY %s %dx %s @ %d¢ [%s] (edge=%.1f%%, conf=%d)",
                    side, contracts, ticker, price or 0, category,
                    rec.get("edge_pct", 0), rec.get("confidence", 0),
                )

            except Exception as e:
                logger.error("Kalshi trade failed for %s: %s", ticker, e)
                self._log_activity(
                    "trade_failed",
                    ticker=ticker,
                    details={"error": str(e), "platform": "kalshi", "category": category},
                    ai_reasoning=rec.get("reasoning"),
                )

        # Log summary
        summary = analysis.get("market_summary", "")
        self._log_activity(
            "signal_created",
            details={
                "platform": "kalshi",
                "markets_scanned": len(markets),
                "markets_analyzed": len(top_markets),
                "trades_placed": trades_placed,
                "recommendations": len([r for r in recommendations if r.get("recommendation") != "SKIP"]),
                "categories_found": list(set(r.get("category", "?") for r in recommendations)),
                "model": used_model,
            },
            ai_reasoning=f"{summary}\n\nCross-reference: {cross_insights}" if cross_insights else summary,
        )

        logger.info(
            "Kalshi scan complete: %d markets scanned, %d analyzed, %d trades placed",
            len(markets), len(top_markets), trades_placed,
        )
        return trades_placed
