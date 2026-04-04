# Skidaway Trading — AI Agent Architecture

A complete guide to how the AI agents analyze markets and execute trades.

---

## System Overview

```
┌──────────────────────────────────────────────────────────────────────┐
│                    UNUSUAL WHALES API (25+ endpoints)                │
│  Flow Alerts · Dark Pool · GEX · NOPE · IV · Congress · Insiders   │
└───────────────────────────────┬──────────────────────────────────────┘
                                │
                    ┌───────────▼───────────┐
                    │   TIER 1: HAIKU       │  Every 60 seconds
                    │   Fast Screen         │  Cost: ~$0.001/call
                    │   Score 0-100         │  ~390 calls/day
                    │                       │
                    │   Filters: premium,   │
                    │   institutional vs    │
                    │   retail, hedge vs    │
                    │   directional         │
                    └───────────┬───────────┘
                                │ Score >= 50 ESCALATE
                                │ (~5-15 per day)
                    ┌───────────▼───────────┐
                    │  INTEL GATHERING      │  Per escalated signal
                    │                       │
                    │  • Related flow (8)   │  7 API calls to
                    │  • Dark pool (5)      │  Unusual Whales
                    │  • GEX/gamma exposure │
                    │  • IV rank + vol stats│
                    │  • Market tide        │
                    │  • Congressional data  │
                    │  • Insider txns       │
                    └───────────┬───────────┘
                                │
                    ┌───────────▼───────────┐
                    │   TIER 2: SONNET      │  Deep analysis
                    │   Full Analysis       │  Cost: ~$0.03/call
                    │                       │  ~5-15 calls/day
                    │   Outputs:            │
                    │   • Confidence 0-100  │
                    │   • Thesis            │
                    │   • Direction         │
                    │   • Trade rec         │
                    │   • Risk factors      │
                    │   • GEX/IV/DP context │
                    └───────────┬───────────┘
                                │ Confidence >= 65 CREATE SIGNAL
                                │
                    ┌───────────▼───────────┐
                    │   RISK MANAGER        │  Final gate
                    │                       │
                    │   ✓ Excluded tickers  │
                    │   ✓ Confidence >= 70  │
                    │   ✓ Max positions     │
                    │   ✓ Position size %   │
                    │   ✓ Daily loss limit  │
                    │   ✓ Portfolio delta   │
                    │   ✓ Bot not paused    │
                    └───────────┬───────────┘
                                │ ALL CHECKS PASS
                    ┌───────────▼───────────┐
                    │   IBKR EXECUTION      │  Paper account
                    │   DU8395165           │  Port 4002
                    └───────────────────────┘
```

---

## Agent 1: The Screener (Claude Haiku)

**File:** `bot/src/ai/analyst.py` → `screen_flow_alert()`
**Model:** `claude-haiku-4-5`
**Cost:** ~$0.001 per call
**Frequency:** Every flow alert, every 60 seconds during market hours

### What It Receives

Raw flow alert from Unusual Whales:
```json
{
  "ticker": "NVDA",
  "total_premium": 450000,
  "volume": 5200,
  "open_interest": 1800,
  "strike": 130,
  "put_call": "call",
  "expires": "2026-05-15",
  "is_sweep": true,
  "sentiment": "bullish",
  "underlying_price": 128.50
}
```

### What It Decides

Returns a fast JSON verdict:
```json
{
  "pass_to_deep_analysis": true,
  "initial_score": 72,
  "reasoning": "Large sweep premium, V/OI 2.9x, institutional-sized",
  "is_institutional": true,
  "is_hedge": false,
  "ticker": "NVDA",
  "direction": "bullish"
}
```

### Decision Rules
- **Score >= 50 AND pass_to_deep_analysis = true** → Escalate to Tier 2
- **Score < 50 OR pass = false** → Reject, log to `ai_activity` as `flow_rejected`

### Pre-Filters (Before Haiku Even Sees It)
- Individual stocks: premium >= $10,000
- Index ETFs (SPY, QQQ, IWM, SPX, DIA): premium >= $50,000
- Deduplicated: only one signal per ticker per day per source

---

