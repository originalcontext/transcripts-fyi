import { defineConfig } from "drizzle-kit";

// CLI-only (generate/migrate). The app never uses this path.
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/lib/db/schema.ts",
  out: "./drizzle",
  dbCredentials: { url: process.env.DATABASE_URL! },
});
