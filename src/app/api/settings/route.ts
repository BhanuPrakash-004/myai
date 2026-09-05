import { NextRequest, NextResponse } from "next/server";
import { config } from "@/lib/config";
import { getDb } from "@/lib/db";
import { getAIProvider } from "@/lib/ai";

export async function GET() {
  try {
    const db = getDb();
    const rows = db.prepare("SELECT * FROM app_settings").all() as { key: string; value: string }[];
    const settingsMap: Record<string, string> = {};
    for (const r of rows) settingsMap[r.key] = r.value;

    const provider = await getAIProvider();

    return NextResponse.json({
      appName: config.appName,
      vaultPath: config.vaultPath,
      databasePath: config.databasePath,
      ollamaBaseUrl: settingsMap.ollamaBaseUrl || config.ollamaBaseUrl,
      ollamaModel: settingsMap.ollamaModel || config.ollamaModel,
      activeProvider: provider.name,
      customSettings: settingsMap,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const db = getDb();

    const upsertStmt = db.prepare(`
      INSERT INTO app_settings (key, value)
      VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `);

    for (const [key, value] of Object.entries(body)) {
      if (typeof value === "string") {
        upsertStmt.run(key, value);
      }
    }

    return NextResponse.json({ success: true, message: "Settings updated" });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