## Agent 2: The Analyst (Claude Sonnet)

**File:** `bot/src/ai/analyst.py` → `deep_analysis()`
**Model:** `claude-sonnet-4-5`
**Cost:** ~$0.03 per call
**Frequency:** Only for escalated signals (~5-15 per day)

### What It Receives

Six categories of intelligence gathered by `pipeline._gather_intel()`:

1. **Primary Flow Signal** — the original alert that passed Haiku screening
2. **Congressional/Insider Data** — any matching congressional trades or C-suite transactions
3. **Related Flow** — up to 8 other recent flow alerts on the same ticker
4. **Dark Pool Prints** — up to 5 recent dark pool transactions on the ticker
5. **GEX/IV Data** — gamma exposure, IV rank, volatility statistics
6. **Market Context** — overall market tide (bullish/bearish flow), top net impact movers

### The System Prompt (The Agent's DNA)

The system prompt encodes institutional quant knowledge:

**Flow Classification Framework:**
- V/OI > 3x = new positioning (not rolling). V/OI > 10x = extremely unusual.
- Sweeps = urgency = conviction (buyer lifting offers across exchanges)
- Blocks = institutional (single large negotiated prints)
- $100k+ on single-name = likely institutional. $500k+ = whale.
- Deep OTM = lottery/cheap hedge. ATM/slightly OTM = directional conviction.
- < 7 DTE = gamma play/event trade. 30-90 DTE = thesis trade. > 90 DTE = LEAPS.

**Directional vs. Hedge Logic:**
- Large index put buying is usually portfolio insurance, NOT bearish conviction
- Single-name conviction bets are the real directional signals

**Dark Pool Integration:**
- Prints at/above ask = accumulation (bullish)
- Prints below bid = distribution (bearish)
- Cross-reference with options flow direction for confirmation

**GEX (Gamma Exposure):**
- Positive GEX = dealers hedged long gamma = market pinning
- Negative GEX = dealers short gamma = amplified moves
- Critical for timing entries

**NOPE Indicator:**
- Delta-adjusted net flow
- Extreme readings (> 2 or < -2) often precede mean reversion
- Used as contrarian timing signal

**Risk Rules Baked Into The Prompt:**
- Never recommend more than 5% of portfolio on a single trade
- Prefer defined-risk strategies (spreads, verticals) over naked options
- Always include stop-loss (-30% default)
- Scale out at milestones (50%, 100%)
- Don't buy premium when IV rank > 80 — sell premium instead
- Flag if trade crosses an earnings date

**Confidence Calibration:**
| Score | Meaning | Frequency |
|-------|---------|-----------|
| 90-100 | Career-bet. Multiple confirming signals. | Extremely rare |
| 75-89 | Strong conviction. Clear institutional flow. | 1-2 per week |
| 65-74 | Moderate. Interesting but ambiguous. Small position. | A few per day |
| 50-64 | Marginal. Single data point. Usually not tradeable. | Common |
| <50 | Noise. Retail, hedging, or insufficient data. | Most flow |

### What It Outputs

```json
{
  "confidence_score": 78,
  "direction": "bullish",
  "thesis": "NVDA showing institutional accumulation: $450k call sweep at 130 strike with V/OI 2.9x, confirmed by dark pool prints above ask totaling $12M in the last hour.",
  "is_institutional": true,
  "institutional_type": "conviction_bet",
  "flow_quality": "whale",
  "dark_pool_alignment": true,
  "gex_context": "negative_gamma",
  "iv_assessment": "fair",
  "risk_factors": [
    "Earnings in 18 days — IV may expand",
    "Negative GEX means amplified moves in both directions",
    "Broad market tide is slightly bearish today"
  ],
  "recommended_trade": {
    "action": "BULL CALL SPREAD",
    "strike_selection": "ATM",
    "target_expiry_dte": 45,
    "position_size_pct": 3.0,
    "entry_urgency": "immediate",
    "stop_loss_pct": -30,
    "take_profit_targets": [50, 100],
    "max_risk_dollars": null
  },
  "reasoning": "The $450k sweep at 130C with V/OI of 2.9x is a clear institutional conviction bet, not a hedge — single-name calls at ATM with 45 DTE. Dark pool confirms accumulation with 3 prints above the ask totaling $12M. Negative GEX on NVDA suggests dealers are short gamma, meaning any upward move will be amplified as they buy to hedge. IV rank is 42 — fair, not expensive — so buying premium is reasonable here. Risk: earnings in 18 days could cause a post-event IV crush."
}
```

