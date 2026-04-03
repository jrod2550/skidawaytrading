"""Unusual Whales REST API client."""

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

    # --- Congressional Endpoints ---

    async def get_congressional_trades(self) -> list[dict]:
        """Get recent congressional stock trades."""
        data = await self._get("/api/congress/recent-trades")
        return data.get("data", [])

    async def get_congressional_trader(self, name: str) -> dict:
        """Get trades for a specific representative."""
        data = await self._get(f"/api/congress/member/{name}")
        return data.get("data", {})

    # --- Options Flow Endpoints ---

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

    # --- Market Data ---

    async def get_stock_quote(self, ticker: str) -> dict:
        """Get current stock quote."""
        data = await self._get(f"/api/stock/{ticker}/quote")
        return data.get("data", {})

    async def get_sector_etfs(self) -> list[dict]:
        """Get sector ETF performance."""
        data = await self._get("/api/etf/sectors")
        return data.get("data", [])
