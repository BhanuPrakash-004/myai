import { NextRequest, NextResponse } from "next/server";
import { config } from "@/lib/config";
import { getDb } from "@/lib/db";
import { getAIProvider, resetAIProviderCache } from "@/lib/ai";

export async function GET() {
  try {
    const db = getDb();
    const rows = db.prepare("SELECT * FROM app_settings").all() as { key: string; value: string }[];
    const settingsMap: Record<string, string> = {};
    for (const r of rows) settingsMap[r.key] = r.value;

    const currentKey = settingsMap.openaiApiKey !== undefined ? settingsMap.openaiApiKey : config.openaiApiKey;
    const hasKey = Boolean(currentKey && currentKey.trim().length > 0);
    const maskedKey = hasKey
      ? currentKey.length > 8
        ? `${currentKey.slice(0, 6)}...${currentKey.slice(-4)}`
        : "******"
      : "";

    const provider = await getAIProvider();

    return NextResponse.json({
      appName: config.appName,
      vaultPath: config.vaultPath,
      databasePath: config.databasePath,
      aiProvider: settingsMap.aiProvider || config.aiProvider || "auto",
      ollamaBaseUrl: settingsMap.ollamaBaseUrl || config.ollamaBaseUrl,
      ollamaModel: settingsMap.ollamaModel || config.ollamaModel,
      openaiBaseUrl: settingsMap.openaiBaseUrl || config.openaiBaseUrl,
      openaiModel: settingsMap.openaiModel || config.openaiModel,
      hasOpenaiApiKey: hasKey,
      openaiApiKeyMasked: maskedKey,
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

    // Allowed settings fields
    const allowedKeys = [
      "aiProvider",
      "ollamaBaseUrl",
      "ollamaModel",
      "openaiBaseUrl",
      "openaiModel",
      "openaiApiKey",
    ];

    for (const key of allowedKeys) {
      if (body[key] !== undefined && typeof body[key] === "string") {
        // Only update openaiApiKey if not blank, or if clearApiKey is set
        if (key === "openaiApiKey" && body[key].trim() === "" && !body.clearApiKey) {
          continue;
        }
        upsertStmt.run(key, body[key].trim());
      }
    }

    if (body.clearApiKey) {
      db.prepare("DELETE FROM app_settings WHERE key = 'openaiApiKey'").run();
    }

    // Immediately invalidate AI provider cache so new key / settings take effect
    resetAIProviderCache();
    const newProvider = await getAIProvider();

    return NextResponse.json({
      success: true,
      message: "AI settings saved successfully.",
      activeProvider: newProvider.name,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
