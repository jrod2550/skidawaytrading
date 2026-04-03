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
SONNET = "claude-sonnet-4-6-20250514"

SYSTEM_PROMPT = """You are a senior institutional options flow analyst at a quantitative hedge fund.
You analyze raw market data — options flow, congressional trades, dark pool prints, and prediction
markets — to identify high-conviction trading opportunities.

Your job is to determine:
1. Is this INSTITUTIONAL positioning or retail noise?
2. Is this a DIRECTIONAL bet or a HEDGE?
3. What is the probable THESIS behind this activity?
4. How CONFIDENT are you (0-100)?
5. What specific OPTIONS TRADE would you recommend?

You think in terms of:
- Smart money vs dumb money flow patterns
- Unusual premium relative to open interest and volume
- Sweep urgency (how aggressively the order was filled)
- Congressional insider knowledge and committee relevance
- Dark pool accumulation patterns
- Cross-referencing multiple signals on the same ticker

Be brutally honest about confidence. A 90+ score means you would bet your own money.
Most signals should score 30-60 (noise). Only exceptional setups score 70+.

Always respond in valid JSON format."""

SCREEN_PROMPT = """Analyze this options flow alert and determine if it warrants deeper analysis.

Flow Alert Data:
{flow_data}

Respond in JSON:
{{
  "pass_to_deep_analysis": true/false,
  "initial_score": 0-100,
  "reasoning": "1-2 sentence explanation",
  "is_institutional": true/false,
  "is_hedge": true/false,
  "ticker": "SYMBOL",
  "direction": "bullish" or "bearish"
}}"""

DEEP_ANALYSIS_PROMPT = """Perform deep institutional analysis on this trading signal.

Primary Signal:
{primary_data}

Supporting Congressional Data (if any):
{congressional_data}

Recent Flow on Same Ticker:
{related_flow}

Current Market Context:
{market_context}

Respond in JSON:
{{
  "confidence_score": 0-100,
  "direction": "bullish" or "bearish",
  "thesis": "2-3 sentence institutional thesis",
  "is_institutional": true,
  "institutional_type": "accumulation" | "conviction_bet" | "event_play" | "sector_rotation" | "unknown",
  "risk_factors": ["list", "of", "risks"],
  "recommended_trade": {{
    "action": "BUY CALL" or "BUY PUT" or "BULL SPREAD" or "BEAR SPREAD",
    "strike_selection": "ATM" or "5% OTM" or "10% OTM" or specific number,
    "target_expiry_dte": 30,
    "position_size_pct": 2.0,
    "entry_urgency": "immediate" or "wait_for_pullback" or "scale_in",
    "stop_loss_pct": -30,
    "take_profit_pct": 100
  }},
  "reasoning": "Detailed 3-5 sentence analysis of why this is or isn't a good trade"
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

    async def close(self) -> None:
        await self._client.aclose()

    async def _call(
        self,
        prompt: str,
        model: str = HAIKU,
        max_tokens: int = 1024,
    ) -> dict:
        """Call Claude API and parse JSON response."""
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

            # Extract text content
            text = data["content"][0]["text"]

            # Parse JSON from response (handle markdown code blocks)
            if "```json" in text:
                text = text.split("```json")[1].split("```")[0]
            elif "```" in text:
                text = text.split("```")[1].split("```")[0]

            return json.loads(text.strip())

        except httpx.HTTPStatusError as e:
            logger.error("Claude API error %d: %s", e.response.status_code, e.response.text)
            return {"error": str(e), "confidence_score": 0}
        except json.JSONDecodeError as e:
            logger.error("Failed to parse Claude response as JSON: %s", e)
            return {"error": "JSON parse failed", "confidence_score": 0}
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
        market_context: dict | None = None,
    ) -> dict:
        """Deep institutional analysis with Sonnet.

        Returns full analysis with confidence score, thesis, and trade recommendation.
        Cost: ~$0.02 per call.
        """
        prompt = DEEP_ANALYSIS_PROMPT.format(
            primary_data=json.dumps(primary_data, indent=2),
            congressional_data=json.dumps(congressional_data or {}, indent=2),
            related_flow=json.dumps(related_flow or [], indent=2),
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
