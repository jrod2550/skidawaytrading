"""Claude AI Signal Analyst — the brain of Skidaway Trading.

Uses a tiered approach:
  - Haiku: Fast screening of every flow alert (~$0.001 per call)
  - Sonnet: Deep analysis of promising signals (~$0.02 per call)
  - Opus: Weekly portfolio strategy review (~$0.10 per call)

Each tier acts as a senior institutional options flow analyst.
"""

import json
import logging
from typing import Literal

import httpx

from src.config import settings

logger = logging.getLogger(__name__)

HAIKU = "claude-haiku-4-5-20251001"
SONNET = "claude-sonnet-4-5-20250514"

SYSTEM_PROMPT = """You are a senior quantitative options flow analyst at Skidaway Trading, an institutional-style options fund.

ANALYTICAL FRAMEWORK:
1. FLOW CLASSIFICATION — Distinguish institutional from retail. Key signals:
   - Volume/OI ratio: V/OI > 3x = new positioning (not rolling). V/OI > 10x = extremely unusual.
   - Sweep orders: Buyer lifting offers across exchanges = urgency = conviction.
   - Block trades: Single large prints, often negotiated = institutional.
   - Premium size: $100k+ on single-name = likely institutional. $500k+ = whale.
   - Strike selection: Deep OTM = lottery/cheap hedge. ATM/slightly OTM = directional conviction.
   - Expiry: < 7 DTE = gamma play/event trade. 30-90 DTE = thesis trade. > 90 DTE = LEAPS/accumulation.

2. DIRECTIONAL vs HEDGE — Most large index put buying is portfolio insurance, NOT bearish conviction.
   Hedges: puts on SPY/QQQ alongside long equity. Directional: single-name conviction bets.

3. DARK POOL SIGNALS — Large dark pool prints at or above ask = accumulation (bullish).
   Prints below bid = distribution (bearish). Cross-reference with options flow direction.

4. GREEK EXPOSURE (GEX) — Positive GEX = dealers hedged long gamma = market pinning.
   Negative GEX = dealers short gamma = amplified moves. Key for timing entries.

5. NOPE (Net Options Pricing Effect) — Delta-adjusted net flow. Extreme readings (> 2 or < -2)
   often precede mean reversion. Use as a contrarian timing signal.

6. CONGRESSIONAL TRADES — 30-45 day filing delay. Trades filed today happened weeks ago.
   Committee relevance matters: a senator on Banking Committee buying bank stocks is different
   from a random representative.

7. INSIDER TRANSACTIONS — C-suite cluster buying is the strongest insider signal.
   Single insider sells are noise (executives sell for tax/diversification).

RISK MANAGEMENT PRINCIPLES:
- Position sizing: Never recommend more than 5% of portfolio on a single trade
- Preferred strategies: defined-risk (spreads, verticals) over naked options
- Stop-loss: Always include a stop-loss recommendation (-30% default)
- Take-profit: Scale out at milestones (50%, 100%)
- IV consideration: Don't buy premium when IV rank > 80 (sell premium instead)
- Earnings: Flag if trade crosses an earnings date

CONFIDENCE CALIBRATION:
- 90-100: Would bet your career. Multiple confirming signals, institutional flow + insider + dark pool alignment. Extremely rare.
- 75-89: Strong conviction. Clear institutional flow with supporting data. Maybe 1-2 per week.
- 65-74: Moderate conviction. Interesting setup but some ambiguity. Worth a small position.
- 50-64: Marginal. Single data point, no confirmation. Screen pass but likely not tradeable.
- Below 50: Noise. Retail flow, hedging, or insufficient data.

Always respond in valid JSON format."""

SCREEN_PROMPT = """Analyze this options flow alert. Respond ONLY with a short JSON object, no explanation outside the JSON.

Flow Data:
{flow_data}

JSON format (keep reasoning under 30 words):
{{"pass_to_deep_analysis":true/false,"initial_score":0-100,"reasoning":"brief","is_institutional":true/false,"is_hedge":true/false,"ticker":"SYM","direction":"bullish"/"bearish"}}"""

