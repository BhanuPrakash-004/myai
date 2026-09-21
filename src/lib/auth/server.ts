import { betterAuth } from "better-auth";
import { randomUUID } from "node:crypto";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { getStorage } from "../storage/client";
import { users, sessions, accounts, verifications } from "../storage/schema";
import { authConfig } from "./config";
import { DomainError } from "../storage/access";

let cached: ReturnType<typeof createAuth> | undefined;
export function createAuth(storage = getStorage(), env: Record<string, string | undefined> = process.env) {
  const config = authConfig(env);
  return betterAuth({
    appName: "MyAI", baseURL: config.origin, secret: config.secret,
    trustedOrigins: [config.origin],
    database: drizzleAdapter(storage.db, { provider: "pg", schema: { user: users, session: sessions, account: accounts, verification: verifications } }),
    emailAndPassword: { enabled: true, disableSignUp: true, minPasswordLength: 12, maxPasswordLength: 128 },
    session: { expiresIn: 60 * 60 * 24 * 7, updateAge: 60 * 60 * 24, cookieCache: { enabled: false } },
    // A PostgreSQL-atomic installation-wide login limiter runs before the handler.
    // It works across processes/restarts and cannot be bypassed by spoofed IP headers.
    rateLimit: { enabled: false },
    advanced: { useSecureCookies: config.secure, cookiePrefix: "myai", defaultCookieAttributes: { httpOnly: true, sameSite: "lax", secure: config.secure },
      database: { generateId: () => randomUUID() } },
    logger: { log(level) { if (level === "error") console.error("[auth] Authentication operation failed."); } },
    databaseHooks: {
      user: { create: { before: async () => { throw new Error("Owner creation is only available through the local command."); } } },
      session: { create: { before: async (session) => {
        if (!(await storage.pool.query("SELECT 1 FROM installation WHERE owner_id=$1", [session.userId])).rowCount) return false;
        return { data: session };
      } } },
    },
  });
}
export function getAuth() { return cached ??= createAuth(); }
export async function ownerSession(headers: Headers) {
  const session = await getAuth().api.getSession({ headers });
  if (!session) return null;
  const owner = await getStorage().pool.query("SELECT 1 FROM installation WHERE singleton=true AND owner_id=$1", [session.user.id]);
  return owner.rowCount === 1 ? session : null;
}
export function assertSameOrigin(request: Request) {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return;
  const expected = authConfig().origin;
  if (request.headers.get("origin") !== expected || request.headers.get("sec-fetch-site") === "cross-site") {
    throw new DomainError("UNSAFE_ORIGIN", "Writes require the configured application origin.", 403);
  }
}
