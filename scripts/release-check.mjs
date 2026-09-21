import { spawn } from "node:child_process";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { request as browserRequest } from "@playwright/test";

// Fixed project prefix and generated private environment: never target owner volumes.
const project = "myai-release-" + randomBytes(4).toString("hex");
const scratch = await mkdtemp(path.join(tmpdir(), "myai-release-"));
const password = randomBytes(24).toString("hex"), port = process.env.RELEASE_TEST_PORT || "3392";
const tlsPort = process.env.RELEASE_TLS_PORT || "3443";
const env = { ...process.env, POSTGRES_USER: "myai", POSTGRES_DB: "myai", POSTGRES_PASSWORD: randomBytes(24).toString("hex"),
  BETTER_AUTH_SECRET: randomBytes(48).toString("hex"), APP_PORT: port, APP_URL: `http://localhost:${port}`,
  MYAI_IMAGE_TAG: process.env.RELEASE_IMAGE_TAG || "p12-check", OPENROUTER_API_KEY: "", OPENROUTER_CHAT_MODEL: "",
  OPENROUTER_STRUCTURED_MODEL: "", AI_INDEXING_ENABLED: "false", RERANK_ENABLED: "false", GRAPH_EXPANSION_ENABLED: "false" };
const envFile = path.join(scratch, "empty.env"); await writeFile(envFile, "");
const compose = ["compose", "--env-file", envFile, "-p", project, "-f", "docker-compose.yml"];
function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env, shell: false, windowsHide: true, stdio: ["pipe", "pipe", "pipe"], ...options });
    let output = "";
    child.stdout.on("data", data => { output += data; if (!options.quiet) process.stdout.write(data); });
    child.stderr.on("data", data => { if (!options.quiet) process.stderr.write(data); });
    child.on("error", reject);
    child.on("close", code => code === 0 ? resolve(output.trim()) : reject(new Error(command + " failed (" + code + ")")));
    child.stdin.end(options.input || "");
  });
}
const docker = (args, options) => run("docker", [...compose, ...args], options);
let proxyStarted = false;
try {
  if (!process.argv.includes("--skip-build")) await docker(["build", "myai", "migrate"]);
  await docker(["up", "-d", "--wait", "db"]);
  await docker(["run", "--rm", "-T", "migrate"]);
  await docker(["run", "--rm", "-T", "migrate", "node", "--import", "tsx", "scripts/owner.ts", "create"], { input: JSON.stringify({ email: "owner@example.test", password }) });
  await docker(["up", "-d", "--no-build", "--wait", "myai", "worker"]);
  let api = await browserRequest.newContext({ baseURL: env.APP_URL, extraHTTPHeaders: { Origin: env.APP_URL } });
  assert.equal((await api.get("/api/ready")).status(), 200);
  assert.equal((await api.get("/api/knowledge")).status(), 401);
  assert.equal((await api.post("/api/auth/sign-in/email", { data: { email: "owner@example.test", password } })).status(), 200);
  const json = async response => { assert(response.ok(), await response.text()); return response.json(); };
  const key = randomUUID(), body = { title: "Release persistence", body: "Synthetic release fixture: persistencekeyword." };
  const receipt = (await json(await api.post("/api/knowledge", { data: body, headers: { "Idempotency-Key": key } }))).receipt;
  assert.equal((await json(await api.post("/api/knowledge", { data: body, headers: { "Idempotency-Key": key } }))).receipt.noteId, receipt.noteId);
  const attachment = (await json(await api.post("/api/attachments", { data: "Synthetic attachment", headers: { "Content-Type": "text/plain", "X-File-Name": "fixture.txt" } }))).attachment;
  await docker(["restart", "myai", "worker"]);
  await docker(["up", "-d", "--no-deps", "--wait", "myai", "worker"]);
  assert.equal((await json(await api.get("/api/notes/" + receipt.noteId))).note.body, body.body);
  assert.equal(await (await api.get("/api/attachments/" + attachment.id)).text(), "Synthetic attachment");
  assert((await json(await api.get("/api/search?q=persistencekeyword&method=keyword"))).results.length > 0);
  for (let i = 0; i < 40; i++) {
    const status = await json(await api.get("/api/vector/status"));
    if (status.workers.some(w => w.alive) && status.stages.some(s => s.stage === "chunks" && s.status === "ready")) break;
    if (i === 39) throw new Error("Worker did not process the current note");
    await delay(1000);
  }
  // Migrating an existing installation and recreating matching containers preserves data.
  await docker(["stop", "myai", "worker"]);
  await docker(["run", "--rm", "-T", "--no-deps", "migrate"]);
  await docker(["run", "--rm", "-T", "--no-deps", "migrate", "node", "--import", "tsx", "scripts/recovery-validate.ts"]);
  env.APP_URL = `https://localhost:${tlsPort}`;
  await docker(["up", "-d", "--no-deps", "--force-recreate", "--wait", "myai", "worker"]);
  const caddy = (await readFile("deploy/Caddyfile", "utf8")).replace("{$APP_DOMAIN} {", "{$APP_DOMAIN} {\n  tls internal");
  const caddyPath = path.join(scratch, "Caddyfile"); await writeFile(caddyPath, caddy);
  await run("docker", ["run", "-d", "--name", project + "-proxy", "--network", project + "_default", "-p", `127.0.0.1:${tlsPort}:443`, "-e", "APP_DOMAIN=localhost", "-v", caddyPath + ":/etc/caddy/Caddyfile:ro", "caddy:2.10.2-alpine@sha256:4c6e91c6ed0e2fa03efd5b44747b625fec79bc9cd06ac5235a779726618e530d"]);
  proxyStarted = true;
  await api.dispose();
  api = await browserRequest.newContext({ baseURL: env.APP_URL, ignoreHTTPSErrors: true, extraHTTPHeaders: { Origin: env.APP_URL } });
  for (let i = 0; i < 30; i++) { try { if ((await api.get("/api/ready")).ok()) break; } catch {} await delay(500); }
  const login = await api.post("/api/auth/sign-in/email", { data: { email: "owner@example.test", password } });
  assert.equal(login.status(), 200); assert.match(login.headers()["set-cookie"], /; Secure/i);
  assert.equal((await api.get("/api/notes/" + receipt.noteId)).status(), 200);
  assert.equal((await api.post("/api/knowledge", { data: body, headers: { Origin: "https://evil.example.test", "Idempotency-Key": randomUUID() } })).status(), 403);
  const stream = await api.post("/api/chat", { data: { mode: "save", messages: [{ role: "user", content: "Synthetic streaming fixture" }] }, headers: { "Idempotency-Key": randomUUID() } });
  assert.match(stream.headers()["content-type"], /text\/event-stream/); assert.match(await stream.text(), /"type":"complete"/);
  await api.dispose();
  await run(process.execPath, ["node_modules/@playwright/test/cli.js", "test"], { env: { ...env, BROWSER_TEST_URL: env.APP_URL, BROWSER_TEST_PASSWORD: password } });
  // Verify image UID and build-context exclusion without printing environment values.
  for (const service of ["myai", "worker"]) {
    assert.equal(await docker(["exec", "-T", service, "id", "-u"], { quiet: true }), "1000");
    await docker(["exec", "-T", service, "node", "-e", "const f=require('fs');for(const p of ['.env','.env.local','data/myai.db','vault','backups'])if(f.existsSync(p))process.exit(1)"]);
  }
  await docker(["stop", "db"]);
  const health = await browserRequest.newContext({ baseURL: env.APP_URL, ignoreHTTPSErrors: true });
  try {
    assert.equal((await health.get("/api/health")).status(), 200);
    assert.equal((await health.get("/api/ready")).status(), 503);
  } finally { await health.dispose(); }
  console.log("PASS: fresh setup, owner, no-key save/search, attachments, worker restart, migrations/recreation, HTTPS cookies/origin/SSE, desktop/mobile workflow and image isolation.");
} finally {
  if (proxyStarted) await run("docker", ["rm", "-f", project + "-proxy"]);
  // Only this random fixture project is removed; production Compose volumes are untouched.
  await docker(["down", "--volumes", "--remove-orphans"]);
  const resolved = path.resolve(scratch);
  if (path.dirname(resolved) === path.resolve(tmpdir()) && path.basename(resolved).startsWith("myai-release-")) await rm(resolved, { recursive: true, force: true });
}
