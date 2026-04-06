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
    } catch {
      return null;
    }
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

/**
 * Kalshi API v2 balance returns cents for `balance` and `portfolio_value`.
 * Position/fill fields use `_dollars` suffix and return dollar amounts.
 * If a value looks like dollars already (< 1000 and has decimals), don't divide.
 */
function centsToDollars(cents: number): number {
  return cents / 100;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const action = searchParams.get("action") ?? "balance";

  const apiKey = process.env.KALSHI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "Kalshi not configured" }, { status: 500 });
  }

  try {
    if (action === "balance") {
      const data = await kalshiFetch("/portfolio/balance");
      if (!data) return NextResponse.json({ error: "Failed to fetch balance" }, { status: 500 });

      // Kalshi v2 returns cents for balance fields
      // But also check for _dollars fields which some endpoints use
      const balanceCents = data.balance ?? 0;
      const portfolioCents = data.portfolio_value ?? 0;

      // If the API returned dollar amounts in _dollars fields, use those directly
      const balanceDollars = data.balance_dollars ?? centsToDollars(balanceCents);
      const portfolioDollars = data.portfolio_value_dollars ?? centsToDollars(portfolioCents);

      return NextResponse.json({
        balance_cents: balanceCents,
        balance_dollars: balanceDollars,
        portfolio_value_cents: portfolioCents,
        portfolio_value_dollars: portfolioDollars,
        raw: data, // Pass raw data so frontend can debug
      });
    }

    if (action === "positions") {
      const [posData, fillsData, settlementsData, ordersData] = await Promise.all([
        kalshiFetch("/portfolio/positions?limit=100"),
        kalshiFetch("/portfolio/fills?limit=200"),
        kalshiFetch("/portfolio/settlements?limit=200"),
        kalshiFetch("/portfolio/orders?status=resting"),
      ]);

      // Active positions (non-zero)
      const positions = (posData?.market_positions ?? []).filter(
        (p: Record<string, unknown>) => {
          const pos = parseFloat(String(p.position ?? p.position_fp ?? "0"));
          return pos !== 0;
        }
      );

      // Enrich with market titles
      const enriched = [];
      for (const pos of positions) {
        let title = pos.ticker;
        try {
          const mkt = await kalshiFetch(`/markets/${pos.ticker}`);
          if (mkt?.market) {
            title = mkt.market.title || mkt.market.yes_sub_title || pos.ticker;
          }
        } catch { /* */ }

        const positionCount = parseFloat(String(pos.position ?? pos.position_fp ?? "0"));
        const exposure = parseFloat(String(pos.market_exposure ?? pos.market_exposure_dollars ?? "0"));
        const realizedPnl = parseFloat(String(pos.realized_pnl ?? pos.realized_pnl_dollars ?? "0"));
        const totalCost = parseFloat(String(pos.total_cost ?? pos.total_cost_dollars ?? "0"));

        enriched.push({
          ticker: pos.ticker,
          market_title: title,
          side: positionCount > 0 ? "YES" : "NO",
          position: Math.abs(positionCount),
          exposure_dollars: Math.abs(exposure),
          realized_pnl_dollars: realizedPnl,
          total_cost_dollars: Math.abs(totalCost),
        });
      }

      // Fills — include cost per fill
      const fills = (fillsData?.fills ?? []).map((f: Record<string, unknown>) => {
        const yesPrice = parseFloat(String(f.yes_price ?? f.yes_price_dollars ?? "0"));
        const noPrice = parseFloat(String(f.no_price ?? f.no_price_dollars ?? "0"));
        const count = parseFloat(String(f.count ?? f.count_fp ?? "0"));
        const side = String(f.side ?? "yes");
        const priceDollars = side === "yes" ? yesPrice : noPrice;
        // If price looks like cents (> 1), it's cents. If < 1, it's dollars.
        const priceInCents = priceDollars > 1 ? Math.round(priceDollars) : Math.round(priceDollars * 100);
        const costDollars = priceDollars > 1 ? (count * priceDollars / 100) : (count * priceDollars);
        const fee = parseFloat(String(f.fee ?? f.fee_cost ?? "0"));

        return {
          fill_id: f.fill_id ?? f.id,
          ticker: f.ticker ?? f.market_ticker,
          side,
          action: f.action ?? "buy",
          count,
          price_cents: priceInCents,
          cost_dollars: costDollars,
          fee,
          total_cost_dollars: costDollars + fee,
          created_at: f.created_time ?? f.created_at,
          is_taker: f.is_taker,
        };
      });

      // Settlements — clear P&L per bet
      const settlements = (settlementsData?.settlements ?? []).map((s: Record<string, unknown>) => {
        const revenue = parseFloat(String(s.revenue ?? s.revenue_dollars ?? "0"));
        const cost = parseFloat(String(s.cost ?? s.cost_dollars ?? "0"));
        // Settlement PnL = revenue - cost, or use settlement_pnl if provided
        const pnl = s.settlement_pnl != null
          ? parseFloat(String(s.settlement_pnl))
          : (s.pnl != null ? parseFloat(String(s.pnl)) : revenue);

        return {
          ticker: s.ticker ?? s.market_ticker,
          settled_at: s.settled_time ?? s.settled_at,
          revenue,
          cost,
          pnl,
          yes_price: s.yes_price,
          no_price: s.no_price,
          result: pnl > 0 ? "WON" : pnl < 0 ? "LOST" : "PUSH",
        };
      });

      // Resting orders
      const resting = (ordersData?.orders ?? []).map((o: Record<string, unknown>) => ({
        order_id: o.order_id,
        ticker: o.ticker,
        side: o.side,
        action: o.action,
        price: o.yes_price ?? o.no_price,
        remaining: o.remaining_count,
        created_at: o.created_time,
      }));

      const totalPnl = settlements.reduce((s: number, x: { pnl: number }) => s + x.pnl, 0);
      const totalSpent = fills
        .filter((f: { action: string }) => f.action === "buy")
        .reduce((s: number, f: { total_cost_dollars: number }) => s + f.total_cost_dollars, 0);

      return NextResponse.json({
        positions: enriched,
        fills,
        settlements,
        resting_orders: resting,
        total_pnl: totalPnl,
        total_spent: totalSpent,
      });
    }

    if (action === "markets") {
      const query = searchParams.get("q") ?? "";
      const data = await kalshiFetch(`/markets?status=open&limit=50${query ? `&series_ticker=${query}` : ""}`);
      return NextResponse.json({
        markets: data?.markets ?? [],
      });
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
        const eventTicker = event.event_ticker;
        if (eventTicker === "KXMASTERS-25") continue;
        const moreMarkets = await kalshiFetch(`/markets?event_ticker=${eventTicker}&limit=50`);
        if (moreMarkets?.markets) {
          for (const m of moreMarkets.markets) {
            markets.push({ ...m, event_title: event.title });
          }
        }
      }

      return NextResponse.json({
        event: mastersEvent ?? null,
        events: golfEvents,
        markets,
        status: markets.length === 0
          ? "Markets not yet open for trading."
          : `${markets.length} markets available`,
      });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
