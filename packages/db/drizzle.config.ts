import { defineConfig } from "drizzle-kit";

// `drizzle-kit generate` only diffs the TS schema against drizzle/meta snapshots — it never connects,
// so the fallback URL below is never dialed. `migrate` at runtime is done by apps/worker (src/migrate.ts).
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema.ts",
  out: "./drizzle",
  dbCredentials: { url: process.env.DATABASE_URL ?? "postgres://localhost/unused" },
});
