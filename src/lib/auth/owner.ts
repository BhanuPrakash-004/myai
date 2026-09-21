import { randomUUID } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import { z } from "zod";
import type { Pool } from "pg";
import { transaction } from "../storage/client";
import { DomainError } from "../storage/access";

const credentials = z.object({ email: z.email().max(254).transform((s) => s.toLowerCase()), password: z.string().min(12).max(128), name: z.string().trim().min(1).max(100).default("Owner") });
// Local process only: never expose either function as an HTTP action.
export async function provisionOwner(pool: Pool, raw: z.input<typeof credentials>) {
  const input = credentials.parse(raw), password = await hashPassword(input.password);
  return transaction(pool, async (client) => {
    await client.query("SELECT singleton FROM installation WHERE singleton=true FOR UPDATE");
    if ((await client.query("SELECT id FROM auth_users LIMIT 1")).rowCount) throw new DomainError("OWNER_EXISTS", "An owner already exists. Use owner:recover to reset its password.", 409);
    const id = randomUUID();
    await client.query("INSERT INTO auth_users(id,name,email,email_verified) VALUES($1,$2,$3,true)", [id, input.name, input.email]);
    await client.query("INSERT INTO auth_accounts(id,user_id,account_id,provider_id,password) VALUES($1,$2,$2,'credential',$3)", [randomUUID(), id, password]);
    await client.query("UPDATE installation SET owner_id=$1 WHERE singleton=true", [id]);
    return { id, email: input.email };
  });
}
export async function recoverOwner(pool: Pool, raw: z.input<typeof credentials>) {
  const input = credentials.parse(raw), password = await hashPassword(input.password);
  return transaction(pool, async (client) => {
    await client.query("SELECT singleton FROM installation WHERE singleton=true FOR UPDATE");
    const owner = (await client.query("SELECT u.id FROM auth_users u JOIN installation i ON i.owner_id=u.id WHERE lower(u.email)=$1 FOR UPDATE OF u", [input.email])).rows[0];
    if (!owner) throw new DomainError("NOT_FOUND", "No provisioned owner matches that email.", 404);
    await client.query("UPDATE auth_accounts SET password=$2,updated_at=now() WHERE user_id=$1 AND provider_id='credential'", [owner.id, password]);
    await client.query("DELETE FROM auth_sessions WHERE user_id=$1", [owner.id]);
    await client.query("DELETE FROM auth_verifications");
    await client.query("DELETE FROM auth_login_throttle");
    return { id: owner.id, email: input.email };
  });
}
export async function allowLogin(pool: Pool) {
  const result = await pool.query<{ attempts: number }>(`INSERT INTO auth_login_throttle(key,attempts,window_start) VALUES('owner-login',1,clock_timestamp())
    ON CONFLICT(key) DO UPDATE SET attempts=CASE WHEN auth_login_throttle.window_start < clock_timestamp()-interval '1 minute' THEN 1 ELSE auth_login_throttle.attempts+1 END,
    window_start=CASE WHEN auth_login_throttle.window_start < clock_timestamp()-interval '1 minute' THEN clock_timestamp() ELSE auth_login_throttle.window_start END RETURNING attempts`);
  return result.rows[0].attempts <= 10;
}
