import assert from "node:assert/strict";
import test from "node:test";
import type { SemesterState, SyllabusExtraction } from "@workspace/api-client-react";
import { applyApprovedSyllabus, getSyllabusChanges } from "./syllabus-import.ts";

function makeState(): SemesterState {
  return {
    courses: [{
      id: "course-a",
      name: "Biology",
      code: "BIO 101",
      instructor: "Dr. Lee",
      color: "#6758E8",
      description: "Introductory biology",
      targetFinalGrade: 90,
      gradingMode: "points_based",
      gradeCategories: [],
      semesterStart: "2026-08-24",
      semesterEnd: "2026-12-18",
    }],
    assignments: [
      {
        id: "assignment-paper",
        courseId: "course-a",
        title: "Research paper",
        type: "paper",
        dueDate: "2026-11-20",
        dueTime: "17:00",
        gradeWeight: 20,
        estimatedHours: 4,
        description: "Read and write",
        status: "in_progress",
        gradeEarned: 88,
        gradeCategoryId: "papers",
        pointsEarned: 44,
        pointsPossible: 50,
        sourceDocumentId: "document-old",
        sourcePage: 5,
        milestones: [{ id: "m1", title: "Outline", completed: true }],
      },
      {
        id: "manual",
        courseId: "course-a",
        title: "Manually added task",
        type: "homework",
        dueDate: null,
        dueTime: null,
        gradeWeight: null,
        estimatedHours: 1,
        description: null,
        status: "upcoming",
        gradeEarned: null,
        gradeCategoryId: null,
        pointsEarned: null,
        pointsPossible: null,
        sourceDocumentId: null,
        sourcePage: null,
        milestones: [],
      },
      {
        id: "removed",
        courseId: "course-a",
        title: "Old quiz",
        type: "quiz",
        dueDate: "2026-10-01",
        dueTime: null,
        gradeWeight: 10,
        estimatedHours: 1,
        description: null,
        status: "upcoming",
        gradeEarned: null,
        gradeCategoryId: null,
        pointsEarned: null,
        pointsPossible: null,
        sourceDocumentId: "document-old",
        sourcePage: 2,
        milestones: [],
      },
    ],
    sessions: [
      { id: "planned", assignmentId: "assignment-paper", title: "Draft", date: "2026-11-18", startTime: "10:00", durationMinutes: 45, status: "planned", completedMinutes: null },
      { id: "completed", assignmentId: "removed", title: "Quiz review", date: "2026-09-30", startTime: "10:00", durationMinutes: 45, status: "completed", completedMinutes: 45 },
    ],
    notifications: [],
    documents: [{
      id: "document-old",
      courseId: "course-a",
      filename: "old.pdf",
      uploadedAt: "2026-09-01T12:00:00.000Z",
      version: 1,
      policyNotes: [{ id: "policy-old", topic: "Late work", text: "One day late", page: 3 }],
    }],
    preferences: {
      timezone: "America/New_York",
      semesterStart: "2026-08-24",
      semesterEnd: "2026-12-18",
      availableDays: [1, 2, 3, 4, 5],
      availabilityStart: "09:00",
      availabilityEnd: "20:00",
      preferredTime: "afternoon",
      sessionDurationMinutes: 60,
      breakMinutes: 10,
      dailyStudyLimit: 3,
      reminderHours: [24, 2],
      notificationCategories: ["syllabus"],
      quietHoursStart: "22:00",
      quietHoursEnd: "08:00",
    },
  } as unknown as SemesterState;
}

function extraction(overrides: Partial<SyllabusExtraction> = {}): SyllabusExtraction {
  return {
    course: {
      name: "Biology",
      code: "BIO 101",
      instructor: "Dr. Lee",
      description: "Introductory biology",
      semesterStart: "2026-08-24",
      semesterEnd: "2026-12-18",
    },
    assignments: [{
      title: "Research paper",
      type: "paper",
      dueDate: "2026-11-21",
      dueTime: "17:00",
      gradeWeight: 20,
      estimatedHours: 5,
      description: "Updated research paper",
      sourcePage: 6,
    }],
    policyNotes: [{ topic: "Late work", text: "Two days late", page: 4 }],
    ambiguities: [],
    ...overrides,
  } as SyllabusExtraction;
}

