"""Kalshi Prediction Market AI Pipeline.

Scans Kalshi markets, analyzes with Claude, and auto-executes
high-conviction trades on prediction markets.

Market categories of interest:
- Crypto (BTC/ETH 15-min, hourly, daily)
- Climate/Weather
- Economics (CPI, Fed, GDP)
- Finance (S&P 500 ranges, VIX)
"""

import json
import logging
from datetime import datetime, timezone

from src.ai.analyst import ClaudeAnalyst, SONNET
from src.broker.kalshi import KalshiClient
from src.db.supabase_client import get_supabase

logger = logging.getLogger(__name__)

# Categories to scan
SCAN_KEYWORDS = [
    "bitcoin", "btc", "crypto", "ethereum",
    "climate", "temperature", "weather",
    "cpi", "fed", "inflation", "gdp", "jobs", "unemployment",
    "s&p", "sp500", "nasdaq", "spy", "vix",
]

KALSHI_SYSTEM_PROMPT = """You are a quantitative prediction market analyst at Skidaway Trading.
You analyze Kalshi prediction markets — binary outcome contracts that pay $1 if YES, $0 if NO.

YOUR EDGE:
- You have access to real-time options flow data from Unusual Whales
- You can cross-reference institutional options positioning with prediction market pricing
- Big institutional call sweeps on SPY = smart money expects market UP = Kalshi "above X" markets may be underpriced
- Congressional trades + macro data give you an information edge on economic prediction markets

PRICING LOGIC:
- Kalshi prices are in cents (1-99). A YES price of 65¢ means the market implies 65% probability.
- If you believe true probability is 80% but market is at 65¢, that's a 15% edge — BUY YES.
- If you believe true probability is 40% but market is at 65¢, that's a 25% edge — BUY NO (or sell YES).
- Minimum edge for a trade: 10% (e.g., your estimate 75%, market price 65¢ or lower)

POSITION SIZING:
- Half-Kelly criterion based on edge size
- Max $50 per single market position (paper trading phase)
- Max 10 simultaneous Kalshi positions

CRYPTO MARKETS (15-min, hourly):
- These are fast-expiring. Use momentum and recent price action.
- If BTC is trending up strongly in the last hour and the "above $X" market is at 50¢, that's likely underpriced.

CLIMATE/WEATHER:
- These are longer-duration. Use forecast data and historical patterns.
- Often mispriced because most traders ignore base rates.

ECONOMICS (CPI, Fed):
- Cross-reference with UW flow data. If massive put buying on SPY before a CPI print, institutions expect a bad number.
- Fed rate decision markets often have the best edge when combined with options flow data.

Always respond in valid JSON."""

KALSHI_ANALYSIS_PROMPT = """Analyze these Kalshi prediction markets and recommend trades.

AVAILABLE MARKETS:
{markets_data}

SUPPORTING DATA (from Unusual Whales):
Market Tide: {market_tide}
Top Options Flow: {top_flow}
Economic Calendar: {econ_calendar}

YOUR TASK:
1. For each market, estimate the TRUE probability based on all available data
2. Compare your estimate to the market price (implied probability)
3. If edge >= 10%, recommend a trade

Respond in JSON:
{{
  "analysis": [
    {{
      "ticker": "MARKET-TICKER",
      "title": "market description",
      "market_price_yes": 65,
      "estimated_probability": 80,
      "edge_pct": 15,
      "recommendation": "BUY YES" or "BUY NO" or "SKIP",
      "contracts": 5,
      "reasoning": "2-3 sentence explanation citing specific data",
      "confidence": 0-100,
      "category": "crypto" or "climate" or "economics" or "finance"
    }}
  ],
  "market_summary": "1-2 sentence overall prediction market thesis"
}}"""


