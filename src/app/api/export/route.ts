import { NextRequest, NextResponse } from "next/server";
import AdmZip from "adm-zip";
import fs from "fs";
import { getVaultPath } from "@/lib/vault";

export async function GET(req: NextRequest) {
  try {
    const vaultDir = getVaultPath();
    const zip = new AdmZip();

    if (fs.existsSync(vaultDir)) {
      zip.addLocalFolder(vaultDir, "vault");
    }

    const zipBuffer = zip.toBuffer();

    return new Response(new Uint8Array(zipBuffer), {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="myai-knowledge-vault-${new Date().toISOString().slice(0, 10)}.zip"`,
      },
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
