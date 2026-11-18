import assert from "node:assert/strict";
import test from "node:test";
import { createCalendarFile, parseCalendarFile, isUpcomingCalendarBlock } from "./calendar-ics.ts";

test("reads UTC events and escaped summaries", () => {
  const text = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "BEGIN:VEVENT",
    "UID:review-1",
    "DTSTART:20261114T150000Z",
    "DTEND:20261114T160000Z",
    "SUMMARY:Study\\, review",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");

  assert.deepEqual(parseCalendarFile(text, "America/New_York", "2026-11-14", "2026-11-14"), [
    {
      uid: "review-1-single",
      title: "Study, review",
      date: "2026-11-14",
      startTime: "10:00",
      durationMinutes: 60,
    },
  ]);
});

test("reads all-day events and excludes cancelled or transparent events", () => {
  const text = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "BEGIN:VEVENT",
    "UID:holiday",
    "DTSTART;VALUE=DATE:20261115",
    "DTEND;VALUE=DATE:20261116",
    "SUMMARY:Reading day",
    "END:VEVENT",
    "BEGIN:VEVENT",
    "UID:cancelled",
    "STATUS:CANCELLED",
    "DTSTART:20261115T090000Z",
    "DTEND:20261115T100000Z",
    "END:VEVENT",
    "BEGIN:VEVENT",
    "UID:free",
    "TRANSP:TRANSPARENT",
    "DTSTART:20261115T110000Z",
    "DTEND:20261115T120000Z",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");

  assert.deepEqual(parseCalendarFile(text, "UTC", "2026-11-15", "2026-11-15"), [
    {
      uid: "holiday-single",
      title: "Reading day",
      date: "2026-11-15",
      startTime: "00:00",
      durationMinutes: 1440,
    },
  ]);
});

test("expands recurring events only inside the selected date range", () => {
  const text = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "BEGIN:VEVENT",
    "UID:daily-review",
    "DTSTART:20261113T150000Z",
    "DURATION:PT45M",
    "RRULE:FREQ=DAILY;COUNT=4",
    "SUMMARY:Daily review",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");

  const events = parseCalendarFile(text, "America/New_York", "2026-11-14", "2026-11-15");
  assert.equal(events.length, 2);
  assert.deepEqual(events.map((event) => [event.date, event.startTime, event.durationMinutes]), [
    ["2026-11-14", "10:00", 45],
    ["2026-11-15", "10:00", 45],
  ]);
});

test("exports sessions as unambiguous UTC events and excludes imported busy blocks", () => {
  const state = {
    courses: [],
    assignments: [],
    sessions: [
      { id: "s1", assignmentId: null, title: "Study, review", date: "2026-11-14", startTime: "09:30", durationMinutes: 60, status: "planned", completedMinutes: null },
      { id: "busy1", assignmentId: null, title: "Busy · Class", date: "2026-11-14", startTime: "10:00", durationMinutes: 60, status: "busy", completedMinutes: null },
    ],
    notifications: [],
    documents: [],
    preferences: {},
  } as unknown as import("@workspace/api-client-react").SemesterState;
  const file = createCalendarFile(state, "2026-11-14", "2026-11-14", "America/New_York", new Date("2026-11-13T12:00:00.000Z"));

  assert.match(file, /DTSTART:20261114T143000Z/);
  assert.match(file, /SUMMARY:Study\\, review/);
  assert.doesNotMatch(file, /SUMMARY:Busy/);
});

test("imports overnight commitments that started before the selected range",()=>{
  const text=["BEGIN:VCALENDAR","VERSION:2.0","BEGIN:VEVENT","UID:overnight",
    "DTSTART:20261113T230000Z","DTEND:20261114T020000Z","SUMMARY:Overnight",
    "END:VEVENT","END:VCALENDAR"].join("\r\n");
  const blocks=parseCalendarFile(text,"UTC","2026-11-14","2026-11-15");
  assert.equal(blocks.length,1);
  assert.equal(isUpcomingCalendarBlock(blocks[0],"2026-11-14","UTC"),true);
  assert.equal(isUpcomingCalendarBlock(blocks[0],"2026-11-15","UTC"),false);
});

test("recurring overnight occurrences overlap the first selected day",()=>{
  const text=["BEGIN:VCALENDAR","VERSION:2.0","BEGIN:VEVENT","UID:overnight-repeated",
    "DTSTART:20261112T230000Z","DTEND:20261113T020000Z","RRULE:FREQ=DAILY;COUNT=3",
    "SUMMARY:Repeated overnight","END:VEVENT","END:VCALENDAR"].join("\r\n");
  const blocks=parseCalendarFile(text,"UTC","2026-11-14","2026-11-14");
  assert.ok(blocks.some(b=>b.date==="2026-11-13"));
});
