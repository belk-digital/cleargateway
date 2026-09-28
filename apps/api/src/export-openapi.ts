import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Db } from "@belk/db";
import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";

/**
 * Writes the public API description (OpenAPI 3) that the docs site renders, so the reference is generated from the same
 * route schemas the API validates with and cannot drift. Needs no database or network: routes only register.
 * Usage: tsx src/export-openapi.ts <output.json>
 */
const out = process.argv[2];
if (!out) throw new Error("usage: export-openapi <output.json>");

const config = loadConfig({
  NODE_ENV: "test",
  DATABASE_URL: "postgres://x:x@localhost:1/x",
  REDIS_URL: "redis://localhost:1",
  RPC_URL: "https://sepolia.base.org",
  CLIENT_SECRET_KEY: "00".repeat(32),
  ENCRYPTION_KEY: "00".repeat(32),
  CHECKOUT_ORIGIN: "http://localhost:3001",
  CHECKOUT_BASE_URL: "http://localhost:3001/pay",
});
const app = await buildApp({ config, db: {} as Db });
await app.ready();
const spec = app.swagger() as { paths: Record<string, unknown>; tags?: unknown };

// Public surface only: merchant API and hosted-checkout calls. Staff, sign-in and inbound-provider routes are not for merchants.
const paths = Object.fromEntries(Object.entries(spec.paths).filter(([p]) => p.startsWith("/v1/")));
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify({ ...spec, paths }, null, 2));
await app.close();
console.log(`wrote ${Object.keys(paths).length} paths to ${out}`);
