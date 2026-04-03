import { NextResponse } from "next/server";

const UW_BASE = "https://api.unusualwhales.com";
const SONNET = "claude-sonnet-4-5-20250514";

async function uwFetch(path: string, apiKey: string) {
  const resp = await fetch(`${UW_BASE}${path}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
    next: { revalidate: 300 },
  });
  if (!resp.ok) return null;
  const data = await resp.json();
  return data.data ?? data;
}

function getMarketContext(): { status: string; time: string; dateStr: string; isHoliday: boolean } {
  const now = new Date();
  const etParts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);

  const getPart = (type: string) => etParts.find((p) => p.type === type)?.value ?? "0";
  const hour = parseInt(getPart("hour"));
  const minute = parseInt(getPart("minute"));
  const year = parseInt(getPart("year"));
  const month = parseInt(getPart("month"));
  const date = parseInt(getPart("day"));
  const mmdd = `${String(month).padStart(2, "0")}-${String(date).padStart(2, "0")}`;

  const etDayStr = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
  }).format(now);
  const dayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const day = dayMap[etDayStr] ?? 0;
  const timeMinutes = hour * 60 + minute;

  const holidays2026 = [
    "01-01", "01-19", "02-16", "04-03", "05-25",
    "06-19", "07-03", "09-07", "11-26", "12-25",
  ];
  const isHoliday = holidays2026.includes(mmdd);
  const isWeekday = day >= 1 && day <= 5;
  const isTradingDay = isWeekday && !isHoliday;

  let status = "closed";
  if (isTradingDay && timeMinutes >= 570 && timeMinutes < 960) status = "open";
  else if (isTradingDay && timeMinutes >= 240 && timeMinutes < 570) status = "pre-market";
  else if (isTradingDay && timeMinutes >= 960 && timeMinutes < 1200) status = "after-hours";
  if (isHoliday) status = "holiday";

  const timeStr = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(now);

  const dateStr = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(now);

  return { status, time: timeStr, dateStr, isHoliday };
}

export async function GET() {
  const apiKey = process.env.UW_API_KEY;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;

  if (!apiKey || !anthropicKey) {
    return NextResponse.json({ error: "API keys not configured" }, { status: 500 });
  }

  try {
    const marketCtx = getMarketContext();

    const [flowAlerts, congressTrades, sectorData] = await Promise.all([
      uwFetch("/api/option-trades/flow-alerts", apiKey),
      uwFetch("/api/congress/recent-trades", apiKey),
      uwFetch("/api/etf/sectors", apiKey),
    ]);

    // Include ALL flow — separate indexes from individual names
    const allFlow = Array.isArray(flowAlerts) ? flowAlerts : [];
    const indexTickers = new Set(["SPY", "QQQ", "IWM", "SPX", "SPXW", "DIA", "XSP"]);

    const individualFlow = allFlow
      .filter((a: Record<string, unknown>) => !indexTickers.has(String(a.ticker ?? "")))
      .filter((a: Record<string, unknown>) => Number(a.total_premium ?? 0) >= 10000)
      .sort((a: Record<string, unknown>, b: Record<string, unknown>) =>
        Number(b.total_premium ?? 0) - Number(a.total_premium ?? 0)
      )
      .slice(0, 12)
      .map((a: Record<string, unknown>) => ({
        ticker: a.ticker,
        premium: `$${(Number(a.total_premium ?? 0) / 1000).toFixed(0)}k`,
        type: a.put_call ?? a.call_put,
        strike: a.strike,
        expiry: a.expires ?? a.expiry,
        is_sweep: a.is_sweep,
        volume: a.volume,
        open_interest: a.open_interest,
        underlying_price: a.underlying_price,
      }));

    const indexFlow = allFlow
      .filter((a: Record<string, unknown>) => indexTickers.has(String(a.ticker ?? "")))
      .filter((a: Record<string, unknown>) => Number(a.total_premium ?? 0) >= 50000)
      .sort((a: Record<string, unknown>, b: Record<string, unknown>) =>
        Number(b.total_premium ?? 0) - Number(a.total_premium ?? 0)
      )
      .slice(0, 6)
      .map((a: Record<string, unknown>) => ({
        ticker: a.ticker,
        premium: `$${(Number(a.total_premium ?? 0) / 1000).toFixed(0)}k`,
        type: a.put_call ?? a.call_put,
        strike: a.strike,
        expiry: a.expires ?? a.expiry,
        is_sweep: a.is_sweep,
      }));

    const recentCongress = Array.isArray(congressTrades)
      ? congressTrades.slice(0, 10).map((t: Record<string, unknown>) => ({
          name: t.name ?? t.reporter,
          ticker: t.ticker,
          type: t.txn_type,
          amount: t.amounts,
          transaction_date: t.transaction_date,
          filed_date: t.filed_at_date,
          member_type: t.member_type,
        }))
      : [];

    const sectors = Array.isArray(sectorData)
      ? sectorData.slice(0, 11).map((s: Record<string, unknown>) => ({
          sector: s.name ?? s.sector,
          ticker: s.ticker ?? s.symbol,
          change: `${Number(s.change_percent ?? s.performance ?? 0).toFixed(2)}%`,
        }))
      : [];

    const systemPrompt = `You are a senior quantitative options flow analyst at Skidaway Trading, a small institutional-style options trading group based in Savannah, GA. You operate with the rigor of a sell-side research desk but the directness of a prop desk.

YOUR ANALYSIS PRINCIPLES:
- Distinguish between HEDGING flow and DIRECTIONAL bets. Large index put buying is often portfolio insurance, not bearish conviction.
- Volume/OI ratio matters: V/OI > 3x on single-name options suggests new positioning, not rolling.
- Sweeps indicate urgency — the buyer is lifting offers across exchanges rather than working a patient limit order.
- Congressional trades have a 30-45 day disclosure delay. A trade filed today happened weeks ago. Always note this.
- When the market is closed, do NOT describe flow as "happening now." It is historical/cached data from the last trading session.
- ALWAYS be explicit about data recency. Say "from the most recent trading session" or "based on the last available data."
- If data appears stale or the market is closed, say so clearly.

YOUR ROLE:
- Synthesize raw data into actionable intelligence
- Call out what's noise vs. what deserves attention
- Think in terms of risk/reward, not just direction
- Be specific: name tickers, premiums, strikes, and expiries
- Be honest about uncertainty — if the data doesn't tell a clear story, say so`;

    const prompt = `DATE: ${marketCtx.dateStr}
TIME: ${marketCtx.time} ET
MARKET STATUS: ${marketCtx.status.toUpperCase()}${marketCtx.isHoliday ? " (US Market Holiday)" : ""}

DATA SOURCE: Unusual Whales API (real-time options flow aggregation, congressional trade disclosures)
NOTE: ${marketCtx.status === "open" ? "Market is currently open. Data is live." :
       marketCtx.status === "holiday" ? "Market is CLOSED for a US holiday. All flow data below is from the MOST RECENT trading session, not today." :
       marketCtx.status === "closed" ? "Market is currently closed. Flow data below is from the most recent trading session." :
       `Market is in ${marketCtx.status} session.`}

INDIVIDUAL STOCK OPTIONS FLOW ($10k+ premium):
${individualFlow.length > 0 ? JSON.stringify(individualFlow, null, 2) : "No individual stock flow alerts available."}

INDEX/ETF OPTIONS FLOW ($50k+ premium):
${indexFlow.length > 0 ? JSON.stringify(indexFlow, null, 2) : "No index flow alerts available."}

CONGRESSIONAL TRADE DISCLOSURES (note: 30-45 day filing delay):
${recentCongress.length > 0 ? JSON.stringify(recentCongress, null, 2) : "No recent congressional trades available."}

SECTOR ETF PERFORMANCE:
${sectors.length > 0 ? JSON.stringify(sectors, null, 2) : "No sector data available."}

Write a market intelligence briefing. Structure:

1. **Status & Context** — Market status, date, any holidays. Be accurate.
2. **Individual Stock Flow** — The most notable single-name options activity. What are institutions positioning in? Analyze V/OI ratios, sweep urgency, and strike selection. Separate potential directional bets from hedging.
3. **Index & Macro Flow** — What does SPY/QQQ flow tell us about institutional sentiment? Is it hedging or conviction?
4. **Congressional Activity** — Notable trades by members of Congress. Note the filing delay. Which ones overlap with current flow?
5. **Sector Rotation** — What sectors are leading/lagging? What does that imply for options positioning?
6. **Actionable Takeaway** — 1-2 sentences. What should we be watching when the market ${marketCtx.status === "open" ? "today" : "opens next"}?

Rules:
- Under 500 words
- No emojis
- Use $ for dollar amounts
- If data is sparse or market is closed, say so honestly — don't fabricate narrative
- Cite "Unusual Whales flow data" or "congressional disclosure filings" when referencing sources`;

    // Try latest Sonnet first, then older versions
    const MODELS = [SONNET, "claude-3-5-sonnet-latest", "claude-3-5-sonnet-20241022", "claude-3-5-sonnet-20240620"];
    let claudeResp: Response | null = null;
    let usedModel = SONNET;

    for (const model of MODELS) {
      claudeResp = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": anthropicKey,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model,
          max_tokens: 1500,
          system: systemPrompt,
          messages: [{ role: "user", content: prompt }],
        }),
      });

      if (claudeResp.ok) {
        usedModel = model;
        break;
      }

      // If not_found error, try next model
      const errText = await claudeResp.text();
      if (errText.includes("not_found") && model !== MODELS[MODELS.length - 1]) {
        continue;
      }
      return NextResponse.json({ error: `Claude API error: ${errText}` }, { status: 500 });
    }

    if (!claudeResp || !claudeResp.ok) {
      return NextResponse.json({ error: "All Claude models failed" }, { status: 500 });
    }

    const claudeData = await claudeResp.json();
    const briefingText = claudeData.content?.[0]?.text ?? "Briefing unavailable.";
    const usage = claudeData.usage ?? {};

    // Sonnet pricing
    const cost = (
      (usage.input_tokens ?? 0) * 0.000003 +
      (usage.output_tokens ?? 0) * 0.000015
    ).toFixed(4);

    return NextResponse.json({
      briefing: briefingText,
      model: usedModel,
      market_status: marketCtx.status,
      generated_at: new Date().toISOString(),
      token_usage: {
        input_tokens: usage.input_tokens ?? 0,
        output_tokens: usage.output_tokens ?? 0,
        estimated_cost: cost,
      },
      data_summary: {
        individual_flow: individualFlow.length,
        index_flow: indexFlow.length,
        congressional_trades: recentCongress.length,
        sectors_tracked: sectors.length,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: `Briefing generation failed: ${String(error)}` },
      { status: 500 }
    );
  }
}
