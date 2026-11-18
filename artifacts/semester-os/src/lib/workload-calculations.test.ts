import assert from "node:assert/strict";
import test from "node:test";
import type { Assignment, SemesterState, StudySession } from "@workspace/api-client-react";
import { normalizeClockTime, semesterDateRange } from "@workspace/academic";
import { getWeeklyWorkload } from "./workload-calculations.ts";

function assignment(overrides: Partial<Assignment> = {}): Assignment {
  return {
    id: "assignment-a", courseId: "course-a", title: "Paper", type: "paper",
    dueDate: "2026-11-18", estimatedHours: 2, gradeWeight: null,
    status: "upcoming", milestones: [], ...overrides,
  };
}

function state(assignments: Assignment[], sessions: StudySession[] = [], availableDays = [1, 2, 3, 4, 5]) {
  return {
    assignments, sessions,
    preferences: { dailyStudyLimit: 4, availableDays },
  } as Pick<SemesterState, "assignments" | "sessions" | "preferences">;
}

test("normalizes syllabus times into the format required for saving", () => {
  assert.equal(normalizeClockTime("11:59 PM ET"), "23:59");
  assert.equal(normalizeClockTime("5:00 p.m."), "17:00");
  assert.equal(normalizeClockTime("12:00 AM"), "00:00");
  assert.equal(normalizeClockTime("12:00 PM"), "12:00");
  assert.equal(normalizeClockTime("17:30"), "17:30");
  assert.equal(normalizeClockTime("after lecture"), null);
});

test("semester date range includes imported course dates outside global settings", () => {
  const preferences: SemesterState["preferences"] = {
    timezone: "America/New_York", semesterStart: "2026-08-24", semesterEnd: "2026-12-18",
    availableDays: [1, 2, 3, 4, 5], availabilityStart: "09:00", availabilityEnd: "21:00",
    preferredTime: "afternoon", sessionDurationMinutes: 60, breakMinutes: 10, dailyStudyLimit: 4,
    reminderHours: [24, 2], notificationCategories: ["deadline"], quietHoursStart: "22:00", quietHoursEnd: "08:00",
  };
  const course: SemesterState["courses"][number] = {
    id: "course-spring", name: "Algorithm Design", code: "CS 341", instructor: null, description: null,
    color: "#6758E8", targetFinalGrade: null, gradingMode: "assignment_weighted", gradeCategories: [],
    semesterStart: "2027-01-11", semesterEnd: "2027-05-02",
  };
  assert.deepEqual(semesterDateRange({ preferences, courses: [course] }), {
    start: "2026-08-24",
    end: "2027-05-02",
  });
});

test("workload combines normalized components with the specified 50/30/20 weights", () => {
  const workload = getWeeklyWorkload(state(Array.from({ length: 5 }, (_, index) =>
    assignment({ id: String(index), gradeWeight: 4 }),
  )), "2026-11-16");
  assert.equal(workload.academic, 50);
  assert.equal(workload.concentration, 100);
  assert.equal(workload.gradeImportance, 50);
  assert.equal(workload.level, 65);
  assert.equal(workload.category, "Heavy");
});

test("workload excludes completed and undated work without inventing dates", () => {
  const workload = getWeeklyWorkload(state([
    assignment({ id: "monday", dueDate: "2026-11-16" }),
    assignment({ id: "sunday", dueDate: "2026-11-22" }),
    assignment({ id: "next-week", dueDate: "2026-11-23" }),
    assignment({ id: "completed", status: "completed" }),
    assignment({ id: "undated", dueDate: null }),
  ]), "2026-11-16");
  assert.deepEqual(workload.thisWeek.map((item) => item.id), ["monday", "sunday"]);
  assert.equal(workload.unknownDates, 1);
  assert.equal(workload.hours, 4);
  assert.equal(workload.endKey, "2026-11-22");
});

test("missing estimates use the disclosed two-hour default and missing weights are renormalized", () => {
  const workload = getWeeklyWorkload(state([
    assignment({ estimatedHours: null }),
  ]), "2026-11-16");
  assert.equal(workload.hours, 2);
  assert.equal(workload.defaultedHours, 1);
  assert.equal(workload.gradeImportance, null);
  assert.equal(workload.level, 14);
});

test("workload scores and free capacity stay within their bounds", () => {
  const workload = getWeeklyWorkload(state(Array.from({ length: 6 }, (_, index) =>
    assignment({ id: String(index), estimatedHours: 20, gradeWeight: 20 }),
  )), "2026-11-16");
  assert.equal(workload.academic, 100);
  assert.equal(workload.concentration, 100);
  assert.equal(workload.gradeImportance, 100);
  assert.equal(workload.level, 100);
  assert.equal(workload.category, "Very heavy");
  assert.equal(workload.free, 0);
});

test("zero availability omits the academic-hours component rather than dividing by zero", () => {
  const workload = getWeeklyWorkload(state([
    assignment({ gradeWeight: 20 }),
  ], [], []), "2026-11-16");
  assert.equal(workload.academic, null);
  assert.equal(workload.level, 32);
  assert.equal(workload.category, "Moderate");
});

test("calendar week boundaries and completed study totals work across a year boundary", () => {
  const session: StudySession = {
    id: "study", title: "Study", date: "2027-01-01", startTime: "10:00",
    durationMinutes: 60, completedMinutes: 45, status: "completed",
  };
  const workload = getWeeklyWorkload(state([
    assignment({ dueDate: "2027-01-03" }),
    assignment({ id: "next-week", dueDate: "2027-01-04" }),
  ], [session]), "2026-12-28");
  assert.equal(workload.endKey, "2027-01-03");
  assert.equal(workload.thisWeek.length, 1);
  assert.equal(workload.completed, 0.75);
});
