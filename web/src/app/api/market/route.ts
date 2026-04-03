import { NextResponse } from "next/server";

const UW_BASE = "https://api.unusualwhales.com";

async function uwFetch(path: string, apiKey: string) {
  const resp = await fetch(`${UW_BASE}${path}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
    next: { revalidate: 60 },
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
    const [flowAlerts, sectorData] = await Promise.all([
      uwFetch("/api/option-trades/flow-alerts", apiKey),
      uwFetch("/api/etf/sectors", apiKey),
    ]);

    // Determine market status based on current time (US Eastern)
    const now = new Date();
    const eastern = new Date(
      now.toLocaleString("en-US", { timeZone: "America/New_York" })
    );
    const hour = eastern.getHours();
    const minute = eastern.getMinutes();
    const day = eastern.getDay();
    const timeMinutes = hour * 60 + minute;

    const isWeekday = day >= 1 && day <= 5;
    const preMarket = isWeekday && timeMinutes >= 240 && timeMinutes < 570; // 4:00-9:30
    const marketOpen = isWeekday && timeMinutes >= 570 && timeMinutes < 960; // 9:30-16:00
    const afterHours = isWeekday && timeMinutes >= 960 && timeMinutes < 1200; // 16:00-20:00

    let marketStatus = "closed";
    if (marketOpen) marketStatus = "open";
    else if (preMarket) marketStatus = "pre-market";
    else if (afterHours) marketStatus = "after-hours";

    // Get top flow by premium (limit to 8 most interesting)
    const topFlow = Array.isArray(flowAlerts)
      ? flowAlerts
          .filter((a: Record<string, unknown>) => {
            const premium = Number(a.total_premium ?? 0);
            return premium >= 25000;
          })
          .sort(
            (a: Record<string, unknown>, b: Record<string, unknown>) =>
              Number(b.total_premium ?? 0) - Number(a.total_premium ?? 0)
          )
          .slice(0, 8)
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
          }))
      : [];

    // Sector performance
    const sectors = Array.isArray(sectorData)
      ? sectorData.slice(0, 11).map((s: Record<string, unknown>) => ({
          name: s.name ?? s.sector,
          ticker: s.ticker ?? s.symbol,
          change_pct: Number(s.change_percent ?? s.performance ?? 0),
        }))
      : [];

    return NextResponse.json({
      market_status: marketStatus,
      market_time: eastern.toLocaleTimeString("en-US", {
        hour: "numeric",
        minute: "2-digit",
        timeZone: "America/New_York",
      }),
      top_flow: topFlow,
      sectors,
    });
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to fetch market data" },
      { status: 500 }
    );
  }
}
