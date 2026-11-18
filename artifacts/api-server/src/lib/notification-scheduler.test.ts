import assert from "node:assert/strict";
import test from "node:test";
import { buildScheduledNotifications } from "./notification-scheduler.ts";

type SemesterState = Parameters<typeof buildScheduledNotifications>[0];

function makeState(
  assignments: SemesterState["assignments"] = [],
  sessions: SemesterState["sessions"] = [],
  notifications: SemesterState["notifications"] = [],
): SemesterState {
  return {
    courses: [],
    assignments,
    sessions,
    notifications,
    documents: [],
    preferences: {
      timezone: "UTC",
      semesterStart: "2026-09-01",
      semesterEnd: "2026-12-20",
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
  } as unknown as SemesterState;
}

const dueAssignment = {
  id: "assignment-1",
  courseId: "course-1",
  title: "Research paper",
  type: "assignment",
  dueDate: "2026-11-14",
  dueTime: "23:59",
  estimatedHours: 3,
  status: "not_started",
} as unknown as SemesterState["assignments"][number];

test("deadline reminders use configured thresholds and remain deduplicated", () => {
  const state = makeState([dueAssignment]);
  const now = new Date("2026-11-13T11:00:00.000Z");
  const first = buildScheduledNotifications(state, now);
  assert.deepEqual(first.map((item) => item.id), [
    "deadline-assignment-1-2026-11-14-23:59-72",
  ]);

  const duplicateState = makeState(
    [dueAssignment],
    [],
    first,
  );
  assert.deepEqual(buildScheduledNotifications(duplicateState, now), []);
});

test("quiet hours suppress reminders without suppressing the later schedule", () => {
  const state = makeState([dueAssignment]);
  assert.deepEqual(
    buildScheduledNotifications(state, new Date("2026-11-13T23:30:00.000Z")),
    [],
  );
  assert.equal(
    buildScheduledNotifications(state, new Date("2026-11-13T11:00:00.000Z")).length,
    1,
  );
});
