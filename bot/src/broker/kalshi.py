"""Kalshi prediction market broker adapter.

Connects to Kalshi Exchange API for prediction market trading.
Supports demo (paper) and production environments.
Uses RSA-PSS SHA-256 signing for authentication.
"""

import base64
import datetime
import logging
from typing import Any
from urllib.parse import urlparse

import httpx
from cryptography.hazmat.backends import default_backend
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding

from src.config import settings

logger = logging.getLogger(__name__)

# Kalshi environments
DEMO_BASE = "https://demo-api.kalshi.co/trade-api/v2"
PROD_BASE = "https://api.elections.kalshi.com/trade-api/v2"


class KalshiClient:
    """Kalshi Exchange API client with RSA-PSS authentication."""

    def __init__(self, demo: bool = True) -> None:
        self.base_url = DEMO_BASE if demo else PROD_BASE
        self.api_key = settings.kalshi_api_key
        self._private_key = self._load_private_key()
        self._client = httpx.AsyncClient(timeout=30.0)
        self.demo = demo
        logger.info("Kalshi client initialized (%s)", "DEMO" if demo else "PRODUCTION")

    def _load_private_key(self):
        """Load RSA private key from config."""
        key_data = settings.kalshi_private_key
        if not key_data:
            logger.warning("No Kalshi private key configured")
            return None
        # Handle both file path and inline key
        if key_data.startswith("-----"):
            key_bytes = key_data.encode("utf-8")
        else:
            with open(key_data, "rb") as f:
                key_bytes = f.read()
        return serialization.load_pem_private_key(
            key_bytes, password=None, backend=default_backend()
        )

    def _sign_request(self, method: str, path: str) -> dict[str, str]:
        """Generate authentication headers with RSA-PSS signature."""
        timestamp = str(int(datetime.datetime.now().timestamp() * 1000))
        path_only = urlparse(self.base_url + path).path
        message = f"{timestamp}{method.upper()}{path_only}".encode("utf-8")

        signature = self._private_key.sign(
            message,
            padding.PSS(
                mgf=padding.MGF1(hashes.SHA256()),
                salt_length=padding.PSS.DIGEST_LENGTH,
            ),
            hashes.SHA256(),
        )

        return {
            "KALSHI-ACCESS-KEY": self.api_key,
            "KALSHI-ACCESS-TIMESTAMP": timestamp,
            "KALSHI-ACCESS-SIGNATURE": base64.b64encode(signature).decode("utf-8"),
            "Content-Type": "application/json",
        }

    async def _get(self, path: str, params: dict | None = None) -> Any:
        headers = self._sign_request("GET", path)
        resp = await self._client.get(
            self.base_url + path, headers=headers, params=params
        )
        resp.raise_for_status()
        return resp.json()

    async def _post(self, path: str, body: dict) -> Any:
        headers = self._sign_request("POST", path)
        resp = await self._client.post(
            self.base_url + path, headers=headers, json=body
        )
        resp.raise_for_status()
        return resp.json()

    async def _delete(self, path: str) -> Any:
        headers = self._sign_request("DELETE", path)
        resp = await self._client.delete(self.base_url + path, headers=headers)
        resp.raise_for_status()
        return resp.json()

    async def close(self) -> None:
        await self._client.aclose()

    # ── Account ───────────────────────────────────────────────

    async def get_balance(self) -> dict:
        """Get account balance (in cents)."""
        data = await self._get("/portfolio/balance")
        return data

    async def get_positions(self) -> list[dict]:
        """Get all open positions."""
        data = await self._get("/portfolio/positions", params={"limit": 200})
        return data.get("market_positions", [])

    async def get_fills(self, limit: int = 50) -> list[dict]:
        """Get recent trade fills."""
        data = await self._get("/portfolio/fills", params={"limit": limit})
        return data.get("fills", [])

    async def get_settlements(self, limit: int = 50) -> list[dict]:
        """Get recent settlements."""
        data = await self._get("/portfolio/settlements", params={"limit": limit})
        return data.get("settlements", [])

    # ── Markets ───────────────────────────────────────────────

    async def get_markets(
        self,
        status: str = "open",
        limit: int = 100,
        series_ticker: str | None = None,
        event_ticker: str | None = None,
    ) -> list[dict]:
        """Get available markets."""
        params: dict[str, Any] = {"status": status, "limit": limit}
        if series_ticker:
            params["series_ticker"] = series_ticker
        if event_ticker:
            params["event_ticker"] = event_ticker
        data = await self._get("/markets", params=params)
        return data.get("markets", [])

    async def get_market(self, ticker: str) -> dict:
        """Get a single market by ticker."""
        data = await self._get(f"/markets/{ticker}")
        return data.get("market", {})

    async def get_orderbook(self, ticker: str) -> dict:
        """Get order book for a market."""
        data = await self._get(f"/markets/{ticker}/orderbook")
        return data.get("orderbook", {})

    async def get_events(self, limit: int = 50) -> list[dict]:
        """Get available events."""
        data = await self._get("/events", params={"limit": limit})
        return data.get("events", [])

    async def get_event(self, event_ticker: str) -> dict:
        """Get a single event."""
        data = await self._get(f"/events/{event_ticker}")
        return data.get("event", {})

    async def get_trades(self, ticker: str, limit: int = 50) -> list[dict]:
        """Get recent trades for a market."""
        data = await self._get("/markets/trades", params={"ticker": ticker, "limit": limit})
        return data.get("trades", [])

    # ── Orders ────────────────────────────────────────────────

    async def place_order(
        self,
        ticker: str,
        side: str,  # "yes" or "no"
        action: str,  # "buy" or "sell"
        count: int,
        price_cents: int | None = None,
        time_in_force: str = "good_till_canceled",
    ) -> dict:
        """Place an order on Kalshi.

        Args:
            ticker: Market ticker (e.g., "INXD-26APR04-B5200")
            side: "yes" or "no"
            action: "buy" or "sell"
            count: Number of contracts
            price_cents: Price in cents (1-99). None = market order via FOK
            time_in_force: "good_till_canceled", "fill_or_kill", "immediate_or_cancel"
        """
        body: dict[str, Any] = {
            "ticker": ticker,
            "side": side,
            "action": action,
            "count": count,
            "time_in_force": time_in_force,
        }
        if price_cents is not None:
            if side == "yes":
                body["yes_price"] = price_cents
            else:
                body["no_price"] = price_cents

        data = await self._post("/portfolio/orders", body)
        order = data.get("order", {})

        logger.info(
            "Kalshi order placed: %s %s %dx %s @ %s¢ (order_id=%s)",
            action, side, count, ticker,
            price_cents or "MKT", order.get("order_id", "?"),
        )
        return order

    async def cancel_order(self, order_id: str) -> dict:
        """Cancel an order."""
        data = await self._delete(f"/portfolio/orders/{order_id}")
        logger.info("Kalshi order cancelled: %s", order_id)
        return data

    async def get_orders(self, status: str = "resting") -> list[dict]:
        """Get orders by status (resting, canceled, executed)."""
        data = await self._get("/portfolio/orders", params={"status": status})
        return data.get("orders", [])

    # ── Exchange Info ─────────────────────────────────────────

    async def get_exchange_status(self) -> dict:
        """Get exchange status."""
        return await self._get("/exchange/status")

    async def get_exchange_schedule(self) -> dict:
        """Get exchange schedule."""
        return await self._get("/exchange/schedule")
