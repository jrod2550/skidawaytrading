import { NextResponse } from "next/server";
import crypto from "crypto";

const PROD_BASE = "https://api.elections.kalshi.com/trade-api/v2";

function createSignature(privateKeyPem: string, timestamp: string, method: string, path: string): string {
  const message = `${timestamp}${method}${path}`;
  const key = crypto.createPrivateKey(privateKeyPem);
  const signature = crypto.sign("sha256", Buffer.from(message), {
    key,
    padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
    saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST,
  });
  return signature.toString("base64");
}

function getHeaders(method: string, path: string) {
  const apiKey = process.env.KALSHI_API_KEY ?? "";
  const privateKey = process.env.KALSHI_PRIVATE_KEY ?? "";
  let keyPem = privateKey.replace(/\\n/g, "\n");
  if (!keyPem.startsWith("-----")) {
    try {
      const fs = require("fs");
      keyPem = fs.readFileSync(privateKey, "utf8");
    } catch { return null; }
  }
  const timestamp = String(Date.now());
  const fullPath = `/trade-api/v2${path}`;
  const signature = createSignature(keyPem, timestamp, method, fullPath);
  return {
    "KALSHI-ACCESS-KEY": apiKey,
    "KALSHI-ACCESS-TIMESTAMP": timestamp,
    "KALSHI-ACCESS-SIGNATURE": signature,
    "Content-Type": "application/json",
  };
}

