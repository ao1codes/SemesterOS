import type { SemesterState } from "@workspace/api-client-react";

export type DemoAnswer = {
  answer: string;
  sources: { label: string; page: number | null }[];
};

const questionWords = new Set([
  "a", "about", "am", "an", "are", "assignment", "assignments", "course",
  "data", "deadline", "deadlines", "due", "for", "how", "is", "it", "my",
  "next", "of", "planned", "please", "soon", "the", "this", "time",
  "upcoming", "what", "when", "week", "which",
]);

function normalizedWords(value: string) {
  return value.toLocaleLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}

function dateLabel(date?: string | null) {
  if (!date) return "No date";
  return new Date(`${date}T12:00:00`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

function addDays(date: string, days: number) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, "0")}-${String(value.getUTCDate()).padStart(2, "0")}`;
}

export function answerDemoQuestion(
  question: string,
  state: SemesterState,
  today: string,
): DemoAnswer {
  const words = normalizedWords(question);
  const mentionedCourse = state.courses.find((course) => {
    const codeWords = normalizedWords(course.code);
    const nameWords = normalizedWords(course.name).filter((word) =>
      word.length > 3 && !questionWords.has(word),
    );
    return [...codeWords, ...nameWords].some((word) => words.includes(word));
  });
  const coursesById = new Map(state.courses.map((course) => [course.id, course]));
  const asksAboutDates = /\b(due|deadline|upcoming|next|this week|coming up)\b/i.test(question);
  const knownWords = new Set(
    state.courses.flatMap((course) => normalizedWords(`${course.code} ${course.name}`))
      .concat(state.assignments.flatMap((assignment) =>
        normalizedWords(`${assignment.title} ${assignment.description || ""} ${assignment.type}`),
      )),
  );
  const unknownSubject = words.find((word) =>
    word.length > 3 && !questionWords.has(word) && !knownWords.has(word),
  );

  if (asksAboutDates) {
    if (!mentionedCourse && unknownSubject) {
      return {
        answer: `I can’t find course or assignment details matching “${unknownSubject}” in the seeded demo data.`,
        sources: [],
      };
    }

    const asksThisWeek = /\bthis week\b/i.test(question);
    const weekDay = new Date(`${today}T00:00:00Z`).getUTCDay();
    const monday = addDays(today, -((weekDay + 6) % 7));
    const sunday = addDays(monday, 6);
    const horizon = addDays(today, 7);
    const assignments = state.assignments
      .filter((assignment) =>
        assignment.dueDate &&
        assignment.dueDate >= today &&
        assignment.status !== "completed" &&
        (!mentionedCourse || assignment.courseId === mentionedCourse.id) &&
        (asksThisWeek
          ? assignment.dueDate >= monday && assignment.dueDate <= sunday
          : mentionedCourse || /\b(next|upcoming)\b/i.test(question)
            ? true
            : assignment.dueDate <= horizon),
      )
      .sort((a, b) => a.dueDate!.localeCompare(b.dueDate!));

    if (!assignments.length) {
      if (asksThisWeek) {
        return {
          answer: mentionedCourse
            ? `No open assignments for ${mentionedCourse.code} are due this week in the demo data.`
            : "No open assignments are due this week in the demo data.",
          sources: [],
        };
      }
      if (mentionedCourse) {
        return {
          answer: `No upcoming open assignments are listed for ${mentionedCourse.code} in the demo data.`,
          sources: [],
        };
      }
    } else {
      const selected = mentionedCourse || /\b(next|upcoming)\b/i.test(question)
        ? assignments.slice(0, 1)
        : assignments;
      return {
        answer: `The demo data shows ${selected.map((assignment) => {
          const course = coursesById.get(assignment.courseId);
          return `${assignment.title} (${course?.code || "course"}) due ${dateLabel(assignment.dueDate)}${assignment.dueTime ? ` at ${assignment.dueTime}` : ""}`;
        }).join("; ")}. These dates come from the seeded assignment list, not a live syllabus lookup.`,
        sources: selected.map((assignment) => ({
          label: `${coursesById.get(assignment.courseId)?.code || "Course"} · ${assignment.title}`,
          page: assignment.sourcePage ?? null,
        })),
      };
    }

    return {
      answer: "There are no open assignments due in the next seven days in the demo data.",
      sources: [],
    };
  }

  const terms = words.filter((word) => word.length > 3);
  const matching = state.assignments
    .map((assignment) => {
      const course = coursesById.get(assignment.courseId);
      const searchable = normalizedWords(
        `${assignment.title} ${assignment.description || ""} ${assignment.type} ${course?.name || ""} ${course?.code || ""}`,
      );
      return {
        assignment,
        score: terms.reduce((score, term) => score + (searchable.includes(term) ? 1 : 0), 0) +
          words.reduce((score, word) => score + (word.length <= 3 && searchable.includes(word) ? 1 : 0), 0),
      };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((item) => item.assignment);
  if (matching.length) {
    const assignment = matching[0];
    const course = coursesById.get(assignment.courseId);
    return {
      answer: `In this demo’s saved course data, ${assignment.title} is for ${course?.name || "a course"} and is due ${dateLabel(assignment.dueDate)}${assignment.dueTime ? ` at ${assignment.dueTime}` : ""}. ${assignment.estimatedHours == null ? "No estimate is saved." : `It has a ${assignment.estimatedHours}-hour estimate.`} ${assignment.description || "No additional assignment notes are saved."} This answer uses only the sample data shown in your dashboard.`,
      sources: [{ label: `${course?.code || "Course"} · ${assignment.title}`, page: assignment.sourcePage ?? null }],
    };
  }
  if (mentionedCourse) {
    return {
      answer: `The demo data lists ${mentionedCourse.name} (${mentionedCourse.code})${mentionedCourse.instructor ? ` with ${mentionedCourse.instructor}` : ""}. ${mentionedCourse.description || "There are no more course notes saved here."} I couldn’t find a more specific policy or deadline in the sample data.`,
      sources: [{ label: `${mentionedCourse.code} course details`, page: null }],
    };
  }
  return {
    answer: "I can’t find that in the seeded demo data. The demo only answers from the course and assignment details visible in SemesterOS; it does not invent syllabus policies.",
    sources: [],
  };
}
