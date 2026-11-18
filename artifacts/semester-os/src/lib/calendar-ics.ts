import ICAL from "ical.js";
import type { SemesterState } from "@workspace/api-client-react";

export type ImportedCalendarBlock = {
  uid: string;
  title: string;
  date: string;
  startTime: string;
  durationMinutes: number;
};

type CalendarFields = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
};

export function isUpcomingCalendarBlock(block: ImportedCalendarBlock, today: string, timezone: string) {
  const start=localDateTimeToUtc(block.date,block.startTime,timezone);
  return start.getTime()+block.durationMinutes*60_000>localDateTimeToUtc(today,"00:00",timezone).getTime();
}

function localFields(instant: Date, timeZone: string): CalendarFields {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour: Number(values.hour),
    minute: Number(values.minute),
  };
}

function dateKey(fields: Pick<CalendarFields, "year" | "month" | "day">) {
  return `${fields.year}-${String(fields.month).padStart(2, "0")}-${String(fields.day).padStart(2, "0")}`;
}

function clock(fields: Pick<CalendarFields, "hour" | "minute">) {
  return `${String(fields.hour).padStart(2, "0")}:${String(fields.minute).padStart(2, "0")}`;
}

function localDateTimeToUtc(date: string, time: string, timeZone: string) {
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const target = Date.UTC(year, month - 1, day, hour, minute);
  let candidate = target;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const fields = localFields(new Date(candidate), timeZone);
    const represented = Date.UTC(fields.year, fields.month - 1, fields.day, fields.hour, fields.minute);
    const adjustment = target - represented;
    if (!adjustment) return new Date(candidate);
    candidate += adjustment;
  }
  return new Date(candidate);
}

function floatingTimeToUtc(time: ICAL.Time, timeZone: string) {
  const date = dateKey(time);
  return localDateTimeToUtc(date, clock(time), timeZone);
}

function toInstant(time: ICAL.Time, timeZone: string) {
  return time.zone?.tzid === "floating" ? floatingTimeToUtc(time, timeZone) : time.toJSDate();
}

function toBlock(
  event: ICAL.Event,
  startTime: ICAL.Time,
  endTime: ICAL.Time,
  timezone: string,
  fallbackUid: string,
): ImportedCalendarBlock {
  if (startTime.isDate) {
    const date = dateKey(startTime);
    const endDate = dateKey(endTime);
    const first = new Date(`${date}T12:00:00Z`);
    const last = new Date(`${endDate}T12:00:00Z`);
    const days = Math.max(1, Math.round((last.getTime() - first.getTime()) / 86_400_000));
    return {
      uid: event.uid || fallbackUid,
      title: event.summary || "Imported calendar event",
      date,
      startTime: "00:00",
      durationMinutes: days * 1440,
    };
  }

  const start = toInstant(startTime, timezone);
  const end = toInstant(endTime, timezone);
  const startFields = localFields(start, timezone);
  return {
    uid: event.uid || fallbackUid,
    title: event.summary || "Imported calendar event",
    date: dateKey(startFields),
    startTime: clock(startFields),
    durationMinutes: Math.max(5, Math.round((end.getTime() - start.getTime()) / 60_000)),
  };
}

export function parseCalendarFile(
  text: string,
  timezone: string,
  rangeStartDate: string,
  rangeEndDate: string,
): ImportedCalendarBlock[] {
  const calendar = new ICAL.Component(ICAL.parse(text));
  const rangeStart = localDateTimeToUtc(rangeStartDate, "00:00", timezone);
  const rangeEnd = localDateTimeToUtc(rangeEndDate, "23:59", timezone);
  const result: ImportedCalendarBlock[] = [];
  const components = calendar.getAllSubcomponents("vevent");

  for (const [index, component] of components.entries()) {
    const event = new ICAL.Event(component);
    if (event.component.getFirstPropertyValue("status") === "CANCELLED") continue;
    if (event.component.getFirstPropertyValue("transp") === "TRANSPARENT") continue;

    const pushOccurrence = (startTime: ICAL.Time, endTime: ICAL.Time, suffix: string) => {
      const block = toBlock(event, startTime, endTime, timezone, `event-${index}`);
      const eventStart = startTime.isDate
        ? localDateTimeToUtc(block.date, "00:00", timezone)
        : toInstant(startTime, timezone);
      const eventEnd=toInstant(endTime,timezone);
      if (eventEnd<=rangeStart || eventStart>rangeEnd) return;
      result.push({ ...block, uid: `${block.uid}-${suffix}` });
    };

    if (!event.isRecurring()) {
      pushOccurrence(event.startDate, event.endDate, "single");
      continue;
    }

    // Keep the actual DTSTART so COUNT and interval phase remain correct.
    const iterator = event.iterator();
    for (let occurrenceIndex = 0; occurrenceIndex < 10000; occurrenceIndex += 1) {
      const occurrence = iterator.next();
      if (!occurrence) break;
      const occurrenceStart = event.getOccurrenceDetails(occurrence);
      const start = occurrenceStart.startDate.isDate
        ? localDateTimeToUtc(dateKey(occurrenceStart.startDate), "00:00", timezone)
        : toInstant(occurrenceStart.startDate, timezone);
      if (start > rangeEnd) break;
      pushOccurrence(occurrenceStart.startDate, occurrenceStart.endDate, `occurrence-${start.getTime()}`);
      if(occurrenceIndex===9999)throw new Error("This calendar has too many historical recurring events. Export a bounded calendar file and try again.");
    }
  }

  return result;
}

