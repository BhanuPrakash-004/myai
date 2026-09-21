export function authConfig(env: Record<string, string | undefined> = process.env) {
  let url: URL;
  try { url = new URL(env.APP_URL || "http://localhost:3000"); } catch { throw new Error("APP_URL must be an absolute origin."); }
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if ((url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("APP_URL must be an HTTPS origin, or HTTP on localhost for local access.");
  }
  const secret = env.BETTER_AUTH_SECRET;
  if (!secret || secret.length < 32 || /replace|change-me|your-secret/i.test(secret)) throw new Error("Set BETTER_AUTH_SECRET to a private random value of at least 32 characters.");
  return { origin: url.origin, secret, secure: url.protocol === "https:" };
}
