import { randomBytes } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

// Never overwrite an existing installation or print generated credentials.
const password = randomBytes(32).toString("hex");
const template = await readFile(new URL("../.env.example", import.meta.url), "utf8");
const contents = template.replace(/^BETTER_AUTH_SECRET=.*$/m, "BETTER_AUTH_SECRET=" + randomBytes(48).toString("hex"))
  .replaceAll("replace-with-a-random-hex-password", password);
try {
  await writeFile(new URL("../.env", import.meta.url), contents, { flag: "wx", mode: 0o600 });
  console.log("Created .env with independent random secrets. Configure APP_URL and optional AI models before startup. Existing .env.local overrides .env for local Node commands, but Docker Compose reads .env only.");
} catch (error) {
  if (error.code !== "EEXIST") throw error;
  console.error(".env already exists; nothing changed. Edit your existing configuration.");
  process.exitCode = 1;
}
