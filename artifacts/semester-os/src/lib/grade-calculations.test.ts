import assert from "node:assert/strict";
import test from "node:test";
import type { Assignment, CourseGradingMode, GradeCategory } from "@workspace/api-client-react";
import { calculateCourseGrade, calculateRequiredAverage } from "./grade-calculations.ts";

const assignment = (values: Partial<Assignment> = {}) =>
  ({
    gradeEarned: null,
    gradeWeight: null,
    gradeCategoryId: null,
    pointsEarned: null,
    pointsPossible: null,
    ...values,
  }) as Assignment;

const category = (id: string, weight: number): GradeCategory => ({ id, name: id, weight });

test("assignment weighting uses recorded grades without inventing missing weights", () => {
  const assignments = [
    assignment({ gradeEarned: 80, gradeWeight: 40 }),
    assignment({ gradeEarned: 90, gradeWeight: 20 }),
    assignment({ gradeEarned: null, gradeWeight: null }),
  ];
  const result = calculateCourseGrade(assignments, [], "assignment_weighted");
  assert.equal(result.currentGrade, 83.33333333333333);
  assert.equal(result.gradedWeight, 60);
  assert.equal(result.weightStructureComplete, false);
  assert.equal(calculateRequiredAverage(result, 90), null);
});

test("points weighting calculates a remaining average only when all possible points are known", () => {
  const complete = calculateCourseGrade(
    [
      assignment({ pointsEarned: 40, pointsPossible: 50 }),
      assignment({ pointsPossible: 50 }),
    ],
    [],
    "points_based",
  );
  assert.equal(complete.currentGrade, 80);
  assert.equal(complete.remainingPossiblePoints, 50);
  assert.equal(calculateRequiredAverage(complete, 90), 100);

  const incomplete = calculateCourseGrade(
    [assignment({ pointsEarned: 40, pointsPossible: 50 }), assignment()],
    [],
    "points_based",
  );
  assert.equal(incomplete.pointStructureComplete, false);
  assert.equal(calculateRequiredAverage(incomplete, 90), null);
});

test("category weighting converts within-category weights into course weights", () => {
  const categories = [category("exams", 60), category("homework", 40)];
  const result = calculateCourseGrade(
    [
      assignment({ gradeCategoryId: "exams", gradeEarned: 80, gradeWeight: 50 }),
      assignment({ gradeCategoryId: "exams", gradeEarned: 100, gradeWeight: 50 }),
      assignment({ gradeCategoryId: "homework", gradeEarned: 90, gradeWeight: 100 }),
    ],
    categories,
    "category_weighted",
  );
  assert.equal(result.currentGrade, 90);
  assert.equal(result.gradedWeight, 100);
  assert.equal(result.weightStructureComplete, true);
  assert.equal(calculateRequiredAverage(result, 90), null);
});

test("category structure is incomplete when category or assignment weights are missing", () => {
  const result = calculateCourseGrade(
    [assignment({ gradeCategoryId: "exams", gradeEarned: 80, gradeWeight: 50 })],
    [category("exams", 60), category("homework", 40)],
    "category_weighted",
  );
  assert.equal(result.weightStructureComplete, false);
  assert.equal(calculateRequiredAverage(result, 90), null);
});

test("all supported grading modes return no grade when no scores are recorded", () => {
  const modes: CourseGradingMode[] = [
    "assignment_weighted",
    "points_based",
    "category_weighted",
  ];
  for (const mode of modes) {
    const result = calculateCourseGrade([assignment()], [category("exams", 100)], mode);
    assert.equal(result.currentGrade, null);
  }
});
