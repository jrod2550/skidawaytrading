"""Skidaway Trading Bot — Main entry point.

AI-powered signal scanning with Claude, scheduled data ingestion from
Unusual Whales, and automated trade execution on IBKR.
"""

import asyncio
import logging
from datetime import datetime, timezone

from apscheduler.schedulers.asyncio import AsyncIOScheduler

from src.ai.analyst import ClaudeAnalyst
from src.ai.pipeline import AIPipeline
from src.broker.paper import PaperBroker
from src.config import settings
from src.db.supabase_client import get_supabase
from src.execution.executor import TradeExecutor
from src.execution.order_builder import build_order_from_signal
from src.market_data.unusual_whales import UnusualWhalesClient
from src.risk.manager import RiskManager
from src.signals.engine import SignalEngine

logging.basicConfig(
    level=getattr(logging, settings.log_level),
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("skidaway")


async def main() -> None:
    logger.info("=" * 60)
    logger.info("  SKIDAWAY TRADING BOT — Starting up...")
    logger.info("  Mode: %s", settings.bot_mode)
    logger.info("=" * 60)

    # Initialize components
    uw = UnusualWhalesClient()
    analyst = ClaudeAnalyst()
    ai_pipeline = AIPipeline(uw, analyst)
    signal_engine = SignalEngine(uw)  # kept for signal lifecycle management

    # Connect to IBKR paper trading via TWS Gateway
    from src.broker.ibkr import IBKRBroker
    broker = IBKRBroker()
    await broker.connect()

    risk_manager = RiskManager(broker)
    executor = TradeExecutor(broker, risk_manager)

    # Send initial heartbeat
    db = get_supabase()
    db.table("bot_heartbeats").insert({
        "status": "healthy",
        "details": {
            "started_at": datetime.now(timezone.utc).isoformat(),
            "mode": settings.bot_mode,
            "broker": "ibkr_paper",
        },
    }).execute()

    # Set up scheduler
    scheduler = AsyncIOScheduler()

    # ── AI Flow Scan — every 1 minute during market hours ──
    scheduler.add_job(
        ai_pipeline.run_flow_scan,
        "cron",
        day_of_week="mon-fri",
        hour="9-16",
        minute="*",
        timezone="US/Eastern",
        id="ai_flow_scan",
        max_instances=1,
        misfire_grace_time=30,
    )

    # ── AI Congressional Scan — every 15 minutes during market hours ──
    scheduler.add_job(
        ai_pipeline.run_congressional_scan,
        "cron",
        day_of_week="mon-fri",
        hour="9-16",
        minute="*/15",
        timezone="US/Eastern",
        id="ai_congressional_scan",
        max_instances=1,
        misfire_grace_time=60,
    )

    # ── Expire old signals — every 15 minutes ──
    scheduler.add_job(
        signal_engine.expire_old_signals,
        "interval",
        minutes=15,
        id="expire_signals",
    )

    # ── Position sync — every 60 seconds during market hours ──
    scheduler.add_job(
        executor.sync_positions,
        "cron",
        day_of_week="mon-fri",
        hour="9-16",
        second="0",
        timezone="US/Eastern",
        id="position_sync",
    )

    # ── Heartbeat — every 30 seconds ──
    async def send_heartbeat():
        db.table("bot_heartbeats").insert({"status": "healthy"}).execute()

    scheduler.add_job(send_heartbeat, "interval", seconds=30, id="heartbeat")

    # ── Execute approved signals — every 10 seconds ──
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
    logger.info("Scheduler started with %d jobs:", len(scheduler.get_jobs()))
    for job in scheduler.get_jobs():
        logger.info("  - %s: %s", job.id, job.trigger)

    logger.info("")
    logger.info("Bot is running. Ctrl+C to stop.")
    logger.info("AI Flow Scan: every 1 minute (Haiku screen -> Sonnet deep analysis)")
    logger.info("Congressional Scan: every 15 minutes (Sonnet analysis)")
    logger.info("Signal Execution: every 10 seconds (approved signals -> paper trades)")

    try:
        # Keep the bot running
        while True:
            await asyncio.sleep(1)
    except KeyboardInterrupt:
        logger.info("Shutting down...")
    finally:
        scheduler.shutdown()
        await broker.disconnect()
        await analyst.close()
        await uw.close()
        db.table("bot_heartbeats").insert({
            "status": "error",
            "details": {"reason": "shutdown"},
        }).execute()
        logger.info("Bot stopped.")


if __name__ == "__main__":
    asyncio.run(main())
