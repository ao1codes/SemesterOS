import test from "node:test";
import assert from "node:assert/strict";
import { normalizeWireDates, stateRevision } from "./state-revision";
import { GetSemesterStateResponse, SaveSemesterStateBody } from "@workspace/api-zod";
import { emptySemesterState } from "./semester-store";
import { semesterValidationError } from "./semester-validation";

test("revision is stable across object key order and ignores only revision metadata",()=>{
  assert.equal(stateRevision({a:1,b:2}),stateRevision({b:2,a:1,revision:"old"}));
  assert.notEqual(stateRevision({a:1}),stateRevision({a:2}));
});
test("legacy date-only instants normalize without changing real timestamps",()=>{
  const value=normalizeWireDates({dueDate:"2026-11-12T00:00:00.000Z",createdAt:"2026-11-12T20:00:00.000Z",nested:[{date:"2026-11-13T00:00:00.000Z"}]});
  assert.deepEqual(value,{dueDate:"2026-11-12",createdAt:"2026-11-12T20:00:00.000Z",nested:[{date:"2026-11-13"}]});
});
test("date-only API roundtrips retain calendar strings rather than Date objects",()=>{
  const saved=GetSemesterStateResponse.parse(emptySemesterState);
  assert.equal(typeof saved.preferences.semesterStart,"string");
  assert.equal(SaveSemesterStateBody.safeParse({...saved,preferences:{...saved.preferences,semesterStart:"2026-02-30"}}).success,false);
});
test("server rejects invalid timezones and reversed availability",()=>{
  assert.match(semesterValidationError({...emptySemesterState,preferences:{...emptySemesterState.preferences,timezone:"Bad/Zone"}})!,/timezone/);
  assert.match(semesterValidationError({...emptySemesterState,preferences:{...emptySemesterState.preferences,availabilityStart:"19:00",availabilityEnd:"09:00"}})!,/availability/);
});
