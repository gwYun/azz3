import { NextResponse } from "next/server";

export const revalidate = 3600; // cache for 1 hour at the CDN/edge

export async function GET() {
  try {
    const res = await fetch(
      "https://api.frankfurter.app/latest?from=EUR&to=KRW",
      { next: { revalidate: 3600 } },
    );
    if (!res.ok) throw new Error(`upstream ${res.status}`);
    const data = (await res.json()) as { rates?: { KRW?: number } };
    const rate = data.rates?.KRW;
    if (!rate || !isFinite(rate)) throw new Error("missing KRW rate");
    return NextResponse.json({ rate });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "unknown" },
      { status: 502 },
    );
  }
}
