type ZonedFields = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

function fieldsAt(instant: Date, timeZone: string): ZonedFields {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour: Number(values.hour),
    minute: Number(values.minute),
    second: Number(values.second),
  };
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

export function zonedDateTimeToUtc(date: string, time: string, timeZone: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const timeMatch = /^(\d{2}):(\d{2})$/.exec(time);
  if (!match || !timeMatch || !isValidTimeZone(timeZone)) {
    throw new RangeError("Invalid date, time, or time zone.");
  }

  const [, year, month, day] = match;
  const [, hour, minute] = timeMatch;
  const normalizedDate = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (
    normalizedDate.getUTCFullYear() !== Number(year) ||
    normalizedDate.getUTCMonth() + 1 !== Number(month) ||
    normalizedDate.getUTCDate() !== Number(day) ||
    Number(hour) > 23 ||
    Number(minute) > 59
  ) {
    throw new RangeError("Invalid date or time.");
  }
  const target = Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute));
  let candidate = target;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const fields = fieldsAt(new Date(candidate), timeZone);
    const represented = Date.UTC(
      fields.year,
      fields.month - 1,
      fields.day,
      fields.hour,
      fields.minute,
      fields.second,
    );
    const adjustment = target - represented;
    if (adjustment === 0) return new Date(candidate);
    candidate += adjustment;
  }

  return new Date(candidate);
}

export function utcToZonedDateTime(instant: Date, timeZone: string): { date: string; time: string } {
  const fields = fieldsAt(instant, timeZone);
  return {
    date: `${fields.year}-${String(fields.month).padStart(2, "0")}-${String(fields.day).padStart(2, "0")}`,
    time: `${String(fields.hour).padStart(2, "0")}:${String(fields.minute).padStart(2, "0")}`,
  };
}
