"""Multi-factor signal scoring engine.

Composite score (0-100) from four weighted factors:
  - Congressional: 35% — rep track record, trade size, timeliness, committee relevance
  - Options Flow:  25% — premium, sweep vs block, OI change, repeat flow
  - Polymarket:    20% — probability alignment, whale activity, trend
  - Technical:     20% — relative volume, price trend, sector momentum
"""

import logging

logger = logging.getLogger(__name__)

DEFAULT_WEIGHTS = {
    "congressional": 0.35,
    "flow": 0.25,
    "polymarket": 0.20,
    "technical": 0.20,
}

# Known representatives with historically strong track records
HIGH_TRACK_RECORD_REPS = {
    "Pelosi", "Tuberville", "Crenshaw", "Ossoff",
}


def score_congressional(trade: dict) -> float:
    """Score a congressional trade signal (0-100)."""
    score = 0.0

    # Representative track record (0-30)
    rep = trade.get("representative", "")
    if rep in HIGH_TRACK_RECORD_REPS:
        score += 30
    else:
        score += 10  # baseline for any congressional trade

    # Trade size (0-20)
    amount = trade.get("amount", "").lower()
    if "5m" in amount or "5,000,000" in amount:
        score += 20
    elif "1m" in amount or "1,000,000" in amount:
        score += 15
    elif "500k" in amount or "500,000" in amount:
        score += 10
    else:
        score += 5

    # Timeliness — days between transaction and disclosure (0-20)
    days_delay = trade.get("disclosure_delay_days", 45)
    if days_delay <= 5:
        score += 20
    elif days_delay <= 15:
        score += 15
    elif days_delay <= 30:
        score += 10
    else:
        score += 5

    # Committee relevance (0-15)
    committees = trade.get("committees", [])
    relevant = {"Finance", "Commerce", "Energy", "Armed Services", "Banking"}
    if any(c in relevant for c in committees):
        score += 15
    else:
        score += 5

    # Bipartisan signal (0-15)
    if trade.get("bipartisan", False):
        score += 15

    return min(score, 100.0)


def score_flow(alert: dict) -> float:
    """Score an unusual options flow alert (0-100)."""
    score = 0.0

    # Premium size (0-25)
    premium = alert.get("premium", 0)
    if premium >= 1_000_000:
        score += 25
    elif premium >= 500_000:
        score += 20
    elif premium >= 100_000:
        score += 15
    elif premium >= 50_000:
        score += 10
    else:
        score += 5

    # Sweep vs block (0-20)
    flow_type = alert.get("type", "").lower()
    if flow_type == "sweep":
        score += 20
    elif flow_type == "block":
        score += 15
    else:
        score += 5

    # OI change (0-20)
    oi_change = alert.get("oi_change", 0)
    if oi_change > 5000:
        score += 20
    elif oi_change > 1000:
        score += 15
    elif oi_change > 500:
        score += 10
    else:
        score += 5

    # Expiry timing (0-15)
    dte = alert.get("dte", 30)
    if 14 <= dte <= 60:
        score += 15
    elif 7 <= dte <= 90:
        score += 10
    else:
        score += 5

    # Repeat flow (0-20)
    repeat_count = alert.get("repeat_count", 0)
    if repeat_count >= 3:
        score += 20
    elif repeat_count >= 1:
        score += 10

    return min(score, 100.0)


def score_polymarket(prediction: dict) -> float:
    """Score polymarket/prediction alignment (0-100)."""
    score = 0.0

    # Probability alignment (0-30)
    probability = prediction.get("probability", 0.5)
    if probability >= 0.8:
        score += 30
    elif probability >= 0.65:
        score += 20
    elif probability >= 0.5:
        score += 10

    # Whale activity alignment (0-30)
    whale_activity = prediction.get("whale_activity", "neutral")
    if whale_activity == "aligned":
        score += 30
    elif whale_activity == "neutral":
        score += 10

    # Liquidity (0-20)
    liquidity = prediction.get("liquidity", 0)
    if liquidity >= 100_000:
        score += 20
    elif liquidity >= 50_000:
        score += 15
    else:
        score += 5

    # Trend (0-20)
    trend = prediction.get("trend", "flat")
    if trend == "aligned":
        score += 20
    elif trend == "flat":
        score += 10

    return min(score, 100.0)


def score_technical(data: dict) -> float:
    """Score technical indicators (0-100)."""
    score = 0.0

    # Relative volume (0-25)
    rel_vol = data.get("relative_volume", 1.0)
    if rel_vol >= 3.0:
        score += 25
    elif rel_vol >= 2.0:
        score += 20
    elif rel_vol >= 1.5:
        score += 15
    else:
        score += 5

    # Price trend alignment (0-25)
    trend_aligned = data.get("trend_aligned", False)
    score += 25 if trend_aligned else 5

    # Sector momentum (0-25)
    sector_momentum = data.get("sector_momentum", "neutral")
    if sector_momentum == "strong":
        score += 25
    elif sector_momentum == "moderate":
        score += 15
    else:
        score += 5

    # Earnings proximity (0-25)
    days_to_earnings = data.get("days_to_earnings", 999)
    if days_to_earnings <= 3:
        score += 5  # risky, score low unless thesis is earnings play
    elif days_to_earnings <= 14:
        score += 15
    else:
        score += 25

    return min(score, 100.0)


def compute_composite_score(
    congressional_data: dict | None = None,
    flow_data: dict | None = None,
    polymarket_data: dict | None = None,
    technical_data: dict | None = None,
    weights: dict[str, float] | None = None,
) -> tuple[float, dict[str, float]]:
    """Compute composite confidence score.

    Returns:
        (composite_score, scoring_breakdown)
    """
    w = weights or DEFAULT_WEIGHTS
    factors: dict[str, float] = {}

    if congressional_data:
        factors["congressional"] = score_congressional(congressional_data)
    if flow_data:
        factors["flow"] = score_flow(flow_data)
    if polymarket_data:
        factors["polymarket"] = score_polymarket(polymarket_data)
    if technical_data:
        factors["technical"] = score_technical(technical_data)

    if not factors:
        return 0.0, {}

    # Normalize weights to only count present factors
    active_weights = {k: w.get(k, 0) for k in factors}
    total_weight = sum(active_weights.values())
    if total_weight == 0:
        return 0.0, factors

    composite = sum(
        factors[k] * (active_weights[k] / total_weight) for k in factors
    )

    return round(composite, 2), factors
