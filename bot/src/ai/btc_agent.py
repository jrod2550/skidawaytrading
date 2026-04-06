"""Dedicated BTC 15-min Agent — runs independently from the main Kalshi scanner.

This agent:
1. Runs every 2 minutes (catches every 15-min window)
2. Fetches real-time BTC price data from Binance (15-min candles)
3. Checks Kalshi for open BTC 15-min markets
4. Analyzes with Claude Sonnet using momentum, volume, fear/greed
5. Auto-executes $5 bets on every window where it sees any edge
"""

import json
import logging
from datetime import datetime, timezone

from src.ai.analyst import HAIKU, SONNET
from src.broker.kalshi import KalshiClient
from src.db.supabase_client import get_supabase
from src.market_data.crypto import CryptoClient

logger = logging.getLogger(__name__)

BTC_SYSTEM_PROMPT = """You are a crypto momentum trader at Booyah Trading.
You specialize in Bitcoin 15-minute price prediction markets on Kalshi.

YOU HAVE REAL-TIME DATA:
- Current BTC price from CoinGecko
- Last 20 fifteen-minute candles from Binance (5 hours of price action)
- 1-hour momentum trend and volume ratio
- Fear & Greed index

YOUR STRATEGY:
1. MOMENTUM: If BTC moved up >0.1% in the last hour with volume ratio >1.0, favor UP.
   If down >0.1% with volume ratio >1.0, favor DOWN. Sideways = coin flip, still bet but lower confidence.

2. VOLUME: Rising volume confirms the trend. Falling volume = trend exhaustion, potential reversal.

3. CANDLE PATTERNS: Look at the last 4 candles:
   - 3+ green candles in a row = strong momentum up
   - 3+ red candles = strong momentum down
   - Doji/small candles = indecision, lower confidence

4. FEAR/GREED: Extreme fear (<25) = contrarian buy signal. Extreme greed (>75) = contrarian sell signal.
   Neutral (40-60) = follow the momentum.

5. PRICE LEVEL: If BTC is near a round number ($70k, $75k), it often bounces or breaks through with conviction.

ALWAYS BET. Every 15-min window, you MUST make a recommendation. $5 minimum.
If momentum is clear, bet with conviction. If uncertain, still bet but lean toward the dominant trend.

Respond in valid JSON only."""

BTC_ANALYSIS_PROMPT = """Analyze the current BTC 15-minute prediction market.

KALSHI MARKET:
Ticker: {ticker}
Title: {title}
YES price (UP): {yes_price}¢
NO price (DOWN): {no_price}¢
Volume: ${volume}
Closes: {close_time}

REAL-TIME BTC DATA:
{btc_data}

Make your call. Respond in JSON:
{{
  "direction": "UP" or "DOWN",
  "side": "yes" or "no",
  "confidence": 50-100,
  "edge_pct": your estimated edge,
  "reasoning": "2-3 sentences explaining your momentum read, citing specific candle data and volume",
  "bet_amount_dollars": 5
}}"""


