import {
  boolean,
  date,
  foreignKey,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const semesterRecords = pgTable("semester_records", {
  userId: text("user_id").primaryKey(),
  preferences: jsonb("preferences").$type<Record<string, unknown>>().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const semesterCourses = pgTable(
  "semester_courses",
  {
    userId: text("user_id").notNull(),
    id: text("id").notNull(),
    name: text("name").notNull(),
    code: text("code").notNull(),
    instructor: text("instructor"),
    color: text("color").notNull(),
    description: text("description"),
    targetFinalGrade: real("target_final_grade"),
    gradingMode: text("grading_mode").notNull(),
    gradeCategories: jsonb("grade_categories").$type<unknown[]>().notNull(),
    semesterStart: date("semester_start", { mode: "string" }).notNull(),
    semesterEnd: date("semester_end", { mode: "string" }).notNull(),
    position: integer("position").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.id] }),
    foreignKey({
      columns: [table.userId],
      foreignColumns: [semesterRecords.userId],
    }).onDelete("cascade"),
  ],
);

export const semesterDocuments = pgTable(
  "semester_documents",
  {
    userId: text("user_id").notNull(),
    id: text("id").notNull(),
    courseId: text("course_id"),
    filename: text("filename").notNull(),
    uploadedAt: timestamp("uploaded_at", { withTimezone: true }).notNull(),
    version: integer("version").notNull(),
    policyNotes: jsonb("policy_notes").$type<unknown[]>().notNull(),
    snapshot: jsonb("snapshot").$type<unknown>(),
    position: integer("position").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.id] }),
    foreignKey({
      columns: [table.userId],
      foreignColumns: [semesterRecords.userId],
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.userId, table.courseId],
      foreignColumns: [semesterCourses.userId, semesterCourses.id],
    }).onDelete("cascade"),
  ],
);

export const semesterAssignments = pgTable(
  "semester_assignments",
  {
    userId: text("user_id").notNull(),
    id: text("id").notNull(),
    courseId: text("course_id").notNull(),
    title: text("title").notNull(),
    type: text("type").notNull(),
    dueDate: date("due_date", { mode: "string" }),
    dueTime: text("due_time"),
    gradeWeight: real("grade_weight"),
    estimatedHours: real("estimated_hours"),
    description: text("description"),
    status: text("status").notNull(),
    gradeEarned: real("grade_earned"),
    gradeCategoryId: text("grade_category_id"),
    pointsEarned: real("points_earned"),
    pointsPossible: real("points_possible"),
    sourceDocumentId: text("source_document_id"),
    sourcePage: integer("source_page"),
    milestones: jsonb("milestones").$type<unknown[]>().notNull(),
    position: integer("position").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.id] }),
    foreignKey({
      columns: [table.userId],
      foreignColumns: [semesterRecords.userId],
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.userId, table.courseId],
      foreignColumns: [semesterCourses.userId, semesterCourses.id],
    }).onDelete("cascade"),
  ],
);

export const semesterStudySessions = pgTable(
  "semester_study_sessions",
  {
    userId: text("user_id").notNull(),
    id: text("id").notNull(),
    assignmentId: text("assignment_id"),
    title: text("title").notNull(),
    date: date("date", { mode: "string" }).notNull(),
    startTime: text("start_time").notNull(),
    durationMinutes: integer("duration_minutes").notNull(),
    status: text("status").notNull(),
    completedMinutes: integer("completed_minutes"),
    calendarEventId: text("calendar_event_id"),
    position: integer("position").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.id] }),
    foreignKey({
      columns: [table.userId],
      foreignColumns: [semesterRecords.userId],
    }).onDelete("cascade"),
  ],
);

export const semesterNotifications = pgTable(
  "semester_notifications",
  {
    userId: text("user_id").notNull(),
    id: text("id").notNull(),
    category: text("category").notNull(),
    title: text("title").notNull(),
    message: text("message").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    isRead: boolean("is_read").notNull(),
    dismissed: boolean("dismissed").notNull(),
    snoozedUntil: timestamp("snoozed_until", { withTimezone: true }),
    position: integer("position").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.id] }),
    foreignKey({
      columns: [table.userId],
      foreignColumns: [semesterRecords.userId],
    }).onDelete("cascade"),
  ],
);

export const insertSemesterRecordSchema = createInsertSchema(semesterRecords).omit({ updatedAt: true });
export type InsertSemesterRecord = z.infer<typeof insertSemesterRecordSchema>;
export type SemesterRecord = typeof semesterRecords.$inferSelect;

export const insertSemesterCourseSchema = createInsertSchema(semesterCourses).omit({ position: true });
export type InsertSemesterCourse = z.infer<typeof insertSemesterCourseSchema>;
export type SemesterCourse = typeof semesterCourses.$inferSelect;

export const insertSemesterDocumentSchema = createInsertSchema(semesterDocuments).omit({ position: true });
export type InsertSemesterDocument = z.infer<typeof insertSemesterDocumentSchema>;
export type SemesterDocument = typeof semesterDocuments.$inferSelect;

export const insertSemesterAssignmentSchema = createInsertSchema(semesterAssignments).omit({ position: true });
export type InsertSemesterAssignment = z.infer<typeof insertSemesterAssignmentSchema>;
export type SemesterAssignment = typeof semesterAssignments.$inferSelect;

export const insertSemesterStudySessionSchema = createInsertSchema(semesterStudySessions).omit({ position: true });
export type InsertSemesterStudySession = z.infer<typeof insertSemesterStudySessionSchema>;
export type SemesterStudySession = typeof semesterStudySessions.$inferSelect;

export const insertSemesterNotificationSchema = createInsertSchema(semesterNotifications).omit({ position: true });
export type InsertSemesterNotification = z.infer<typeof insertSemesterNotificationSchema>;
export type SemesterNotification = typeof semesterNotifications.$inferSelect;