DEEP_ANALYSIS_PROMPT = """Perform deep institutional-grade analysis on this trading signal using ALL available data.

PRIMARY FLOW SIGNAL:
{primary_data}

SUPPORTING CONGRESSIONAL / INSIDER DATA:
{congressional_data}

RELATED OPTIONS FLOW ON SAME TICKER (recent):
{related_flow}

DARK POOL ACTIVITY ON THIS TICKER:
{dark_pool_data}

GREEK EXPOSURE (GEX), VOLATILITY & EARNINGS:
{greeks_vol_data}
(Note: If "upcoming_earnings" is present above, it contains this ticker's next earnings dates. Factor this into your analysis — IV typically expands 5-10 days before earnings and crushes immediately after.)

MARKET-WIDE CONTEXT (tide, top movers, economic calendar):
{market_context}
(Note: If "economic_calendar" is present above, these are upcoming macro events. FOMC, CPI, NFP, and GDP are HIGH IMPACT — they can move the entire market and spike/crush IV across all tickers.)

ANALYSIS REQUIREMENTS:
1. Cross-reference flow direction with dark pool activity. Alignment = higher conviction.
2. Check GEX positioning — is the market/stock in positive or negative gamma territory?
3. Evaluate IV rank — is premium expensive or cheap? Should we buy or sell premium?
4. CHECK ECONOMIC CALENDAR — flag FOMC, CPI, PPI, jobs, GDP. If a macro event is within 3 days, note the risk of holding through it. Major events can crush or spike IV.
5. CHECK EARNINGS — if the ticker has earnings within 14 days, flag it. Pre-earnings IV expansion can help or hurt depending on entry timing. Post-earnings IV crush is real.
6. Consider the current market tide — is this trade with or against the macro flow?

Respond in JSON:
{{
  "confidence_score": 0-100,
  "direction": "bullish" or "bearish",
  "thesis": "2-3 sentence institutional thesis with specific data points",
  "is_institutional": true/false,
  "institutional_type": "accumulation" | "conviction_bet" | "event_play" | "sector_rotation" | "hedge" | "unknown",
  "flow_quality": "whale" | "institutional" | "mixed" | "retail",
  "dark_pool_alignment": true/false/null,
  "gex_context": "positive_gamma" | "negative_gamma" | "neutral" | "unknown",
  "iv_assessment": "cheap" | "fair" | "expensive",
  "risk_factors": ["specific", "data-backed", "risks"],
  "recommended_trade": {{
    "action": "BUY CALL" | "BUY PUT" | "SELL PUT" | "BULL CALL SPREAD" | "BEAR PUT SPREAD" | "IRON CONDOR",
    "strike_selection": "ATM" or "5% OTM" or specific number,
    "target_expiry_dte": 30,
    "position_size_pct": 2.0,
    "entry_urgency": "immediate" | "wait_for_pullback" | "scale_in",
    "stop_loss_pct": -30,
    "take_profit_targets": [50, 100],
    "max_risk_dollars": null
  }},
  "reasoning": "Detailed 4-6 sentence analysis referencing specific data: flow premium, V/OI, dark pool prints, GEX, IV rank. Explain WHY the data supports or contradicts the trade."
}}"""

CONGRESSIONAL_PROMPT = """Analyze this congressional trade disclosure for trading opportunities.

Congressional Trade:
{trade_data}

Historical Performance of This Representative:
{rep_history}

Current Options Flow on {ticker}:
{current_flow}

Respond in JSON:
{{
  "confidence_score": 0-100,
  "direction": "bullish" or "bearish",
  "thesis": "2-3 sentence thesis based on congressional insider activity",
  "committee_relevance": true/false,
  "disclosure_delay_days": number,
  "trade_still_actionable": true/false,
  "reasoning": "Why this congressional trade matters or doesn't",
  "recommended_trade": {{
    "action": "BUY CALL" or "BUY PUT",
    "strike_selection": "ATM" or "5% OTM",
    "target_expiry_dte": 45,
    "position_size_pct": 2.0
  }}
}}"""


