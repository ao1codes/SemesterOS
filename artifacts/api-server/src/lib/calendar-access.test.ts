import assert from "node:assert/strict";
import test from "node:test";
import { calendarOwnerAllowed } from "./calendar-access.ts";

test("allows only the configured account and denies access when no owner is set", () => {
  assert.equal(calendarOwnerAllowed("user-owner", "user-owner"), true);
  assert.equal(calendarOwnerAllowed("user-other", "user-owner"), false);
  assert.equal(calendarOwnerAllowed("user-owner", undefined), false);
  assert.equal(calendarOwnerAllowed(null, "user-owner"), false);
  assert.equal(calendarOwnerAllowed("user-owner", "  user-owner  "), true);
});
