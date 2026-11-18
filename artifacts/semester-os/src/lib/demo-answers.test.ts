import assert from "node:assert/strict";
import test from "node:test";
import { seedState } from "@/data/demo-semester";
import { answerDemoQuestion } from "./demo-answers";

test("course-specific next-deadline questions use that course's next open assignment", () => {
  const result = answerDemoQuestion("When is my next CS 220 deadline?", seedState, "2026-11-14");

  assert.match(result.answer, /Project 2: Trees and Maps/);
  assert.match(result.answer, /CS 220/);
  assert.match(result.answer, /Mar 5/);
  assert.deepEqual(result.sources, [{ label: "CS 220 · Project 2: Trees and Maps", page: null }]);
});

test("this-week questions explain when the sample semester has no current deadlines", () => {
  const result = answerDemoQuestion("What assignments are due this week?", seedState, "2026-11-14");

  assert.match(result.answer, /No open assignments are due this week/);
  assert.deepEqual(result.sources, []);
});

test("this-week questions list open assignments within the current Monday-to-Sunday week", () => {
  const state = {
    ...seedState,
    assignments: [
      ...seedState.assignments,
      {
        ...seedState.assignments[0],
        id: "due-this-week",
        title: "Due this week",
        dueDate: "2026-11-15",
        status: "upcoming",
        sourcePage: 3,
      },
    ],
  };
  const result = answerDemoQuestion("What assignments are due this week?", state, "2026-11-14");

  assert.match(result.answer, /Due this week \(CS 220\)/);
  assert.deepEqual(result.sources, [{ label: "CS 220 · Due this week", page: 3 }]);
});

test("a subject absent from the sample data does not return an unrelated deadline", () => {
  const result = answerDemoQuestion("When is my next psychology deadline?", seedState, "2026-11-14");

  assert.match(result.answer, /matching “psychology”/);
  assert.doesNotMatch(result.answer, /CS 220|MATH 215/);
});

test("assignment detail questions return the requested assignment and source", () => {
  const result = answerDemoQuestion("How much time is estimated for Project 2?", seedState, "2026-11-14");

  assert.match(result.answer, /Project 2: Trees and Maps/);
  assert.match(result.answer, /12-hour estimate/);
  assert.deepEqual(result.sources, [{ label: "CS 220 · Project 2: Trees and Maps", page: null }]);
});
