import assert from "node:assert/strict";
import test from "node:test";
import { isValidTimeZone, utcToZonedDateTime, zonedDateTimeToUtc } from "./calendar-time.ts";

test("converts local times across standard and daylight offsets", () => {
  assert.equal(
    zonedDateTimeToUtc("2026-01-15", "09:30", "America/New_York").toISOString(),
    "2026-01-15T14:30:00.000Z",
  );
  assert.equal(
    zonedDateTimeToUtc("2026-07-15", "09:30", "America/New_York").toISOString(),
    "2026-07-15T13:30:00.000Z",
  );
});

test("formats a UTC instant in the requested time zone", () => {
  assert.deepEqual(
    utcToZonedDateTime(new Date("2026-07-15T13:30:00.000Z"), "America/New_York"),
    { date: "2026-07-15", time: "09:30" },
  );
});

test("rejects invalid time zones and local date-time values", () => {
  assert.equal(isValidTimeZone("Not/AZone"), false);
  assert.throws(() => zonedDateTimeToUtc("2026-02-30", "09:00", "UTC"), RangeError);
});
