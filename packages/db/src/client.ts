import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";

export function createDb(databaseUrl: string) {
  const sql = postgres(databaseUrl, { max: 10 });
  const db = drizzle(sql, { schema });
  return { db, sql, close: () => sql.end() };
}

export type Db = ReturnType<typeof createDb>["db"];
/** A Drizzle transaction handle (what `db.transaction(async (tx) => ...)` passes in). */
export type DbTx = Parameters<Parameters<Db["transaction"]>[0]>[0];
/** Anything that can run queries: the pool or an open transaction. */
export type Executor = Db | DbTx;
