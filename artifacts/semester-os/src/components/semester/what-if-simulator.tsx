import { useEffect, useMemo, useState } from "react";
import type { Assignment, Preferences, StudySession } from "@workspace/api-client-react";
import { sessionErrors, zonedNow } from "@workspace/academic";
import { buildStudyPlan } from "@/lib/study-planner";

type WhatIfSimulatorProps = {
  currentScore: number | null;
  weeklyHours: number;
  concentration: number | null;
  gradeImportance: number | null;
  availableDays: number;
  dailyLimit: number;
  assignments: Assignment[];
  sessions: StudySession[];
  preferences: Preferences;
  onApplyCapacity: (hoursPerDay: number) => void;
  onApplySessions: (sessions: StudySession[]) => void;
};

function calculateScore(hours: number, capacity: number, concentration: number | null, gradeImportance: number | null) {
  const academic = capacity > 0 ? Math.min(100, Math.round((hours / capacity) * 100)) : null;
  const components = [
    { value: academic, weight: 0.5 },
    { value: concentration, weight: 0.3 },
    { value: gradeImportance, weight: 0.2 },
  ].filter((item): item is { value: number; weight: number } => item.value != null);
  if (!components.length) return null;
  return Math.round(components.reduce((sum, item) => sum + item.value * item.weight, 0) / components.reduce((sum, item) => sum + item.weight, 0));
}

function shiftDate(date: string, offset: number) {
  const value = new Date(`${date}T12:00:00`);
  value.setDate(value.getDate() + offset);
  return `${value.getFullYear()}-${String(value.getMonth()+1).padStart(2,"0")}-${String(value.getDate()).padStart(2,"0")}`;
}
function dateKey(value:Date) {
  return `${value.getFullYear()}-${String(value.getMonth()+1).padStart(2,"0")}-${String(value.getDate()).padStart(2,"0")}`;
}
function mondayKey(value:string) {
  const date=new Date(`${value}T12:00:00`);
  date.setDate(date.getDate()-((date.getDay()+6)%7));
  return dateKey(date);
}
function hoursForWeek(items:StudySession[],start:string) {
  const end=shiftDate(start,6);
  return items.filter(item=>item.status==="planned"&&item.date>=start&&item.date<=end).reduce((sum,item)=>sum+item.durationMinutes/60,0);
}

