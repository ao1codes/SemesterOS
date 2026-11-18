import type { Assignment, Course, SemesterState, StudySession } from "@workspace/api-client-react";

export type AcademicState = Pick<SemesterState, "assignments" | "sessions" | "preferences"> & { courses?: Course[] };

export function normalizeClockTime(value: string | null | undefined): string | null {
  if (!value?.trim()) return null;
  const cleaned = value.trim()
    .replace(/\./g, "")
    .replace(/\b(?:ET|EST|EDT|UTC|GMT|EASTERN(?:\s+TIME)?)\b/gi, "")
    .replace(/^(?:due|by|at)\s*:?\s*/i, "")
    .trim();
  if (/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(cleaned)) return cleaned;
  if (/^noon$/i.test(cleaned)) return "12:00";
  if (/^midnight$/i.test(cleaned)) return "00:00";
  const match = /^(1[0-2]|0?[1-9])(?::([0-5]\d))?\s*(AM|PM)$/i.exec(cleaned);
  if (!match) return null;
  const hour = Number(match[1]) % 12 + (match[3].toUpperCase() === "PM" ? 12 : 0);
  return `${String(hour).padStart(2, "0")}:${match[2] ?? "00"}`;
}

export function semesterDateRange(state: Pick<AcademicState, "preferences" | "courses">) {
  const courses = state.courses ?? [];
  const starts = [state.preferences.semesterStart, ...courses.map(course => course.semesterStart)]
    .filter((date): date is string => Boolean(date))
    .sort();
  const ends = [state.preferences.semesterEnd, ...courses.map(course => course.semesterEnd)]
    .filter((date): date is string => Boolean(date))
    .sort();
  return { start: starts[0] ?? null, end: ends.at(-1) ?? null };
}