---

## Agent 3: The Congressional Analyst (Claude Sonnet)

**File:** `bot/src/ai/analyst.py` → `analyze_congressional_trade()`
**Model:** `claude-sonnet-4-5`
**Frequency:** Every 15 minutes during market hours

### Key Difference

Congressional trades skip Haiku screening entirely — they go straight to Sonnet because:
1. They're already filtered by the Unusual Whales API
2. They have inherent information value (insider knowledge)
3. Volume is low (~0-5 per scan)

### Important Context

- **30-45 day filing delay** — a trade filed today happened weeks ago
- **Committee relevance** — a Banking Committee member buying JPM is more significant
- **Congressional signals are ALWAYS `pending`** — they never auto-execute, even in full_auto mode

---

## The Risk Manager

**File:** `bot/src/risk/manager.py`

### Check Order (Every Trade Must Pass All)

| # | Check | Default Limit | Configurable From |
|---|-------|---------------|-------------------|
| 0 | Excluded tickers | none | Strategy page |
| 1 | Minimum confidence | 70 | Strategy page (`min_confidence`) |
| 2 | Max open positions | 10 | bot_config |
| 3 | Max position size | 5% of portfolio | Strategy page |
| 4 | Daily loss circuit breaker | 3% | bot_config |
| 5 | Portfolio delta limit | ±500 | bot_config |
| 6 | Bot not paused | false | bot_config |

### What It Does NOT Do (Current Limitations)

- **No stop-loss enforcement** — The AI recommends stops, the risk manager stores the limit, but no code monitors positions and auto-closes at -30%
- **No take-profit enforcement** — Same issue
- **No theta monitoring** — `min_portfolio_theta` is defined but never checked
- **No weekly loss limit** — Defined but not implemented
- **No spread order support** — AI can recommend spreads but only single-leg buys are executed

---

## Data Sources (Unusual Whales API)

### Currently Used (Active in Pipeline)

| Endpoint | Used By | Purpose |
|----------|---------|---------|
| `/api/option-trades/flow-alerts` | Screener | Raw options flow |
| `/api/congress/recent-trades` | Congressional Agent | Disclosure filings |
| `/api/darkpool/{ticker}` | Intel Gathering | Dark pool prints |
| `/api/stock/{ticker}/greek-exposure` | Intel Gathering | GEX data |
| `/api/stock/{ticker}/iv-rank` | Intel Gathering | IV rank |
| `/api/stock/{ticker}/volatility-stats` | Intel Gathering | Vol statistics |
| `/api/market/tide` | Intel Gathering | Market sentiment |
| `/api/market/top-net-impact` | Intel Gathering | Top movers |
| `/api/insiders/{ticker}` | Intel Gathering | Insider transactions |
| `/api/etf/sectors` | Dashboard API | Sector performance |

### Available But Not Yet Integrated

| Endpoint | Value |
|----------|-------|
| `/api/stock/{ticker}/nope` | NOPE indicator — strong short-term signal |
| `/api/stock/{ticker}/max-pain` | Max pain by expiry |
| `/api/stock/{ticker}/net-premium-ticks` | Real-time call/put sentiment |
| `/api/darkpool/recent` | Market-wide dark pool feed |
| `/api/market/sector-tide` | Sector-level flow sentiment |
| `/api/market/economic-calendar` | Macro events (FOMC, CPI, etc.) |
| `/api/market/fda-calendar` | FDA catalysts |
| `/api/earnings/{ticker}` | Earnings dates and history |
| `/api/short/{ticker}/interest` | Short interest / squeeze data |
| `/api/institution/activity-v2` | 13-F institutional holdings |
| `/api/screener/contract-screener` | Hottest chains |
| WebSocket channels | Real-time streaming (not polling) |

