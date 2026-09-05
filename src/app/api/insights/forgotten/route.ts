import { NextResponse } from "next/server";
import { getFrequentlyForgotten } from "@/lib/memory/tracker";

export async function GET() {
  try {
    const items = getFrequentlyForgotten(15);
    return NextResponse.json({ items });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
