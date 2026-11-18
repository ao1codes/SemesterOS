import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

// No connection is opened until a query is made. Public demo/health can start
// without a database; account APIs are gated in the server.
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL || "postgresql://localhost:5432/semesteros",
  connectionTimeoutMillis: 5_000,
});
export const db = drizzle(pool, { schema });

export * from "./schema";
