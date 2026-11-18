import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const googleCalendarConnections = pgTable("google_calendar_connections", {
  userId: text("user_id").primaryKey(),
  encryptedRefreshToken: text("encrypted_refresh_token").notNull(),
  encryptedAccessToken: text("encrypted_access_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
  grantedScopes: text("granted_scopes").array().notNull().default([]),
  connectedAt: timestamp("connected_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const googleCalendarOAuthStates = pgTable("google_calendar_oauth_states", {
  stateHash: text("state_hash").primaryKey(),
  userId: text("user_id").notNull(),
  encryptedCodeVerifier: text("encrypted_code_verifier").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const insertGoogleCalendarConnectionSchema = createInsertSchema(googleCalendarConnections);
export type InsertGoogleCalendarConnection = z.infer<typeof insertGoogleCalendarConnectionSchema>;
export type GoogleCalendarConnection = typeof googleCalendarConnections.$inferSelect;

export const insertGoogleCalendarOAuthStateSchema = createInsertSchema(googleCalendarOAuthStates).omit({ createdAt: true });
export type InsertGoogleCalendarOAuthState = z.infer<typeof insertGoogleCalendarOAuthStateSchema>;
export type GoogleCalendarOAuthState = typeof googleCalendarOAuthStates.$inferSelect;
