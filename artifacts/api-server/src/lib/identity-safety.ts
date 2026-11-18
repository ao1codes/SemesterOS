import { pool } from "@workspace/db";
import { authMode } from "./runtime-config";
import { createHash } from "node:crypto";

// Every ownership table, including the compatibility mirror and OAuth state.
export const ownershipTables = [
  "semester_states", "semester_records", "semester_courses",
  "semester_documents", "semester_assignments", "semester_study_sessions",
  "semester_notifications", "notification_deliveries",
  "google_calendar_connections", "google_calendar_oauth_states",
] as const;

type IdentityDatabase = {
  query(sql: string, params?: string[]): Promise<{ rows: { fingerprint?: string }[]; rowCount?: number | null }>;
};

export async function verifyIdentityCutover(env: NodeJS.ProcessEnv = process.env, database: IdentityDatabase = pool) {
  if (authMode(env) !== "external") return;
  const fingerprint = createHash("sha256").update(env.CLERK_PUBLISHABLE_KEY || "").digest("hex");
  const binding = await database.query("SELECT fingerprint FROM identity_tenant WHERE id = 'clerk'");
  if (binding.rows[0]?.fingerprint === fingerprint) return;
  const choice = env.CLERK_DATA_MIGRATION;
  if (choice !== "empty-new-tenant" && choice !== "verified-existing-ids") {
    throw new Error("External Clerk requires CLERK_DATA_MIGRATION: verify existing user IDs or explicitly choose an empty new tenant. See SETUP.md.");
  }
  // Read-only: never delete or remap existing ownership. Missing schema fails closed.
  if (choice === "empty-new-tenant") {
    for (const table of ownershipTables) {
      const result = await database.query(`SELECT 1 FROM "${table}" LIMIT 1`);
      if (result.rowCount) {
        throw new Error("New Clerk tenant refused: account data already exists. Verify identity migration using SETUP.md.");
      }
    }
  }
  await database.query(`INSERT INTO identity_tenant (id, fingerprint) VALUES ('clerk', $1)
    ON CONFLICT (id) DO UPDATE SET fingerprint = EXCLUDED.fingerprint, acknowledged_at = now()`, [fingerprint]);
}
