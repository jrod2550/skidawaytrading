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

KALSHI_SYSTEM_PROMPT = """You are a quantitative prediction market analyst at Booyah Trading.
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

CRYPTO (15-min, hourly, daily) — PRIORITY CATEGORY:
- You receive REAL-TIME BTC data: current price, 15-min candles, 1-hour momentum, volume ratio, fear/greed index.
- For 15-min BTC markets: if BTC is trending up with volume ratio > 1.2, the "above X" markets are likely underpriced. Bet YES.
- If BTC is trending down with volume ratio > 1.2, "below X" is underpriced. Bet YES on the downside.
- Sideways with low volume = skip or bet small.
- ALWAYS allocate at least $5 to BTC 15-min markets when you see any edge.
- Cross-reference with crypto ETF options flow (BITO, ETHE) from UW data.
- Fear/Greed index: extreme fear (< 25) often precedes bounces. Extreme greed (> 75) often precedes dips.

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
- You receive REAL-TIME weather data: current temps, 7-day forecasts, global temperature trends from Open-Meteo API.
- Global warming markets: compare current temps to historical averages. Trending above normal = "warming exceeds X" underpriced.
- Hurricane markets: check Caribbean sea temps and wind patterns in the weather data.
- Temperature records: use forecast data to estimate probability of extreme heat/cold events.
- EV adoption: cross-reference with energy policy and oil prices.
- EDGE: Most Kalshi weather traders use gut feel. You have actual forecast data. Use it.

SPORTS:
- Game outcomes, player props, championship futures.
- Look for sharp money patterns — high volume at specific prices signals informed betting.

CULTURE & TECH:
- Oscar predictions, tech launches, social media milestones.
- Often mispriced because most traders focus on finance.

PRICING & EDGE DETECTION:
- Kalshi price in cents (1-99). Price = market-implied probability.
- Your edge = your estimated probability - market price.
- Minimum edge for a trade: 5%. Be aggressive — we want volume and action.
- If you see ANY edge on sports, weather, politics, culture — TAKE IT.
- Half-Kelly position sizing: bet proportional to edge.
- Use fill_or_kill for instant execution on liquid markets.

POSITION LIMITS:
- Max $100 per single market position
- Max 20 simultaneous positions across all categories
- Sports, culture, weather — be aggressive, $50 max per trade
- Find opportunities across EVERY category, not just finance

Always respond in valid JSON."""

