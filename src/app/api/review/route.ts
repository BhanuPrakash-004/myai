import { NextRequest, NextResponse } from "next/server";
import { startReviewSession, logReviewOutcome, ReviewSessionConfig } from "@/lib/review/engine";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const mode = (searchParams.get("mode") || "quick") as ReviewSessionConfig["mode"];
    const topic = searchParams.get("topic") || undefined;
    const limit = parseInt(searchParams.get("limit") || "8", 10);

    const session = startReviewSession({ mode, topic, limit });
    return NextResponse.json(session);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { sessionId, memoryId, remembered } = body;

    if (!sessionId || !memoryId) {
      return NextResponse.json({ error: "sessionId and memoryId are required" }, { status: 400 });
    }

    logReviewOutcome(sessionId, memoryId, Boolean(remembered));
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