---

## Signal Lifecycle

```
Flow Alert → Haiku Screen → [REJECT or ESCALATE]
                                    │
                              Intel Gathering (7 API calls)
                                    │
                              Sonnet Analysis
                                    │
                        [BELOW THRESHOLD or CREATE SIGNAL]
                                    │
                              Signal Created
                              status: pending/approved
                                    │
                    ┌───────────────┼───────────────┐
                    │               │               │
               MANUAL MODE     SEMI-AUTO       FULL-AUTO
               → pending       score >= 85     → approved
               (you approve    → approved      (always)
                on dashboard)  else → pending
                    │               │               │
                    └───────────────┼───────────────┘
                                    │
                              Approved Signal
                                    │
                              Risk Manager Check
                                    │
                        [BLOCKED or ALLOWED]
                                    │
                              IBKR Execution
                              → Trade recorded
                              → Signal marked executed
```

---

## Auto-Trade Modes

### Manual Review (Safest)
- Every signal goes to the Signals page as "pending"
- You review the AI's thesis, risk factors, and recommended trade
- Click Approve or Reject
- Approved signals execute within 10 seconds

### Semi-Auto (Current Setting)
- Signals scoring 85+ auto-execute (whale-level conviction)
- Everything else goes to pending for your review
- Best balance of automation and control

### Full Auto (Maximum Automation)
- All signals above the confidence threshold (65) auto-execute
- Only the risk manager can block trades
- Use only when you trust the system and have tested it thoroughly

---

## Execution Flow

```
Approved Signal
    │
    ▼
Order Builder
    │ Converts signal → OptionOrder
    │ Default: buy_to_open, limit order
    │ Position size: 2% of portfolio / ($3 × 100)
    │
    ▼
Risk Manager (final check)
    │ Re-validates confidence, position size,
    │ daily loss, portfolio delta, excluded tickers
    │
    ▼
IBKR Broker Adapter
    │ Qualifies contract with IBKR
    │ Places order (LMT or MKT)
    │ Waits 3 seconds for fill
    │
    ▼
Trade Recorded in Supabase
    │ status: filled/pending/failed
    │ fill_price, commission, order_id
    │
    ▼
Signal marked "executed"
```

---

## Cost Estimates

### Daily (Market Hours Only)
| Component | Volume | Cost |
|-----------|--------|------|
| Haiku screens | ~390/day | ~$0.40 |
| Sonnet analysis | ~5-15/day | ~$0.15-$0.45 |
| On-demand briefings | 1-3/day | ~$0.03-$0.09 |
| **Total AI** | | **~$0.60-$1.00/day** |
| Unusual Whales API | Unlimited | Included in subscription |
| Supabase | DB reads/writes | Free tier covers it |

### Monthly
- **AI (Anthropic):** ~$12-$20
- **Unusual Whales:** Whatever your plan costs
- **Supabase:** Free
- **Vercel:** Free (Hobby plan)
- **IBKR:** Free (paper) / $0 + commissions (live)

---

## Known Limitations & Roadmap

### Critical (Should Fix Before Going Live)

1. **No stop-loss enforcement** — AI recommends -30% stops but nothing monitors and closes positions
2. **No spread orders** — AI recommends spreads, builder only places single legs
3. **Confidence threshold gap** — Pipeline creates at 65, risk blocks at 70. Signals at 65-69 get stuck as "approved" forever
4. **No limit price on orders** — Orders may execute as market orders

### Important (Should Fix Soon)

5. **Sequential intel gathering** — 7 API calls run sequentially instead of parallel
6. **Position sync race condition** — Full delete-reinsert during sync creates a window where positions appear empty
7. **No duplicate trade protection** — If signal marking fails after execution, signal re-executes on next tick
8. **Rep history never populated** — Congressional prompt has a slot but receives empty data

### Nice to Have

9. **NOPE integration** — Strong short-term signal not yet used
10. **Economic calendar awareness** — Bot doesn't know about FOMC, CPI, earnings dates
11. **Weekly Opus review** — Mentioned but never built
12. **WebSocket streaming** — Currently polling every 60s, could be real-time
