"""Hardcore BTC 15-min Agent — the moneymaker.

This agent:
1. Runs every 5 minutes
2. Pulls EVERYTHING: Binance candles, order book depth, funding rates,
   CoinGecko price, fear/greed, AND crypto ETF options flow from UW
3. Claude Haiku makes the call with institutional-grade data
4. $10 bets, fill-or-kill
"""

import json
import logging
from datetime import datetime, timezone

from src.ai.analyst import HAIKU, SONNET
from src.broker.kalshi import KalshiClient
from src.db.supabase_client import get_supabase
from src.market_data.crypto import CryptoClient
from src.market_data.unusual_whales import UnusualWhalesClient

logger = logging.getLogger(__name__)

BTC_SYSTEM_PROMPT = """You are an elite crypto momentum trader. You ONLY trade Bitcoin 15-minute prediction markets on Kalshi.

YOUR EDGE: You have data nobody else on Kalshi has:
1. REAL-TIME 15-min candles from Binance (open, high, low, close, volume)
2. Binance order book depth (bid/ask walls — where is the liquidity?)
3. Crypto ETF institutional flow from Unusual Whales (IBIT, BITO, MARA, RIOT, COIN options)
4. Fear & Greed index
5. Funding rates and liquidation data

YOUR STRATEGY — BE DECISIVE:

MOMENTUM RULES (most important):
- 3+ green 15-min candles with rising volume = STRONG UP, bet YES aggressively
- 3+ red 15-min candles with rising volume = STRONG DOWN, bet NO aggressively
- Volume ratio > 1.5 = trend is accelerating, GO WITH IT
- Volume ratio < 0.5 = trend exhaustion, potential reversal

ORDER BOOK:
- Large bid wall below current price = support, favors UP
- Large ask wall above current price = resistance, favors DOWN
- Thin book = volatile, go with momentum
- If momentum is UP and there's a big ask wall within 0.1%, the move may stall — reduce confidence

INSTITUTIONAL FLOW (from Unusual Whales):
- Massive IBIT call buying = institutions expect BTC UP
- IBIT put buying or BITO put buying = institutions hedging, expect DOWN
- MARA/RIOT call sweeps = miners bullish = BTC UP
- Dark pool prints on crypto ETFs = smart money positioning

FEAR/GREED:
- Extreme fear (<20) = contrarian BUY signal (short-term bounces likely)
- Extreme greed (>80) = contrarian SELL signal
- Neutral = follow momentum

CRITICAL RULES:
1. ALWAYS make a call. Every window. No skipping.
2. Go with momentum unless you have strong contrarian signal
3. If uncertain, bet SMALL but still bet
4. Cite specific data points — "volume ratio 1.8, 4 green candles, IBIT calls $2M"

Respond in valid JSON only."""

BTC_ANALYSIS_PROMPT = """KALSHI MARKET:
Ticker: {ticker}
Title: {title}
YES price: {yes_price}¢ | NO price: {no_price}¢
Volume: ${volume} | Closes: {close_time}

BINANCE BTC DATA:
{btc_data}

ORDER BOOK DEPTH:
{orderbook_data}

CRYPTO ETF INSTITUTIONAL FLOW (Unusual Whales):
{crypto_flow}

Your call. JSON response:
{{
  "direction": "UP" or "DOWN",
  "side": "yes" or "no",
  "confidence": 50-100,
  "edge_pct": estimated edge over market price,
  "reasoning": "2-3 sentences citing SPECIFIC data: candle count, volume ratio, order book walls, ETF flow premiums"
}}"""


