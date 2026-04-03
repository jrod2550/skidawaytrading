import { NextResponse } from "next/server";

const UW_BASE = "https://api.unusualwhales.com";

async function uwFetch(path: string, apiKey: string) {
  const resp = await fetch(`${UW_BASE}${path}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
    next: { revalidate: 300 },
  });
  if (!resp.ok) return null;
  const data = await resp.json();
  return data.data ?? data;
}

export async function GET() {
  const apiKey = process.env.UW_API_KEY;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;

  if (!apiKey || !anthropicKey) {
    return NextResponse.json({ error: "API keys not configured" }, { status: 500 });
  }

  try {
    // Gather market data
    const [flowAlerts, congressTrades, sectorData] = await Promise.all([
      uwFetch("/api/option-trades/flow-alerts", apiKey),
      uwFetch("/api/congress/recent-trades", apiKey),
      uwFetch("/api/etf/sectors", apiKey),
    ]);

    // Summarize the data for Claude
    const topFlow = Array.isArray(flowAlerts)
      ? flowAlerts
          .filter((a: Record<string, unknown>) => Number(a.total_premium ?? 0) >= 50000)
          .sort((a: Record<string, unknown>, b: Record<string, unknown>) =>
            Number(b.total_premium ?? 0) - Number(a.total_premium ?? 0)
          )
          .slice(0, 15)
          .map((a: Record<string, unknown>) => ({
            ticker: a.ticker,
            premium: `$${(Number(a.total_premium ?? 0) / 1000).toFixed(0)}k`,
            type: a.put_call ?? a.call_put,
            strike: a.strike,
            expiry: a.expires ?? a.expiry,
            is_sweep: a.is_sweep,
            sentiment: a.sentiment,
          }))
      : [];

    const recentCongress = Array.isArray(congressTrades)
      ? congressTrades.slice(0, 10).map((t: Record<string, unknown>) => ({
          name: t.name ?? t.reporter,
          ticker: t.ticker,
          type: t.txn_type,
          amount: t.amounts,
          date: t.transaction_date,
        }))
      : [];

    const sectors = Array.isArray(sectorData)
      ? sectorData.slice(0, 11).map((s: Record<string, unknown>) => ({
          sector: s.name ?? s.sector,
          change: `${Number(s.change_percent ?? s.performance ?? 0).toFixed(2)}%`,
        }))
      : [];

    // Call Claude for the briefing
    const prompt = `You are the AI analyst for Skidaway Trading, a small options trading group in Savannah, GA. Write a concise daily market briefing based on this data. Be direct, insightful, and use a professional but casual tone. Use bullet points and keep it under 400 words.

TODAY'S TOP UNUSUAL OPTIONS FLOW:
${JSON.stringify(topFlow, null, 2)}

RECENT CONGRESSIONAL TRADES:
${JSON.stringify(recentCongress, null, 2)}

SECTOR PERFORMANCE:
${JSON.stringify(sectors, null, 2)}

Structure your briefing as:
1. **Market Pulse** - 2-3 sentences on overall market sentiment based on flow and sectors
2. **Smart Money Moves** - Top 3-4 most interesting flow alerts and what they might mean
3. **Capitol Hill** - Any notable congressional trades worth watching
4. **Sectors to Watch** - Which sectors are hot/cold and why it matters for options
5. **Bottom Line** - One sentence takeaway for the day

Do NOT use emojis. Use $ for dollar amounts. Be specific about tickers and numbers.`;

    const claudeResp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": anthropicKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-3-haiku-20240307",
        max_tokens: 1024,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!claudeResp.ok) {
      const err = await claudeResp.text();
      return NextResponse.json({ error: `Claude API error: ${err}` }, { status: 500 });
    }

    const claudeData = await claudeResp.json();
    const briefingText = claudeData.content?.[0]?.text ?? "Briefing unavailable.";
    const usage = claudeData.usage ?? {};

    return NextResponse.json({
      briefing: briefingText,
      generated_at: new Date().toISOString(),
      token_usage: {
        input_tokens: usage.input_tokens ?? 0,
        output_tokens: usage.output_tokens ?? 0,
        estimated_cost: (
          (usage.input_tokens ?? 0) * 0.00000025 +
          (usage.output_tokens ?? 0) * 0.00000125
        ).toFixed(4),
      },
      data_summary: {
        flow_alerts_analyzed: topFlow.length,
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