export function addDays(date: string, days: number) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
export function mondayOf(date: string) {
  return addDays(date, -((new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7));
}
export function minutes(time: string) {
  return Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
}
export function zonedNow(timezone: string, now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(now).map(p => [p.type, p.value]));
  const time = `${parts.hour}:${parts.minute}`;
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time, minutes: minutes(time) };
}
/** Reject nonexistent spring-forward times instead of silently moving a session. */
export function localInstant(date: string, time: string, timezone: string) {
  const target = Date.parse(`${date}T${time}:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time) || !Number.isFinite(target)) return null;
  let candidate = target;
  for (let i = 0; i < 5; i++) {
    const shown = zonedNow(timezone, new Date(candidate));
    const represented = Date.parse(`${shown.date}T${shown.time}:00Z`);
    if (represented === target) return candidate;
    candidate += target - represented;
  }
  return null;
}
export function effectiveWeight(a: Assignment, courses: Course[] = [], assignments: Assignment[] = []) {
  const course = courses.find(c => c.id === a.courseId);
  if (course?.gradingMode === "points_based") {
    const all = assignments.filter(x => x.courseId === a.courseId);
    if (!all.length || all.some(x => x.pointsPossible == null || x.pointsPossible <= 0)) return null;
    return a.pointsPossible! / all.reduce((sum, x) => sum + x.pointsPossible!, 0) * 100;
  }
  if (a.gradeWeight == null) return null;
  if (course?.gradingMode === "category_weighted") {
    const category = course.gradeCategories?.find(c => c.id === a.gradeCategoryId);
    return category ? category.weight * a.gradeWeight / 100 : null;
  }
  return a.gradeWeight;
}
export function remainingMinutes(state: AcademicState, a: Assignment, includePlanned = false, now = new Date()) {
  const local = zonedNow(state.preferences.timezone || "UTC", now);
  const allocated = state.sessions.filter(s => s.assignmentId === a.id).reduce((sum, s) => sum + (
    s.status === "completed" || s.status === "partial" ? (s.completedMinutes ?? (s.status === "completed" ? s.durationMinutes : 0)) :
    includePlanned && s.status === "planned" && (s.date > local.date || (s.date === local.date && minutes(s.startTime) + s.durationMinutes > local.minutes)) ? s.durationMinutes : 0
  ), 0);
  return Math.max(0, Math.round((a.estimatedHours ?? 2) * 60) - allocated);
}
export function priorityAssignments<T extends AcademicState>(state: T) {
  return state.assignments.filter(a => a.status !== "completed").sort((a, b) => {
    // Undated work stays visible but cannot displace urgent dated work.
    const due = (a.dueDate || "9999").localeCompare(b.dueDate || "9999");
    return due || (effectiveWeight(b, state.courses, state.assignments) ?? -1) -
      (effectiveWeight(a, state.courses, state.assignments) ?? -1) || a.title.localeCompare(b.title);
  });
}
export function weeklyWorkload(state: AcademicState, week: string) {
  const startKey = mondayOf(week), endKey = addDays(startKey, 6);
  const thisWeek = state.assignments.filter(a => a.status !== "completed" && a.dueDate && a.dueDate >= startKey && a.dueDate <= endKey);
  const hours = thisWeek.reduce((sum, a) => sum + remainingMinutes(state, a) / 60, 0);
  const capacity = state.preferences.dailyStudyLimit * new Set(state.preferences.availableDays).size;
  const weights = thisWeek.map(a => effectiveWeight(a, state.courses, state.assignments)).filter((w): w is number => w != null);
  const gradeWeight = weights.reduce((sum, w) => sum + w, 0);
  const academic = capacity > 0 ? Math.min(100, Math.round(hours / capacity * 100)) : null;
  const concentration = Math.min(100, thisWeek.length * 20);
  const gradeImportance = weights.length ? Math.min(100, Math.round(gradeWeight / 40 * 100)) : null;
  const values = [{v:academic,w:0.5},{v:concentration,w:0.3},{v:gradeImportance,w:0.2}].filter(x => x.v != null);
  const level = values.length ? Math.round(values.reduce((s,x) => s + x.v! * x.w,0) / values.reduce((s,x) => s+x.w,0)) : null;
  const completed = state.sessions.filter(s => (s.status === "completed" || s.status === "partial") && s.date >= startKey && s.date <= endKey)
    .reduce((sum,s) => sum + (s.completedMinutes ?? (s.status === "completed" ? s.durationMinutes : 0)), 0) / 60;
  return {thisWeek,hours,capacity,gradeWeight,academic,concentration,gradeImportance,level,completed,startKey,endKey,
    free:Math.max(0,capacity-hours),gradeItems:weights.length,
    unknownDates:state.assignments.filter(a=>a.status!=="completed"&&!a.dueDate).length,
    defaultedHours:thisWeek.filter(a=>a.estimatedHours==null).length,
    category:level==null?"No score":level<25?"Light":level<50?"Moderate":level<75?"Heavy":"Very heavy"};
}
function absoluteMinutes(date: string, time: string) {
  return Date.parse(`${date}T00:00:00Z`) / 60000 + minutes(time);
}
/** Intersections include overnight/multi-day imported commitments. */
export function sessionErrors(state: AcademicState, candidate: StudySession, now = new Date()): string[] {
  if (candidate.status !== "planned") return [];
  const errors: string[] = [], p = state.preferences;
  const start = absoluteMinutes(candidate.date, candidate.startTime), end = start + candidate.durationMinutes;
  const instant = localInstant(candidate.date, candidate.startTime, p.timezone);
  if (instant == null) errors.push("Choose a real local time; this time may not exist during daylight saving changes.");
  else {
    if (instant < now.getTime()) errors.push("Choose a date and time that are not in the past.");
    const finish = zonedNow(p.timezone, new Date(instant + candidate.durationMinutes * 60000));
    const nominalEnd = start + candidate.durationMinutes;
    if (absoluteMinutes(finish.date, finish.time) !== nominalEnd) errors.push("A session cannot cross a daylight saving clock change.");
  }
  const weekday = new Date(`${candidate.date}T12:00:00Z`).getUTCDay();
  if (!p.availableDays.includes(weekday)) errors.push("This day is outside your saved availability.");
  if (minutes(candidate.startTime) < minutes(p.availabilityStart) || minutes(candidate.startTime) + candidate.durationMinutes > minutes(p.availabilityEnd))
    errors.push("This time is outside your saved study hours.");
  const assignment = state.assignments.find(a => a.id === candidate.assignmentId);
  if (assignment?.status === "completed") errors.push("This assignment is already complete.");
  if (assignment?.dueDate && end > absoluteMinutes(assignment.dueDate, assignment.dueTime || "23:59"))
    errors.push("Study must finish before the assignment deadline.");
  const others = state.sessions.filter(s => s.id !== candidate.id && s.status !== "skipped");
  if (others.some(s => {
    const otherStart = absoluteMinutes(s.date,s.startTime), otherEnd = otherStart + s.durationMinutes;
    const gap = s.status === "busy" ? 0 : p.breakMinutes;
    return start < otherEnd + gap && end + gap > otherStart;
  })) errors.push("This time overlaps another session, a busy block, or a required study break.");
  const used = others.filter(s => s.date === candidate.date && s.status !== "busy")
    .reduce((sum,s) => sum + (s.status === "partial" ? (s.completedMinutes ?? 0) : s.durationMinutes),0);
  if (used + candidate.durationMinutes > p.dailyStudyLimit * 60) errors.push("This would exceed your daily study limit.");
  return errors;
}
export function availableMinutes(state: AcademicState, date: string, now = new Date()) {
  const p = state.preferences, local = zonedNow(p.timezone,now);
  if (date < local.date || !p.availableDays.includes(new Date(`${date}T12:00:00Z`).getUTCDay())) return 0;
  let free = 0;
  for (let minute = Math.max(minutes(p.availabilityStart), date === local.date ? local.minutes : 0); minute < minutes(p.availabilityEnd); minute++) {
    const start = absoluteMinutes(date, "00:00") + minute;
    if (!state.sessions.some(s => s.status !== "skipped" && start >= absoluteMinutes(s.date,s.startTime) && start < absoluteMinutes(s.date,s.startTime) + s.durationMinutes)) free++;
  }
  const used = state.sessions.filter(s=>s.date===date&&s.status!=="busy"&&s.status!=="skipped").reduce((sum,s)=>sum+s.durationMinutes,0);
  return Math.max(0,Math.min(free,p.dailyStudyLimit*60-used));
}