test("approved revised syllabus preserves grades and milestones without duplicating assignments", () => {
  const result = applyApprovedSyllabus(
    makeState(),
    { extraction: extraction(), courseId: "course-a", filename: "revised.pdf" },
    new Date("2026-11-13T12:00:00.000Z"),
  );
  const paper = result.assignments.find((item) => item.id === "assignment-paper");

  assert.equal(result.assignments.filter((item) => item.title === "Research paper").length, 1);
  assert.equal(paper?.gradeEarned, 88);
  assert.equal(paper?.gradeCategoryId, "papers");
  assert.equal(paper?.pointsEarned, 44);
  assert.equal(paper?.pointsPossible, 50);
  assert.deepEqual(paper?.milestones, [{ id: "m1", title: "Outline", completed: true }]);
  assert.ok(result.assignments.some((item) => item.id === "manual"));
  assert.ok(!result.assignments.some((item) => item.id === "removed"));
  assert.equal(result.sessions.find((item) => item.id === "planned")?.status, "skipped");
  assert.equal(result.sessions.find((item) => item.id === "completed")?.status, "completed");
  assert.equal(result.documents.at(-1)?.version, 2);
  assert.equal(result.documents.at(-1)?.filename, "revised.pdf");
});

test("syllabus change summary reports date, description, and policy changes before approval", () => {
  const changes = getSyllabusChanges(makeState(), "course-a", extraction());

  assert.ok(changes.some((change) => change.kind === "Changed" && change.title === "Research paper" && /due date/.test(change.detail)));
  assert.ok(changes.some((change) => change.kind === "Changed" && change.title === "Research paper" && /description/.test(change.detail)));
  assert.ok(changes.some((change) => change.kind === "Changed" && change.title === "Policy: Late work"));
  assert.ok(changes.some((change) => change.kind === "Removed" && change.title === "Old quiz"));
});

test("duplicate titles in one extraction are saved once", () => {
  const result = applyApprovedSyllabus(
    makeState(),
    {
      extraction: extraction({
        assignments: [
          { title: "Research paper", type: "paper", dueDate: "2026-11-21", sourcePage: 6 },
          { title: "  RESEARCH---PAPER  ", type: "paper", dueDate: "2026-11-21", sourcePage: 7 },
        ],
      }),
      courseId: "course-a",
      filename: "duplicate.pdf",
    },
    new Date("2026-11-13T12:00:00.000Z"),
  );

  assert.equal(result.assignments.filter((item) => item.id === "assignment-paper").length, 1);
});

test("policy-only revisions produce a persistent syllabus alert",()=>{
  const original=makeState();
  const revised=extraction({assignments:original.assignments.filter(a=>a.sourceDocumentId).map(a=>({...a,sourcePage:a.sourcePage??null}))});
  const result=applyApprovedSyllabus(original,{extraction:revised,courseId:"course-a",filename:"policies.pdf"});
  assert.ok(result.notifications.some(n=>n.category==="syllabus"));
});
test("explicit rename mapping preserves the existing assignment and milestones",()=>{
  const original=makeState();
  const revised=extraction({assignments:[{...extraction().assignments[0],title:"Renamed paper"}]});
  const result=applyApprovedSyllabus(original,{extraction:revised,courseId:"course-a",filename:"renamed.pdf",matches:{0:"assignment-paper"}});
  const saved=result.assignments.find(a=>a.id==="assignment-paper");
  assert.equal(saved?.title,"Renamed paper");
  assert.equal(saved?.gradeEarned,88);
  assert.equal(saved?.milestones[0].title,"Outline");
});
test("repeated same-title assessments on different dates are retained separately",()=>{
  const result=applyApprovedSyllabus(makeState(),{extraction:extraction({assignments:[
    {title:"Weekly quiz",type:"quiz",dueDate:"2026-11-18"},
    {title:"Weekly quiz",type:"quiz",dueDate:"2026-11-25"},
  ]}),courseId:"course-a",filename:"weekly.pdf"});
  assert.equal(result.assignments.filter(a=>a.title==="Weekly quiz").length,2);
});
