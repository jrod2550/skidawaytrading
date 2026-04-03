import { NextResponse } from "next/server";

export async function GET() {
  const apiKey = process.env.UW_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "UW_API_KEY not set" }, { status: 500 });
  }

  try {
    const resp = await fetch(
      "https://api.unusualwhales.com/api/congress/recent-trades",
      {
        headers: { Authorization: `Bearer ${apiKey}` },
        next: { revalidate: 300 }, // cache 5 minutes
      }
    );

    if (!resp.ok) {
      return NextResponse.json(
        { error: `UW API error: ${resp.status}` },
        { status: resp.status }
      );
    }

    const data = await resp.json();
    return NextResponse.json({ trades: data.data ?? [] });
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to fetch congressional trades" },
      { status: 500 }
    );
  }
}
