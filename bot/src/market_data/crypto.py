"""Real-time crypto price data for Kalshi BTC/ETH prediction markets.

Uses CoinGecko API (free, no key required) for:
- Current BTC/ETH price
- 24h price change
- 1h/4h momentum
- Volume data
"""

import logging
import httpx

logger = logging.getLogger(__name__)


class CryptoClient:
    """Free crypto price data from CoinGecko + Binance."""

    def __init__(self) -> None:
        self._client = httpx.AsyncClient(timeout=15.0)

    async def close(self) -> None:
        await self._client.aclose()

    async def get_btc_analysis(self) -> dict:
        """Get comprehensive BTC data for 15-min prediction analysis."""
        import asyncio

        current, candles, fear_greed = await asyncio.gather(
            self._get_current_price("bitcoin"),
            self._get_recent_candles("BTCUSDT"),
            self._get_fear_greed(),
        )

        # Calculate momentum indicators from candles
        momentum = self._calc_momentum(candles)

        return {
            "current_price": current.get("price"),
            "price_change_24h_pct": current.get("change_24h"),
            "price_change_1h_pct": current.get("change_1h"),
            "high_24h": current.get("high_24h"),
            "low_24h": current.get("low_24h"),
            "volume_24h": current.get("volume_24h"),
            "market_cap": current.get("market_cap"),
            "momentum": momentum,
            "fear_greed_index": fear_greed,
            "data_source": "CoinGecko + Binance (real-time)",
        }

    async def _get_current_price(self, coin: str = "bitcoin") -> dict:
        try:
            resp = await self._client.get(
                "https://api.coingecko.com/api/v3/simple/price",
                params={
                    "ids": coin,
                    "vs_currencies": "usd",
                    "include_24hr_change": "true",
                    "include_24hr_vol": "true",
                    "include_market_cap": "true",
                    "include_last_updated_at": "true",
                },
            )
            if resp.status_code == 200:
                data = resp.json().get(coin, {})
                return {
                    "price": data.get("usd"),
                    "change_24h": data.get("usd_24h_change"),
                    "change_1h": None,  # Not available from this endpoint
                    "high_24h": None,
                    "low_24h": None,
                    "volume_24h": data.get("usd_24h_vol"),
                    "market_cap": data.get("usd_market_cap"),
                }
        except Exception:
            pass
        return {}

    async def _get_recent_candles(self, symbol: str = "BTCUSDT") -> list[dict]:
        """Get 15-min candles from Binance (free, no key)."""
        try:
            resp = await self._client.get(
                "https://api.binance.com/api/v3/klines",
                params={
                    "symbol": symbol,
                    "interval": "15m",
                    "limit": 20,  # Last 5 hours of 15-min candles
                },
            )
            if resp.status_code == 200:
                candles = []
                for c in resp.json():
                    candles.append({
                        "open": float(c[1]),
                        "high": float(c[2]),
                        "low": float(c[3]),
                        "close": float(c[4]),
                        "volume": float(c[5]),
                        "timestamp": c[0],
                    })
                return candles
        except Exception:
            pass
        return []

    async def _get_fear_greed(self) -> dict:
        """Get crypto fear & greed index."""
        try:
            resp = await self._client.get("https://api.alternative.me/fng/?limit=1")
            if resp.status_code == 200:
                data = resp.json().get("data", [{}])[0]
                return {
                    "value": int(data.get("value", 50)),
                    "label": data.get("value_classification", "Neutral"),
                }
        except Exception:
            pass
        return {"value": 50, "label": "Unknown"}

    def _calc_momentum(self, candles: list[dict]) -> dict:
        """Calculate simple momentum from 15-min candles."""
        if len(candles) < 4:
            return {"trend": "unknown", "strength": 0}

        # Last 4 candles (1 hour)
        recent = candles[-4:]
        first_close = recent[0]["close"]
        last_close = recent[-1]["close"]
        hour_change = ((last_close - first_close) / first_close) * 100

        # Last 1 candle (15 min)
        last = candles[-1]
        prev = candles[-2]
        fifteen_min_change = ((last["close"] - prev["close"]) / prev["close"]) * 100

        # Volume trend
        recent_vol = sum(c["volume"] for c in candles[-4:])
        earlier_vol = sum(c["volume"] for c in candles[-8:-4]) if len(candles) >= 8 else recent_vol
        vol_ratio = recent_vol / earlier_vol if earlier_vol > 0 else 1

        # Simple trend
        if hour_change > 0.5:
            trend = "strong_up"
        elif hour_change > 0.1:
            trend = "up"
        elif hour_change < -0.5:
            trend = "strong_down"
        elif hour_change < -0.1:
            trend = "down"
        else:
            trend = "sideways"

        return {
            "trend": trend,
            "hour_change_pct": round(hour_change, 3),
            "fifteen_min_change_pct": round(fifteen_min_change, 3),
            "volume_ratio": round(vol_ratio, 2),
            "last_price": last_close,
            "last_4_candles": [
                {"close": c["close"], "vol": round(c["volume"], 1)} for c in recent
            ],
        }