class ClaudeAnalyst:
    """AI analyst that processes market data through Claude."""

    # Cost per token (Anthropic pricing)
    TOKEN_COSTS = {
        HAIKU: {"input": 0.80 / 1_000_000, "output": 4.00 / 1_000_000},
        SONNET: {"input": 3.00 / 1_000_000, "output": 15.00 / 1_000_000},
    }

    def __init__(self) -> None:
        self._client = httpx.AsyncClient(
            base_url="https://api.anthropic.com",
            headers={
                "x-api-key": settings.anthropic_api_key,
                "anthropic-version": "2023-06-01",
                "content-type": "application/json",
            },
            timeout=30.0,
        )
        # Running token/cost totals for this session
        self.session_tokens = {"input": 0, "output": 0}
        self.session_cost = 0.0

    async def close(self) -> None:
        await self._client.aclose()

    async def _call(
        self,
        prompt: str,
        model: str = HAIKU,
        max_tokens: int = 1024,
    ) -> dict:
        """Call Claude API and parse JSON response. Includes _token_usage in result."""
        import re

        try:
            resp = await self._client.post(
                "/v1/messages",
                json={
                    "model": model,
                    "max_tokens": max_tokens,
                    "system": SYSTEM_PROMPT,
                    "messages": [{"role": "user", "content": prompt}],
                },
            )
            resp.raise_for_status()
            data = resp.json()

            # Track token usage
            usage = data.get("usage", {})
            input_tokens = usage.get("input_tokens", 0)
            output_tokens = usage.get("output_tokens", 0)
            costs = self.TOKEN_COSTS.get(model, self.TOKEN_COSTS[HAIKU])
            call_cost = input_tokens * costs["input"] + output_tokens * costs["output"]

            self.session_tokens["input"] += input_tokens
            self.session_tokens["output"] += output_tokens
            self.session_cost += call_cost

            token_usage = {
                "model": model,
                "input_tokens": input_tokens,
                "output_tokens": output_tokens,
                "total_tokens": input_tokens + output_tokens,
                "cost_usd": round(call_cost, 6),
                "session_cost_usd": round(self.session_cost, 4),
            }

            text = data["content"][0]["text"]

            # Try multiple JSON extraction strategies
            # Strategy 1: code blocks
            if "```json" in text:
                text = text.split("```json")[1].split("```")[0]
            elif "```" in text:
                text = text.split("```")[1].split("```")[0]

            # Strategy 2: find first { to last }
            start = text.find("{")
            end = text.rfind("}")
            if start != -1 and end != -1:
                text = text[start : end + 1]

            try:
                result = json.loads(text.strip())
                result["_token_usage"] = token_usage
                return result
            except json.JSONDecodeError:
                # Strategy 3: regex extract key fields from malformed JSON
                score_match = re.search(r'"initial_score"\s*:\s*(\d+)', text)
                pass_match = re.search(r'"pass_to_deep_analysis"\s*:\s*(true|false)', text, re.I)
                dir_match = re.search(r'"direction"\s*:\s*"(bullish|bearish)"', text)
                ticker_match = re.search(r'"ticker"\s*:\s*"([A-Z.]+)"', text)
                inst_match = re.search(r'"is_institutional"\s*:\s*(true|false)', text, re.I)
                hedge_match = re.search(r'"is_hedge"\s*:\s*(true|false)', text, re.I)
                conf_match = re.search(r'"confidence_score"\s*:\s*(\d+)', text)

                result = {}
                if score_match:
                    result["initial_score"] = int(score_match.group(1))
                if pass_match:
                    result["pass_to_deep_analysis"] = pass_match.group(1).lower() == "true"
                if dir_match:
                    result["direction"] = dir_match.group(1)
                if ticker_match:
                    result["ticker"] = ticker_match.group(1)
                if inst_match:
                    result["is_institutional"] = inst_match.group(1).lower() == "true"
                if hedge_match:
                    result["is_hedge"] = hedge_match.group(1).lower() == "true"
                if conf_match:
                    result["confidence_score"] = int(conf_match.group(1))

                if result:
                    result["_token_usage"] = token_usage
                    logger.debug("Recovered partial JSON for %s", result.get("ticker", "?"))
                    return result

                logger.error("Could not parse Claude response: %s", text[:200])
                return {"error": "JSON parse failed", "confidence_score": 0, "_token_usage": token_usage}

        except httpx.HTTPStatusError as e:
            logger.error("Claude API error %d: %s", e.response.status_code, e.response.text)
            return {"error": str(e), "confidence_score": 0}
        except Exception as e:
            logger.exception("Unexpected error calling Claude")
            return {"error": str(e), "confidence_score": 0}

    async def screen_flow_alert(self, flow_data: dict) -> dict:
        """Fast screen a flow alert with Haiku.

        Returns screening result with pass/fail and initial score.
        Cost: ~$0.001 per call.
        """
        prompt = SCREEN_PROMPT.format(flow_data=json.dumps(flow_data, indent=2))
        result = await self._call(prompt, model=HAIKU, max_tokens=512)
        logger.info(
            "HAIKU screen: %s — score=%s, pass=%s",
            flow_data.get("ticker", "?"),
            result.get("initial_score", "?"),
            result.get("pass_to_deep_analysis", False),
        )
        return result

    async def deep_analysis(
        self,
        primary_data: dict,
        congressional_data: dict | None = None,
        related_flow: list[dict] | None = None,
        dark_pool_data: list[dict] | None = None,
        greeks_vol_data: dict | None = None,
        market_context: dict | None = None,
    ) -> dict:
        """Deep institutional analysis with Sonnet using all available data.

        Returns full analysis with confidence score, thesis, and trade recommendation.
        Cost: ~$0.03 per call.
        """
        prompt = DEEP_ANALYSIS_PROMPT.format(
            primary_data=json.dumps(primary_data, indent=2),
            congressional_data=json.dumps(congressional_data or {}, indent=2),
            related_flow=json.dumps(related_flow or [], indent=2),
            dark_pool_data=json.dumps(dark_pool_data or [], indent=2),
            greeks_vol_data=json.dumps(greeks_vol_data or {}, indent=2),
            market_context=json.dumps(market_context or {}, indent=2),
        )
        result = await self._call(prompt, model=SONNET, max_tokens=2048)
        logger.info(
            "SONNET analysis: %s — confidence=%s, direction=%s",
            primary_data.get("ticker", "?"),
            result.get("confidence_score", "?"),
            result.get("direction", "?"),
        )
        return result

    async def analyze_congressional_trade(
        self,
        trade_data: dict,
        rep_history: dict | None = None,
        current_flow: list[dict] | None = None,
    ) -> dict:
        """Analyze a congressional trade disclosure with Sonnet.

        Returns analysis with confidence, thesis, and actionability.
        """
        ticker = trade_data.get("ticker", "UNKNOWN")
        prompt = CONGRESSIONAL_PROMPT.format(
            trade_data=json.dumps(trade_data, indent=2),
            rep_history=json.dumps(rep_history or {}, indent=2),
            ticker=ticker,
            current_flow=json.dumps(current_flow or [], indent=2),
        )
        result = await self._call(prompt, model=SONNET, max_tokens=1536)
        logger.info(
            "SONNET congressional: %s by %s — confidence=%s, actionable=%s",
            ticker,
            trade_data.get("name", "?"),
            result.get("confidence_score", "?"),
            result.get("trade_still_actionable", "?"),
        )
        return result