class BTCAgent:
    """Dedicated BTC 15-min prediction market trader."""

    def __init__(self, kalshi: KalshiClient, analyst_client) -> None:
        self.kalshi = kalshi
        self.analyst_client = analyst_client  # httpx client from ClaudeAnalyst
        self.db = get_supabase()
        self.crypto = CryptoClient()
        self._last_traded_ticker = None  # Don't bet same window twice

    def _log(self, event_type: str, ticker: str | None, details: dict, reasoning: str | None = None, confidence: float | None = None):
        try:
            self.db.table("ai_activity").insert({
                "event_type": event_type,
                "ticker": f"BTC:{ticker}" if ticker else "BTC",
                "details": details,
                "ai_reasoning": reasoning,
                "confidence_score": confidence,
            }).execute()
        except Exception:
            pass

    async def run(self) -> bool:
        """Check for BTC 15-min market and trade it. Returns True if traded."""
        logger.info("BTC Agent: scanning for 15-min market...")

        # Check if paused
        try:
            paused = self.db.table("bot_config").select("value").eq("key", "bot_paused").execute()
            if paused.data and paused.data[0].get("value"):
                logger.info("BTC Agent: bot is paused")
                return False
        except Exception:
            pass

        # Find open BTC 15-min market
        try:
            data = await self.kalshi._get("/markets", params={
                "series_ticker": "KXBTC15M",
                "status": "open",
                "limit": 5,
            })
            markets = data.get("markets", [])
        except Exception as e:
            logger.error("BTC Agent: failed to fetch markets: %s", e)
            return False

        if not markets:
            logger.info("BTC Agent: no open BTC 15-min markets")
            return False

        # Pick the soonest expiring market
        market = markets[0]
        ticker = market.get("ticker", "")

        # Don't bet same window twice
        if ticker == self._last_traded_ticker:
            logger.info("BTC Agent: already traded this window (%s)", ticker)
            return False

        yes_bid = float(market.get("yes_bid_dollars", "0") or 0)
        yes_ask = float(market.get("yes_ask_dollars", "0") or 0)
        no_bid = float(market.get("no_bid_dollars", "0") or 0)
        no_ask = float(market.get("no_ask_dollars", "0") or 0)
        volume = float(market.get("volume_fp", "0") or 0)
        title = market.get("title", "BTC 15-min")

        if yes_bid == 0 and yes_ask == 0:
            logger.info("BTC Agent: no pricing on %s", ticker)
            return False

        # Get real-time BTC data
        try:
            btc_data = await self.crypto.get_btc_analysis()
        except Exception:
            btc_data = {}

        # Claude analyzes
        prompt = BTC_ANALYSIS_PROMPT.format(
            ticker=ticker,
            title=title,
            yes_price=round(yes_ask * 100) if yes_ask > 0 else round(yes_bid * 100),
            no_price=round(no_ask * 100) if no_ask > 0 else round(no_bid * 100),
            volume=f"{volume:.0f}",
            close_time=market.get("close_time", ""),
            btc_data=json.dumps(btc_data, indent=2),
        )

        try:
            MODELS = [HAIKU, SONNET, "claude-3-haiku-20240307"]
            resp_data = None

            for model in MODELS:
                try:
                    resp = await self.analyst_client.post(
                        "/v1/messages",
                        json={
                            "model": model,
                            "max_tokens": 500,
                            "system": BTC_SYSTEM_PROMPT,
                            "messages": [{"role": "user", "content": prompt}],
                        },
                    )
                    resp.raise_for_status()
                    resp_data = resp.json()
                    break
                except Exception as e:
                    if "not_found" in str(e).lower() or "404" in str(e):
                        continue
                    raise

            if not resp_data:
                return False

            text = resp_data["content"][0]["text"]
            start = text.find("{")
            end = text.rfind("}")
            if start != -1 and end != -1:
                text = text[start:end + 1]

            import re
            text = re.sub(r',\s*}', '}', text)
            analysis = json.loads(text.strip())

        except Exception as e:
            logger.error("BTC Agent: analysis failed: %s", e)
            return False

        direction = analysis.get("direction", "UP")
        side = analysis.get("side", "yes")
        confidence = analysis.get("confidence", 50)
        reasoning = analysis.get("reasoning", "")
        edge = analysis.get("edge_pct", 0)

        # Calculate contracts for $5 bet
        if side == "yes":
            price_cents = round(yes_ask * 100) if yes_ask > 0 else round(yes_bid * 100)
        else:
            price_cents = round(no_ask * 100) if no_ask > 0 else round(no_bid * 100)

        if price_cents <= 0:
            price_cents = 50

        contracts = max(1, round(500 / price_cents))  # $5 worth

        bet_desc = f"BTC 15-min: {direction} — {'YES' if side == 'yes' else 'NO'} {contracts}x @ {price_cents}¢ = ${contracts * price_cents / 100:.2f}"

        logger.info("BTC Agent: %s (confidence=%d, edge=%.1f%%)", bet_desc, confidence, edge)

        # Log the suggestion
        self._log(
            "signal_created",
            ticker=ticker,
            details={
                "platform": "kalshi",
                "agent": "btc_15min",
                "bet": bet_desc,
                "market_title": title,
                "direction": direction,
                "side": side,
                "contracts": contracts,
                "price_cents": price_cents,
                "total_cost": f"${contracts * price_cents / 100:.2f}",
                "edge_pct": edge,
                "btc_price": btc_data.get("current_price"),
                "momentum": btc_data.get("momentum", {}).get("trend"),
                "category": "crypto",
            },
            reasoning=reasoning,
            confidence=confidence,
        )

        # Execute the trade
        try:
            order = await self.kalshi.place_order(
                ticker=ticker,
                side=side,
                action="buy",
                count=contracts,
                price_cents=price_cents,
                time_in_force="fill_or_kill",
            )

            self._last_traded_ticker = ticker
            fill_status = order.get("status", "unknown")

            self._log(
                "trade_executed",
                ticker=ticker,
                details={
                    "platform": "kalshi",
                    "agent": "btc_15min",
                    "bet": bet_desc,
                    "market_title": title,
                    "direction": direction,
                    "side": side,
                    "contracts": contracts,
                    "price_cents": price_cents,
                    "total_cost": f"${contracts * price_cents / 100:.2f}",
                    "fill_status": fill_status,
                    "edge_pct": edge,
                    "btc_price": btc_data.get("current_price"),
                    "momentum": btc_data.get("momentum", {}).get("trend"),
                    "category": "crypto",
                    "order_id": order.get("order_id"),
                },
                reasoning=reasoning,
                confidence=confidence,
            )

            logger.info("BTC Agent: TRADED — %s (fill=%s)", bet_desc, fill_status)
            return True

        except Exception as e:
            logger.error("BTC Agent: trade failed: %s", e)
            self._log(
                "trade_failed",
                ticker=ticker,
                details={"error": str(e), "agent": "btc_15min", "bet": bet_desc},
                reasoning=reasoning,
            )
            return False

    async def close(self):
        await self.crypto.close()
