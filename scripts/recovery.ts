import { spawn } from "node:child_process";
// Host-side Compose orchestration. Secrets stay in Compose environment, never argv/logs.
const [action, name] = process.argv.slice(2);
if (!["backup", "verify", "restore"].includes(action) || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(name || "")) throw new Error("Usage: npm run recovery -- backup|verify|restore BACKUP_NAME");
const args = ["compose", "-f", "docker-compose.yml", "-f", "compose.recovery.yml"];
async function docker(tail: string[]) {
  await new Promise<void>((resolve, reject) => {
    const child = spawn("docker", [...args, ...tail], { stdio: "inherit", shell: false, windowsHide: true });
    child.on("error", reject); child.on("exit", code => code === 0 ? resolve() : reject(new Error("Recovery command failed; services remain stopped. Inspect the error before retrying.")));
  });
}
if (action !== "verify") await docker(["stop", "myai", "worker"]);
await docker(["up", "-d", "--wait", "db"]);
await docker(["run", "--rm", "--no-deps", "recovery", action, name]);
if (action === "backup") console.log("Backup saved. Restart with: docker compose up -d myai worker");
if (action === "restore") console.log("Restore saved. Validate before restart: docker compose run --rm --no-deps migrate node --import tsx scripts/recovery-validate.ts");
