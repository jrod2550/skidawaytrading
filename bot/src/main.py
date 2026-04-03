"""Skidaway Trading Bot — Main entry point.

Runs the signal scanning scheduler, WebSocket consumer,
and trade execution loop.
"""

import asyncio
import logging
from datetime import datetime, timezone

from apscheduler.schedulers.asyncio import AsyncIOScheduler

from src.broker.paper import PaperBroker
from src.config import settings
from src.db.supabase_client import get_supabase
from src.execution.executor import TradeExecutor
from src.execution.order_builder import build_order_from_signal
from src.market_data.unusual_whales import UnusualWhalesClient
from src.market_data.websocket import UWWebSocketConsumer
from src.risk.manager import RiskManager
from src.signals.engine import SignalEngine
from src.signals.flow import process_flow_alert

logging.basicConfig(
    level=getattr(logging, settings.log_level),
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("skidaway")


async def main() -> None:
    logger.info("Starting Skidaway Trading Bot...")

    # Initialize components
    uw = UnusualWhalesClient()
    signal_engine = SignalEngine(uw)

    # Use paper broker by default; switch to IBKRBroker for live trading
    # from src.broker.ibkr import IBKRBroker
    # broker = IBKRBroker()
    broker = PaperBroker(initial_balance=100_000.0)
    await broker.connect()

    risk_manager = RiskManager(broker)
    executor = TradeExecutor(broker, risk_manager)

    # Send initial heartbeat
    db = get_supabase()
    db.table("bot_heartbeats").insert({
        "status": "healthy",
        "details": {"started_at": datetime.now(timezone.utc).isoformat()},
    }).execute()

    # Set up scheduler
    scheduler = AsyncIOScheduler()

    # Congressional scan — every 30 minutes during market hours
    scheduler.add_job(
        signal_engine.run_congressional_scan,
        "cron",
        day_of_week="mon-fri",
        hour="9-16",
        minute="*/30",
        timezone="US/Eastern",
        id="congressional_scan",
    )

    # Options flow scan — every 5 minutes during market hours
    scheduler.add_job(
        signal_engine.run_flow_scan,
        "cron",
        day_of_week="mon-fri",
        hour="9-16",
        minute="*/5",
        timezone="US/Eastern",
        id="flow_scan",
    )

    # Expire old signals — every 15 minutes
    scheduler.add_job(
        signal_engine.expire_old_signals,
        "interval",
        minutes=15,
        id="expire_signals",
    )

    # Position sync — every 60 seconds during market hours
    scheduler.add_job(
        executor.sync_positions,
        "cron",
        day_of_week="mon-fri",
        hour="9-16",
        second="0",
        timezone="US/Eastern",
        id="position_sync",
    )

    # Heartbeat — every 30 seconds
    async def send_heartbeat():
        db.table("bot_heartbeats").insert({"status": "healthy"}).execute()

    scheduler.add_job(send_heartbeat, "interval", seconds=30, id="heartbeat")

    # Approved signal execution loop — every 10 seconds
    async def execute_approved_signals():
        signals = await signal_engine.get_approved_signals()
        if not signals:
            return

        balance = await broker.get_account_balance()
        for signal in signals:
            order = build_order_from_signal(signal, balance.total_value)
            success = await executor.execute_signal(signal, order)
            if success:
                await signal_engine.mark_signal_executed(signal["id"])

    scheduler.add_job(
        execute_approved_signals, "interval", seconds=10, id="execute_signals"
    )

    scheduler.start()
    logger.info("Scheduler started with %d jobs", len(scheduler.get_jobs()))

    # Start WebSocket consumer for real-time flow alerts
    async def on_flow_alert(data: dict) -> None:
        await process_flow_alert(data, uw)

    ws_consumer = UWWebSocketConsumer(on_flow_alert)

    try:
        # Run WebSocket consumer (blocks until stopped)
        await ws_consumer.start()
    except KeyboardInterrupt:
        logger.info("Shutting down...")
    finally:
        await ws_consumer.stop()
        scheduler.shutdown()
        await broker.disconnect()
        await uw.close()
        db.table("bot_heartbeats").insert({
            "status": "error",
            "details": {"reason": "shutdown"},
        }).execute()
        logger.info("Bot stopped.")


if __name__ == "__main__":
    asyncio.run(main())
