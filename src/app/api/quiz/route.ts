import { NextRequest, NextResponse } from "next/server";
import { generateQuiz, evaluateQuizAnswer } from "@/lib/quiz/generator";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const topic = searchParams.get("topic") || undefined;
    const count = parseInt(searchParams.get("count") || "5", 10);

    const quiz = await generateQuiz(topic, count);
    return NextResponse.json(quiz);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { sessionId, question, answer } = body;

    if (!sessionId || !question || answer === undefined) {
      return NextResponse.json({ error: "sessionId, question, and answer are required" }, { status: 400 });
    }

    const evaluation = await evaluateQuizAnswer(sessionId, question, answer);
    return NextResponse.json(evaluation);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
