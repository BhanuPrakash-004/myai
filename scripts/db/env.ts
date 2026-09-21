import { existsSync } from "node:fs";
import path from "node:path";

export function loadCliEnv() {
  for (const name of [".env.local", ".env"]) {
    const file = path.resolve(name);
    if (existsSync(file)) process.loadEnvFile(file);
  }
}
