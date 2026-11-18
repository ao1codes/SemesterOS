import assert from "node:assert/strict";
import test from "node:test";
import { releaseExpiredSnoozes } from "./notification-utils.ts";

test("releases expired snoozes and returns them to unread", () => {
  const now = new Date("2026-11-13T12:00:00.000Z");
  const result = releaseExpiredSnoozes([
    { id: "expired", isRead: true, snoozedUntil: "2026-11-13T11:59:00.000Z" },
    { id: "active", isRead: true, snoozedUntil: "2026-11-13T13:00:00.000Z" },
    { id: "normal", isRead: false, snoozedUntil: null },
  ], now);

  assert.deepEqual(result, [
    { id: "expired", isRead: false, snoozedUntil: null },
    { id: "active", isRead: true, snoozedUntil: "2026-11-13T13:00:00.000Z" },
    { id: "normal", isRead: false, snoozedUntil: null },
  ]);
});

test("keeps the original list when nothing has expired", () => {
  const notifications = [{ isRead: true, snoozedUntil: "2026-11-14T00:00:00.000Z" }];
  assert.equal(releaseExpiredSnoozes(notifications, new Date("2026-11-13T12:00:00.000Z")), notifications);
});