async function kalshiFetch(path: string) {
  const headers = getHeaders("GET", path);
  if (!headers) return null;
  const resp = await fetch(`${PROD_BASE}${path}`, { headers, next: { revalidate: 30 } });
  if (!resp.ok) return null;
  return resp.json();
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const action = searchParams.get("action") ?? "balance";
  const apiKey = process.env.KALSHI_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "Kalshi not configured" }, { status: 500 });

  try {
    if (action === "balance") {
      const data = await kalshiFetch("/portfolio/balance");
      if (!data) return NextResponse.json({ error: "Failed to fetch balance" }, { status: 500 });
      // API returns balance in CENTS (e.g. 7251 = $72.51)
      const balanceCents = data.balance ?? 0;
      const portfolioCents = data.portfolio_value ?? 0;
      return NextResponse.json({
        balance_cents: balanceCents,
        balance_dollars: balanceCents / 100,
        portfolio_value_cents: portfolioCents,
        portfolio_value_dollars: portfolioCents / 100,
      });
    }

    if (action === "positions") {
      const [posData, fillsData, settlementsData] = await Promise.all([
        kalshiFetch("/portfolio/positions?limit=100"),
        kalshiFetch("/portfolio/fills?limit=200"),
        kalshiFetch("/portfolio/settlements?limit=200"),
      ]);

      // Active positions
      const positions = (posData?.market_positions ?? []).filter(
        (p: Record<string, unknown>) => parseFloat(String(p.position ?? p.position_fp ?? "0")) !== 0
      );
      const enriched = [];
      for (const pos of positions) {
        let title = pos.ticker;
        try {
          const mkt = await kalshiFetch(`/markets/${pos.ticker}`);
          if (mkt?.market) title = mkt.market.title || pos.ticker;
        } catch { /* */ }
        const count = parseFloat(String(pos.position ?? pos.position_fp ?? "0"));
        enriched.push({
          ticker: pos.ticker,
          market_title: title,
          side: count > 0 ? "YES" : "NO",
          position: Math.abs(count),
          exposure_dollars: Math.abs(parseFloat(String(pos.market_exposure ?? pos.market_exposure_dollars ?? "0"))),
          total_cost_dollars: Math.abs(parseFloat(String(pos.total_cost ?? pos.total_cost_dollars ?? "0"))),
        });
      }

      // Fills — prices come as dollars (e.g. "0.5100" = 51 cents)
      const fills = (fillsData?.fills ?? []).map((f: Record<string, unknown>) => {
        const side = String(f.side ?? "yes");
        const yesPrice = parseFloat(String(f.yes_price_dollars ?? "0"));
        const noPrice = parseFloat(String(f.no_price_dollars ?? "0"));
        const count = parseFloat(String(f.count_fp ?? f.count ?? "0"));
        const fee = parseFloat(String(f.fee_cost ?? "0"));
        const priceDollars = side === "yes" ? yesPrice : noPrice;
        const costDollars = count * priceDollars;
        return {
          fill_id: f.fill_id,
          ticker: f.ticker ?? f.market_ticker,
          side,
          action: f.action ?? "buy",
          count,
          price_cents: Math.round(priceDollars * 100),
          cost_dollars: costDollars,
          fee_dollars: fee,
          total_cost_dollars: costDollars + fee,
          created_at: f.created_time,
        };
      });

      // Settlements — revenue is in CENTS (e.g. 1000 = $10.00)
      const settlements = (settlementsData?.settlements ?? []).map((s: Record<string, unknown>) => {
        const revenueCents = Number(s.revenue ?? 0);
        const revenueDollars = revenueCents / 100;
        const yesCost = parseFloat(String(s.yes_total_cost_dollars ?? "0"));
        const noCost = parseFloat(String(s.no_total_cost_dollars ?? "0"));
        const totalCost = yesCost + noCost;
        const profitDollars = revenueDollars - totalCost;
        const yesCount = parseFloat(String(s.yes_count_fp ?? "0"));
        const noCount = parseFloat(String(s.no_count_fp ?? "0"));
        const result = s.market_result;
        // Determine if we won: if we had YES and result=yes, or NO and result=no
        const hadYes = yesCount > 0;
        const hadNo = noCount > 0;
        const marketWentYes = result === "yes";
        let outcome = "PUSH";
        if (totalCost === 0) outcome = "SKIP"; // no position
        else if (profitDollars > 0) outcome = "WON";
        else if (profitDollars < 0) outcome = "LOST";
        return {
          ticker: s.ticker ?? s.market_ticker,
          event_ticker: s.event_ticker,
          settled_at: s.settled_time,
          market_result: result,
          revenue_dollars: revenueDollars,
          cost_dollars: totalCost,
          profit_dollars: profitDollars,
          yes_count: yesCount,
          no_count: noCount,
          outcome,
          had_conflict: hadYes && hadNo,
        };
      });

      // Filter out zero-position settlements
      const realSettlements = settlements.filter((s: { cost_dollars: number }) => s.cost_dollars > 0);
      const totalPnl = realSettlements.reduce((s: number, x: { profit_dollars: number }) => s + x.profit_dollars, 0);
      const totalSpent = fills
        .filter((f: { action: string }) => f.action === "buy")
        .reduce((s: number, f: { total_cost_dollars: number }) => s + f.total_cost_dollars, 0);
      const wins = realSettlements.filter((s: { outcome: string }) => s.outcome === "WON").length;
      const losses = realSettlements.filter((s: { outcome: string }) => s.outcome === "LOST").length;

      return NextResponse.json({
        positions: enriched,
        fills,
        settlements: realSettlements,
        total_pnl: totalPnl,
        total_spent: totalSpent,
        wins,
        losses,
        win_rate: realSettlements.length > 0 ? Math.round((wins / realSettlements.length) * 100) : 0,
      });
    }

    if (action === "markets") {
      const query = searchParams.get("q") ?? "";
      const data = await kalshiFetch(`/markets?status=open&limit=50${query ? `&series_ticker=${query}` : ""}`);
      return NextResponse.json({ markets: data?.markets ?? [] });
    }

    if (action === "masters") {
      const mastersEvent = await kalshiFetch("/events/KXMASTERS-25");
      const marketsData = await kalshiFetch("/markets?event_ticker=KXMASTERS-25&limit=100");
      const markets = marketsData?.markets ?? [];
      const allEvents = await kalshiFetch("/events?limit=200");
      const golfEvents = (allEvents?.events ?? []).filter((e: Record<string, unknown>) => {
        const title = String(e.title ?? "").toLowerCase();
        const ticker = String(e.event_ticker ?? "").toLowerCase();
        return title.includes("golf") || title.includes("masters") || title.includes("pga") ||
               ticker.includes("golf") || ticker.includes("masters") || ticker.includes("pga");
      });
      for (const event of golfEvents.slice(0, 5)) {
        if (event.event_ticker === "KXMASTERS-25") continue;
        const more = await kalshiFetch(`/markets?event_ticker=${event.event_ticker}&limit=50`);
        if (more?.markets) markets.push(...more.markets.map((m: Record<string, unknown>) => ({ ...m, event_title: event.title })));
      }
      return NextResponse.json({ event: mastersEvent ?? null, events: golfEvents, markets });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
