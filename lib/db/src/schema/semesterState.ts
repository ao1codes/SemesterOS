import { jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const semesterStates = pgTable("semester_states", {
  userId: text("user_id").primaryKey(),
  state: jsonb("state").$type<Record<string, unknown>>().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const insertSemesterStateSchema = createInsertSchema(semesterStates).omit({
  updatedAt: true,
});
export type InsertSemesterState = z.infer<typeof insertSemesterStateSchema>;
export type SemesterStateRow = typeof semesterStates.$inferSelect;
