import { NextResponse } from "next/server";
import { getWeakAreas } from "@/lib/memory/tracker";

export async function GET() {
  try {
    const areas = getWeakAreas(10);
    return NextResponse.json({ areas });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