function escapeText(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/\r?\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");
}

function toIcsUtc(date: Date) {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

function foldLine(line: string) {
  const output: string[] = [];
  let current = "";
  let byteLength = 0;
  for (const character of line) {
    const length = new TextEncoder().encode(character).length;
    if (byteLength + length > 75) {
      output.push(current);
      current = ` ${character}`;
      byteLength = 1 + length;
    } else {
      current += character;
      byteLength += length;
    }
  }
  output.push(current);
  return output.join("\r\n");
}

export function createCalendarFile(
  state: SemesterState,
  startDate: string,
  endDate: string,
  timezone: string,
  now = new Date(),
) {
  const events: string[][] = [];
  const stamp = toIcsUtc(now);

  for (const session of state.sessions) {
    if (session.status === "skipped" || session.status === "busy" || session.date < startDate || session.date > endDate) continue;
    const start = localDateTimeToUtc(session.date, session.startTime, timezone);
    const end = new Date(start.getTime() + session.durationMinutes * 60_000);
    events.push([
      "BEGIN:VEVENT",
      `UID:${session.id}@semesteros`,
      `DTSTAMP:${stamp}`,
      `DTSTART:${toIcsUtc(start)}`,
      `DTEND:${toIcsUtc(end)}`,
      `SUMMARY:${escapeText(session.title)}`,
      `DESCRIPTION:${escapeText(`Study session · ${session.durationMinutes} minutes`)}`,
      "END:VEVENT",
    ]);
  }

  for (const assignment of state.assignments) {
    if (!assignment.dueDate || assignment.dueDate < startDate || assignment.dueDate > endDate) continue;
    const summary = escapeText(`Due: ${assignment.title}`);
    const description = escapeText(`${state.courses.find((course) => course.id === assignment.courseId)?.code || "Course"} · ${assignment.type} deadline`);
    if (assignment.dueTime) {
      const start = localDateTimeToUtc(assignment.dueDate, assignment.dueTime, timezone);
      const end = new Date(start.getTime() + 30 * 60_000);
      events.push([
        "BEGIN:VEVENT",
        `UID:assignment-${assignment.id}@semesteros`,
        `DTSTAMP:${stamp}`,
        `DTSTART:${toIcsUtc(start)}`,
        `DTEND:${toIcsUtc(end)}`,
        `SUMMARY:${summary}`,
        `DESCRIPTION:${description}`,
        "END:VEVENT",
      ]);
    } else {
      const nextDate = new Date(`${assignment.dueDate}T12:00:00Z`);
      nextDate.setUTCDate(nextDate.getUTCDate() + 1);
      const endDateKey = dateKey({
        year: nextDate.getUTCFullYear(),
        month: nextDate.getUTCMonth() + 1,
        day: nextDate.getUTCDate(),
      });
      events.push([
        "BEGIN:VEVENT",
        `UID:assignment-${assignment.id}@semesteros`,
        `DTSTAMP:${stamp}`,
        `DTSTART;VALUE=DATE:${assignment.dueDate.replaceAll("-", "")}`,
        `DTEND;VALUE=DATE:${endDateKey.replaceAll("-", "")}`,
        `SUMMARY:${summary}`,
        `DESCRIPTION:${description}`,
        "END:VEVENT",
      ]);
    }
  }

  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//SemesterOS//Study Plan//EN",
    "CALSCALE:GREGORIAN",
    ...events.flatMap((event) => event.map(foldLine)),
    "END:VCALENDAR",
    "",
  ].join("\r\n");
}
