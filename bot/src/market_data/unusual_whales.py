"""Unusual Whales REST API client — full endpoint coverage."""

import logging
from typing import Any

import httpx

from src.config import settings

logger = logging.getLogger(__name__)


class UnusualWhalesClient:
    def __init__(self) -> None:
        self._client = httpx.AsyncClient(
            base_url=settings.uw_base_url,
            headers={"Authorization": f"Bearer {settings.uw_api_key}"},
            timeout=30.0,
        )

    async def close(self) -> None:
        await self._client.aclose()

    async def _get(self, path: str, params: dict | None = None) -> Any:
        resp = await self._client.get(path, params=params)
        resp.raise_for_status()
        return resp.json()

    # ── Options Flow ──────────────────────────────────────────

    async def get_flow_alerts(self, ticker: str | None = None) -> list[dict]:
        """Get unusual options flow alerts."""
        params = {}
        if ticker:
            params["ticker"] = ticker
        data = await self._get("/api/option-trades/flow-alerts", params=params)
        return data.get("data", [])

    async def get_option_chain(self, ticker: str, expiry: str) -> list[dict]:
        """Get options chain for a ticker and expiry."""
        data = await self._get(
            f"/api/stock/{ticker}/option-contracts",
            params={"expiry": expiry},
        )
        return data.get("data", [])

    async def get_option_greeks(self, option_symbol: str) -> dict:
        """Get Greeks for a specific option contract."""
        data = await self._get(f"/api/option-contract/{option_symbol}")
        return data.get("data", {})

    async def get_net_premium_ticks(self, ticker: str) -> list[dict]:
        """Get call/put net premium ticks — real-time sentiment."""
        data = await self._get(f"/api/stock/{ticker}/net-premium-ticks")
        return data.get("data", [])

    async def get_nope(self, ticker: str) -> dict:
        """Get NOPE indicator (Net Options Pricing Effect) — delta-adjusted flow signal."""
        data = await self._get(f"/api/stock/{ticker}/nope")
        return data.get("data", {})

    async def get_flow_per_strike(self, ticker: str) -> list[dict]:
        """Get options flow broken down by strike."""
        data = await self._get(f"/api/stock/{ticker}/flow-per-strike")
        return data.get("data", [])

    async def get_flow_per_expiry(self, ticker: str) -> list[dict]:
        """Get options flow broken down by expiry."""
        data = await self._get(f"/api/stock/{ticker}/flow-per-expiry")
        return data.get("data", [])

    # ── Greeks / Volatility ───────────────────────────────────

    async def get_greek_exposure(self, ticker: str) -> dict:
        """Get GEX (gamma exposure) — predicts pinning and big moves."""
        data = await self._get(f"/api/stock/{ticker}/greek-exposure")
        return data.get("data", {})

    async def get_iv_rank(self, ticker: str) -> dict:
        """Get IV rank — is implied volatility high or low relative to history?"""
        data = await self._get(f"/api/stock/{ticker}/iv-rank")
        return data.get("data", {})

    async def get_max_pain(self, ticker: str, expiry: str) -> dict:
        """Get max pain — the strike where most options expire worthless."""
        data = await self._get(
            f"/api/stock/{ticker}/max-pain",
            params={"expiry": expiry},
        )
        return data.get("data", {})

    async def get_volatility_stats(self, ticker: str) -> dict:
        """Get volatility statistics — IV, HV, IV/HV ratio, skew."""
        data = await self._get(f"/api/stock/{ticker}/volatility-stats")
        return data.get("data", {})

    # ── Dark Pool ─────────────────────────────────────────────

    async def get_dark_pool_recent(self) -> list[dict]:
        """Get recent dark pool prints across the market."""
        data = await self._get("/api/darkpool/recent")
        return data.get("data", [])

    async def get_dark_pool_ticker(self, ticker: str) -> list[dict]:
        """Get dark pool trades for a specific ticker."""
        data = await self._get(f"/api/darkpool/{ticker}")
        return data.get("data", [])

    # ── Market-Wide ───────────────────────────────────────────

    async def get_market_tide(self) -> dict:
        """Get overall market tide — bullish/bearish options flow sentiment."""
        data = await self._get("/api/market/tide")
        return data.get("data", {})

    async def get_sector_tide(self) -> list[dict]:
        """Get sector-level tide — which sectors have bullish/bearish flow."""
        data = await self._get("/api/market/sector-tide")
        return data.get("data", [])

    async def get_top_net_impact(self) -> list[dict]:
        """Get top movers by net options impact."""
        data = await self._get("/api/market/top-net-impact")
        return data.get("data", [])

    async def get_economic_calendar(self) -> list[dict]:
        """Get upcoming macro economic events."""
        data = await self._get("/api/market/economic-calendar")
        return data.get("data", [])

    async def get_total_options_volume(self) -> dict:
        """Get market-wide options volume."""
        data = await self._get("/api/market/total-options-volume")
        return data.get("data", {})

    # ── Congressional ─────────────────────────────────────────

    async def get_congressional_trades(self) -> list[dict]:
        """Get recent congressional stock trades."""
        data = await self._get("/api/congress/recent-trades")
        return data.get("data", [])

    async def get_congressional_trader(self, name: str) -> dict:
        """Get trades for a specific representative."""
        data = await self._get(f"/api/congress/member/{name}")
        return data.get("data", {})

    # ── Insider Trading ───────────────────────────────────────

    async def get_insider_transactions(self) -> list[dict]:
        """Get recent insider (C-suite) buy/sell transactions."""
        data = await self._get("/api/insiders/transactions")
        return data.get("data", [])

    async def get_insider_ticker(self, ticker: str) -> list[dict]:
        """Get insider transactions for a specific ticker."""
        data = await self._get(f"/api/insiders/{ticker}")
        return data.get("data", [])

    # ── Stock Data ────────────────────────────────────────────

    async def get_stock_quote(self, ticker: str) -> dict:
        """Get current stock quote."""
        data = await self._get(f"/api/stock/{ticker}/quote")
        return data.get("data", {})

    async def get_sector_etfs(self) -> list[dict]:
        """Get sector ETF performance."""
        data = await self._get("/api/etf/sectors")
        return data.get("data", [])

    # ── Screeners ─────────────────────────────────────────────

    async def get_hottest_chains(self) -> list[dict]:
        """Get hottest options chains right now."""
        data = await self._get("/api/screener/contract-screener")
        return data.get("data", [])

    # ── Short Interest ────────────────────────────────────────

    async def get_short_interest(self, ticker: str) -> dict:
        """Get short interest and float data."""
        data = await self._get(f"/api/short/{ticker}/interest")
        return data.get("data", {})
