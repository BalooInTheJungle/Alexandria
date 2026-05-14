import { NextResponse } from "next/server";
import { getQueryAnalytics } from "@/lib/db/query-logs";

export const dynamic = "force-dynamic";

export async function GET() {
  console.log("[API] GET /api/analytics/overview input:", {});
  try {
    const analytics = await getQueryAnalytics();
    console.log("[API] GET /api/analytics/overview result:", {
      total: analytics.total,
      last30Days: analytics.last30Days,
    });
    return NextResponse.json(analytics);
  } catch (e) {
    console.error("[API] GET /api/analytics/overview error:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Analytics failed" },
      { status: 500 }
    );
  }
}
