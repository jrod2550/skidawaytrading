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

  // Handle inline key (replace \n literals with actual newlines)
  let keyPem = privateKey.replace(/\\n/g, "\n");
  if (!keyPem.startsWith("-----")) {
    // Try reading as file path (only works on NUC, not Vercel)
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
      return NextResponse.json({
        balance_cents: data?.balance ?? 0,
        balance_dollars: (data?.balance ?? 0) / 100,
        portfolio_value_cents: data?.portfolio_value ?? 0,
        portfolio_value_dollars: (data?.portfolio_value ?? 0) / 100,
      });
    }

    if (action === "positions") {
      const data = await kalshiFetch("/portfolio/positions?limit=50");
      return NextResponse.json({
        positions: data?.market_positions ?? [],
        event_positions: data?.event_positions ?? [],
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
      // Get the Masters event directly by known ticker
      const mastersEvent = await kalshiFetch("/events/KXMASTERS-25");

      // Get Masters markets
      const marketsData = await kalshiFetch("/markets?event_ticker=KXMASTERS-25&limit=100");
      const markets = marketsData?.markets ?? [];

      // Also search for any other golf/PGA events
      const allEvents = await kalshiFetch("/events?limit=200");
      const golfEvents = (allEvents?.events ?? []).filter((e: Record<string, unknown>) => {
        const title = String(e.title ?? "").toLowerCase();
        const ticker = String(e.event_ticker ?? "").toLowerCase();
        return title.includes("golf") || title.includes("masters") || title.includes("pga") ||
               ticker.includes("golf") || ticker.includes("masters") || ticker.includes("pga");
      });

      // Get markets for any other golf events
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
          ? "Markets not yet open for trading. The Masters begins Thursday, April 10. Kalshi typically opens markets 1-2 days before the event."
          : `${markets.length} markets available`,
      });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
