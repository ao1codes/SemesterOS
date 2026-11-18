import assert from "node:assert/strict";
import test from "node:test";
import { addDays, effectiveWeight, localInstant, mondayOf, sessionErrors, weeklyWorkload, zonedNow, type AcademicState } from "@workspace/academic";
import type { Assignment, Course, StudySession } from "@workspace/api-client-react";
import { buildStudyPlan } from "./study-planner.ts";

const a:Assignment={id:"a",courseId:"c",title:"Paper",type:"paper",dueDate:"2027-03-10",dueTime:"17:00",estimatedHours:2,gradeWeight:50,status:"upcoming",milestones:[]};
const course:Course={id:"c",name:"Course",code:"C",color:"#6758E8",semesterStart:"2027-01-01",semesterEnd:"2027-05-01"};
const session:StudySession={id:"s",assignmentId:"a",title:"Study",date:"2027-03-08",startTime:"10:00",durationMinutes:60,status:"planned"};
const state:AcademicState={courses:[course],assignments:[a],sessions:[],preferences:{
  timezone:"America/New_York",semesterStart:"2027-01-01",semesterEnd:"2027-05-01",availableDays:[1,2,3,4,5],
  availabilityStart:"09:00",availabilityEnd:"17:00",preferredTime:"morning",sessionDurationMinutes:60,
  breakMinutes:15,dailyStudyLimit:2,reminderHours:[24],quietHoursStart:"22:00",quietHoursEnd:"08:00",
}};
const now=new Date("2027-03-08T13:00:00Z");
test("dates use saved timezone and Monday–Sunday weeks across year boundaries",()=>{
  assert.equal(zonedNow("America/Los_Angeles",new Date("2027-01-01T02:00:00Z")).date,"2026-12-31");
  assert.equal(mondayOf("2027-01-01"),"2026-12-28");
  assert.equal(addDays("2026-12-31",1),"2027-01-01");
});
test("nonexistent daylight-saving local times are rejected",()=>{
  assert.equal(localInstant("2027-03-14","02:30","America/New_York"),null);
  assert.equal(new Date(localInstant("2027-03-15","09:00","America/New_York")!).toISOString(),"2027-03-15T13:00:00.000Z");
});
test("grade importance converts within-category percentages into course percentages",()=>{
  assert.equal(effectiveWeight({...a,gradeCategoryId:"papers"},[{...course,gradingMode:"category_weighted",gradeCategories:[{id:"papers",name:"Papers",weight:40}]}],[a]),20);
  assert.equal(effectiveWeight(a,[{...course,gradingMode:"category_weighted"}],[a]),null);
});
test("points importance requires a complete known denominator",()=>{
  const courses=[{...course,gradingMode:"points_based" as const}];
  assert.equal(effectiveWeight({...a,pointsPossible:25},courses,[{...a,pointsPossible:25},{...a,id:"b",pointsPossible:75}]),25);
  assert.equal(effectiveWeight({...a,pointsPossible:25},courses,[{...a,pointsPossible:25},{...a,id:"b"}]),null);
});
test("workload subtracts completed and partial effort without counting planned time as done",()=>{
  const w=weeklyWorkload({...state,sessions:[{...session,status:"partial",completedMinutes:30}]},"2027-03-08");
  assert.equal(w.hours,1.5);assert.equal(w.completed,0.5);
});
test("manual moves reject unavailable days, daily limits, deadlines and past times",()=>{
  assert.match(sessionErrors(state,{...session,date:"2027-03-13"},now).join(" "),/availability|deadline/);
  assert.match(sessionErrors(state,{...session,startTime:"08:00"},now).join(" "),/study hours/);
  assert.match(sessionErrors(state,{...session,date:"2027-03-10",startTime:"16:30"},now).join(" "),/deadline/);
  assert.match(sessionErrors({...state,sessions:[{...session,id:"old",startTime:"14:00",durationMinutes:120}]},session,now).join(" "),/daily study limit/);
  assert.match(sessionErrors(state,session,new Date("2027-03-09T13:00:00Z")).join(" "),/past/);
});
test("overnight and multi-day busy blocks prevent next-day overlaps",()=>{
  const busy={...session,id:"busy",assignmentId:null,status:"busy" as const,date:"2027-03-07",startTime:"23:00",durationMinutes:1200};
  assert.match(sessionErrors({...state,sessions:[busy]},session,now).join(" "),/busy block/);
});
test("breaks apply before and after existing study but not after busy commitments",()=>{
  const before={...session,id:"old",startTime:"09:00"};
  assert.match(sessionErrors({...state,sessions:[before]},session,now).join(" "),/break/);
  assert.deepEqual(sessionErrors({...state,sessions:[{...before,status:"busy"}]},session,now),[]);
});
test("planner uses higher course importance when deadlines tie",()=>{
  const high={...a,id:"high",gradeWeight:40,estimatedHours:2};
  const low={...a,id:"low",gradeWeight:5,estimatedHours:2};
  const plan=buildStudyPlan({...state,assignments:[low,high]},["2027-03-08"],"2027-03-08",8*60,false,now);
  assert.ok(plan.sessions.every(s=>s.assignmentId==="high"));
  assert.ok(plan.unplaced.some(w=>w.title===a.title));
});
test("planner falls back to earlier availability rather than declaring preferred evening impossible",()=>{
  const plan=buildStudyPlan({...state,preferences:{...state.preferences,preferredTime:"evening"}},["2027-03-08"],"2027-03-08",8*60,false,now);
  assert.equal(plan.sessions.length,2);
  assert.ok(plan.sessions.every(s=>s.startTime<"17:00"));
});
