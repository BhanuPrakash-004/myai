import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/lib/storage/schema.ts",
  out: "./migrations",
  strict: true,
});
