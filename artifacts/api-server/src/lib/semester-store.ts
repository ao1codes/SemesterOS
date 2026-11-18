import { and, asc, eq, sql } from "drizzle-orm";
import { normalizeWireDates, stateRevision, StateConflict } from "./state-revision";
import {
  db,
  notificationDeliveries,
  semesterAssignments,
  semesterCourses,
  semesterDocuments,
  semesterNotifications,
  semesterRecords,
  semesterStates,
  semesterStudySessions,
  googleCalendarConnections,
  googleCalendarOAuthStates,
} from "@workspace/db";
import { GetSemesterStateResponse } from "@workspace/api-zod";

export type SemesterState = ReturnType<typeof GetSemesterStateResponse.parse>;
type DbSession = Pick<typeof db, "delete" | "insert">;
type DeliverySeed = {
  notificationId: string;
  channel: "email" | "push";
  idempotencyKey: string;
};

export const emptySemesterState: SemesterState = GetSemesterStateResponse.parse({
  courses: [],
  assignments: [],
  sessions: [],
  notifications: [],
  documents: [],
  preferences: {
    timezone: "America/New_York",
    semesterStart: "2026-08-24",
    semesterEnd: "2026-12-18",
    availableDays: [1, 2, 3, 4, 5],
    availabilityStart: "09:00",
    availabilityEnd: "21:00",
    preferredTime: "afternoon",
    sessionDurationMinutes: 60,
    breakMinutes: 10,
    dailyStudyLimit: 4,
    reminderHours: [24, 72],
    notificationCategories: [
      "deadline",
      "exam",
      "study_session",
      "workload",
      "conflict",
      "missed_session",
      "syllabus",
      "progress",
    ],
    quietHoursStart: "22:00",
    quietHoursEnd: "08:00",
  },
});

function dateKey(value: Date | string | null | undefined): string | null {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return value.slice(0, 10);
}

function asDate(value: Date | string | null | undefined): Date | null {
  if (value == null) return null;
  return value instanceof Date ? value : new Date(value);
}

async function replaceNormalizedRows(
  tx: DbSession,
  userId: string,
  state: SemesterState,
  updatedAt: Date,
) {
  await tx
    .insert(semesterRecords)
    .values({
      userId,
      preferences: state.preferences as unknown as Record<string, unknown>,
      updatedAt,
    })
    .onConflictDoUpdate({
      target: semesterRecords.userId,
      set: {
        preferences: state.preferences as unknown as Record<string, unknown>,
        updatedAt,
      },
    });

  await tx.delete(semesterStudySessions).where(eq(semesterStudySessions.userId, userId));
  await tx.delete(semesterAssignments).where(eq(semesterAssignments.userId, userId));
  await tx.delete(semesterDocuments).where(eq(semesterDocuments.userId, userId));
  await tx.delete(semesterNotifications).where(eq(semesterNotifications.userId, userId));
  await tx.delete(semesterCourses).where(eq(semesterCourses.userId, userId));

  if (state.courses.length) {
    await tx.insert(semesterCourses).values(state.courses.map((course, position) => ({
      userId,
      id: course.id,
      name: course.name,
      code: course.code,
      instructor: course.instructor ?? null,
      color: course.color,
      description: course.description ?? null,
      targetFinalGrade: course.targetFinalGrade ?? null,
      gradingMode: course.gradingMode ?? "assignment_weighted",
      gradeCategories: course.gradeCategories ?? [],
      semesterStart: dateKey(course.semesterStart)!,
      semesterEnd: dateKey(course.semesterEnd)!,
      position,
    })));
  }

  if (state.documents.length) {
    await tx.insert(semesterDocuments).values(state.documents.map((document, position) => ({
      userId,
      id: document.id,
      courseId: document.courseId ?? null,
      filename: document.filename,
      uploadedAt: asDate(document.uploadedAt)!,
      version: document.version,
      policyNotes: document.policyNotes,
      snapshot: document.snapshot ?? null,
      position,
    })));
  }

  if (state.assignments.length) {
    await tx.insert(semesterAssignments).values(state.assignments.map((assignment, position) => ({
      userId,
      id: assignment.id,
      courseId: assignment.courseId,
      title: assignment.title,
      type: assignment.type,
      dueDate: dateKey(assignment.dueDate),
      dueTime: assignment.dueTime ?? null,
      gradeWeight: assignment.gradeWeight ?? null,
      estimatedHours: assignment.estimatedHours ?? null,
      description: assignment.description ?? null,
      status: assignment.status,
      gradeEarned: assignment.gradeEarned ?? null,
      gradeCategoryId: assignment.gradeCategoryId ?? null,
      pointsEarned: assignment.pointsEarned ?? null,
      pointsPossible: assignment.pointsPossible ?? null,
      sourceDocumentId: assignment.sourceDocumentId ?? null,
      sourcePage: assignment.sourcePage ?? null,
      milestones: assignment.milestones,
      position,
    })));
  }

  if (state.sessions.length) {
    await tx.insert(semesterStudySessions).values(state.sessions.map((session, position) => ({
      userId,
      id: session.id,
      assignmentId: session.assignmentId ?? null,
      title: session.title,
      date: dateKey(session.date)!,
      startTime: session.startTime,
      durationMinutes: session.durationMinutes,
      status: session.status,
      completedMinutes: session.completedMinutes ?? null,
      calendarEventId: session.calendarEventId ?? null,
      position,
    })));
  }

  if (state.notifications.length) {
    await tx.insert(semesterNotifications).values(state.notifications.map((notification, position) => ({
      userId,
      id: notification.id,
      category: notification.category,
      title: notification.title,
      message: notification.message,
      createdAt: asDate(notification.createdAt)!,
      isRead: notification.isRead,
      dismissed: notification.dismissed,
      snoozedUntil: asDate(notification.snoozedUntil),
      position,
    })));
  }
}