export function WhatIfSimulator({ currentScore, weeklyHours, concentration, gradeImportance, availableDays, dailyLimit, assignments, sessions, preferences, onApplyCapacity, onApplySessions }: WhatIfSimulatorProps) {
  const [hoursPerDay, setHoursPerDay] = useState(dailyLimit);
  const [shiftBy, setShiftBy] = useState(-1);
  const [largeAssignmentId, setLargeAssignmentId] = useState("");
  const basis=JSON.stringify({sessions,assignments,preferences});
  const [scenario, setScenario] = useState<{label:string;sessions:StudySession[];basis:string}|null>(null);
  useEffect(()=>{setScenario(current=>current&&current.basis!==basis?null:current);},[basis]);
  const [saved, setSaved] = useState(false);
  useEffect(() => setHoursPerDay(dailyLimit), [dailyLimit]);
  const candidates = useMemo(()=>assignments.filter(a=>a.status!=="completed").sort((a,b)=>(b.estimatedHours||0)-(a.estimatedHours||0)),[assignments]);
  useEffect(()=>{if(!candidates.some(a=>a.id===largeAssignmentId))setLargeAssignmentId(candidates[0]?.id||"");},[candidates,largeAssignmentId]);
  const projectedScore = calculateScore(weeklyHours, hoursPerDay * availableDays, concentration, gradeImportance);
  const plannedSessions=sessions.filter(session=>session.status==="planned");
  const local=zonedNow(preferences.timezone);
  const currentWeek=mondayKey(local.date);
  const nextWeek=shiftDate(currentWeek,7);
  const previewShift=(direction:number)=>{
    const today=new Date(`${local.date}T12:00:00`);
    const next=sessions.map(session=>{
      if(session.status!=="planned")return session;
      const date=shiftDate(session.date,direction);
      const todayKey=`${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,"0")}-${String(today.getDate()).padStart(2,"0")}`;
      return {...session,date:date<todayKey?todayKey:date};
    });
    setScenario({label:direction<0?"Move planned work earlier":"Move planned work later",sessions:next,basis});
  };
  const previewStartSooner=()=>{
    const assignment=candidates.find(item=>item.id===largeAssignmentId);
    if(!assignment)return;
    const today=new Date();today.setHours(12,0,0,0);
    const todayKey=local.date;
    const existingForAssignment=sessions.some(session=>session.assignmentId===assignment.id&&session.status==="planned");
    let next=sessions.map(session=>session.assignmentId===assignment.id&&session.status==="planned"?{...session,date:shiftDate(session.date,-2)<todayKey?todayKey:shiftDate(session.date,-2)}:session);
    if(!existingForAssignment){
      const generated=buildStudyPlan({assignments:[assignment],sessions:next,preferences},Array.from({length:7},(_,i)=>shiftDate(todayKey,i)),todayKey,local.minutes,false);
      next=[...next,...generated.sessions.slice(0,1)];
    }
    setScenario({label:`Start ${assignment.title} sooner`,sessions:next,basis});
  };
  const applyScenario=()=>{
    if(!scenario||scenario.basis!==basis)return;
    if(conflicts.length)return;
    onApplySessions(scenario.sessions);
    setSaved(true);
    setScenario(null);
    window.setTimeout(()=>setSaved(false),2200);
  };
  const changedCount=scenario?.sessions.filter(session=>sessions.find(old=>old.id===session.id)?.date!==session.date).length||0;
  const afterDueCount=scenario?.sessions.filter(session=>session.status==="planned"&&assignments.some(assignment=>assignment.id===session.assignmentId&&assignment.dueDate&&session.date>assignment.dueDate)).length||0;
  const conflictRows=scenario?scenario.sessions.filter(session=>session.status==="planned").flatMap(session=>scenario.sessions.filter(other=>{
    if(other.id===session.id||other.date!==session.date||other.status==="skipped")return false;
    const start=Number(session.startTime.slice(0,2))*60+Number(session.startTime.slice(3,5));
    const otherStart=Number(other.startTime.slice(0,2))*60+Number(other.startTime.slice(3,5));
    return start<otherStart+other.durationMinutes&&start+session.durationMinutes>otherStart;
  }).map(other=>({key:[session.id,other.id].sort().join(":"),text:`${session.title} overlaps ${other.title} on ${session.date}`}))):[];
  const conflicts=[...new Set([...conflictRows.map(item=>item.text),...(scenario?.sessions??[])
    .filter(session=>session.status==="planned"&&JSON.stringify(sessions.find(old=>old.id===session.id))!==JSON.stringify(session))
    .flatMap(session=>sessionErrors({assignments,sessions:scenario!.sessions,preferences},session).map(error=>`${session.title}: ${error}`))])];
  const weekImpact=scenario?[
    {label:"This week",before:hoursForWeek(sessions,currentWeek),after:hoursForWeek(scenario.sessions,currentWeek)},
    {label:"Next week",before:hoursForWeek(sessions,nextWeek),after:hoursForWeek(scenario.sessions,nextWeek)},
  ]:[];

  return (
    <section className="card" data-testid="panel-what-if-simulator">
      <div className="eyebrow">What if?</div>
      <h2 className="card-title" style={{ marginTop: 7 }}>Compare a different week</h2>
      <p className="card-caption" style={{ lineHeight: 1.6 }}>Try a capacity change or preview schedule shifts. Each scenario stays separate from your saved plan until you apply it. Assignment due dates and grade weights never change.</p>
      <div className="grid-two" style={{ marginTop: 17, alignItems: "end" }}>
        <div className="form-field"><label htmlFor="what-if-daily-hours">Study hours per available day</label><input id="what-if-daily-hours" className="field" type="number" min="1" max="12" step="1" value={hoursPerDay} onChange={event => setHoursPerDay(Number(event.target.value))} data-testid="input-what-if-daily-hours"/></div>
        <div className="notice" data-testid="text-what-if-score"><strong>{currentScore ?? "—"}</strong> current score <span aria-hidden="true"> → </span><strong>{projectedScore ?? "—"}</strong> capacity scenario<div style={{ marginTop: 4 }}>{availableDays} available {availableDays === 1 ? "day" : "days"} · {(hoursPerDay * availableDays).toFixed(0)}h capacity</div></div>
      </div>
      <div className="tool-row" style={{marginTop:11}}>
        <button className="quiet-button" type="button" disabled={hoursPerDay === dailyLimit || hoursPerDay < 1 || hoursPerDay > 12} onClick={() => {onApplyCapacity(hoursPerDay);setSaved(true);window.setTimeout(() => setSaved(false), 2200);}} data-testid="button-apply-what-if-capacity">{saved ? "Capacity saved" : "Apply daily capacity"}</button>
      </div>
      <div className="form-grid" style={{marginTop:20}}>
        <div className="form-field"><label htmlFor="what-if-shift-days">Move planned sessions</label><select id="what-if-shift-days" className="field-select" value={shiftBy} onChange={event=>setShiftBy(Number(event.target.value))} data-testid="select-what-if-shift"><option value={-2}>2 days earlier</option><option value={-1}>1 day earlier</option><option value={1}>1 day later</option><option value={2}>2 days later</option></select><button className="quiet-button" type="button" disabled={!plannedSessions.length} onClick={()=>previewShift(shiftBy)} data-testid="button-preview-work-shift">Preview schedule shift</button></div>
        <div className="form-field"><label htmlFor="what-if-large-assignment">Start a large assignment sooner</label><select id="what-if-large-assignment" className="field-select" value={largeAssignmentId} onChange={event=>setLargeAssignmentId(event.target.value)} data-testid="select-what-if-large-assignment">{candidates.map(item=><option key={item.id} value={item.id}>{item.title} · {item.estimatedHours??"no"}h estimate</option>)}</select><button className="quiet-button" type="button" disabled={!largeAssignmentId} onClick={previewStartSooner} data-testid="button-preview-start-sooner">Preview starting sooner</button><span className="card-caption">Moves existing planned sessions up to 2 days earlier, or previews a short first session if none are planned.</span></div>
      </div>
       {scenario&&<div className="notice" style={{marginTop:15}} data-testid="panel-what-if-preview"><strong>{scenario.label}</strong><div style={{marginTop:4}}>{changedCount} planned session{changedCount===1?"":"s"} would change. Your saved calendar remains unchanged until you apply.</div><div className="card-caption" style={{marginTop:8}}>Scheduled study hours · current → proposed</div>{weekImpact.map(week=><div key={week.label} style={{marginTop:4}}>{week.label}: {week.before.toFixed(1)}h → {week.after.toFixed(1)}h</div>)}<div className="card-caption" style={{marginTop:6}}>The deadline-based workload score stays {currentScore??"—"} because assignment dates and weights do not change.</div>{scenario.sessions.filter(session=>sessions.find(old=>old.id===session.id)?.date!==session.date).slice(0,4).map(session=>{const old=sessions.find(item=>item.id===session.id);return <div key={session.id} style={{marginTop:6}} data-testid={`row-what-if-session-${session.id}`}>{session.title}: {old?`${old.date} → `:"New session · "}{session.date} at {session.startTime}</div>;})}{changedCount===0&&<div>No eligible planned sessions are available to move in this scenario.</div>}{afterDueCount>0&&<div className="notice coral" style={{marginTop:9}} data-testid="notice-what-if-after-deadline">{afterDueCount} planned session{afterDueCount===1?" falls":"s fall"} after the assignment due date in this scenario. The assignment deadline is unchanged.</div>}{conflicts.length>0&&<div className="notice coral" style={{marginTop:9}} data-testid="notice-what-if-conflicts"><strong>This schedule has overlapping sessions or busy calendar blocks and cannot be applied.</strong>{conflicts.slice(0,4).map((conflict,index)=><div key={index} style={{marginTop:5}}>{conflict}</div>)}</div>}<div className="tool-row" style={{marginTop:10}}><button type="button" className="primary-button" disabled={!changedCount||conflicts.length>0} onClick={applyScenario} data-testid="button-apply-what-if-scenario">Apply this schedule</button><button type="button" className="quiet-button" onClick={()=>setScenario(null)} data-testid="button-cancel-what-if-scenario">Discard scenario</button></div></div>}
      {!plannedSessions.length&&<p className="card-caption" style={{marginTop:12}} data-testid="text-what-if-no-sessions">No planned sessions yet. Build a plan in Study planner to compare schedule shifts.</p>}
      {saved&&<div className="card-caption" role="status" data-testid="status-what-if-applied">Your selected scenario has been applied.</div>}
    </section>
  );
}
