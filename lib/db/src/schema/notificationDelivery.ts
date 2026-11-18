import {
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const notificationDeliveries = pgTable(
  "notification_deliveries",
  {
    userId: text("user_id").notNull(),
    notificationId: text("notification_id").notNull(),
    channel: text("channel").notNull(),
    idempotencyKey: text("idempotency_key").notNull().unique(),
    status: text("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    providerMessageId: text("provider_message_id"),
    lastErrorCode: text("last_error_code"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
  },
  (table) => [
    primaryKey({
      columns: [table.userId, table.notificationId, table.channel],
    }),
    index("notification_deliveries_due_idx").on(
      table.status,
      table.nextAttemptAt,
    ),
  ],
);

export const insertNotificationDeliverySchema = createInsertSchema(
  notificationDeliveries,
).omit({
  createdAt: true,
  updatedAt: true,
});

export type InsertNotificationDelivery = z.infer<
  typeof insertNotificationDeliverySchema
>;
export type NotificationDelivery = typeof notificationDeliveries.$inferSelect;