async function readNormalizedRows(userId: string): Promise<SemesterState | null> {
  const [record] = await db
    .select({ preferences: semesterRecords.preferences })
    .from(semesterRecords)
    .where(eq(semesterRecords.userId, userId))
    .limit(1);
  if (!record) return null;

  const [courses, assignments, sessions, notifications, documents] = await Promise.all([
    db.select().from(semesterCourses).where(eq(semesterCourses.userId, userId)).orderBy(asc(semesterCourses.position)),
    db.select().from(semesterAssignments).where(eq(semesterAssignments.userId, userId)).orderBy(asc(semesterAssignments.position)),
    db.select().from(semesterStudySessions).where(eq(semesterStudySessions.userId, userId)).orderBy(asc(semesterStudySessions.position)),
    db.select().from(semesterNotifications).where(eq(semesterNotifications.userId, userId)).orderBy(asc(semesterNotifications.position)),
    db.select().from(semesterDocuments).where(eq(semesterDocuments.userId, userId)).orderBy(asc(semesterDocuments.position)),
  ]);

  return GetSemesterStateResponse.parse({
    courses: courses.map((course) => ({
      id: course.id,
      name: course.name,
      code: course.code,
      instructor: course.instructor,
      color: course.color,
      description: course.description,
      targetFinalGrade: course.targetFinalGrade,
      gradingMode: course.gradingMode,
      gradeCategories: course.gradeCategories,
      semesterStart: course.semesterStart,
      semesterEnd: course.semesterEnd,
    })),
    assignments: assignments.map((assignment) => ({
      id: assignment.id,
      courseId: assignment.courseId,
      title: assignment.title,
      type: assignment.type,
      dueDate: assignment.dueDate,
      dueTime: assignment.dueTime,
      gradeWeight: assignment.gradeWeight,
      estimatedHours: assignment.estimatedHours,
      description: assignment.description,
      status: assignment.status,
      gradeEarned: assignment.gradeEarned,
      gradeCategoryId: assignment.gradeCategoryId,
      pointsEarned: assignment.pointsEarned,
      pointsPossible: assignment.pointsPossible,
      sourceDocumentId: assignment.sourceDocumentId,
      sourcePage: assignment.sourcePage,
      milestones: assignment.milestones,
    })),
    sessions: sessions.map((session) => ({
      id: session.id,
      assignmentId: session.assignmentId,
      title: session.title,
      date: session.date,
      startTime: session.startTime,
      durationMinutes: session.durationMinutes,
      status: session.status,
      completedMinutes: session.completedMinutes,
      calendarEventId: session.calendarEventId,
    })),
    notifications: notifications.map((notification) => ({
      id: notification.id,
      category: notification.category,
      title: notification.title,
      message: notification.message,
      createdAt: notification.createdAt.toISOString(),
      isRead: notification.isRead,
      dismissed: notification.dismissed,
      snoozedUntil: notification.snoozedUntil?.toISOString() ?? null,
    })),
    documents: documents.map((document) => ({
      id: document.id,
      courseId: document.courseId,
      filename: document.filename,
      uploadedAt: document.uploadedAt.toISOString(),
      version: document.version,
      policyNotes: document.policyNotes,
      snapshot: document.snapshot ?? undefined,
    })),
    preferences: record.preferences,
  });
}

