import { NextResponse } from "next/server";

const UW_BASE = "https://api.unusualwhales.com";

async function uwFetch(path: string, apiKey: string) {
  const resp = await fetch(`${UW_BASE}${path}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
    next: { revalidate: 30 },
  });
  if (!resp.ok) return null;
  const data = await resp.json();
  return data.data ?? data;
}

export async function GET() {
  const apiKey = process.env.UW_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "UW_API_KEY not set" }, { status: 500 });
  }

  try {
    const flowAlerts = await uwFetch("/api/option-trades/flow-alerts", apiKey);

    // Filter for whale-sized trades ($100k+ premium)
    const whales = Array.isArray(flowAlerts)
      ? flowAlerts
          .filter((a: Record<string, unknown>) => {
            const premium = Number(a.total_premium ?? 0);
            return premium >= 100000;
          })
          .sort(
            (a: Record<string, unknown>, b: Record<string, unknown>) =>
              Number(b.total_premium ?? 0) - Number(a.total_premium ?? 0)
          )
          .slice(0, 20)
          .map((a: Record<string, unknown>) => ({
            ticker: a.ticker,
            strike: a.strike,
            call_put: a.put_call ?? a.call_put ?? a.option_type,
            expiry: a.expires ?? a.expiry,
            premium: Number(a.total_premium ?? 0),
            volume: Number(a.volume ?? 0),
            open_interest: Number(a.open_interest ?? 0),
            sentiment: a.sentiment ?? (String(a.put_call ?? "").toLowerCase() === "call" ? "bullish" : "bearish"),
            is_sweep: a.is_sweep ?? false,
            is_block: a.is_block ?? false,
            underlying_price: Number(a.underlying_price ?? 0),
            timestamp: a.created_at ?? a.timestamp ?? a.date,
          }))
      : [];

    return NextResponse.json({ alerts: whales });
  } catch {
    return NextResponse.json({ error: "Failed to fetch whale alerts" }, { status: 500 });
  }
}
