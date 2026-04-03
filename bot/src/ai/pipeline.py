"""AI Signal Pipeline — connects Unusual Whales data to Claude analysis to trade signals.

This is the main orchestrator that:
1. Pulls raw data from Unusual Whales (every minute)
2. Runs Claude Haiku fast screening on each alert
3. Escalates promising signals to Claude Sonnet for deep analysis
4. Creates signals in Supabase with full AI reasoning
5. Handles the approval -> execution flow
"""

import logging
from datetime import datetime, timezone

from src.ai.analyst import ClaudeAnalyst
from src.db.supabase_client import get_supabase
from src.market_data.unusual_whales import UnusualWhalesClient

logger = logging.getLogger(__name__)

# Minimum Haiku score to escalate to Sonnet
HAIKU_THRESHOLD = 50

# Minimum Sonnet confidence to create a signal
SIGNAL_THRESHOLD = 65

# Premium floor — lower for individual stocks, higher for indexes
MIN_PREMIUM = 10_000

# Index ETFs to de-prioritize (noisy, mostly hedging)
INDEX_TICKERS = {"SPY", "QQQ", "IWM", "SPXW", "SPX", "DIA", "XSP"}
INDEX_MIN_PREMIUM = 50_000  # higher bar for indexes


class AIPipeline:
    """End-to-end AI signal generation pipeline."""

    def __init__(self, uw: UnusualWhalesClient, analyst: ClaudeAnalyst) -> None:
        self.uw = uw
        self.analyst = analyst
        self.db = get_supabase()

    def _log_activity(
        self,
        event_type: str,
        ticker: str | None = None,
        details: dict | None = None,
        ai_reasoning: str | None = None,
        confidence_score: float | None = None,
    ) -> None:
        """Log an event to the ai_activity table."""
        try:
            self.db.table("ai_activity").insert({
                "event_type": event_type,
                "ticker": ticker,
                "details": details or {},
                "ai_reasoning": ai_reasoning,
                "confidence_score": confidence_score,
            }).execute()
        except Exception:
            logger.warning("Failed to log activity: %s %s", event_type, ticker)

    async def run_flow_scan(self) -> int:
        """Pull latest flow alerts, screen with Haiku, analyze with Sonnet.

        Returns number of new signals created.
        """
        logger.info("Running AI flow scan...")

        # 1. Pull flow alerts from Unusual Whales
        alerts = await self.uw.get_flow_alerts()
        if not alerts:
            logger.info("No flow alerts returned")
            return 0

        # Filter by minimum premium — higher bar for index ETFs
        filtered = []
        for a in alerts:
            ticker = a.get("ticker", "")
            premium = float(a.get("total_premium", 0))
            if ticker in INDEX_TICKERS:
                if premium >= INDEX_MIN_PREMIUM:
                    filtered.append(a)
            else:
                if premium >= MIN_PREMIUM:
                    filtered.append(a)
        alerts = filtered
        logger.info("Processing %d flow alerts", len(alerts))
        self._log_activity("scan_started", details={"alert_count": len(alerts), "type": "flow"})

        new_signals = 0

        for alert in alerts:
            ticker = alert.get("ticker", "")
            if not ticker:
                continue

            # Deduplicate — skip if we already have a signal for this ticker today
            existing = (
                self.db.table("signals")
                .select("id")
                .eq("ticker", ticker)
                .eq("source", "flow")
                .gte("created_at", datetime.now(timezone.utc).strftime("%Y-%m-%dT00:00:00Z"))
                .execute()
            )
            if existing.data:
                continue

            # 2. Haiku fast screen
            screen = await self.analyst.screen_flow_alert(alert)

            if screen.get("error"):
                continue

            initial_score = screen.get("initial_score", 0)
            reasoning = screen.get("reasoning", "")

            screen_tokens = screen.pop("_token_usage", None)

            if not screen.get("pass_to_deep_analysis", False) or initial_score < HAIKU_THRESHOLD:
                self._log_activity(
                    "flow_rejected", ticker=ticker,
                    details={"premium": float(alert.get("total_premium", 0)), "haiku_score": initial_score, "token_usage": screen_tokens},
                    ai_reasoning=reasoning, confidence_score=initial_score,
                )
                continue

            self._log_activity(
                "flow_escalated", ticker=ticker,
                details={"premium": float(alert.get("total_premium", 0)), "haiku_score": initial_score, "token_usage": screen_tokens},
                ai_reasoning=f"Haiku escalated: {reasoning}", confidence_score=initial_score,
            )
            logger.info("ESCALATE %s — Haiku score %s, sending to Sonnet", ticker, initial_score)

            # 3. Gather supporting data for deep analysis
            congressional_data = await self._get_congressional_context(ticker)
            related_flow = await self._get_related_flow(ticker)

            # 4. Sonnet deep analysis
            analysis = await self.analyst.deep_analysis(
                primary_data=alert,
                congressional_data=congressional_data,
                related_flow=related_flow,
            )

            if analysis.get("error"):
                continue

            confidence = analysis.get("confidence_score", 0)
            if confidence < SIGNAL_THRESHOLD:
                logger.info("BELOW THRESHOLD %s — Sonnet confidence %s", ticker, confidence)
                continue

            # 5. Create signal in Supabase
            direction = analysis.get("direction", "bullish")
            rec = analysis.get("recommended_trade", {})

            # Auto-approve if in full_auto mode
            config_row = self.db.table("bot_config").select("value").eq("key", "bot_mode").execute()
            bot_mode = "manual_review"
            if config_row.data:
                bot_mode = str(config_row.data[0].get("value", "manual_review")).strip('"')

            signal_status = "pending"
            if bot_mode == "full_auto":
                signal_status = "approved"
            elif bot_mode == "semi_auto" and confidence >= 85:
                signal_status = "approved"

            signal_data = {
                "source": "flow",
                "status": signal_status,
                "ticker": ticker,
                "direction": direction,
                "confidence_score": confidence,
                "source_data": {
                    "flow_alert": alert,
                    "haiku_screen": screen,
                    "ai_analysis": analysis,
                },
                "scoring_factors": {
                    "haiku_initial": initial_score,
                    "sonnet_confidence": confidence,
                    "institutional_type": analysis.get("institutional_type", "unknown"),
                    "thesis": analysis.get("thesis", ""),
                },
                "suggested_action": rec.get("action", f"BUY {'CALL' if direction == 'bullish' else 'PUT'}"),
                "suggested_strike": self._parse_strike(rec.get("strike_selection"), alert),
                "suggested_expiry": self._calc_expiry(rec.get("target_expiry_dte", 30)),
                "suggested_quantity": None,  # risk manager will size this
            }

            self.db.table("signals").insert(signal_data).execute()
            new_signals += 1

            self._log_activity(
                "signal_created", ticker=ticker,
                details={
                    "direction": direction,
                    "action": rec.get("action", ""),
                    "institutional_type": analysis.get("institutional_type", "unknown"),
                },
                ai_reasoning=analysis.get("thesis", "") or analysis.get("reasoning", ""),
                confidence_score=confidence,
            )

            if signal_status == "approved":
                self._log_activity(
                    "signal_auto_approved", ticker=ticker,
                    details={"mode": bot_mode, "direction": direction},
                    ai_reasoning=f"Auto-approved in {bot_mode} mode (confidence {confidence})",
                    confidence_score=confidence,
                )

            logger.info(
                "SIGNAL %s: %s %s (confidence=%s, status=%s)",
                "AUTO-APPROVED" if signal_status == "approved" else "CREATED",
                ticker, direction, confidence, signal_status,
            )

        logger.info("AI flow scan complete: %d new signals from %d alerts", new_signals, len(alerts))
        return new_signals

    async def run_congressional_scan(self) -> int:
        """Pull congressional trades, analyze with Sonnet.

        Returns number of new signals created.
        """
        logger.info("Running AI congressional scan...")

        trades = await self.uw.get_congressional_trades()
        if not trades:
            logger.info("No congressional trades returned")
            return 0

        # Get watched reps from config
        config_row = (
            self.db.table("bot_config")
            .select("value")
            .eq("key", "watched_representatives")
            .execute()
        )
        watched_reps: list[str] = []
        if config_row.data:
            watched_reps = config_row.data[0].get("value", [])

        new_signals = 0

        for trade in trades:
            name = trade.get("name", trade.get("reporter", ""))

            # Filter for watched reps (empty list = watch all)
            if watched_reps and not any(rep.lower() in name.lower() for rep in watched_reps):
                continue

            ticker = trade.get("ticker", "")
            if not ticker:
                continue

            # Deduplicate
            existing = (
                self.db.table("signals")
                .select("id")
                .eq("ticker", ticker)
                .eq("source", "congressional")
                .gte("created_at", datetime.now(timezone.utc).strftime("%Y-%m-%dT00:00:00Z"))
                .execute()
            )
            if existing.data:
                continue

            # Get current flow data for this ticker
            current_flow = []
            try:
                current_flow = await self.uw.get_flow_alerts(ticker)
            except Exception:
                pass

            # Sonnet analysis (congressional trades go straight to deep analysis)
            analysis = await self.analyst.analyze_congressional_trade(
                trade_data=trade,
                current_flow=current_flow[:5],  # limit to 5 most recent
            )

            if analysis.get("error"):
                continue

            confidence = analysis.get("confidence_score", 0)
            if confidence < SIGNAL_THRESHOLD:
                logger.info("BELOW THRESHOLD %s by %s — confidence %s", ticker, name, confidence)
                continue

            if not analysis.get("trade_still_actionable", True):
                logger.info("NOT ACTIONABLE %s by %s — too stale", ticker, name)
                continue

            direction = analysis.get("direction", "bullish")
            txn_type = trade.get("txn_type", "").lower()
            if "sell" in txn_type:
                direction = "bearish"
            elif "buy" in txn_type or "purchase" in txn_type:
                direction = "bullish"

            rec = analysis.get("recommended_trade", {})

            signal_data = {
                "source": "congressional",
                "status": "pending",
                "ticker": ticker,
                "direction": direction,
                "confidence_score": confidence,
                "source_data": {
                    "congressional_trade": trade,
                    "ai_analysis": analysis,
                    "representative": name,
                    "transaction_type": trade.get("txn_type", ""),
                    "amount_range": trade.get("amounts", ""),
                    "filed_date": trade.get("filed_at_date", ""),
                },
                "scoring_factors": {
                    "sonnet_confidence": confidence,
                    "committee_relevance": analysis.get("committee_relevance", False),
                    "disclosure_delay_days": analysis.get("disclosure_delay_days", 0),
                    "thesis": analysis.get("thesis", ""),
                },
                "suggested_action": rec.get("action", f"BUY {'CALL' if direction == 'bullish' else 'PUT'}"),
                "suggested_expiry": self._calc_expiry(rec.get("target_expiry_dte", 45)),
            }

            self.db.table("signals").insert(signal_data).execute()
            new_signals += 1
            logger.info(
                "CONGRESSIONAL SIGNAL: %s %s by %s (confidence=%s)",
                ticker, direction, name, confidence,
            )

        logger.info("Congressional scan complete: %d new signals", new_signals)
        return new_signals

    async def _get_congressional_context(self, ticker: str) -> dict | None:
        """Check if any congressional trades exist for this ticker recently."""
        try:
            trades = await self.uw.get_congressional_trades()
            for t in trades:
                if t.get("ticker", "").upper() == ticker.upper():
                    return t
        except Exception:
            pass
        return None

    async def _get_related_flow(self, ticker: str) -> list[dict]:
        """Get other recent flow alerts for the same ticker."""
        try:
            flow = await self.uw.get_flow_alerts(ticker)
            return flow[:5]
        except Exception:
            return []

    def _parse_strike(self, strike_selection: str | None, alert: dict) -> float | None:
        """Parse strike from AI recommendation."""
        if not strike_selection:
            return float(alert.get("strike", 0)) or None
        if strike_selection == "ATM":
            return float(alert.get("underlying_price", 0)) or None
        try:
            return float(strike_selection)
        except (ValueError, TypeError):
            return float(alert.get("strike", 0)) or None

    def _calc_expiry(self, dte: int | None) -> str | None:
        """Calculate expiry date from DTE."""
        if not dte:
            dte = 30
        from datetime import timedelta
        target = datetime.now(timezone.utc).date() + timedelta(days=dte)
        # Round to next Friday
        days_to_friday = (4 - target.weekday()) % 7
        expiry = target + timedelta(days=days_to_friday)
        return expiry.isoformat()
