import { Pool } from "pg";
import { authConfig } from "@/lib/auth/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Separate small pool: readiness must stay bounded even when application work is busy.
let pool: Pool | undefined;
export async function GET() {
  try {
    authConfig();
    if (!process.env.DATABASE_URL) throw new Error("Missing database");
    if (!pool) {
      pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1,
        connectionTimeoutMillis: 2000, statement_timeout: 2000, idleTimeoutMillis: 5000 });
      pool.on("error", () => {});
    }
    const result = await pool.query("SELECT EXISTS (SELECT 1 FROM myai_migrations WHERE name='0010_attachment_purge.sql') AS migrated, EXISTS (SELECT 1 FROM installation WHERE owner_id IS NOT NULL) AS provisioned");
    if (!result.rows[0]?.migrated || !result.rows[0]?.provisioned) throw new Error("Setup incomplete");
    return Response.json({ status: "ready" }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    // No credentials, owner identity, schema details, or AI dependency in public health.
    return Response.json({ status: "not_ready" }, { status: 503, headers: { "Cache-Control": "no-store", "Retry-After": "5" } });
  }
}
