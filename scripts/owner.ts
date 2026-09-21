import { loadCliEnv } from "./db/env";
import { createStorage } from "../src/lib/storage/client";
import { provisionOwner, recoverOwner } from "../src/lib/auth/owner";
import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";

// Interactive passwords are hidden; automation uses stdin JSON, never argv.
const command = process.argv[2];
if (!["create", "recover"].includes(command)) throw new Error("Usage: npm run owner:create or npm run owner:recover; provide JSON {email,password,name?} on stdin.");
loadCliEnv();
let raw = "";
if (process.stdin.isTTY) {
  let hidden = false;
  const output = new Writable({ write(chunk, encoding, done) { if (!hidden) process.stdout.write(chunk, encoding); done(); } });
  const prompt = createInterface({ input: process.stdin, output, terminal: true });
  try {
    const email = await prompt.question("Owner email: ");
    process.stdout.write("Password (12–128 characters, hidden): "); hidden = true;
    const password = await prompt.question("");
    hidden = false; process.stdout.write("\nConfirm password (hidden): "); hidden = true;
    const confirm = await prompt.question("");
    hidden = false; process.stdout.write("\n");
    if (password !== confirm) throw new Error("Passwords do not match.");
    raw = JSON.stringify({ email, password });
  } finally { hidden = false; prompt.close(); }
} else {
  for await (const chunk of process.stdin) { raw += chunk; if (raw.length > 8192) throw new Error("Owner input is too large."); }
}
const storage = createStorage();
try {
  const result = await (command === "create" ? provisionOwner : recoverOwner)(storage.pool, JSON.parse(raw));
  console.log(command === "create" ? "Owner provisioned: " + result.email : "Owner password changed; all sessions revoked.");
} catch (error) {
  console.error(error instanceof Error && !error.name.includes("Zod") ? error.message : "Invalid owner credentials. Use a valid email and a 12–128 character password.");
  process.exitCode = 1;
} finally { await storage.close(); }
