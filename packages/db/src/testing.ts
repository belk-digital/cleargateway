import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { createDb } from "./client.js";

const DEFAULT_URL = "postgres://belk:belk@localhost:5433/belkpay";

/**
 * Test helper: (re)creates a throwaway database named `name` on the server from DATABASE_URL,
 * applies all migrations, and returns its URL. Dev data in the main database is never touched.
 * Each test package uses its own name so parallel packages don't clash.
 */
export async function setupTestDatabase(name: string): Promise<string> {
  if (!/^[a-z0-9_]*test[a-z0-9_]*$/.test(name)) throw new Error(`test database name must contain "test": ${name}`);
  const adminUrl = process.env.DATABASE_URL ?? DEFAULT_URL;
  const testUrl = adminUrl.replace(/\/[^/?]+(\?.*)?$/, `/${name}`);

  const admin = postgres(adminUrl, { max: 1 });
  await admin.unsafe(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
  await admin.unsafe(`CREATE DATABASE ${name}`);
  await admin.end();

  const ctx = createDb(testUrl);
  await migrate(ctx.db, { migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)) });
  await ctx.close();
  return testUrl;
}
