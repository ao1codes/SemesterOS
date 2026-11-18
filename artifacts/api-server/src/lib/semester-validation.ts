import type { SemesterState } from "./semester-store";
const validTime=(value:string)=>/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
export function semesterValidationError(state:SemesterState):string|null {
  const p=state.preferences;
  try {new Intl.DateTimeFormat("en-US",{timeZone:p.timezone}).format();} catch {return "Choose a valid timezone.";}
  if(![p.availabilityStart,p.availabilityEnd,p.quietHoursStart,p.quietHoursEnd].every(validTime))return "Study and quiet hours must use HH:MM times.";
  if(p.availabilityStart>=p.availabilityEnd)return "Study availability must end after it starts on the same day.";
  if(p.semesterStart>p.semesterEnd)return "Semester end must follow semester start.";
  const collections=[state.courses,state.assignments,state.sessions,state.documents,state.notifications];
  if(collections.some(items=>new Set(items.map(i=>i.id)).size!==items.length))return "Each record must have a unique ID.";
  const courseIds=new Set(state.courses.map(c=>c.id));
  if(state.assignments.some(a=>!courseIds.has(a.courseId)))return "An assignment references a missing course.";
  if(state.documents.some(d=>d.courseId&&!courseIds.has(d.courseId)))return "A document references a missing course.";
  if(state.assignments.some(a=>a.dueTime&&!validTime(a.dueTime)))return "Assignment due times must use HH:MM.";
  if(state.sessions.some(s=>!validTime(s.startTime)))return "Session start times must use HH:MM.";
  if(state.sessions.some(s=>s.completedMinutes!=null&&s.completedMinutes>s.durationMinutes))return "Completed minutes cannot exceed session duration.";
  if(state.assignments.some(a=>a.pointsEarned!=null&&a.pointsPossible!=null&&a.pointsEarned>a.pointsPossible))return "Earned points cannot exceed possible points.";
  return null;
}
