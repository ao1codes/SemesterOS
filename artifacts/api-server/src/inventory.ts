import { pool } from "@workspace/db";
import { ownershipTables } from "./lib/identity-safety";
import { logger } from "./lib/logger";

if (!process.env.DATABASE_URL) throw new Error("Set DATABASE_URL before inventorying ownership.");
try {
  // Contains account IDs: print only to the owner's terminal, never check output into Git.
  for (const table of ownershipTables) {
    const result = await pool.query(`SELECT user_id, count(*)::int AS rows FROM "${table}" GROUP BY user_id ORDER BY user_id`);
    process.stdout.write(JSON.stringify({ table, owners: result.rows }) + "\n");
  }
} catch (err) {
  logger.error({ err }, "Identity inventory failed; apply the schema to a restored copy first");
  process.exitCode = 1;
} finally {
  await pool.end();
}
