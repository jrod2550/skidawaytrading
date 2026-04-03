"""Unusual Whales WebSocket consumer for real-time flow alerts."""

import asyncio
import json
import logging
from collections.abc import Callable, Coroutine
from typing import Any

import websockets

from src.config import settings

logger = logging.getLogger(__name__)

FlowCallback = Callable[[dict[str, Any]], Coroutine[Any, Any, None]]


class UWWebSocketConsumer:
    def __init__(self, on_flow_alert: FlowCallback) -> None:
        self._on_flow_alert = on_flow_alert
        self._running = False

    async def start(self) -> None:
        self._running = True
        while self._running:
            try:
                await self._connect()
            except Exception:
                logger.exception("WebSocket connection error, reconnecting in 10s")
                await asyncio.sleep(10)

    async def stop(self) -> None:
        self._running = False

    async def _connect(self) -> None:
        url = settings.uw_websocket_url
        headers = {"Authorization": f"Bearer {settings.uw_api_key}"}

        async with websockets.connect(url, additional_headers=headers) as ws:
            # Subscribe to flow alerts channel
            subscribe_msg = json.dumps({
                "action": "subscribe",
                "channels": ["flow_alerts"],
            })
            await ws.send(subscribe_msg)
            logger.info("WebSocket connected, subscribed to flow_alerts")

            async for message in ws:
                if not self._running:
                    break
                try:
                    data = json.loads(message)
                    if data.get("type") == "flow_alert":
                        await self._on_flow_alert(data.get("data", {}))
                except Exception:
                    logger.exception("Error processing WebSocket message")