class BTCAgent:
    """Hardcore BTC 15-min prediction market trader."""

    def __init__(self, kalshi: KalshiClient, analyst_client) -> None:
        self.kalshi = kalshi
        self.analyst_client = analyst_client
        self.db = get_supabase()
        self.crypto = CryptoClient()
        self.uw = UnusualWhalesClient()
        self._last_traded_ticker = None

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

    async def _get_crypto_flow(self) -> dict:
        """Get institutional crypto ETF flow from Unusual Whales."""
        import asyncio
        results = {}

        async def fetch_flow(ticker):
            try:
                flow = await self.uw.get_flow_alerts(ticker)
                if flow:
                    # Summarize: total premium, direction, sweeps
                    total_premium = sum(float(f.get("total_premium", 0)) for f in flow[:10])
                    calls = [f for f in flow[:10] if f.get("type") == "call"]
                    puts = [f for f in flow[:10] if f.get("type") == "put"]
                    sweeps = [f for f in flow[:10] if f.get("has_sweep")]
                    return {
                        "ticker": ticker,
                        "total_premium": total_premium,
                        "call_count": len(calls),
                        "put_count": len(puts),
                        "sweep_count": len(sweeps),
                        "call_premium": sum(float(f.get("total_premium", 0)) for f in calls),
                        "put_premium": sum(float(f.get("total_premium", 0)) for f in puts),
                        "sentiment": "bullish" if len(calls) > len(puts) * 1.5 else "bearish" if len(puts) > len(calls) * 1.5 else "neutral",
                        "top_trade": f"{flow[0].get('type','?')} {flow[0].get('strike','')} exp {flow[0].get('expiry','')} ${float(flow[0].get('total_premium',0)):,.0f}" if flow else None,
                    }
            except Exception:
                pass
            return None

        tasks = [fetch_flow(t) for t in ["IBIT", "BITO", "MARA", "RIOT", "COIN"]]
        fetched = await asyncio.gather(*tasks)
        for r in fetched:
            if r:
                results[r["ticker"]] = r

        # Overall sentiment
        total_call_prem = sum(r.get("call_premium", 0) for r in results.values())
        total_put_prem = sum(r.get("put_premium", 0) for r in results.values())
        results["_summary"] = {
            "total_call_premium": total_call_prem,
            "total_put_premium": total_put_prem,
            "institutional_sentiment": "BULLISH" if total_call_prem > total_put_prem * 1.5 else "BEARISH" if total_put_prem > total_call_prem * 1.5 else "NEUTRAL",
        }
        return results

    async def _get_orderbook_depth(self) -> dict:
        """Get Binance BTC order book depth."""
        try:
            import httpx
            async with httpx.AsyncClient(timeout=10) as client:
                resp = await client.get(
                    "https://api.binance.com/api/v3/depth",
                    params={"symbol": "BTCUSDT", "limit": 20},
                )
                if resp.status_code == 200:
                    data = resp.json()
                    bids = [(float(p), float(q)) for p, q in data.get("bids", [])]
                    asks = [(float(p), float(q)) for p, q in data.get("asks", [])]
                    bid_volume = sum(q for _, q in bids)
                    ask_volume = sum(q for _, q in asks)
                    best_bid = bids[0][0] if bids else 0
                    best_ask = asks[0][0] if asks else 0
                    # Find walls (single level > 2x average)
                    avg_bid = bid_volume / len(bids) if bids else 0
                    avg_ask = ask_volume / len(asks) if asks else 0
                    bid_walls = [{"price": p, "btc": q} for p, q in bids if q > avg_bid * 2]
                    ask_walls = [{"price": p, "btc": q} for p, q in asks if q > avg_ask * 2]
                    return {
                        "best_bid": best_bid,
                        "best_ask": best_ask,
                        "spread": round(best_ask - best_bid, 2),
                        "bid_depth_btc": round(bid_volume, 2),
                        "ask_depth_btc": round(ask_volume, 2),
                        "bid_ask_ratio": round(bid_volume / ask_volume, 2) if ask_volume > 0 else 1,
                        "bid_walls": bid_walls[:3],
                        "ask_walls": ask_walls[:3],
                        "pressure": "BUY" if bid_volume > ask_volume * 1.3 else "SELL" if ask_volume > bid_volume * 1.3 else "BALANCED",
                    }
        except Exception:
            pass
        return {}

    async def run(self) -> bool:
        """Check for BTC 15-min market and trade it."""
        logger.info("BTC Agent: scanning...")

        # Check if paused
        try:
            paused = self.db.table("bot_config").select("value").eq("key", "bot_paused").execute()
            if paused.data and paused.data[0].get("value"):
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

        market = markets[0]
        ticker = market.get("ticker", "")

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

        # Gather ALL intelligence in parallel
        import asyncio
        btc_data, orderbook, crypto_flow = await asyncio.gather(
            self.crypto.get_btc_analysis(),
            self._get_orderbook_depth(),
            self._get_crypto_flow(),
        )

        # Build prompt
        prompt = BTC_ANALYSIS_PROMPT.format(
            ticker=ticker,
            title=title,
            yes_price=round(yes_ask * 100) if yes_ask > 0 else round(yes_bid * 100),
            no_price=round(no_ask * 100) if no_ask > 0 else round(no_bid * 100),
            volume=f"{volume:.0f}",
            close_time=market.get("close_time", ""),
            btc_data=json.dumps(btc_data, indent=2),
            orderbook_data=json.dumps(orderbook, indent=2),
            crypto_flow=json.dumps(crypto_flow, indent=2),
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

        # $10 bet
        if side == "yes":
            price_cents = round(yes_ask * 100) if yes_ask > 0 else round(yes_bid * 100)
        else:
            price_cents = round(no_ask * 100) if no_ask > 0 else round(no_bid * 100)

        if price_cents <= 0:
            price_cents = 50

        contracts = max(1, round(1000 / price_cents))  # $10 worth

        bet_desc = f"BTC 15-min: {direction} — {'YES' if side == 'yes' else 'NO'} {contracts}x @ {price_cents}¢ = ${contracts * price_cents / 100:.2f}"
        logger.info("BTC Agent: %s (conf=%d, edge=%.1f%%)", bet_desc, confidence, edge)

        # Log with institutional flow data
        flow_summary = crypto_flow.get("_summary", {})
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
                "volume_ratio": btc_data.get("momentum", {}).get("volume_ratio"),
                "orderbook_pressure": orderbook.get("pressure"),
                "institutional_sentiment": flow_summary.get("institutional_sentiment"),
                "category": "crypto",
            },
            reasoning=reasoning,
            confidence=confidence,
        )

        # Execute
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
                    "orderbook_pressure": orderbook.get("pressure"),
                    "institutional_sentiment": flow_summary.get("institutional_sentiment"),
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
            self._log("trade_failed", ticker=ticker, details={"error": str(e), "agent": "btc_15min", "bet": bet_desc}, reasoning=reasoning)
            return False

    async def close(self):
        await self.crypto.close()
        await self.uw.close()
