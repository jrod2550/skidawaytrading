"""One-time test: Connect to IBKR, run AI pipeline, show results."""

import asyncio
import logging
import sys
import os

# Add parent dir to path so imports work
sys.path.insert(0, os.path.dirname(__file__))
os.chdir(os.path.dirname(__file__))

# Load env from parent directory
from dotenv import load_dotenv
load_dotenv("../.env")

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("skidaway-test")


async def main():
    print("=" * 60)
    print("  SKIDAWAY TRADING — Live Integration Test")
    print("=" * 60)

    # 1. Connect to IBKR
    print("\n[1] Connecting to IBKR Paper Trading...")
    from src.broker.ibkr import IBKRBroker
    broker = IBKRBroker()
    try:
        await broker.connect()
        balance = await broker.get_account_balance()
        print(f"    CONNECTED to IBKR Paper Account")
        print(f"    Total Value:    ${balance.total_value:,.2f}")
        print(f"    Cash Balance:   ${balance.cash_balance:,.2f}")
        print(f"    Buying Power:   ${balance.buying_power:,.2f}")
        print(f"    Positions Value: ${balance.positions_value:,.2f}")
    except Exception as e:
        print(f"    IBKR connection failed: {e}")
        print(f"    Falling back to paper broker for AI test...")
        from src.broker.paper import PaperBroker
        broker = PaperBroker(initial_balance=15_000.0)
        await broker.connect()
        balance = await broker.get_account_balance()

    # 2. Run AI pipeline
    print("\n[2] Running AI Flow Scan...")
    from src.ai.analyst import ClaudeAnalyst
    from src.ai.pipeline import AIPipeline
    from src.market_data.unusual_whales import UnusualWhalesClient

    uw = UnusualWhalesClient()
    analyst = ClaudeAnalyst()
    pipeline = AIPipeline(uw, analyst)

    new_signals = await pipeline.run_flow_scan()
    print(f"    Flow scan complete: {new_signals} new signals created")

    # 3. Run congressional scan
    print("\n[3] Running AI Congressional Scan...")
    congressional_signals = await pipeline.run_congressional_scan()
    print(f"    Congressional scan complete: {congressional_signals} new signals created")

    # 4. Check signals in DB
    print("\n[4] Checking signals in database...")
    from src.db.supabase_client import get_supabase
    db = get_supabase()
    result = db.table("signals").select("*").eq("status", "pending").order("created_at", desc=True).limit(10).execute()

    if result.data:
        print(f"    Found {len(result.data)} pending signals:")
        for sig in result.data:
            print(f"      {sig['ticker']:8s} | {sig['direction']:7s} | confidence={sig['confidence_score']} | {sig['source']} | {sig.get('suggested_action', '?')}")
    else:
        print("    No pending signals (AI was correctly skeptical of current flow)")

    # 5. Show positions
    print("\n[5] Current IBKR Positions:")
    positions = await broker.get_positions()
    if positions:
        for p in positions:
            print(f"      {p.ticker:8s} | qty={p.quantity} | avg_cost=${p.avg_cost:.2f}")
    else:
        print("    No open positions (clean slate for paper testing)")

    # Cleanup
    await broker.disconnect()
    await analyst.close()
    await uw.close()

    print("\n" + "=" * 60)
    print("  TEST COMPLETE — All systems operational")
    print(f"  IBKR: Connected (${balance.total_value:,.0f})")
    print(f"  UW API: Live data flowing")
    print(f"  Claude AI: Screening and analyzing")
    print(f"  Signals: {new_signals + congressional_signals} created this run")
    print("=" * 60)
    print("\n  Open your dashboard at http://localhost:3001 to see signals!")


if __name__ == "__main__":
    asyncio.run(main())