KALSHI_ANALYSIS_PROMPT = """Analyze these Kalshi prediction markets across ALL categories.

AVAILABLE MARKETS ({market_count} total, from {categories_found} categories):
{markets_data}

UNUSUAL WHALES INTELLIGENCE (for finance/economics markets):
Market Tide (overall bullish/bearish): {market_tide}
Top Institutional Options Flow: {top_flow}
Upcoming Economic Events: {econ_calendar}

REAL-TIME WEATHER DATA (for weather/climate markets):
{weather_data}

REAL-TIME BTC DATA (for crypto prediction markets):
{btc_data}
(IMPORTANT: For ANY BTC 15-min price market, use the momentum data above. If BTC is trending up with strong volume, "above X" markets are underpriced. If trending down, "below X" markets are underpriced. Always bet at least $5 on BTC 15-min markets when you see an edge.)

IBKR SIGNAL INTELLIGENCE (recent signals from our options bot):
{ibkr_signals}

YOUR TASK:
1. Scan every market. Estimate TRUE probability using all available data.
2. Compare your estimate to the market price.
3. For any market with edge >= 8%, recommend a trade.
4. Cross-reference categories: does options flow data inform any prediction markets? Do prediction market prices inform any options thesis?

CRITICAL: Respond ONLY with a single valid JSON object. No markdown, no code fences, no text before or after the JSON. No trailing commas before ] or }}.

{{
  "cross_reference_insights": "2-3 sentences on how UW options flow and Kalshi prediction markets inform each other right now. Be specific about tickers and data.",
  "analysis": [
    {{
      "ticker": "MARKET-TICKER",
      "title": "full market description",
      "market_price_yes_cents": 65,
      "your_estimated_probability": 80,
      "edge_pct": 15,
      "recommendation": "BUY YES",
      "contracts": 5,
      "reasoning": "2-3 detailed sentences citing specific data — options flow premiums, dark pool prints, institutional positioning, macro events. Explain WHY the market is mispriced.",
      "confidence": 75,
      "category": "crypto",
      "cross_reference": "what UW flow or IBKR signal data informed this, or null"
    }}
  ],
  "market_summary": "2-3 sentences summarizing the prediction market landscape across all categories scanned"
}}

Rules:
- Only include markets where you recommend a trade (BUY YES or BUY NO), not SKIP
- Max 5 trade recommendations
- Always tag the category: crypto, economics, finance, geopolitics, sports, weather, culture, tech
- The reasoning MUST cite specific data points, not generic statements"""


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

        # Check if bot is paused
        try:
            paused_result = self.db.table("bot_config").select("value").eq("key", "bot_paused").execute()
            if paused_result.data and paused_result.data[0].get("value"):
                logger.info("Kalshi scan skipped — bot is PAUSED")
                return 0
        except Exception:
            pass

        try:
            # Fetch multiple pages to get all markets
            all_markets: list[dict] = []
            cursor = None
            for page in range(3):  # Up to 3000 markets
                params: dict = {"status": "open", "limit": 1000}
                if cursor:
                    params["cursor"] = cursor
                data = await self.kalshi._get("/markets", params=params)
                page_markets = data.get("markets", [])
                all_markets.extend(page_markets)
                cursor = data.get("cursor")
                if not cursor or len(page_markets) == 0:
                    break
            markets = all_markets

            # Skip BTC 15-min markets — dedicated BTC agent handles those
            # Fetch BTC daily range only
            try:
                btc_data = await self.kalshi._get("/markets", params={"series_ticker": "KXBTC", "status": "open", "limit": 10})
                btc_daily = btc_data.get("markets", [])
                if btc_daily:
                    markets.extend(btc_daily)
            except Exception:
                pass

        except Exception as e:
            logger.error("Failed to fetch Kalshi markets: %s", e)
            return 0

        if not markets:
            logger.info("No open Kalshi markets found")
            return 0

        # Format markets — map dollar fields to cents for consistency
        formatted = []
        for m in markets:
            yes_bid_d = float(m.get("yes_bid_dollars") or m.get("yes_bid") or 0)
            yes_ask_d = float(m.get("yes_ask_dollars") or m.get("yes_ask") or 0)
            no_bid_d = float(m.get("no_bid_dollars") or m.get("no_bid") or 0)
            no_ask_d = float(m.get("no_ask_dollars") or m.get("no_ask") or 0)
            vol = float(m.get("volume_fp") or m.get("volume") or 0)
            formatted.append({
                "ticker": m.get("ticker"),
                "title": m.get("title"),
                "subtitle": m.get("subtitle") or m.get("yes_sub_title", ""),
                "yes_bid_cents": round(yes_bid_d * 100),
                "yes_ask_cents": round(yes_ask_d * 100),
                "no_bid_cents": round(no_bid_d * 100),
                "no_ask_cents": round(no_ask_d * 100),
                "volume": vol,
                "open_interest": float(m.get("open_interest_fp") or m.get("open_interest") or 0),
                "close_time": m.get("close_time"),
                "category": m.get("category", ""),
                "has_pricing": yes_bid_d > 0 or yes_ask_d > 0,
            })

        # Diversify market selection — don't just pick by volume
        # Group by category and pick top from each to ensure diversity
        by_category: dict[str, list] = {}
        for m in formatted:
            cat = str(m.get("category") or m.get("title", "")[:20]).lower()
            # Classify by keywords
            title_lower = str(m.get("title", "")).lower() + str(m.get("subtitle", "")).lower()
            if any(x in title_lower for x in ["weather", "climate", "temperature", "warming", "earthquake", "hurricane"]):
                cat = "weather"
            elif any(x in title_lower for x in ["bitcoin", "btc", "eth", "crypto"]):
                cat = "crypto"
            elif any(x in title_lower for x in ["cpi", "fed", "inflation", "gdp", "jobs", "unemployment", "rate"]):
                cat = "economics"
            elif any(x in title_lower for x in ["nba", "nfl", "mlb", "nhl", "soccer", "sport", "game", "player"]):
                cat = "sports"
            elif any(x in title_lower for x in ["election", "president", "congress", "senate", "governor", "vote"]):
                cat = "politics"
            elif any(x in title_lower for x in ["pope", "oscar", "culture", "movie", "music"]):
                cat = "culture"
            elif any(x in title_lower for x in ["ipo", "company", "stock", "market", "s&p", "spy", "vix"]):
                cat = "finance"
            else:
                cat = "other"
            m["_category"] = cat
            by_category.setdefault(cat, []).append(m)

        # ONLY look at liquid markets — must have pricing AND volume
        liquid = [m for m in formatted if m.get("has_pricing") and m.get("volume", 0) > 0]
        liquid.sort(key=lambda x: x.get("volume", 0), reverse=True)

        # Group liquid markets by category, pick top from each
        top_markets = []
        liquid_by_cat: dict[str, list] = {}
        for m in liquid:
            cat = m.get("_category", "other")
            liquid_by_cat.setdefault(cat, []).append(m)

        for cat, cat_markets in liquid_by_cat.items():
            top_markets.extend(cat_markets[:4])

        # Include BTC daily markets but SKIP BTC 15-min (dedicated BTC agent handles those)
        btc_markets = [m for m in formatted if any(x in str(m.get("ticker", "")).lower() for x in ["kxbtc"]) or "bitcoin" in str(m.get("title", "")).lower()]
        btc_markets = [m for m in btc_markets if "kxbtc15m" not in str(m.get("ticker", "")).lower()]
        for bm in btc_markets[:5]:
            if bm not in top_markets:
                bm["_category"] = "crypto"
                top_markets.append(bm)

        # Cap at 25, sorted by volume
        top_markets.sort(key=lambda x: x.get("volume", 0), reverse=True)
        top_markets = top_markets[:25]

        logger.info("Scanning %d Kalshi markets (%d by volume)", len(markets), len(top_markets))

        self._log_activity(
            "scan_started",
            details={
                "type": "kalshi",
                "total_markets": len(markets),
                "analyzed": len(top_markets),
            },
        )

        # Gather intelligence from multiple sources
        import asyncio
        from src.market_data.unusual_whales import UnusualWhalesClient
        from src.market_data.weather import WeatherClient
        from src.market_data.crypto import CryptoClient

        uw = UnusualWhalesClient()
        weather = WeatherClient()
        crypto = CryptoClient()

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

        async def fetch_weather():
            try:
                return await weather.get_weather_summary()
            except Exception:
                return {}

        async def fetch_btc():
            try:
                return await crypto.get_btc_analysis()
            except Exception:
                return {}

        results = await asyncio.gather(fetch_tide(), fetch_flow(), fetch_econ(), fetch_weather(), fetch_btc())
        market_tide = results[0]
        top_flow = results[1]
        econ_calendar = results[2]
        weather_data = results[3]
        btc_data = results[4]
        await uw.close()
        await weather.close()
        await crypto.close()

        # Get IBKR signals for cross-reference
        ibkr_signals = self._get_ibkr_signals()

        # Summarize categories found
        cats_found = list(set(m.get("_category", "other") for m in top_markets))

        # Claude analyzes ALL markets
        prompt = KALSHI_ANALYSIS_PROMPT.format(
            market_count=len(top_markets),
            categories_found=", ".join(cats_found),
            markets_data=json.dumps(top_markets, indent=2),
            market_tide=json.dumps(market_tide, indent=2),
            top_flow=json.dumps(top_flow, indent=2),
            econ_calendar=json.dumps(econ_calendar, indent=2),
            weather_data=json.dumps(weather_data, indent=2) if weather_data else "No weather data available.",
            btc_data=json.dumps(btc_data, indent=2) if btc_data else "No BTC data available.",
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
                    err_str = str(model_err)
                    if "not_found" in err_str.lower() or "404" in err_str:
                        logger.warning("Model %s not available, trying next...", model)
                        continue
                    logger.error("Model %s failed with: %s", model, err_str[:200])
                    raise

            if not data:
                raise ValueError("No Claude model available")

            text = data["content"][0]["text"]
            logger.debug("Kalshi raw response length: %d chars", len(text))

            # Extract JSON — multiple strategies
            if "```json" in text:
                text = text.split("```json")[1].split("```")[0]
            elif "```" in text:
                text = text.split("```")[1].split("```")[0]
            start = text.find("{")
            end = text.rfind("}")
            if start != -1 and end != -1:
                text = text[start:end + 1]

            # Try parsing, with repair for common issues
            try:
                analysis = json.loads(text.strip())
            except json.JSONDecodeError:
                # Try fixing trailing commas and other common issues
                import re
                fixed = re.sub(r',\s*}', '}', text)
                fixed = re.sub(r',\s*]', ']', fixed)
                try:
                    analysis = json.loads(fixed.strip())
                    logger.info("Kalshi JSON repaired successfully")
                except json.JSONDecodeError:
                    # Last resort: extract just the analysis array
                    logger.warning("Kalshi JSON still invalid, attempting partial parse")
                    analysis = {"analysis": [], "market_summary": "JSON parse failed — no trades this cycle"}
        except Exception as e:
            import traceback
            err_detail = traceback.format_exc()
            logger.error("Kalshi AI analysis failed: %s\n%s", e, err_detail)
            self._log_activity("error", details={"error": str(e) or repr(e), "traceback": err_detail[-500:], "type": "kalshi_analysis"})
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

        # Log each recommendation individually so they show on the Kalshi page
        trades_placed = 0
        recommendations = analysis.get("analysis", [])

        for rec in recommendations:
            ticker = rec.get("ticker", "")
            category = rec.get("category", "other")
            recommendation = rec.get("recommendation", "SKIP")
            edge = rec.get("edge_pct", 0)
            confidence = rec.get("confidence", 0)

            market_title = rec.get("title", ticker)

            # Log EVERY recommendation (even SKIPs) so user can see what AI is thinking
            if recommendation != "SKIP":
                self._log_activity(
                    "signal_created",
                    ticker=ticker,
                    details={
                        "platform": "kalshi",
                        "market_title": market_title,
                        "recommendation": recommendation,
                        "edge_pct": edge,
                        "estimated_prob": rec.get("your_estimated_probability"),
                        "market_price_yes_cents": rec.get("market_price_yes_cents"),
                        "contracts": rec.get("contracts"),
                        "category": category,
                        "cross_reference": rec.get("cross_reference"),
                    },
                    ai_reasoning=rec.get("reasoning"),
                    confidence_score=confidence,
                )

            # Only execute if meets thresholds (aggressive)
            if recommendation == "SKIP":
                continue
            if confidence < 40:
                continue
            if abs(edge) < 5:
                continue

            if not ticker:
                continue

            side = "yes" if "YES" in recommendation.upper() else "no"

            # Minimum $2 per bet
            price = rec.get("market_price_yes_cents") if side == "yes" else (100 - (rec.get("market_price_yes_cents") or 50))
            price = price or 50  # default 50¢ if unknown
            min_contracts = max(1, int(200 / price))  # at least $2 worth

            # Position limits
            max_contracts = 15
            contracts = max(min_contracts, min(rec.get("contracts", 3), max_contracts))

            try:
                # Use fill_or_kill for instant execution — no resting orders
                order = await self.kalshi.place_order(
                    ticker=ticker,
                    side=side,
                    action="buy",
                    count=contracts,
                    price_cents=price,
                    time_in_force="fill_or_kill",
                )

                # Build clear bet description
                bet_side = "YES" if side == "yes" else "NO"
                bet_desc = f"BUY {bet_side} on \"{market_title}\" — {contracts}x @ {price}¢ = ${(contracts * price / 100):.2f}"
                fill_status = order.get("status", "unknown")

                self._log_activity(
                    "trade_executed",
                    ticker=ticker,
                    details={
                        "platform": "kalshi",
                        "bet": bet_desc,
                        "market_title": market_title,
                        "side": side,
                        "contracts": contracts,
                        "price_cents": price,
                        "total_cost": f"${(contracts * price / 100):.2f}",
                        "fill_status": fill_status,
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