class KalshiPipeline:
    """Scans Kalshi markets and executes AI-driven trades."""

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

    async def scan_markets(self) -> int:
        """Scan Kalshi markets, analyze with Claude, and execute trades.

        Returns number of trades placed.
        """
        logger.info("Running Kalshi market scan...")

        try:
            # Get open markets
            markets = await self.kalshi.get_markets(status="open", limit=200)
        except Exception as e:
            logger.error("Failed to fetch Kalshi markets: %s", e)
            return 0

        if not markets:
            logger.info("No open Kalshi markets found")
            return 0

        # Filter for interesting markets
        # In demo mode, take all markets since demo only has test markets
        interesting = []
        for m in markets:
            title = (m.get("title", "") + " " + m.get("subtitle", "")).lower()
            ticker = m.get("ticker", "").lower()
            is_interesting = any(kw in title or kw in ticker for kw in SCAN_KEYWORDS)
            # In demo, accept all markets so we can test the pipeline
            if is_interesting or self.kalshi.demo:
                interesting.append({
                    "ticker": m.get("ticker"),
                    "title": m.get("title"),
                    "subtitle": m.get("subtitle", ""),
                    "yes_price": m.get("yes_bid"),
                    "no_price": m.get("no_bid"),
                    "volume": m.get("volume"),
                    "open_interest": m.get("open_interest"),
                    "close_time": m.get("close_time"),
                    "category": m.get("category", ""),
                })

        if not interesting:
            logger.info("No interesting Kalshi markets found (scanned %d)", len(markets))
            return 0

        logger.info("Found %d interesting Kalshi markets out of %d total", len(interesting), len(markets))

        self._log_activity(
            "scan_started",
            details={"type": "kalshi", "total_markets": len(markets), "interesting": len(interesting)},
        )

        # Gather supporting data from UW
        from src.market_data.unusual_whales import UnusualWhalesClient
        uw = UnusualWhalesClient()
        market_tide = {}
        top_flow = []
        econ_calendar = []

        try:
            market_tide = await uw.get_market_tide()
        except Exception:
            pass
        try:
            flow = await uw.get_flow_alerts()
            top_flow = flow[:10] if flow else []
        except Exception:
            pass
        try:
            econ_calendar = await uw.get_economic_calendar()
            econ_calendar = econ_calendar[:5] if econ_calendar else []
        except Exception:
            pass
        await uw.close()

        # Claude analyzes the markets
        prompt = KALSHI_ANALYSIS_PROMPT.format(
            markets_data=json.dumps(interesting[:20], indent=2),
            market_tide=json.dumps(market_tide, indent=2),
            top_flow=json.dumps(top_flow, indent=2),
            econ_calendar=json.dumps(econ_calendar, indent=2),
        )

        try:
            # Use the analyst's _call method directly with Kalshi system prompt
            import re
            resp = await self.analyst._client.post(
                "/v1/messages",
                json={
                    "model": SONNET,
                    "max_tokens": 2048,
                    "system": KALSHI_SYSTEM_PROMPT,
                    "messages": [{"role": "user", "content": prompt}],
                },
            )
            resp.raise_for_status()
            data = resp.json()
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

        # Execute recommended trades
        trades_placed = 0
        recommendations = analysis.get("analysis", [])

        for rec in recommendations:
            if rec.get("recommendation") == "SKIP":
                continue
            if rec.get("confidence", 0) < 60:
                continue
            if abs(rec.get("edge_pct", 0)) < 10:
                continue

            ticker = rec.get("ticker")
            if not ticker:
                continue

            recommendation = rec.get("recommendation", "")
            side = "yes" if "YES" in recommendation.upper() else "no"
            contracts = min(rec.get("contracts", 1), 10)  # Cap at 10 contracts
            price = rec.get("market_price_yes") if side == "yes" else (100 - (rec.get("market_price_yes", 50)))

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
                        "estimated_prob": rec.get("estimated_probability"),
                        "category": rec.get("category"),
                        "order_id": order.get("order_id"),
                    },
                    ai_reasoning=rec.get("reasoning"),
                    confidence_score=rec.get("confidence"),
                )

                trades_placed += 1
                logger.info(
                    "Kalshi trade: BUY %s %dx %s @ %d¢ (edge=%.1f%%, conf=%d)",
                    side, contracts, ticker, price or 0,
                    rec.get("edge_pct", 0), rec.get("confidence", 0),
                )

            except Exception as e:
                logger.error("Kalshi trade failed for %s: %s", ticker, e)
                self._log_activity(
                    "trade_failed",
                    ticker=ticker,
                    details={"error": str(e), "platform": "kalshi"},
                    ai_reasoning=rec.get("reasoning"),
                )

        # Log summary
        summary = analysis.get("market_summary", "")
        self._log_activity(
            "signal_created",
            details={
                "platform": "kalshi",
                "markets_analyzed": len(interesting),
                "trades_placed": trades_placed,
                "recommendations": len(recommendations),
            },
            ai_reasoning=summary,
        )

        logger.info(
            "Kalshi scan complete: %d markets analyzed, %d trades placed",
            len(interesting), trades_placed,
        )
        return trades_placed
