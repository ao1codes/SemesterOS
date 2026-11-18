import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { verifyIdentityCutover, ownershipTables } from "./identity-safety";
import { authConfigured, authMode, corsOrigins, notificationSchedulerEnabled, webBasePath } from "./runtime-config";

test("portable defaults use only supported authentication modes", () => {
  assert.equal(authMode({}), "external");
  assert.equal(authConfigured({}), false);
  assert.throws(() => authMode({ CLERK_MODE: "unsupported" }), /must be external or disabled/);
  assert.equal(webBasePath({ WEB_BASE_PATH: "/semester/" }), "/semester");
  assert.throws(() => webBasePath({ WEB_BASE_PATH: "//../" }));
});

test("development allows the local web origin for Clerk and CORS", () => {
  assert.deepEqual(corsOrigins({ NODE_ENV: "development" }), [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
  ]);
  assert.deepEqual(corsOrigins({
    NODE_ENV: "development",
    WEB_PORT: "5180",
    CORS_ORIGINS: "https://semester.example, http://localhost:5180",
  }), [
    "https://semester.example",
    "http://localhost:5180",
    "http://127.0.0.1:5180",
  ]);
  assert.deepEqual(corsOrigins({
    NODE_ENV: "production",
    CORS_ORIGINS: "https://semester.example",
  }), ["https://semester.example"]);
});

function mockDb(occupied = false, fingerprint?: string) {
  const statements: string[] = [];
  return {
    statements,
    async query(sql: string) {
      statements.push(sql);
      return { rows: sql.startsWith("SELECT fingerprint") && fingerprint ? [{ fingerprint }] : [], rowCount: sql.startsWith("SELECT 1") && occupied ? 1 : 0 };
    },
  };
}
const external = { CLERK_MODE: "external", CLERK_PUBLISHABLE_KEY: "public-test-key" };
test("startup scheduling is off unless explicitly enabled", () => {
  assert.equal(notificationSchedulerEnabled({}), false);
  for (const value of ["", "false", "TRUE", "1", "yes"]) {
    assert.equal(notificationSchedulerEnabled({ NOTIFICATION_SCHEDULER_ENABLED: value }), false);
  }
  assert.equal(notificationSchedulerEnabled({ NOTIFICATION_SCHEDULER_ENABLED: "true" }), true);
});
test("unacknowledged external identities fail closed without changing owners", async () => {
  const database = mockDb();
  await assert.rejects(verifyIdentityCutover(external, database), /CLERK_DATA_MIGRATION/);
  assert.equal(database.statements.length, 1);
});
test("new tenants cannot access a populated database", async () => {
  const database = mockDb(true);
  await assert.rejects(verifyIdentityCutover({ ...external, CLERK_DATA_MIGRATION: "empty-new-tenant" }, database), /account data already exists/);
  assert.ok(database.statements.every(sql => sql.startsWith("SELECT")));
});
test("empty tenant choice checks every ownership table and saves only its tenant binding", async () => {
  const database = mockDb();
  await verifyIdentityCutover({ ...external, CLERK_DATA_MIGRATION: "empty-new-tenant" }, database);
  for (const table of ownershipTables) assert.ok(database.statements.some(sql => sql.includes(`"${table}"`)));
  assert.match(database.statements.at(-1)!, /^INSERT INTO identity_tenant/);
});
test("a bound tenant restarts after users save data without repeating empty checks", async () => {
  const fingerprint = createHash("sha256").update(external.CLERK_PUBLISHABLE_KEY).digest("hex");
  const database = mockDb(true, fingerprint);
  await verifyIdentityCutover(external, database);
  assert.equal(database.statements.length, 1);
});
test("verified migration acknowledgement never rewrites ownership", async () => {
  const database = mockDb(true);
  await verifyIdentityCutover({ ...external, CLERK_DATA_MIGRATION: "verified-existing-ids" }, database);
  assert.equal(database.statements.length, 2);
  assert.match(database.statements[1], /^INSERT INTO identity_tenant/);
});
