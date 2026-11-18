import type { StudySession } from "@workspace/api-client-react";
import { localInstant, minutes, priorityAssignments, sessionErrors, type AcademicState } from "@workspace/academic";

export type UnplacedStudyWork = { title: string; hours: number; reason: string };
export function isMissedStudySession(session: StudySession, today: string, nowMinutes: number) {
  return session.status === "planned" && Boolean(session.assignmentId) &&
    (session.date < today || (session.date === today && minutes(session.startTime) + session.durationMinutes <= nowMinutes));
}

export function buildStudyPlan(state: AcademicState, dates: string[], today: string, nowMinutes: number, replaceMissed: boolean, clock?: Date) {
  const proposed: StudySession[] = [], unplaced: UnplacedStudyWork[] = [];
  // Explicit clock keeps previews and tests reproducible; date/time arguments are in saved timezone.
  const realClock = clock ?? new Date();
  // Legacy callers pass a local clock. Resolve it to an instant without relying on browser timezone.
  const time=`${String(Math.floor(nowMinutes/60)).padStart(2,"0")}:${String(nowMinutes%60).padStart(2,"0")}`;
  const checkClock = clock ?? new Date(localInstant(today,time,state.preferences.timezone||"UTC")??realClock.getTime());
  const retained = state.sessions.filter(s => !(replaceMissed && isMissedStudySession(s,today,nowMinutes)));
  for (const a of priorityAssignments(state)) {
    const allocated = state.sessions.filter(s=>s.assignmentId===a.id).reduce((sum,s)=>sum+(
      s.status==="completed" ? (s.completedMinutes??s.durationMinutes) : s.status==="partial" ? (s.completedMinutes??0) :
      s.status==="planned"&&!isMissedStudySession(s,today,nowMinutes)?s.durationMinutes:0
    ),0);
    let remaining = Math.max(0, Math.round((a.estimatedHours??2)*60)-allocated);
    if (!a.dueDate) {
      if (remaining) unplaced.push({title:a.title,hours:remaining/60,reason:"No due date is saved, so the planner cannot place this work in a deadline-aware weekly plan."});
      continue;
    }
    for (const date of [...new Set(dates)].sort()) {
      if (date<today||date>a.dueDate||!remaining) continue;
      const start=minutes(state.preferences.availabilityStart), end=minutes(state.preferences.availabilityEnd);
      const anchor=state.preferences.preferredTime==="afternoon"?Math.max(start,720):state.preferences.preferredTime==="evening"?Math.max(start,1020):start;
      // Preferred period first, but use earlier availability if the preferred period cannot fit.
      const slots=[...Array.from({length:Math.max(0,Math.ceil((end-start)/15))},(_,i)=>start+i*15)];
      slots.sort((a,b)=>Number(a<anchor)-Number(b<anchor)||a-b);
      for (const minute of slots) {
        if (remaining<15 || (date===today&&minute<nowMinutes+5)) continue;
        const current={...state,sessions:[...retained,...proposed]};
        const used=current.sessions.filter(s=>s.date===date&&s.status!=="busy"&&s.status!=="skipped").reduce((sum,s)=>sum+(s.status==="partial"?(s.completedMinutes??0):s.durationMinutes),0);
        const duration=Math.min(state.preferences.sessionDurationMinutes,remaining,state.preferences.dailyStudyLimit*60-used);
        if (duration<15) continue;
        const candidate:StudySession={id:`session-${crypto.randomUUID()}`,assignmentId:a.id,title:`Work on ${a.title}`,date,
          startTime:`${String(Math.floor(minute/60)).padStart(2,"0")}:${String(minute%60).padStart(2,"0")}`,
          durationMinutes:duration,status:"planned",completedMinutes:null};
        if (!sessionErrors(current,candidate,checkClock).length) {proposed.push(candidate);remaining-=duration;}
      }
    }
    if (remaining) unplaced.push({title:a.title,hours:remaining/60,reason:`Available time windows, daily limits, existing sessions, or the deadline leave too little open time.${a.estimatedHours==null?" Uses a temporary 2-hour estimate.":""}`});
  }
  return {sessions:proposed,unplaced};
}
