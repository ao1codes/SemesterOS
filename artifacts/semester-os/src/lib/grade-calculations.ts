import type { Assignment, CourseGradingMode, GradeCategory } from "@workspace/api-client-react";

type GradeAssignment = Pick<
  Assignment,
  "gradeEarned" | "gradeWeight" | "gradeCategoryId" | "pointsEarned" | "pointsPossible"
>;

export type CourseGradeCalculation = {
  mode: CourseGradingMode;
  currentGrade: number | null;
  gradedWeight: number;
  weightedEarned: number;
  remainingWeight: number;
  weightStructureComplete: boolean;
  pointsEarned: number;
  recordedPossiblePoints: number;
  totalPossiblePoints: number | null;
  remainingPossiblePoints: number | null;
  pointStructureComplete: boolean;
};

const closeTo = (value: number, target: number) => Math.abs(value - target) < 0.01;

export function calculateCourseGrade(
  assignments: GradeAssignment[],
  categories: GradeCategory[],
  mode: CourseGradingMode,
): CourseGradeCalculation {
  if (mode === "points_based") {
    const gradedAssignments = assignments.filter(
      (assignment) =>
        assignment.pointsEarned != null &&
        assignment.pointsPossible != null &&
        assignment.pointsPossible > 0 &&
        assignment.pointsEarned >= 0 &&
        assignment.pointsEarned <= assignment.pointsPossible,
    );
    const pointsEarned = gradedAssignments.reduce(
      (sum, assignment) => sum + (assignment.pointsEarned ?? 0),
      0,
    );
    const recordedPossiblePoints = gradedAssignments.reduce(
      (sum, assignment) => sum + (assignment.pointsPossible ?? 0),
      0,
    );
    const pointStructureComplete =
      assignments.length > 0 &&
      assignments.every(
        (assignment) =>
          assignment.pointsPossible != null &&
          assignment.pointsPossible > 0 &&
          (assignment.pointsEarned == null ||
            (assignment.pointsEarned >= 0 && assignment.pointsEarned <= assignment.pointsPossible)),
      );
    const totalPossiblePoints = pointStructureComplete
      ? assignments.reduce((sum, assignment) => sum + (assignment.pointsPossible ?? 0), 0)
      : null;
    const remainingPossiblePoints =
      totalPossiblePoints == null
        ? null
        : Math.max(0, totalPossiblePoints - recordedPossiblePoints);

    return {
      mode,
      currentGrade:
        recordedPossiblePoints > 0 ? (pointsEarned / recordedPossiblePoints) * 100 : null,
      gradedWeight: 0,
      weightedEarned: 0,
      remainingWeight: 0,
      weightStructureComplete: false,
      pointsEarned,
      recordedPossiblePoints,
      totalPossiblePoints,
      remainingPossiblePoints,
      pointStructureComplete,
    };
  }

  let gradedWeight = 0;
  let weightedEarned = 0;
  let weightStructureComplete = false;

  if (mode === "category_weighted") {
    const categoryById = new Map(categories.map((category) => [category.id, category]));
    const categoryWeightsTotal = categories.reduce((sum, category) => sum + category.weight, 0);
    const weightsByCategory = new Map<string, number>();

    for (const assignment of assignments) {
      if (!assignment.gradeCategoryId || !categoryById.has(assignment.gradeCategoryId)) continue;
      weightsByCategory.set(
        assignment.gradeCategoryId,
        (weightsByCategory.get(assignment.gradeCategoryId) ?? 0) + (assignment.gradeWeight ?? 0),
      );
      const category = categoryById.get(assignment.gradeCategoryId)!;
      if (
        assignment.gradeEarned != null &&
        assignment.gradeWeight != null &&
        assignment.gradeWeight > 0 &&
        assignment.gradeEarned >= 0 &&
        assignment.gradeEarned <= 100
      ) {
        const courseWeight = (category.weight * assignment.gradeWeight) / 100;
        gradedWeight += courseWeight;
        weightedEarned += assignment.gradeEarned * courseWeight;
      }
    }

    weightStructureComplete =
      categories.length > 0 &&
      assignments.length > 0 &&
      categories.every(
        (category) =>
          Number.isFinite(category.weight) &&
          category.weight >= 0 &&
          closeTo(weightsByCategory.get(category.id) ?? 0, 100),
      ) &&
      closeTo(categoryWeightsTotal, 100) &&
      assignments.every(
        (assignment) =>
          assignment.gradeCategoryId != null &&
          categoryById.has(assignment.gradeCategoryId) &&
          assignment.gradeWeight != null &&
          Number.isFinite(assignment.gradeWeight) &&
          assignment.gradeWeight >= 0,
      );
  } else {
    const totalWeight = assignments.reduce(
      (sum, assignment) => sum + (assignment.gradeWeight ?? 0),
      0,
    );
    weightStructureComplete =
      assignments.length > 0 &&
      assignments.every(
        (assignment) =>
          assignment.gradeWeight != null &&
          Number.isFinite(assignment.gradeWeight) &&
          assignment.gradeWeight >= 0,
      ) &&
      closeTo(totalWeight, 100);

    for (const assignment of assignments) {
      if (
        assignment.gradeEarned == null ||
        assignment.gradeWeight == null ||
        assignment.gradeWeight <= 0 ||
        assignment.gradeEarned < 0 ||
        assignment.gradeEarned > 100
      ) {
        continue;
      }
      gradedWeight += assignment.gradeWeight;
      weightedEarned += assignment.gradeEarned * assignment.gradeWeight;
    }
  }

  return {
    mode,
    currentGrade: gradedWeight > 0 ? weightedEarned / gradedWeight : null,
    gradedWeight,
    weightedEarned,
    remainingWeight: Math.max(0, 100 - gradedWeight),
    weightStructureComplete,
    pointsEarned: 0,
    recordedPossiblePoints: 0,
    totalPossiblePoints: null,
    remainingPossiblePoints: null,
    pointStructureComplete: false,
  };
}

export function calculateRequiredAverage(
  calculation: CourseGradeCalculation,
  target: number | null,
): number | null {
  if (target == null || !Number.isFinite(target) || target < 0 || target > 100) return null;

  if (calculation.mode === "points_based") {
    if (
      !calculation.pointStructureComplete ||
      calculation.totalPossiblePoints == null ||
      calculation.remainingPossiblePoints == null ||
      calculation.remainingPossiblePoints <= 0
    ) {
      return null;
    }
    return (
      ((target / 100) * calculation.totalPossiblePoints - calculation.pointsEarned) /
      calculation.remainingPossiblePoints
    ) * 100;
  }

  if (
    !calculation.weightStructureComplete ||
    calculation.remainingWeight <= 0
  ) {
    return null;
  }
  return (
    (target * 100 - calculation.weightedEarned) /
    calculation.remainingWeight
  );
}
