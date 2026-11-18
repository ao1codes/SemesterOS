import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

// Configuration metadata only. Never rewrites semester ownership.
export const identityTenant = pgTable("identity_tenant", {
  id: text("id").primaryKey(),
  fingerprint: text("fingerprint").notNull(),
  acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }).defaultNow().notNull(),
});
