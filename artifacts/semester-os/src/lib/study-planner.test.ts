import assert from "node:assert/strict";
import test from "node:test";
import type { SemesterState } from "@workspace/api-client-react";
import { buildStudyPlan, isMissedStudySession } from "./study-planner.ts";

const preferences = {
  timezone: "America/New_York",
  semesterStart: "2026-08-24",
  semesterEnd: "2026-12-18",
  availableDays: [1, 2],
  availabilityStart: "09:00",
  availabilityEnd: "17:00",
  preferredTime: "morning" as const,
  sessionDurationMinutes: 60,
  breakMinutes: 10,
  dailyStudyLimit: 2,
  reminderHours: [24],
  quietHoursStart: "22:00",
  quietHoursEnd: "08:00",
};

function makeState(assignments: unknown[], sessions: unknown[] = []) {
  return {
    preferences,
    assignments,
    sessions,
  } as unknown as Pick<SemesterState, "assignments" | "sessions" | "preferences">;
}

function assignment(overrides: Record<string, unknown> = {}) {
  return {
    id: "assignment-a",
    courseId: "course-a",
    title: "Research paper",
    type: "paper",
    dueDate: "2026-11-18",
    dueTime: "23:59",
    estimatedHours: 4,
    status: "upcoming",
    milestones: [],
    ...overrides,
  };
}

test("planner splits work across available days before the due date", () => {
  const plan = buildStudyPlan(
    makeState([assignment()]),
    ["2026-11-16", "2026-11-17", "2026-11-18"],
    "2026-11-16",
    8 * 60,
    false,
  );

  assert.equal(plan.sessions.length, 4);
  assert.deepEqual([...new Set(plan.sessions.map((session) => session.date))], [
    "2026-11-16",
    "2026-11-17",
  ]);
  assert.ok(plan.sessions.every((session) => session.durationMinutes === 60));
  assert.deepEqual(plan.unplaced, []);
});

test("planner respects existing busy blocks and does not schedule past work", () => {
  const state = makeState(
    [assignment({ estimatedHours: 1 })],
    [{
      id: "busy-a",
      assignmentId: null,
      title: "Busy appointment",
      date: "2026-11-16",
      startTime: "09:00",
      durationMinutes: 120,
      status: "busy",
      completedMinutes: null,
    }],
  );
  const plan = buildStudyPlan(state, ["2026-11-15", "2026-11-16"], "2026-11-16", 8 * 60, false);

  assert.equal(plan.sessions.length, 1);
  assert.equal(plan.sessions[0].date, "2026-11-16");
  assert.equal(plan.sessions[0].startTime, "11:00");
  assert.equal(plan.unplaced.length, 0);
});

test("planner explains work that cannot fit before a deadline", () => {
  const plan = buildStudyPlan(
    makeState([assignment({ dueDate: "2026-11-16", dueTime: "10:00", estimatedHours: 1 })]),
    ["2026-11-16"],
    "2026-11-16",
    11 * 60,
    false,
  );

  assert.equal(plan.sessions.length, 0);
  assert.equal(plan.unplaced[0].title, "Research paper");
  assert.match(plan.unplaced[0].reason, /too little open time/);
});

test("planner never invents a deadline for undated work", () => {
  const plan = buildStudyPlan(
    makeState([assignment({ dueDate: null, estimatedHours: 1.5 })]),
    ["2026-11-16", "2026-11-17"],
    "2026-11-16",
    8 * 60,
    false,
  );

  assert.equal(plan.sessions.length, 0);
  assert.equal(plan.unplaced[0].hours, 1.5);
  assert.match(plan.unplaced[0].reason, /No due date is saved/);
});

test("missed-session detection only treats unfinished assignment sessions as missed", () => {
  const session = {
    id: "session-a",
    assignmentId: "assignment-a",
    title: "Study",
    date: "2026-11-16",
    startTime: "09:00",
    durationMinutes: 60,
    status: "planned",
    completedMinutes: null,
  };
  assert.equal(isMissedStudySession(session as never, "2026-11-16", 11 * 60), true);
  assert.equal(isMissedStudySession({ ...session, status: "completed" } as never, "2026-11-16", 11 * 60), false);
  assert.equal(isMissedStudySession({ ...session, assignmentId: null } as never, "2026-11-16", 11 * 60), false);
});