export async function readSemesterState(
  userId: string,
  fallback: SemesterState = emptySemesterState,
): Promise<SemesterState> {
  const [normalizedRecord] = await db
    .select({ updatedAt: semesterRecords.updatedAt })
    .from(semesterRecords)
    .where(eq(semesterRecords.userId, userId))
    .limit(1);
  const [legacyRecord] = await db
    .select({ state: semesterStates.state, updatedAt: semesterStates.updatedAt })
    .from(semesterStates)
    .where(eq(semesterStates.userId, userId))
    .limit(1);

  // The mirror is one atomic snapshot; prefer it to reading several tables while another writer commits.
  if (legacyRecord && (!normalizedRecord || legacyRecord.updatedAt >= normalizedRecord.updatedAt)) {
    return GetSemesterStateResponse.parse(normalizeWireDates(legacyRecord.state));
  }

  if (normalizedRecord && (!legacyRecord || normalizedRecord.updatedAt >= legacyRecord.updatedAt)) {
    const normalized = await readNormalizedRows(userId);
    if (normalized) return normalized;
  }

  if (!legacyRecord) return fallback;
  const legacyState = GetSemesterStateResponse.parse(normalizeWireDates(legacyRecord.state));
  await db.transaction(async (tx) => {
    await replaceNormalizedRows(tx, userId, legacyState, legacyRecord.updatedAt);
  });
  return legacyState;
}

export async function hasStoredSemesterState(userId: string): Promise<boolean> {
  const [normalized] = await db
    .select({ userId: semesterRecords.userId })
    .from(semesterRecords)
    .where(eq(semesterRecords.userId, userId))
    .limit(1);
  if (normalized) return true;
  const [legacy] = await db
    .select({ userId: semesterStates.userId })
    .from(semesterStates)
    .where(eq(semesterStates.userId, userId))
    .limit(1);
  return Boolean(legacy);
}

export async function saveSemesterState(
  userId: string,
  state: SemesterState,
  updatedAt = new Date(),
) {
  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${userId}))`);
    const [existing] = await tx.select().from(semesterStates).where(eq(semesterStates.userId,userId)).for("update");
    const current = existing ? GetSemesterStateResponse.parse(normalizeWireDates(existing.state)) : await readSemesterState(userId);
    if (!state.revision || state.revision !== stateRevision(current)) throw new StateConflict();
    const clean = { ...state };
    delete clean.revision;
    await replaceNormalizedRows(tx, userId, clean, updatedAt);
    await tx
      .insert(semesterStates)
      .values({ userId, state:clean, updatedAt })
      .onConflictDoUpdate({
        target: semesterStates.userId,
        set: { state:clean, updatedAt },
      });
  });
}

export async function commitScheduledState(
  userId: string,
  expectedState: unknown,
  expectedUpdatedAt: Date,
  nextState: SemesterState,
  deliveries: DeliverySeed[],
  now: Date,
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const updated = await tx
      .update(semesterStates)
      .set({ state: nextState, updatedAt: now })
      .where(and(
        eq(semesterStates.userId, userId),
        eq(semesterStates.updatedAt, expectedUpdatedAt),
        eq(semesterStates.state, expectedState as Record<string, unknown>),
      ))
      .returning({ userId: semesterStates.userId });
    if (!updated.length) return false;

    await replaceNormalizedRows(tx, userId, nextState, now);
    if (deliveries.length) {
      await tx.insert(notificationDeliveries).values(deliveries.map((delivery) => ({
        userId,
        notificationId: delivery.notificationId,
        channel: delivery.channel,
        idempotencyKey: delivery.idempotencyKey,
      }))).onConflictDoNothing();
    }
    return true;
  });
}

export async function deleteSemesterState(userId: string) {
  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${userId}))`);
    await tx.select().from(semesterStates).where(eq(semesterStates.userId,userId)).for("update");
    await tx.delete(notificationDeliveries).where(eq(notificationDeliveries.userId, userId));
    await tx.delete(semesterRecords).where(eq(semesterRecords.userId, userId));
    await tx.delete(semesterStates).where(eq(semesterStates.userId, userId));
    await tx.delete(googleCalendarOAuthStates).where(eq(googleCalendarOAuthStates.userId,userId));
    await tx.delete(googleCalendarConnections).where(eq(googleCalendarConnections.userId,userId));
  });
}
