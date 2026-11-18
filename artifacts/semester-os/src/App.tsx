import { createContext, useContext, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { ClerkProvider, SignIn, SignUp } from "@clerk/react";
import { clerkKey as clerkPubKey, useAuth, useClerk, useUser } from "@/lib/account-auth";
import { Overview } from "@/components/semester/overview";
import { AccountDeletion } from "@/components/semester/account-deletion";
import "@/components/semester/auth-responsive.css";
import { addDays, zonedNow, sessionErrors, priorityAssignments } from "@workspace/academic";
import { shadcn } from "@clerk/themes";
import { ErrorBoundary } from "@/components/error-boundary";
import { GradeTracker } from "@/components/semester/grade-tracker";
import { SyllabusUpload } from "@/components/semester/syllabus-upload";
import { WhatIfSimulator } from "@/components/semester/what-if-simulator";
import { GoogleCalendarPanel } from "@/components/semester/google-calendar-panel";
import { createCalendarFile, parseCalendarFile, isUpcomingCalendarBlock } from "@/lib/calendar-ics";
import { NOTIFICATIONS_ENABLED } from "@/lib/features";
import { buildStudyPlan, isMissedStudySession } from "@/lib/study-planner";
import { answerDemoQuestion, type DemoAnswer } from "@/lib/demo-answers";
import { getWeeklyWorkload } from "@/lib/workload-calculations";
import { semesterDateRange } from "@workspace/academic";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import { Route, Switch, Link, useLocation, useRoute, Router as WouterRouter } from "wouter";
import { Activity, ArrowRight, Bell, BookOpen, CalendarDays, Check, CheckCircle2, CircleHelp, Clock3, FileText, Filter, GraduationCap, LayoutDashboard, LogOut, Plus, Settings2, Sparkles, Trash2, Upload, X } from "lucide-react";
import { useAskSyllabi, useGetNotificationDeliveryStatus, useSuggestAssignmentMilestones } from "@workspace/api-client-react";
import type { Assignment, Course, Notification, PolicyNote, Preferences, SemesterState, StudySession } from "@workspace/api-client-react";
import { DEMO_STORAGE_KEY, useSemester } from "@/hooks/use-semester";
import { useDialogFocus } from "@/hooks/use-dialog-focus";
import { enableBrowserPush, suspendBrowserPush } from "@/lib/onesignal";

const queryClient = new QueryClient();
const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");
function stripBase(path: string) { return basePath && path.startsWith(basePath) ? path.slice(basePath.length) || "/" : path; }

const appearance = {
  theme: shadcn, cssLayerName:"clerk",
  options:{logoPlacement:"inside" as const,logoLinkUrl:basePath || "/",logoImageUrl:`${window.location.origin}${basePath}/logo.svg`},
  variables:{colorPrimary:"#6758E8",colorForeground:"#28263B",colorMutedForeground:"#777589",colorDanger:"#c65348",colorBackground:"#FBFAF7",colorInput:"#FBFAF7",colorInputForeground:"#28263B",colorNeutral:"#28263B",fontFamily:"DM Sans, sans-serif",borderRadius:"0.8rem"},
  elements:{rootBox:"w-full flex justify-center",cardBox:"bg-[#FBFAF7] rounded-2xl w-[440px] max-w-full overflow-hidden",card:"!shadow-none !border-0 !bg-transparent !rounded-none",footer:"!shadow-none !border-0 !bg-transparent !rounded-none",headerTitle:"text-[#28263B] font-bold",headerSubtitle:"text-[#777589]",socialButtonsBlockButtonText:"text-[#28263B] font-semibold",formFieldLabel:"text-[#4f4c61] font-semibold",footerActionLink:"text-[#6758E8] font-semibold",footerActionText:"text-[#777589]",dividerText:"text-[#777589]",identityPreviewEditButton:"text-[#6758E8]",formFieldSuccessText:"text-[#58722b]",alertText:"text-[#9c5345]",logoBox:"mb-3",logoImage:"rounded-lg",socialButtonsBlockButton:"border-[#e5e2da] rounded-xl",formButtonPrimary:"rounded-xl font-bold",formFieldInput:"rounded-xl border-[#e5e2da] bg-[#fbfaf7]",footerAction:"text-[#777589]",dividerLine:"bg-[#e5e2da]",alert:"rounded-xl",otpCodeFieldInput:"rounded-lg",formFieldRow:"gap-2",main:"gap-4"},
};
const SemesterContext = createContext<ReturnType<typeof useSemester> | null>(null);
function useS() { const ctx = useContext(SemesterContext); if (!ctx) throw new Error("Semester state is unavailable"); return ctx; }
function SemesterProvider({ children }: { children: ReactNode }) {
  const {userId}=useAuth();
  return <AccountSemesterProvider key={userId??"demo"}>{children}</AccountSemesterProvider>;
}
function AccountSemesterProvider({ children }: { children: ReactNode }) {
  const semester = useSemester();
  useEffect(()=>()=>{void suspendBrowserPush().catch(()=>{});},[]);
  useEffect(()=>{if(!semester.state.preferences.pushEnabled)void suspendBrowserPush().catch(()=>{});},[semester.state.preferences.pushEnabled]);
  return <SemesterContext.Provider value={semester}>{children}</SemesterContext.Provider>;
}

const navItems = [
  {href:"/",label:"Overview",icon:LayoutDashboard},
  {href:"/assignments",label:"Assignments",icon:CheckCircle2},
  {href:"/study-planner",label:"Study planner",icon:CalendarDays},
  {href:"/workload",label:"Workload",icon:Activity},
  {href:"/ask",label:"Ask your syllabi",icon:CircleHelp},
  {href:"/settings",label:"Settings",icon:Settings2},
];
const notificationCategoryOptions: { value: Notification["category"]; label: string }[] = [
  {value:"deadline",label:"Deadlines"},
  {value:"exam",label:"Exams"},
  {value:"study_session",label:"Study sessions"},
  {value:"workload",label:"Heavy weeks"},
  {value:"conflict",label:"Schedule conflicts"},
  {value:"missed_session",label:"Missed sessions"},
  {value:"syllabus",label:"Syllabus changes"},
  {value:"progress",label:"Weekly progress"},
];
function AppShell({ children }: {children:ReactNode}) {
  const [location] = useLocation();
  const { mode, isSignedIn, isLoaded,loadError,retryLoad,saveError,saveErrorMessage,conflict,retrySave,reloadSaved,saving } = useS();
  const { user } = useUser();
  const { signOut } = useClerk();
  const {state,update}=useS();
  const [notificationsOpen,setNotificationsOpen]=useState(false);
  const [showSnoozed,setShowSnoozed]=useState(false);
  const notifications=[...state.notifications].sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
  const now=Date.now();
  const snoozedCount=notifications.filter(notification=>notification.snoozedUntil&&new Date(notification.snoozedUntil).getTime()>now&&!notification.dismissed).length;
  const unreadCount=notifications.filter(notification=>!notification.isRead&&!notification.dismissed&&!(notification.snoozedUntil&&new Date(notification.snoozedUntil).getTime()>now)).length;
  const visibleNotifications=notifications.filter(notification=>showSnoozed||!(notification.snoozedUntil&&new Date(notification.snoozedUntil).getTime()>now));
  useEffect(()=>{
    const expirations=state.notifications.map(item=>item.snoozedUntil?Date.parse(String(item.snoozedUntil)):Number.POSITIVE_INFINITY);
    const nextExpiry=Math.min(...expirations);
    if(!Number.isFinite(nextExpiry))return;
    const timer=window.setTimeout(()=>{
      const currentTime=Date.now();
      update(current=>({...current,notifications:current.notifications.map(item=>{
        if(!item.snoozedUntil)return item;
        const expiry=Date.parse(String(item.snoozedUntil));
        return !Number.isFinite(expiry)||expiry<=currentTime?{...item,isRead:false,snoozedUntil:null}:item;
      })}));
    },Math.max(0,nextExpiry-Date.now()+10));
    return ()=>window.clearTimeout(timer);
  },[state.notifications]);
  const markNotification=(item:Notification,change:Partial<Notification>)=>update(s=>({...s,notifications:s.notifications.map(n=>n.id===item.id?{...n,...change}:n)}));
  const active = navItems.find(i => i.href === location)?.label ?? "SemesterOS";
  return <div className="app-frame"><div className="shell">
    <aside className="sidebar">
      <Link href="/" className="brand" data-testid="link-brand"><span className="brand-mark"><GraduationCap size={19}/></span><span className="brand-text">semester<span style={{fontWeight:500}}>os</span></span></Link>
      <nav className="nav-section" aria-label="Main navigation">
        <div className="nav-label">Your semester</div>
        {navItems.map(({href,label,icon:Icon})=><Link key={href} href={href} className={`nav-link ${location===href?"active":""}`} data-testid={`link-${label.toLowerCase().replaceAll(" ","-")}`}><Icon/><span>{label}</span></Link>)}
      </nav>
      <div className="sidebar-foot"><div className="demo-note" data-testid="notice-mode"><strong>{mode==="demo"?"Demo / sample data":"Your private space"}</strong>{mode==="demo"?"Changes stay in this browser. Create an account to keep your semester across devices.":"Only you can see your semester plan."}</div></div>
    </aside>
    <main className="main">
      <div className="topbar">
        <div className="crumb">Your semester <span style={{padding:"0 7px",color:"#c4c1cb"}}>/</span> {active}</div>
        <div className="top-actions">
          {mode === "demo" && <span className="pill violet" data-testid="text-demo-label">Demo / sample data</span>}
          {NOTIFICATIONS_ENABLED&&<div style={{position:"relative"}}><button className="quiet-button" type="button" onClick={()=>setNotificationsOpen(v=>!v)} aria-expanded={notificationsOpen} aria-label={`Notifications${unreadCount?`, ${unreadCount} unread`:""}`} data-testid="button-notifications"><Bell size={15}/>{unreadCount>0&&<span className="pill coral" style={{padding:"1px 6px",fontSize:10}}>{unreadCount}</span>}</button>
            {notificationsOpen&&<div className="card" style={{position:"absolute",zIndex:25,right:0,top:44,width:"min(360px,calc(100vw - 35px))",maxHeight:420,overflow:"auto",boxShadow:"0 15px 35px #28263b1b",padding:16}} data-testid="panel-notifications"><div className="section-row" style={{margin:"0 0 12px"}}><div><h2>Notifications</h2><span className="card-caption">{unreadCount} unread</span></div><div className="tool-row"><button className="text-button" onClick={()=>update(s=>({...s,notifications:s.notifications.map(n=>n.dismissed?n:{...n,isRead:true,snoozedUntil:null})}))} disabled={!unreadCount} data-testid="button-mark-all-notifications-read">Mark all read</button><button className="text-button" onClick={()=>setNotificationsOpen(false)} aria-label="Close notifications" data-testid="button-close-notifications"><X size={14}/></button></div></div>
              {visibleNotifications.length?visibleNotifications.map(n=><div key={n.id} className="course-row" style={{alignItems:"flex-start",opacity:n.dismissed?0.62:1}} data-testid={`notification-${n.id}`}><span className="course-dot" style={{background:n.isRead||n.dismissed?"#c9c6d0":"#6758e8",marginTop:4}}/><div style={{flex:1}}><div className="course-name">{n.title}{n.dismissed&&<span className="pill" style={{marginLeft:7}}>Dismissed</span>}</div><div className="card-caption" style={{lineHeight:1.5}}>{n.message}</div>{n.snoozedUntil&&new Date(n.snoozedUntil).getTime()>now&&<div className="assignment-course">Snoozed until {new Date(n.snoozedUntil).toLocaleString()}</div>}<div className="tool-row" style={{marginTop:5}}>{!n.isRead&&!n.dismissed&&<button className="text-button" onClick={()=>markNotification(n,{isRead:true,snoozedUntil:null})} data-testid={`button-read-notification-${n.id}`}>Mark read</button>}{!n.dismissed&&<><button className="text-button" onClick={()=>markNotification(n,{isRead:true,snoozedUntil:new Date(Date.now()+86400000).toISOString()})} data-testid={`button-snooze-notification-${n.id}`}>Snooze 1 day</button><button className="text-button" style={{color:"#b55349"}} onClick={()=>markNotification(n,{dismissed:true,isRead:true,snoozedUntil:null})} data-testid={`button-dismiss-notification-${n.id}`}>Dismiss</button></>}</div></div></div>):emptyBlock("All caught up","New deadline and study reminders will appear here.",<Bell size={16}/>)}
              {snoozedCount>0&&<button className="text-button" style={{marginTop:10}} onClick={()=>setShowSnoozed(value=>!value)} aria-expanded={showSnoozed} data-testid="button-toggle-snoozed-notifications">{showSnoozed?"Hide":"Show"} {snoozedCount} snoozed notification{snoozedCount===1?"":"s"}</button>}
              <div className="card-caption" style={{marginTop:13}}>Deadline, study, conflict, and progress reminders are created by the server and saved here. Email and browser push depend on your saved preferences and verified provider setup.</div>
            </div>}
          </div>}
          {isSignedIn ? <><span className="avatar" aria-label="Account" data-testid="text-account">{(user?.firstName?.[0]||"S")+(user?.lastName?.[0]||"")}</span><button className="quiet-button" type="button" onClick={()=>signOut({redirectUrl:basePath||"/"})} data-testid="button-sign-out"><LogOut size={14}/> Sign out</button></> :
            <><Link href="/sign-in" className="quiet-button" data-testid="link-sign-in">Sign in</Link><Link href="/sign-up" className="primary-button" style={{padding:"9px 13px"}} data-testid="link-sign-up">Save my semester <ArrowRight size={14}/></Link></>}
        </div>
      </div>
      {!isLoaded && <div className="notice" style={{marginBottom:14}}>Loading your private semester…</div>}
      {!clerkPubKey && <div className="notice" style={{marginBottom:14}}>Public demo: changes stay in this browser. Account sign-in is not configured. See SETUP.md to connect your Clerk application.</div>}
      {loadError&&<div className="notice coral" style={{marginBottom:14}} role="alert" data-testid="status-account-load-error">We couldn’t load your private semester. Editing is paused so demo data can’t be mistaken for account data. <button className="text-button" onClick={()=>void retryLoad()} data-testid="button-retry-account-load">Try again</button></div>}
      {saving&&<div className="card-caption" role="status">Saving changes…</div>}
      {saveError&&<div className="notice coral" style={{marginBottom:14}} role="alert" data-testid="status-account-save-error">{conflict?"Your semester changed in another tab or on the server. Your unsaved edits are still here; reload to resolve the conflict.":`${saveErrorMessage||"Changes could not be saved."} Your local draft is retained; editing is paused.`} {!conflict&&<button className="text-button" onClick={retrySave}>Retry saving</button>} <button className="text-button" onClick={()=>void reloadSaved()}>Reload saved semester</button></div>}
      {children}
    </main>
  </div></div>;
}
function PageFrame({children}: {children:ReactNode}) { return <AppShell><div className="content fade-in">{children}</div></AppShell>; }
function Heading({eyebrow,title,subtitle,action}: {eyebrow:string;title:string;subtitle:string;action?:ReactNode}) {
  return <div className="page-heading"><div><div className="eyebrow">{eyebrow}</div><h1>{title}</h1><p className="subtitle">{subtitle}</p></div>{action}</div>;
}
function Modal({title,subtitle,onClose,children}: {title:string;subtitle?:string;onClose:()=>void;children:ReactNode}) {
  useDialogFocus(true,onClose);
  return <div className="modal-backdrop" role="presentation" onMouseDown={e=>{if(e.target===e.currentTarget)onClose();}}><section className="modal" role="dialog" aria-modal="true" aria-label={title}><div className="modal-head"><div><h2>{title}</h2>{subtitle&&<p className="card-caption">{subtitle}</p>}</div><button type="button" onClick={onClose} className="modal-close" aria-label="Close" data-testid="button-close-modal"><X size={19}/></button></div>{children}</section></div>;
}
function dateLabel(date?:string|null) {
  if(!date)return "No date";
  const d=new Date(`${date}T12:00:00`);
  return d.toLocaleDateString("en-US",{month:"short",day:"numeric"});
}
function localDateKey(d:Date) { return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; }
function escapeIcs(value:string) { return value.replace(/\\/g,"\\\\").replace(/\r?\n/g,"\\n").replace(/,/g,"\\,").replace(/;/g,"\\;"); }
function daysUntil(date?:string|null) {
  if(!date)return Infinity;
  const d=new Date(`${date}T23:59:00`).getTime();
  return Math.ceil((d-Date.now())/86400000);
}
function courseFor(state:SemesterState,id:string) { return state.courses.find(c=>c.id===id); }
function typeName(type:string) { return type.replaceAll("_"," ").replace(/\b\w/g,m=>m.toUpperCase()); }
function statusClass(status:string) { return status==="completed"?"lime":status==="in_progress"?"violet":"sky"; }
function emptyBlock(title:string,copy:string,icon:ReactNode) { return <div className="empty-state"><div className="empty-icon">{icon}</div><strong style={{display:"block",color:"#4d4a60",fontSize:13,marginBottom:5}}>{title}</strong>{copy}</div>; }

function HomePage() {
  const {state,mode,isSignedIn,isLoading}=useS();
  const upcoming=[...state.assignments].filter(a=>a.status!=="completed").sort((a,b)=>(a.dueDate||"").localeCompare(b.dueDate||"")).slice(0,4);
  const focus=upcoming[0];
  const todayKey=zonedNow(state.preferences.timezone).date;
  const todaySessions=state.sessions.filter(s=>s.date===todayKey&&s.status!=="skipped").sort((a,b)=>a.startTime.localeCompare(b.startTime));
  const todayDeadlines=state.assignments.filter(a=>a.dueDate===todayKey&&a.status!=="completed");
  const todayHours=todaySessions.reduce((sum,s)=>sum+(s.status==="completed"?(s.completedMinutes??s.durationMinutes):s.durationMinutes),0)/60;
  const hoursLeft=Math.max(0,state.preferences.dailyStudyLimit-todayHours);
  const week=Array.from({length:7},(_,i)=>{const d=new Date();d.setDate(d.getDate()+i);const key=localDateKey(d);const hrs=state.sessions.filter(s=>s.date===key&&s.status!=="skipped").reduce((sum,s)=>sum+s.durationMinutes/60,0);return {label:d.toLocaleDateString("en-US",{weekday:"short"}).slice(0,1),hrs};});
  const totalHours=upcoming.reduce((sum,a)=>sum+(a.estimatedHours||0),0);
  if(isLoading)return <PageFrame><Heading eyebrow="Your semester at a glance" title="A gentler way to stay on top of it." subtitle="Loading your saved coursework and study plan."/><div className="grid-two"><div className="card" style={{height:180,background:"#eeecf4"}}/><div className="card" style={{height:180,background:"#eeecf4"}}/></div></PageFrame>;
  return <PageFrame>
    <div className="hero-card" data-testid="panel-semester-overview"><div className="eyebrow">{mode==="demo"?"A look at SemesterOS":"Your semester, in view"}</div><div className="hero-title">{focus?<>You have room to make a plan<br/>for what’s next.</>:"Your semester, one calm step at a time."}</div><p className="hero-copy">{focus?`${focus.title} is coming up ${daysUntil(focus.dueDate)<=1?"soon":`in ${daysUntil(focus.dueDate)} days`}. We’ve gathered your deadlines so you can choose a first step.`:"Add a course or assignment to begin building a study rhythm that works for you."}</p><div className="tool-row"><Link href="/assignments" className="primary-button" data-testid="button-view-assignments">See what’s due <ArrowRight size={15}/></Link><Link href="/study-planner" className="quiet-button" data-testid="button-open-planner">Open study planner</Link></div></div>
    <div className="stats-row">
      <div className="stat-card"><div className="stat-value">{upcoming.length}</div><div className="stat-label">upcoming deadlines</div></div>
      <div className="stat-card"><div className="stat-value">{totalHours.toFixed(1)}h</div><div className="stat-label">estimated study time</div></div>
      <div className="stat-card"><div className="stat-value">{state.sessions.filter(s=>s.status==="completed").length}</div><div className="stat-label">sessions completed</div></div>
    </div>
    <div className="grid-two" style={{marginTop:16}}>
      <section className="card" data-testid="panel-daily-brief"><div className="section-row" style={{margin:"0 0 10px"}}><div><div className="eyebrow">Daily brief</div><h2 style={{margin:"6px 0 0"}}>Today, at a glance</h2></div><span className="pill sky">{hoursLeft.toFixed(1)}h left in your daily limit</span></div>
        <div className="daily-brief-list">
          <div className="course-row"><Clock3 size={15} color="#6758E8"/><span className="course-name">Study time planned</span><b>{todayHours.toFixed(1)}h</b></div>
          <div className="course-row"><CalendarDays size={15} color="#ff856f"/><span className="course-name">Deadlines today</span><b>{todayDeadlines.length}</b></div>
          {todaySessions.length>0?todaySessions.map(s=><div className="daily-brief-item" key={s.id}><span>{s.startTime}</span><b>{s.title}</b><small>{s.status==="completed"?"Completed":`${s.durationMinutes} min`}</small></div>):<p className="card-caption" style={{marginTop:12}}>No study sessions planned for today. You can make a light plan in the Study Planner.</p>}
          {todayDeadlines.map(a=><div className="daily-brief-item deadline" key={a.id}><span>Due today</span><b>{a.title}</b><small>{courseFor(state,a.courseId)?.code}</small></div>)}
        </div>
      </section>
      <section className="card" data-testid="panel-next-best-move"><div className="eyebrow">Your next best move</div><h2 style={{margin:"7px 0"}}>{focus?`Start with ${focus.title}`:"Add one thing to your semester"}</h2><p className="card-caption" style={{lineHeight:1.7}}>{focus?`${courseFor(state,focus.courseId)?.name||"Your course"} · due ${dateLabel(focus.dueDate)}. ${focus.estimatedHours==null?"No workload estimate saved yet.":`${focus.estimatedHours} estimated hours.`} Break it into a first short session and keep room for the rest of the week.`:"Add a course from its syllabus or make an assignment manually to get a useful weekly plan."}</p><div className="tool-row" style={{marginTop:15}}>{focus?<Link href="/study-planner" className="primary-button" data-testid="button-next-best-move">Plan a first session <ArrowRight size={14}/></Link>:<Link href="/settings" className="primary-button" data-testid="button-add-first-course">Add a syllabus <ArrowRight size={14}/></Link>}<Link href="/workload" className="quiet-button" data-testid="link-weekly-summary">Weekly workload</Link></div></section>
    </div>
    <div className="grid-main">
      <section><div className="section-row"><h2>Coming up</h2><Link href="/assignments" className="text-button" data-testid="link-all-deadlines">All assignments <ArrowRight size={13}/></Link></div>
        {upcoming.length?<div className="deadline-list">{upcoming.map(a=><AssignmentPreview key={a.id} assignment={a}/>)}</div>:emptyBlock("Clear horizon","Add an assignment when you’re ready.",<Check size={18}/>)}
      </section>
      <section><div className="section-row"><h2>This week</h2><Link href="/workload" className="text-button" data-testid="link-week-workload">Details <ArrowRight size={13}/></Link></div>
        <div className="card" style={{padding:"18px 17px"}}><p className="card-caption" style={{marginTop:0}}>Planned study time, by day</p><div className="week-bars" data-testid="chart-weekly-sessions">{week.map((day,i)=><div className="week-day" key={i}><div className="bar-track"><div className={`bar-fill ${i===0?"today":""}`} style={{height:`${Math.max(8,Math.min(100,day.hrs/2*100))}%`}}/></div><span>{day.label}</span></div>)}</div></div>
        <div className="section-row" style={{marginTop:23}}><h2>Your courses</h2><span className="pill">{state.courses.length} courses</span></div>
        <div className="card" style={{padding:"5px 17px"}}>{state.courses.slice(0,4).map(c=><CourseRow course={c} key={c.id}/>)}</div>
      </section>
    </div>
    {mode==="demo"&&<div style={{marginTop:24,display:"flex",justifyContent:"space-between",alignItems:"center",gap:18,flexWrap:"wrap"}}><div><span className="eyebrow">Make it yours</span><div style={{font:"750 16px Manrope",marginTop:4}}>A private home for your whole semester.</div></div><Link href="/sign-up" className="primary-button" data-testid="button-create-account">Create an account <ArrowRight size={14}/></Link></div>}
    {!isSignedIn&&<p className="card-caption" style={{marginTop:22}}>Demo answers and sample deadlines are based only on the course data shown here. Your edits are saved on this device.</p>}
  </PageFrame>;
}
function AssignmentPreview({assignment}: {assignment:Assignment}) {
  const {state}=useS();const course=courseFor(state,assignment.courseId);const due=daysUntil(assignment.dueDate);
  return <div className="deadline-item" data-testid={`card-deadline-${assignment.id}`}><div className="date-block">{due<0?"PAST":due===0?"TODAY":`IN ${due}`}<b>{dateLabel(assignment.dueDate).split(" ")[1]}</b></div><div><div className="deadline-title">{assignment.title}</div><div className="deadline-meta">{course?.code||"Course"} · {typeName(assignment.type)} · {assignment.estimatedHours||0}h estimated</div></div><span className={`pill ${statusClass(assignment.status)}`}>{typeName(assignment.status)}</span></div>;
}
function CourseRow({course}: {course:Course}) {
  const {state}=useS();const count=state.assignments.filter(a=>a.courseId===course.id).length;return <Link href={`/courses/${course.id}`} className="course-row" style={{textDecoration:"none"}} data-testid={`row-course-${course.id}`} aria-label={`Open ${course.name}`}><span className="course-dot" style={{background:course.color}}/><div className="course-name">{course.name}<div className="course-code">{course.code}</div></div><span className="pill">{count} dates</span><ArrowRight size={14}/></Link>;
}

function CourseDetailPage() {
  const [,params]=useRoute<{courseId:string}>("/courses/:courseId");
  const {state,update}=useS();
  const course=state.courses.find(item=>item.id===params?.courseId);
  if(!course)return <NotFound/>;
  const assignments=state.assignments.filter(item=>item.courseId===course.id).sort((a,b)=>(a.dueDate||"9999").localeCompare(b.dueDate||"9999"));
  const documents=state.documents.filter(document=>document.courseId===course.id).sort((a,b)=>b.version-a.version);
  return <PageFrame>
    <Heading eyebrow="Course overview" title={course.name} subtitle={`${course.code}${course.instructor?` · ${course.instructor}`:""}`} action={<Link href="/assignments" className="quiet-button">All assignments <ArrowRight size={14}/></Link>}/>
    {course.description&&<div className="notice" style={{marginBottom:16}}>{course.description}</div>}
    <div className="grid-main">
      <section className="card">
        <div className="section-row" style={{marginTop:0}}><div><h2>Assignments & deadlines</h2><p className="card-caption">{assignments.length} item{assignments.length===1?"":"s"} linked to this course.</p></div><Link href="/study-planner" className="text-button">Study planner <ArrowRight size={13}/></Link></div>
        {assignments.length?assignments.map(assignment=><AssignmentPreview key={assignment.id} assignment={assignment}/>):emptyBlock("No assignments yet","Add an assignment or upload a syllabus to build this course plan.",<CheckCircle2 size={18}/>)}
        {documents.length>0&&<div style={{marginTop:18}}><div className="eyebrow">Syllabus history</div>{documents.map(document=><div className="course-row" key={document.id}><FileText size={14} color="#6758E8"/><span className="course-name">{document.filename}<span className="course-code">Version {document.version} · {document.snapshot?.assignments.length??0} captured assignments</span></span></div>)}</div>}
      </section>
      <aside><GradeTracker course={course} assignments={assignments} onSaveCourse={patch=>update(current=>({...current,courses:current.courses.map(item=>item.id===course.id?{...item,...patch}:item)}))}/></aside>
    </div>
  </PageFrame>;
}

function AssignmentPage() {
  const {state,update}=useS();const [filterCourse,setFilterCourse]=useState("all");const [filterStatus,setFilterStatus]=useState("all");const [filterType,setFilterType]=useState("all");const [fromDate,setFromDate]=useState("");const [throughDate,setThroughDate]=useState("");const [sortBy,setSortBy]=useState<"deadline"|"priority">("deadline");const [query,setQuery]=useState("");const [editing,setEditing]=useState<Assignment|null>(null);const [showForm,setShowForm]=useState(false);
  const filtered=state.assignments.filter(a=>(filterCourse==="all"||a.courseId===filterCourse)&&(filterStatus==="all"||a.status===filterStatus)&&(filterType==="all"||a.type===filterType)&&(!fromDate||Boolean(a.dueDate&&a.dueDate>=fromDate))&&(!throughDate||Boolean(a.dueDate&&a.dueDate<=throughDate))&&`${a.title} ${courseFor(state,a.courseId)?.code||""}`.toLowerCase().includes(query.toLowerCase())).sort((a,b)=>{const deadline=(a.dueDate||"9999").localeCompare(b.dueDate||"9999");if(sortBy==="deadline")return deadline||a.title.localeCompare(b.title);return deadline||(b.gradeWeight??-1)-(a.gradeWeight??-1)||a.title.localeCompare(b.title);});
  const gradeItems=filterCourse==="all"?filtered:state.assignments.filter(a=>a.courseId===filterCourse);const graded=gradeItems.filter(a=>a.gradeEarned!=null);const weightedGrades=graded.filter(a=>a.gradeWeight!=null&&a.gradeWeight>0);const earnedAverage=weightedGrades.length?Math.round(weightedGrades.reduce((sum,a)=>sum+(a.gradeEarned||0)*(a.gradeWeight||0),0)/weightedGrades.reduce((sum,a)=>sum+(a.gradeWeight||0),0)):null;
  const save=(item:Assignment)=>{update(s=>({...s,assignments:s.assignments.some(a=>a.id===item.id)?s.assignments.map(a=>a.id===item.id?item:a):[...s.assignments,item]}));setShowForm(false);setEditing(null);};
  const del=(a:Assignment)=>{if(window.confirm(`Remove “${a.title}” from your assignments?`))update(s=>({...s,assignments:s.assignments.filter(x=>x.id!==a.id),sessions:s.sessions.filter(x=>x.assignmentId!==a.id)}));};
  const setStatus=(a:Assignment,status:Assignment["status"])=>update(s=>({...s,assignments:s.assignments.map(x=>x.id===a.id?{...x,status}:x)}));
  return <PageFrame><Heading eyebrow="Keep the dates in view" title="Assignments" subtitle="One place for every paper, quiz, project, and exam." action={<button className="primary-button" onClick={()=>{setEditing(null);setShowForm(true)}} data-testid="button-add-assignment"><Plus size={15}/> Add assignment</button>}/>
    <div className="card">
      <div className="filters"><input className="filter-select" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search assignments…" aria-label="Search assignments" data-testid="input-search-assignments"/><select className="filter-select" value={filterCourse} onChange={e=>setFilterCourse(e.target.value)} aria-label="Filter by course" data-testid="select-course-filter"><option value="all">All courses</option>{state.courses.map(c=><option key={c.id} value={c.id}>{c.code}</option>)}</select><select className="filter-select" value={filterStatus} onChange={e=>setFilterStatus(e.target.value)} aria-label="Filter by status" data-testid="select-status-filter"><option value="all">All statuses</option><option value="upcoming">Upcoming</option><option value="in_progress">In progress</option><option value="completed">Completed</option></select><select className="filter-select" value={filterType} onChange={e=>setFilterType(e.target.value)} aria-label="Filter by assignment type" data-testid="select-type-filter"><option value="all">All types</option>{["homework","paper","project","quiz","exam","presentation","other"].map(t=><option key={t} value={t}>{typeName(t)}</option>)}</select><input className="filter-select" type="date" aria-label="Due on or after" value={fromDate} onChange={e=>setFromDate(e.target.value)} data-testid="input-due-date-from"/><input className="filter-select" type="date" aria-label="Due on or before" value={throughDate} onChange={e=>setThroughDate(e.target.value)} data-testid="input-due-date-through"/><select className="filter-select" value={sortBy} onChange={e=>setSortBy(e.target.value as "deadline"|"priority")} aria-label="Sort assignments" data-testid="select-assignment-sort"><option value="deadline">Sort: deadline</option><option value="priority">Sort: priority</option></select><span className="pill" data-testid="text-assignment-count">{filtered.length} shown</span></div>
      {sortBy==="priority"&&<p className="card-caption" style={{marginTop:-7,marginBottom:12}} data-testid="text-priority-sort-help">Priority puts earlier deadlines first, then higher known assignment weights. Missing weights stay unranked.</p>}
      {filterCourse!=="all"&&<div className="notice" style={{marginBottom:13}} data-testid={`panel-course-grades-${filterCourse}`}><strong>{courseFor(state,filterCourse)?.name} · grade overview</strong><div style={{marginTop:5}}>{earnedAverage!=null?`Assignment-weighted view: ${earnedAverage}% across ${weightedGrades.length} graded items with known assignment weights.`:graded.length?`${graded.length} grade${graded.length===1?" is":"s are"} recorded, but no assignment weights are available for this view.`:"No grades recorded for this course yet."} This is an assignment-weighted summary; use the tracker below for the course’s selected grading mode. Grades and missing weights are never inferred.</div></div>}
      {!filtered.length?emptyBlock("Nothing matches this view","Try changing the filters or add a new assignment.",<Filter size={18}/>):<div className="table-wrap"><table className="assignment-table"><thead><tr><th>Assignment</th><th>Due</th><th>Type</th><th>Weight</th><th>{filterCourse==="all"?"Status":"Status / grade"}</th><th>Actions</th></tr></thead><tbody>{filtered.map(a=><tr key={a.id} data-testid={`row-assignment-${a.id}`}><td><div className="assignment-name">{a.title}</div><div className="assignment-course">{courseFor(state,a.courseId)?.code||"Course"} · {a.estimatedHours||0}h planned</div></td><td>{dateLabel(a.dueDate)}<div className="assignment-course">{a.dueTime||""}</div></td><td><span className="pill">{typeName(a.type)}</span></td><td>{a.gradeWeight==null?"—":`${a.gradeWeight}%`}</td><td><select className="filter-select" value={a.status} onChange={e=>setStatus(a,e.target.value as Assignment["status"])} aria-label={`Status for ${a.title}`} data-testid={`select-assignment-status-${a.id}`}><option value="upcoming">Upcoming</option><option value="in_progress">In progress</option><option value="completed">Completed</option></select>{filterCourse!=="all"&&<div className="assignment-course">{a.gradeEarned!=null?`Grade ${a.gradeEarned}%`:"No grade yet"}</div>}</td><td><div className="tool-row"><button className="text-button" onClick={()=>{setEditing(a);setShowForm(true)}} data-testid={`button-edit-assignment-${a.id}`}>Edit</button><button className="text-button" style={{color:"#b55349"}} onClick={()=>del(a)} aria-label={`Delete ${a.title}`} data-testid={`button-delete-assignment-${a.id}`}><Trash2 size={14}/></button></div></td></tr>)}</tbody></table></div>}
    </div>
    {filterCourse!=="all"&&courseFor(state,filterCourse)&&<div style={{marginTop:16}}><GradeTracker course={courseFor(state,filterCourse)!} assignments={state.assignments.filter(a=>a.courseId===filterCourse)} onSaveCourse={patch=>update(s=>({...s,courses:s.courses.map(c=>c.id===filterCourse?{...c,...patch}:c)}))}/></div>}
    {showForm&&<AssignmentForm assignment={editing} onClose={()=>setShowForm(false)} onSave={save}/>}
  </PageFrame>;
}
function AssignmentForm({assignment,onClose,onSave}: {assignment:Assignment|null;onClose:()=>void;onSave:(a:Assignment)=>void}) {
  const {state,isSignedIn}=useS();const suggest=useSuggestAssignmentMilestones();const [courseId,setCourse]=useState(assignment?.courseId||state.courses[0]?.id||"");const [title,setTitle]=useState(assignment?.title||"");const [type,setType]=useState<Assignment["type"]>(assignment?.type||"homework");const [dueDate,setDue]=useState(assignment?.dueDate||"");const [dueTime,setTime]=useState(assignment?.dueTime||"23:59");const [hours,setHours]=useState(String(assignment?.estimatedHours??2));const [weight,setWeight]=useState(String(assignment?.gradeWeight??""));const [grade,setGrade]=useState(String(assignment?.gradeEarned??""));const [gradeCategoryId,setGradeCategoryId]=useState(assignment?.gradeCategoryId||"");const [pointsEarned,setPointsEarned]=useState(String(assignment?.pointsEarned??""));const [pointsPossible,setPointsPossible]=useState(String(assignment?.pointsPossible??""));const [description,setDescription]=useState(assignment?.description||"");const [milestones,setMilestones]=useState(assignment?.milestones||[]);const [milestoneTitle,setMilestoneTitle]=useState("");const [suggestions,setSuggestions]=useState<string[]>([]);const [formError,setFormError]=useState("");const selectedCourse=state.courses.find(c=>c.id===courseId);
  const addMilestone=()=>{if(!milestoneTitle.trim())return;setMilestones(items=>[...items,{id:`milestone-${crypto.randomUUID()}`,title:milestoneTitle.trim(),completed:false}]);setMilestoneTitle("");};
  const moveMilestone=(index:number,offset:-1|1)=>setMilestones(items=>{const target=index+offset;if(target<0||target>=items.length)return items;const next=[...items];[next[index],next[target]]=[next[target],next[index]];return next;});
  const submit=(e:FormEvent)=>{e.preventDefault();if(!title.trim()||!courseId)return;const earned=pointsEarned===""?null:Number(pointsEarned);const possible=pointsPossible===""?null:Number(pointsPossible);if(earned!=null&&possible==null){setFormError("Enter possible points before recording points earned.");return;}if(possible!=null&&possible<=0){setFormError("Possible points must be greater than zero.");return;}if(earned!=null&&possible!=null&&earned>possible){setFormError("Points earned cannot exceed possible points.");return;}setFormError("");onSave({id:assignment?.id||`assignment-${crypto.randomUUID()}`,courseId,title:title.trim(),type,dueDate:dueDate||null,dueTime:dueTime||null,estimatedHours:hours===""?null:Number(hours),gradeWeight:weight===""?null:Number(weight),description:description||null,status:assignment?.status||"upcoming",gradeEarned:grade===""?null:Number(grade),gradeCategoryId:gradeCategoryId||null,pointsEarned:earned,pointsPossible:possible,sourceDocumentId:assignment?.sourceDocumentId||null,sourcePage:assignment?.sourcePage||null,milestones});};
  return <Modal title={assignment?"Edit assignment":"Add an assignment"} subtitle="A realistic estimate is more useful than a perfect one." onClose={onClose}><form onSubmit={submit} className="form-grid" data-testid="form-assignment">
    <div className="form-field full"><label htmlFor="assignment-title">Assignment name</label><input id="assignment-title" className="field" required value={title} onChange={e=>{setTitle(e.target.value);setSuggestions([]);}} placeholder="e.g. Reading response 2" data-testid="input-assignment-title"/></div>
    <div className="form-field"><label htmlFor="assignment-course">Course</label><select id="assignment-course" className="field-select" value={courseId} onChange={e=>{const nextCourse=state.courses.find(c=>c.id===e.target.value);setCourse(e.target.value);if(!nextCourse?.gradeCategories?.some(category=>category.id===gradeCategoryId))setGradeCategoryId("");}} data-testid="select-assignment-course">{state.courses.map(c=><option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}</select></div>
    <div className="form-field"><label htmlFor="assignment-type">Type</label><select id="assignment-type" className="field-select" value={type} onChange={e=>{setType(e.target.value as Assignment["type"]);setSuggestions([]);}} data-testid="select-assignment-type">{["homework","paper","project","quiz","exam","presentation","other"].map(t=><option key={t} value={t}>{typeName(t)}</option>)}</select></div>
    <div className="form-field"><label htmlFor="assignment-due">Due date</label><input id="assignment-due" type="date" className="field" value={dueDate||""} onChange={e=>setDue(e.target.value)} data-testid="input-assignment-due"/></div>
    <div className="form-field"><label htmlFor="assignment-time">Due time</label><input id="assignment-time" type="time" className="field" value={dueTime||""} onChange={e=>setTime(e.target.value)} data-testid="input-assignment-time"/></div>
    <div className="form-field"><label htmlFor="assignment-hours">Estimated hours</label><input id="assignment-hours" type="number" min="0" step=".25" className="field" value={hours} onChange={e=>setHours(e.target.value)} data-testid="input-assignment-hours"/></div>
    <div className="form-field"><label htmlFor="assignment-weight">{selectedCourse?.gradingMode==="category_weighted"?"Weight within category (%)":"Assignment weight (%)"}</label><input id="assignment-weight" type="number" min="0" max="100" className="field" value={weight} onChange={e=>setWeight(e.target.value)} placeholder="Optional" data-testid="input-assignment-weight"/>{selectedCourse?.gradingMode==="points_based"&&<span className="card-caption">Not used in points-based grade calculations.</span>}</div>
    <div className="form-field"><label htmlFor="assignment-grade">Grade earned (%)</label><input id="assignment-grade" type="number" min="0" max="100" className="field" value={grade} onChange={e=>setGrade(e.target.value)} placeholder="Not graded yet" data-testid="input-assignment-grade"/></div>
    {selectedCourse?.gradingMode==="category_weighted"&&<div className="form-field"><label htmlFor="assignment-category">Grade category</label><select id="assignment-category" className="field-select" value={gradeCategoryId} onChange={e=>setGradeCategoryId(e.target.value)} data-testid="select-assignment-grade-category"><option value="">No category assigned</option>{(selectedCourse.gradeCategories||[]).map(c=><option key={c.id} value={c.id}>{c.name} · {c.weight}%</option>)}</select></div>}
    <div className="form-field"><label htmlFor="assignment-points-earned">Points earned</label><input id="assignment-points-earned" type="number" min="0" step=".1" className="field" value={pointsEarned} onChange={e=>setPointsEarned(e.target.value)} placeholder="Optional" data-testid="input-assignment-points-earned"/></div>
    <div className="form-field"><label htmlFor="assignment-points-possible">Points possible</label><input id="assignment-points-possible" type="number" min="0" step=".1" className="field" value={pointsPossible} onChange={e=>setPointsPossible(e.target.value)} placeholder="Optional" data-testid="input-assignment-points-possible"/></div>
    <div className="form-field full"><label htmlFor="assignment-description">Notes</label><textarea id="assignment-description" className="field-textarea" value={description} onChange={e=>{setDescription(e.target.value);setSuggestions([]);}} placeholder="What does this involve?" data-testid="input-assignment-description"/></div>
    <div className="form-field full"><label>Milestones</label><div className="tool-row"><input className="field" value={milestoneTitle} onChange={e=>setMilestoneTitle(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"){e.preventDefault();addMilestone();}}} placeholder="Add a small next step" aria-label="New milestone" data-testid="input-new-milestone"/><button type="button" className="quiet-button" onClick={addMilestone} disabled={!milestoneTitle.trim()} data-testid="button-add-milestone"><Plus size={13}/> Add</button><button type="button" className="quiet-button" disabled={!isSignedIn||!title.trim()||suggest.isPending} onClick={()=>{setSuggestions([]);suggest.mutate({data:{assignmentTitle:title.trim(),type,description:description||null}},{onSuccess:result=>setSuggestions(result.suggestions),onError:()=>setSuggestions([])});}} data-testid="button-suggest-milestones"><Sparkles size={13}/>{suggest.isPending?"Suggesting…":"Suggest steps"}</button></div>
      {!isSignedIn&&<p className="card-caption" data-testid="text-milestone-sign-in">Sign in to use AI suggestions. You can still add milestones yourself.</p>}
      {suggest.isError&&<div className="notice coral" role="alert" data-testid="status-milestone-suggestion-error">Suggestions are unavailable right now. Your saved milestones are unchanged.</div>}
      {suggestions.length>0&&<div className="notice" style={{marginTop:9}} data-testid="panel-ai-milestone-suggestions"><strong>AI-generated suggestions · review before adding</strong><div style={{display:"grid",gap:6,marginTop:8}}>{suggestions.map((suggestion,index)=><div className="tool-row" key={`${suggestion}-${index}`}><span className="course-name">{suggestion}</span><button type="button" className="text-button" onClick={()=>setMilestones(items=>items.some(m=>m.title===suggestion)?items:[...items,{id:`milestone-${crypto.randomUUID()}`,title:suggestion,completed:false}])} disabled={milestones.some(m=>m.title===suggestion)} data-testid={`button-add-ai-milestone-${index}`}>{milestones.some(m=>m.title===suggestion)?"Added":"Add milestone"}</button></div>)}</div><span className="card-caption">Only milestones you explicitly add are saved when you save this assignment.</span></div>}
      {milestones.map((milestone,index)=><div className="milestone-row" key={milestone.id} data-testid={`row-milestone-${milestone.id}`}><input type="checkbox" checked={milestone.completed} onChange={e=>setMilestones(items=>items.map(m=>m.id===milestone.id?{...m,completed:e.target.checked}:m))} aria-label={`Mark ${milestone.title} complete`} data-testid={`checkbox-milestone-${milestone.id}`}/><input className="field" value={milestone.title} onChange={e=>setMilestones(items=>items.map(m=>m.id===milestone.id?{...m,title:e.target.value}:m))} aria-label={`Edit ${milestone.title}`} data-testid={`input-milestone-${milestone.id}`}/><button type="button" className="text-button" onClick={()=>moveMilestone(index,-1)} disabled={index===0} aria-label={`Move ${milestone.title} up`} data-testid={`button-milestone-up-${milestone.id}`}>Up</button><button type="button" className="text-button" onClick={()=>moveMilestone(index,1)} disabled={index===milestones.length-1} aria-label={`Move ${milestone.title} down`} data-testid={`button-milestone-down-${milestone.id}`}>Down</button><button type="button" className="text-button" style={{color:"#b55349"}} onClick={()=>setMilestones(items=>items.filter(m=>m.id!==milestone.id))} aria-label={`Remove ${milestone.title}`} data-testid={`button-delete-milestone-${milestone.id}`}><X size={14}/></button></div>)}
      {milestones.length===0&&<p className="card-caption">Break a large assignment into steps you can finish one at a time.</p>}
    </div>
    {formError&&<div className="notice coral" role="alert" style={{gridColumn:"1/-1"}} data-testid="status-assignment-form-error">{formError}</div>}
    <div className="tool-row" style={{gridColumn:"1/-1",justifyContent:"flex-end",marginTop:5}}><button type="button" className="quiet-button" onClick={onClose} data-testid="button-cancel-assignment">Cancel</button><button className="primary-button" type="submit" data-testid="button-save-assignment"><Check size={15}/> Save assignment</button></div>
  </form></Modal>;
}

function StudyPlannerPage() {
  const {state,update,isSignedIn}=useS();const [preview,setPreview]=useState<StudySession[]|null>(null);const [unplaced,setUnplaced]=useState<{title:string;hours:number;reason:string}[]>([]);const [created,setCreated]=useState(false);const [calendarMessage,setCalendarMessage]=useState("");const [replaceMissed,setReplaceMissed]=useState(false);const [reschedulingId,setReschedulingId]=useState<string|null>(null);const [rescheduleDate,setRescheduleDate]=useState("");const [rescheduleTime,setRescheduleTime]=useState("");const [calendarStart,setCalendarStart]=useState("");const [calendarEnd,setCalendarEnd]=useState("");const [planRange,setPlanRange]=useState("7");
  const localNow=zonedNow(state.preferences.timezone);
  const todayKey=localNow.date;
  const semesterEnd=state.preferences.semesterEnd||todayKey;
  const semesterDays=Math.max(1,Math.ceil((new Date(`${semesterEnd}T12:00:00`).getTime()-new Date(`${todayKey}T12:00:00`).getTime())/86400000)+1);
  const dayCount=planRange==="semester"?Math.min(180,semesterDays):Number(planRange);
  const dates=Array.from({length:dayCount},(_,i)=>addDays(todayKey,i));
  const exportStart=calendarStart||todayKey;const exportEnd=calendarEnd||semesterEnd||dates[dates.length-1];
  const currentMinutes=localNow.minutes;
  const isMissedSession=(session:StudySession)=>isMissedStudySession(session,todayKey,currentMinutes);
  const missedSessions=state.sessions.filter(isMissedSession);
  const createPlan=(replanMissed=missedSessions.length>0)=>{
    const {sessions:proposed,unplaced:notPlaced}=buildStudyPlan(state,dates,todayKey,currentMinutes,replanMissed);
    setPreview(proposed);setUnplaced(notPlaced);setCreated(false);setReplaceMissed(replanMissed);
  };
  const applyPlan=()=>{if(!preview)return;const sessions=[...state.sessions.filter(x=>!(replaceMissed&&isMissedSession(x))),...preview];const invalid=preview.flatMap(candidate=>sessionErrors({...state,sessions},candidate));if(invalid.length){setCalendarMessage(`The preview is no longer valid. ${invalid[0]} Generate a fresh preview.`);return;}update(s=>({...s,sessions}));setCreated(true);setPreview(null);setUnplaced([]);setReplaceMissed(false);};
  const mark=(session:StudySession,status:StudySession["status"])=>update(s=>({...s,sessions:s.sessions.map(x=>x.id===session.id?{...x,status,completedMinutes:status==="completed"?x.durationMinutes:x.completedMinutes}:x)}));
  const markPartial=(session:StudySession)=>{const raw=window.prompt(`How many minutes did you complete? (1–${session.durationMinutes})`,String(Math.max(1,Math.floor(session.durationMinutes/2))));if(raw===null)return;const minutes=Number(raw);if(!Number.isInteger(minutes)||minutes<1||minutes>session.durationMinutes){setCalendarMessage(`Enter a whole number from 1 to ${session.durationMinutes} minutes.`);return;}update(s=>({...s,sessions:s.sessions.map(x=>x.id===session.id?{...x,status:"partial",completedMinutes:minutes}:x)}));setCalendarMessage("Partial progress saved; the planner will account for the remaining minutes.");};
  const reschedule=(session:StudySession)=>{const candidate={...session,date:rescheduleDate,startTime:rescheduleTime};const errors=sessionErrors(state,candidate);if(errors.length){setCalendarMessage(errors.join(" "));return;}update(s=>({...s,sessions:s.sessions.map(item=>item.id===session.id?candidate:item)}));setCalendarMessage("Study session rescheduled.");setReschedulingId(null);};
  const exportCalendar=()=>{
    if(exportStart>exportEnd){setCalendarMessage("Choose an export end date that is on or after the start date.");return;}
    const sessions=state.sessions.filter(s=>s.status!=="skipped"&&s.status!=="busy"&&s.date>=exportStart&&s.date<=exportEnd);
    const deadlines=state.assignments.filter(a=>a.dueDate&&a.dueDate>=exportStart&&a.dueDate<=exportEnd);
    if(!sessions.length&&!deadlines.length){setCalendarMessage("No study sessions or dated assignments fall within that range.");return;}
    const file=createCalendarFile(state,exportStart,exportEnd,state.preferences.timezone);
    const blob=new Blob([file],{type:"text/calendar"});
    const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download="semesteros-study-plan.ics";a.click();window.setTimeout(()=>URL.revokeObjectURL(url),1000);
    setCalendarMessage(`Calendar file exported for ${exportStart}–${exportEnd}: ${sessions.length} study sessions and ${deadlines.filter(Boolean).length} deadlines.`);
  };
  const importCalendar=async(file:File)=>{
    setCalendarMessage("");
    if(file.size>1024*1024){setCalendarMessage("Choose a calendar file smaller than 1 MB.");return;}
    try{
      const text=await file.text();
      const parsed=parseCalendarFile(text,state.preferences.timezone,exportStart,exportEnd);
      const incoming=parsed.filter(block=>isUpcomingCalendarBlock(block,todayKey,state.preferences.timezone)).map(block=>({id:`ics-${block.uid}`,assignmentId:null,title:`Busy · ${block.title}`,date:block.date,startTime:block.startTime,durationMinutes:block.durationMinutes,status:"busy" as const,completedMinutes:null}));
      const unique=new Map(incoming.map(item=>[item.id,item]));
      const accepted=[...unique.values()];
      if(!accepted.length){setCalendarMessage("No upcoming events were found in that calendar file and date range.");return;}
      const incomingIds=new Set(accepted.map(item=>item.id));
      update(current=>({...current,sessions:[...current.sessions.filter(item=>!incomingIds.has(item.id)),...accepted]}));
      setCalendarMessage(`${accepted.length} upcoming calendar busy block${accepted.length===1?" was":"s were"} imported locally. Existing calendar events were not changed.`);
    }catch{setCalendarMessage("This calendar file could not be read.");}
  };
  return <PageFrame><Heading eyebrow="A plan that bends with you" title="Study planner" subtitle="Turn the work ahead into short, doable sessions. Move things around as your week changes." action={<button className="primary-button" onClick={()=>createPlan()} data-testid="button-build-study-plan"><Sparkles size={15}/> Build my week</button>}/>
    {missedSessions.length>0&&<div className="notice coral" style={{marginBottom:14}} data-testid="notice-missed-sessions">{missedSessions.length} planned session{missedSessions.length===1?" was":"s were"} missed. Rebuild the remaining week to replace missed work without changing your deadlines. <button className="text-button" onClick={()=>createPlan(true)} data-testid="button-replan-missed">Re-plan remaining work</button></div>}
    <div className="tool-row" style={{marginBottom:15,alignItems:"flex-end"}}><div className="form-field"><label htmlFor="calendar-export-start">Export from</label><input id="calendar-export-start" type="date" className="field" value={exportStart} onChange={e=>setCalendarStart(e.target.value)} data-testid="input-calendar-export-start"/></div><div className="form-field"><label htmlFor="calendar-export-end">Export through</label><input id="calendar-export-end" type="date" className="field" value={exportEnd} onChange={e=>setCalendarEnd(e.target.value)} data-testid="input-calendar-export-end"/></div><button className="quiet-button" type="button" onClick={exportCalendar} data-testid="button-export-calendar"><CalendarDays size={14}/> Export .ics</button><label className="quiet-button" style={{cursor:"pointer"}}>Import .ics<input type="file" accept=".ics,text/calendar" style={{display:"none"}} onChange={e=>{const f=e.target.files?.[0];if(f)void importCalendar(f);e.currentTarget.value="";}} data-testid="input-import-calendar"/></label><span className="card-caption">ICS file only · no calendar account connection</span></div>
     {calendarMessage&&<div className="notice" style={{marginBottom:13}} data-testid="status-calendar-import-export">{calendarMessage}</div>}
     <GoogleCalendarPanel state={state} update={update} isSignedIn={isSignedIn} startDate={exportStart} endDate={exportEnd}/>
      {preview&&<div className="card" style={{marginBottom:16,borderColor:"#b8b3eb"}} data-testid="panel-plan-preview"><div className="section-row" style={{margin:"0 0 10px"}}><div><h2>Review your proposed plan</h2><p className="card-caption">{replaceMissed?"Missed sessions will be removed only if you apply this replacement plan.":"Nothing is added until you apply these sessions."}</p></div><span className="pill violet">{preview.length} sessions</span></div>{preview.length?preview.map(s=><div className="course-row" key={s.id} data-testid={`preview-session-${s.id}`}><CalendarDays size={14} color="#6758E8"/><span className="course-name">{s.title}</span><span className="card-caption">{dateLabel(s.date)} · {s.startTime} · {s.durationMinutes} min</span></div>):<div className="notice">No new sessions fit the current availability, daily limits, and deadlines. You can adjust preferences or add estimates.</div>}{unplaced.length>0&&<div className="notice coral" style={{marginTop:12}} data-testid="panel-unplaced-work"><strong>{unplaced.reduce((sum,item)=>sum+item.hours,0).toFixed(1)} planning hours remain unscheduled</strong><div style={{marginTop:4}}>This is the work the preview could not place; it remains on your assignment list and is not silently removed.</div>{unplaced.map((item,index)=><div key={`${item.title}-${index}`} style={{marginTop:7}} data-testid={`row-unplaced-work-${index}`}><b>{item.title} · {item.hours.toFixed(1)}h</b><div>{item.reason}</div></div>)}</div>}<div className="tool-row" style={{justifyContent:"flex-end",marginTop:12}}><button className="quiet-button" onClick={()=>{setPreview(null);setUnplaced([]);setReplaceMissed(false)}} data-testid="button-cancel-plan">Cancel</button><button className="primary-button" onClick={applyPlan} disabled={!preview.length} data-testid="button-apply-plan"><Check size={14}/> Apply plan</button></div></div>}
     <div className="grid-main"><section className="card"><div className="section-row" style={{marginTop:0}}><div><h2>Your next {dates.length} days</h2><p className="card-caption">Planned sessions can always be adjusted.</p></div><select className="filter-select" aria-label="Planner horizon" value={planRange} onChange={event=>setPlanRange(event.target.value)} data-testid="select-planner-horizon"><option value="7">7 days</option><option value="14">14 days</option><option value="semester">Through semester end</option></select><span className="pill violet">{state.sessions.filter(s=>s.date>=todayKey&&s.date<=dates[dates.length-1]&&s.status==="planned").length} planned</span></div>
       {planRange==="semester"&&semesterDays>180&&<div className="notice" style={{marginBottom:12}}>The semester view is capped at 180 days. Update the semester end date in Settings to adjust it.</div>}
      {created&&<div className="notice" style={{marginBottom:12}} data-testid="status-plan-created">Plan updated from your upcoming assignments and availability.</div>}
        {dates.map(date=>{const sessions=state.sessions.filter(s=>s.date===date).sort((a,b)=>a.startTime.localeCompare(b.startTime));return <div className="planner-day" key={date} data-testid={`planner-day-${date}`}><div className="planner-date">{date===todayKey?"Today":new Date(`${date}T12:00:00`).toLocaleDateString("en-US",{weekday:"short"})}<div style={{marginTop:4,fontWeight:500,textTransform:"none"}}>{dateLabel(date)}</div></div><div>{sessions.length?sessions.map(s=><div className={`session-block ${s.status==="completed"?"completed":s.status==="busy"?"busy":""}`} key={s.id} data-testid={`card-session-${s.id}`}><div style={{flex:1,minWidth:0}}><div className="session-name">{s.title}</div><div className="session-meta">{s.startTime} · {s.durationMinutes} min {s.status==="completed"?"· Completed":s.status==="partial"?`· ${s.completedMinutes??0} min completed`:s.status==="busy"?"· Calendar busy":s.status==="skipped"?"· Skipped":isMissedSession(s)?"· Missed":""}</div>{reschedulingId===s.id&&<div className="tool-row" style={{marginTop:8}}><input className="field" type="date" min={todayKey} value={rescheduleDate} onChange={e=>setRescheduleDate(e.target.value)} aria-label="New session date" data-testid={`input-reschedule-date-${s.id}`}/><input className="field" type="time" value={rescheduleTime} onChange={e=>setRescheduleTime(e.target.value)} aria-label="New session time" data-testid={`input-reschedule-time-${s.id}`}/><button className="text-button" onClick={()=>reschedule(s)} data-testid={`button-save-reschedule-${s.id}`}>Save</button><button className="text-button" onClick={()=>setReschedulingId(null)}>Cancel</button></div>}</div><div className="tool-row">{s.status==="planned"&&<><button className="text-button" onClick={()=>mark(s,"completed")} aria-label={`Mark ${s.title} complete`} data-testid={`button-complete-session-${s.id}`}><Check size={15}/></button><button className="text-button" onClick={()=>markPartial(s)} aria-label={`Log partial progress for ${s.title}`} data-testid={`button-partial-session-${s.id}`}>Partly done</button><button className="text-button" onClick={()=>{setReschedulingId(s.id);setRescheduleDate(s.date);setRescheduleTime(s.startTime);setCalendarMessage("");}} aria-label={`Reschedule ${s.title}`} data-testid={`button-reschedule-session-${s.id}`}>Move</button><button className="text-button" onClick={()=>mark(s,"skipped")} aria-label={`Skip ${s.title}`} data-testid={`button-skip-session-${s.id}`}>Skip</button></>}{s.status==="partial"&&<button className="text-button" onClick={()=>mark(s,"completed")} data-testid={`button-finish-partial-session-${s.id}`}>Finish</button>}{s.status==="busy"&&<button className="text-button" onClick={()=>update(current=>({...current,sessions:current.sessions.filter(item=>item.id!==s.id)}))} data-testid={`button-remove-busy-session-${s.id}`}>Forget</button>}</div></div>):<div style={{fontSize:11,color:"#aaa7b1",paddingTop:7}}>A little breathing room.</div>}</div></div>;})}
    </section><aside><div className="card"><div className="eyebrow">Your rhythm</div><h2 className="card-title" style={{marginTop:7}}>Availability</h2><p className="card-caption" style={{lineHeight:1.6}}>The planner uses your preferred time, session length, and daily limit from settings.</p><div style={{display:"grid",gap:11,marginTop:18}}><div className="course-row"><Clock3 size={16} color="#6758E8"/><span className="course-name">Session length</span><b style={{fontSize:11}}>{state.preferences.sessionDurationMinutes} min</b></div><div className="course-row"><CalendarDays size={16} color="#6758E8"/><span className="course-name">Daily study limit</span><b style={{fontSize:11}}>{state.preferences.dailyStudyLimit}h</b></div><div className="course-row"><Activity size={16} color="#6758E8"/><span className="course-name">Preferred time</span><b style={{fontSize:11,textTransform:"capitalize"}}>{state.preferences.preferredTime}</b></div></div><Link href="/settings" className="quiet-button" style={{marginTop:16,justifyContent:"center"}} data-testid="link-edit-preferences">Edit availability <ArrowRight size={14}/></Link></div>
      <div className="notice" style={{marginTop:15}}>Planning is a starting point, not a promise. Your schedule stays yours to change.</div></aside></div>
  </PageFrame>;
}

function weekStartKey(date:Date) {
  const start=new Date(date);start.setHours(12,0,0,0);start.setDate(start.getDate()-((start.getDay()+6)%7));
  return localDateKey(start);
}
function getSemesterWeeks(state:SemesterState) {
  const range=semesterDateRange(state);
  const startValue=range.start||localDateKey(new Date());
  const endValue=range.end||startValue;
  const start=new Date(`${startValue}T12:00:00`);const end=new Date(`${endValue}T12:00:00`);
  start.setDate(start.getDate()-((start.getDay()+6)%7));
  const weeks:string[]=[];
  for(const cursor=new Date(start);cursor<=end;cursor.setDate(cursor.getDate()+7))weeks.push(localDateKey(cursor));
  return weeks;
}
function WorkloadPage() {
  const {state,update}=useS();const weeks=getSemesterWeeks(state);const currentWeek=weekStartKey(new Date());const [selectedWeek,setSelectedWeek]=useState(currentWeek);
  const activeWeek=weeks.includes(selectedWeek)?selectedWeek:weeks.find(w=>w===currentWeek)||weeks[0]||currentWeek;
  const w=getWeeklyWorkload(state,activeWeek);
  const rows=state.courses.map(c=>({course:c,items:w.thisWeek.filter(a=>a.courseId===c.id),hours:w.thisWeek.filter(a=>a.courseId===c.id).reduce((sum,a)=>sum+(a.estimatedHours==null?2:a.estimatedHours),0)})).sort((a,b)=>b.hours-a.hours);
  return <PageFrame><Heading eyebrow="The whole semester, made legible" title="Weekly workload" subtitle="A Monday–Sunday view with every part of the score out in the open." action={<Link href="/settings" className="quiet-button" data-testid="link-workload-settings"><Settings2 size={14}/> Adjust your capacity</Link>}/>
    <section className="card semester-heatmap" data-testid="panel-semester-heatmap"><div className="section-row" style={{marginTop:0}}><div><h2>Semester heatmap</h2><p className="card-caption">Select a Monday to see the assignments behind its score.</p></div><div className="heatmap-legend"><span><i className="heatmap-swatch light"/>Light</span><span><i className="heatmap-swatch moderate"/>Moderate</span><span><i className="heatmap-swatch heavy"/>Heavy</span><span><i className="heatmap-swatch very-heavy"/>Very heavy</span></div></div><div className="heatmap-grid">{weeks.map(startKey=>{const item=getWeeklyWorkload(state,startKey);return <button type="button" key={startKey} className={`heatmap-cell ${item.category.toLowerCase().replace(" ","-")} ${activeWeek===startKey?"selected":""}`} aria-pressed={activeWeek===startKey} aria-label={`Week of ${dateLabel(startKey)}, ${item.category.toLowerCase()} workload, score ${item.level??"unavailable"}`} title={`${dateLabel(startKey)} · ${item.category} · ${item.level??"No score"}`} onClick={()=>setSelectedWeek(startKey)} data-testid={`button-heatmap-week-${startKey}`}><span>{dateLabel(startKey)}</span><b>{item.level??"—"}</b></button>;})}</div></section>
    <div className="notice" style={{marginBottom:16}} data-testid="text-workload-period">Week of {dateLabel(w.startKey)}–{dateLabel(w.endKey)} · {w.category} workload · Monday through Sunday</div>
    <div className="grid-main"><div className="card"><div className="eyebrow">{activeWeek===currentWeek?"This week’s score":"Selected week’s score"}</div><div className="workload-ring" style={{background:`conic-gradient(var(--violet) 0 ${w.level??0}%,#eceaf3 ${w.level??0}% 100%)`}} aria-label={w.level==null?"Workload score unavailable":`${w.level} out of 100`} data-testid="chart-workload-score"><div className="ring-content"><strong>{w.level??"—"}</strong><span>out of 100</span></div></div><div style={{textAlign:"center",fontSize:12,color:"#767385"}}>{w.hours.toFixed(1)} estimated hours across {w.thisWeek.length} dated {w.thisWeek.length===1?"item":"items"}</div><div style={{height:1,background:"#efede7",margin:"18px 0"}}/><div className="grid-two"><div><div className="eyebrow">Estimated hours due</div><div className="stat-value" style={{fontSize:20,marginTop:5}}>{w.hours.toFixed(1)}h</div></div><div><div className="eyebrow">Weekly capacity</div><div className="stat-value" style={{fontSize:20,marginTop:5}}>{w.capacity.toFixed(1)}h</div></div></div><p className="card-caption" style={{marginTop:12}}>Completed study time this week: {w.completed.toFixed(1)}h</p></div>
    <div className="card"><h2 className="card-title">The score, component by component</h2><p className="card-caption" style={{lineHeight:1.7,marginTop:9}}>Each available input is normalized to 0–100. Missing grade weights are excluded and the remaining component weights are proportionally renormalized.</p>
      <WorkloadComponent label="Academic hours" description="Estimated hours ÷ weekly study capacity" value={w.academic} weight="50%" tone="#6758E8" testId="workload-academic"/>
      <WorkloadComponent label="Deadline concentration" description="Dated assignments due this week ÷ 5" value={w.concentration} weight="30%" tone="#ff856f" testId="workload-deadlines"/>
      <WorkloadComponent label="Grade importance" description="Known grade weight due this week ÷ 40%" value={w.gradeImportance} weight="20%" tone="#7b9b42" testId="workload-grade-importance"/>
      <div className="notice" style={{marginTop:12}}>Score = weighted mean of available normalized components. Academic hours are estimated: an assignment with no estimate is temporarily counted as 2 hours, clearly marked below.</div>
    </div></div>
      <div style={{marginTop:16}}><WhatIfSimulator currentScore={w.level} weeklyHours={w.hours} concentration={w.concentration} gradeImportance={w.gradeImportance} availableDays={state.preferences.availableDays.length} dailyLimit={state.preferences.dailyStudyLimit} preferences={state.preferences} assignments={state.assignments} sessions={state.sessions} onApplyCapacity={hoursPerDay=>update(s=>({...s,preferences:{...s.preferences,dailyStudyLimit:hoursPerDay}}))} onApplySessions={sessions=>update(s=>({...s,sessions}))}/></div>
     {(w.defaultedHours>0||w.unknownDates>0||w.gradeImportance==null)&&<div className="notice coral" style={{marginTop:14}} data-testid="notice-workload-unknowns">{w.defaultedHours>0&&`${w.defaultedHours} assignment${w.defaultedHours===1?"":"s"} without an hour estimate use the transparent 2-hour default. `}{w.unknownDates>0&&`${w.unknownDates} unfinished assignment${w.unknownDates===1?" has":"s have"} no due date and are excluded from this week; no dates are inferred. `}{w.gradeImportance==null&&"No grade weights are available this week, so that component is omitted and the other weights are renormalized."}</div>}
    <div className="section-row"><h2>Where the hours are</h2><span className="pill">{w.thisWeek.length} dated deadlines</span></div>
    <div className="card" style={{padding:"8px 20px"}}>{rows.map(({course,items,hours})=><div className="course-row" key={course.id} data-testid={`workload-course-${course.id}`}><span className="course-dot" style={{background:course.color}}/><div className="course-name">{course.name}<div className="course-code">{items.length?items.map(i=>i.title).join(" · "):"Nothing due this week"}</div></div><div className="progress-track"><div className="progress-fill" style={{width:`${w.hours?Math.min(100,hours/w.hours*100):0}%`,background:course.color}}/></div><b style={{fontSize:12,minWidth:45,textAlign:"right"}}>{hours.toFixed(1)}h</b></div>)}</div>
  </PageFrame>;
}
function WorkloadComponent({label,description,value,weight,tone,testId}:{label:string;description:string;value:number|null;weight:string;tone:string;testId:string}) {
  return <div className="course-row" style={{alignItems:"flex-start"}} data-testid={testId}><span className="course-dot" style={{background:tone,marginTop:3}}/><div className="course-name">{label}<div className="course-code" style={{lineHeight:1.5}}>{description}</div></div><span className="pill">{weight}</span><b style={{fontSize:12,minWidth:34,textAlign:"right"}}>{value==null?"—":value}</b></div>;
}

function AskPage() {
  const {state,mode}=useS();const ask=useAskSyllabi();const [question,setQuestion]=useState("");const [result,setResult]=useState<DemoAnswer|null>(null);const [error,setError]=useState("");
  const submit=(e:FormEvent)=>{e.preventDefault();const q=question.trim();if(!q)return;setError("");setResult(null);if(mode==="demo"){setResult(answerDemoQuestion(q,state,zonedNow(state.preferences.timezone).date));return;}ask.mutate({data:{question:q}},{onSuccess:data=>setResult(data),onError:()=>setError("We couldn’t get an answer from your saved syllabus data. Try again in a moment.")});};
  return <PageFrame><Heading eyebrow="A question, grounded in your course" title="Ask your syllabi" subtitle="Ask about a deadline or course detail. Answers include their source when the syllabus provides one."/>
    <div className="grid-main"><section className="card" style={{minHeight:380}}><div style={{display:"flex",gap:12,alignItems:"center"}}><div className="empty-icon" style={{margin:0}}><BookOpen size={19}/></div><div><h2 className="card-title">Your course companion</h2><p className="card-caption">{mode==="demo"?"Demo answers use only the sample courses and assignments below.":"Answers are drawn from your saved course and syllabus data."}</p></div></div>
      <div className="notice" style={{marginTop:18}} data-testid="notice-ask-scope">{mode==="demo"?"Demo mode · Grounded only in the seeded course and assignment details. No AI service is called.":"Answers use reviewed, saved course information, assignments, and policy notes—not the complete original PDFs. Details not extracted and saved may be unavailable. Check source page references against your own copy."}</div>
      {result&&<div className="answer-box" data-testid="panel-answer"><div className="eyebrow">{mode==="demo"?"Demo answer":"Answer"}</div><p style={{margin:"9px 0 0"}}>{result.answer}</p>{result.sources.length>0&&<div className="source-list"><span style={{fontSize:10,color:"#777589",alignSelf:"center"}}>Sources</span>{result.sources.map((s,i)=><span className="pill violet" key={i} data-testid={`source-answer-${i}`}>{s.label}{s.page?` · p. ${s.page}`:""}</span>)}</div>}</div>}
      {error&&<div role="alert" className="notice coral" style={{marginTop:16}} data-testid="status-ask-error">{error}</div>}
      {ask.isPending&&<div className="card-caption" style={{marginTop:15}} data-testid="status-ask-loading">Checking your saved course data…</div>}
      <form onSubmit={submit} className="qa-input"><input className="field" value={question} onChange={e=>setQuestion(e.target.value)} maxLength={1200} placeholder="What’s coming up in CS 220?" aria-label="Ask a syllabus question" data-testid="input-syllabus-question"/><button className="primary-button" type="submit" disabled={!question.trim()||ask.isPending} data-testid="button-ask-question">Ask <ArrowRight size={14}/></button></form>
    </section><aside className="card"><div className="eyebrow">A few starters</div><h2 className="card-title" style={{marginTop:7}}>Try asking</h2><div style={{display:"grid",gap:8,marginTop:17}}>{["What assignments are due this week?","When is my next CS 220 deadline?","How much time is estimated for Project 2?"].map((q,i)=><button key={q} className="quiet-button" style={{justifyContent:"space-between",textAlign:"left",lineHeight:1.5}} onClick={()=>setQuestion(q)} data-testid={`button-question-starter-${i}`}>{q}<ArrowRight size={13}/></button>)}</div><div className="notice" style={{marginTop:18}}>If a source is missing or unclear, SemesterOS says so rather than guessing.</div></aside></div>
  </PageFrame>;
}

function SyllabusHistoryList({state,update}: {state:SemesterState;update:(recipe:(current:SemesterState)=>SemesterState)=>void}) {
  const [editingDoc,setEditingDoc]=useState<string|null>(null);
  const [policyDraft,setPolicyDraft]=useState<PolicyNote[]>([]);
  const [snapshotOpenId,setSnapshotOpenId]=useState<string|null>(null);
  const documents=[...state.documents].sort((a,b)=>b.uploadedAt.localeCompare(a.uploadedAt));
  if(!documents.length)return <>{emptyBlock("No syllabi yet","Uploaded PDFs are sent for extraction, then only the reviewed details and metadata are saved.",<FileText size={17}/>)}</>;
  return <div style={{marginTop:14}}>
    {documents.map(document=>{
      const course=courseFor(state,document.courseId||"");
      const snapshot=document.snapshot;
      const open=editingDoc===document.id;
      return <div key={document.id} className="card" style={{padding:"12px 13px",marginBottom:8}} data-testid={`row-document-${document.id}`}>
        <div className="course-row" style={{padding:0,flexWrap:"wrap"}}>
          <FileText size={15} color="#6758E8"/>
          <div className="course-name">{document.filename}<div className="course-code">Added {dateLabel(document.uploadedAt.slice(0,10))} · v{document.version} · {course?.code||"Course"}</div></div>
          <span className="pill">{document.policyNotes.length} notes</span>
          {snapshot&&<button type="button" className="text-button" onClick={()=>setSnapshotOpenId(snapshotOpenId===document.id?null:document.id)} aria-expanded={snapshotOpenId===document.id} data-testid={`button-view-syllabus-snapshot-${document.id}`}>{snapshotOpenId===document.id?"Hide":"View snapshot"}</button>}
          <button type="button" className="text-button" onClick={()=>{setEditingDoc(open?null:document.id);setPolicyDraft(document.policyNotes.map(note=>({...note})));}} data-testid={`button-edit-syllabus-policies-${document.id}`}>{open?"Close":"Review policies"}</button>
        </div>
        {snapshotOpenId===document.id&&snapshot&&<section className="notice" style={{marginTop:12}} data-testid={`panel-syllabus-snapshot-${document.id}`}>
          <strong>Approved extraction snapshot · {snapshot.course.name} ({snapshot.course.code})</strong>
          {snapshot.course.instructor&&<div style={{marginTop:4}}>Instructor: {snapshot.course.instructor}</div>}
          <div style={{marginTop:5}}>{snapshot.assignments.length} assignments · {snapshot.policyNotes.length} policy notes</div>
          {snapshot.assignments.length>0&&<ul style={{margin:"8px 0 0",paddingLeft:20}}>{snapshot.assignments.map(assignment=><li key={assignment.id}>{assignment.title} · {typeName(assignment.type)} · {dateLabel(assignment.dueDate)}{assignment.estimatedHours!=null?` · ${assignment.estimatedHours}h`:""}</li>)}</ul>}
          {snapshot.policyNotes.length>0&&<div style={{display:"grid",gap:6,marginTop:9}}>{snapshot.policyNotes.map(note=><div key={note.id}><b>{note.topic}</b>: {note.text}{note.page?` · p. ${note.page}`:""}</div>)}</div>}
          {snapshot.ambiguities.length>0&&<div className="notice coral" style={{marginTop:9}}><b>Needs verification:</b> {snapshot.ambiguities.join(" · ")}</div>}
        </section>}
        {open&&<div style={{marginTop:12}} data-testid={`panel-edit-syllabus-policies-${document.id}`}>
          {policyDraft.map((note,index)=><div className="form-grid" key={note.id} style={{marginBottom:10}}>
            <div className="form-field"><label htmlFor={`policy-topic-${note.id}`}>Policy topic</label><input id={`policy-topic-${note.id}`} className="field" value={note.topic} onChange={event=>setPolicyDraft(items=>items.map((item,i)=>i===index?{...item,topic:event.target.value}:item))} data-testid={`input-settings-policy-topic-${note.id}`}/></div>
            <div className="form-field"><label htmlFor={`policy-page-${note.id}`}>Source page</label><input id={`policy-page-${note.id}`} type="number" min="1" className="field" value={note.page??""} onChange={event=>setPolicyDraft(items=>items.map((item,i)=>i===index?{...item,page:event.target.value?Number(event.target.value):null}:item))} data-testid={`input-settings-policy-page-${note.id}`}/></div>
            <div className="form-field full"><label htmlFor={`policy-text-${note.id}`}>Policy detail</label><textarea id={`policy-text-${note.id}`} className="field-textarea" value={note.text} onChange={event=>setPolicyDraft(items=>items.map((item,i)=>i===index?{...item,text:event.target.value}:item))} data-testid={`input-settings-policy-text-${note.id}`}/><button type="button" className="text-button" style={{justifySelf:"start",color:"#b55349"}} onClick={()=>setPolicyDraft(items=>items.filter((_,i)=>i!==index))} data-testid={`button-remove-settings-policy-${note.id}`}>Remove note</button></div>
          </div>)}
          {!policyDraft.length&&<div className="card-caption" style={{marginBottom:9}}>No policy notes. Add one if there is a course rule to keep in view.</div>}
          <div className="tool-row">
            <button type="button" className="quiet-button" onClick={()=>setPolicyDraft(items=>[...items,{id:`policy-${crypto.randomUUID()}`,topic:"New policy",text:"",page:null}])} data-testid={`button-add-settings-policy-${document.id}`}>Add policy note</button>
            <button type="button" className="primary-button" onClick={()=>{update(current=>({...current,documents:current.documents.map(item=>item.id===document.id?{...item,policyNotes:policyDraft,snapshot:item.snapshot?{...item.snapshot,policyNotes:policyDraft}:undefined}:item)}));setEditingDoc(null);}} data-testid={`button-save-settings-policies-${document.id}`}>Save policy notes</button>
          </div>
        </div>}
      </div>;
    })}
  </div>;
}

function SettingsPage() {
  const {state,update,mode,isSignedIn,deleteAccountData,deletingAccountData,deleteAccountError,saving,saveError}=useS();const [saved,setSaved]=useState(false);const [uploadOpen,setUploadOpen]=useState(false);const [pushBusy,setPushBusy]=useState(false);const [pushError,setPushError]=useState("");
  const {user}=useUser();
  const deliveryStatus=useGetNotificationDeliveryStatus({query:{enabled:isSignedIn&&NOTIFICATIONS_ENABLED}});
  const [prefs,setPrefs]=useState<Preferences>(state.preferences);
  useEffect(()=>setPrefs(state.preferences),[state.preferences]);
  const save=(e:FormEvent)=>{e.preventDefault();update(s=>({...s,preferences:prefs}));setSaved(true);window.setTimeout(()=>setSaved(false),2500);};
  const enablePush=async()=>{if(!user?.id)return;setPushBusy(true);setPushError("");try{await enableBrowserPush(user.id);setPrefs(p=>({...p,pushEnabled:true}));}catch(error){setPushError(error instanceof Error?error.message:"Browser push could not be enabled.");}finally{setPushBusy(false);}};
  const toggleDay=(day:number)=>setPrefs(p=>({...p,availableDays:p.availableDays.includes(day)?p.availableDays.filter(d=>d!==day):[...p.availableDays,day].sort()}));
  const toggleReminder=(hours:number)=>setPrefs(p=>({...p,reminderHours:p.reminderHours.includes(hours)?p.reminderHours.filter(value=>value!==hours):[...p.reminderHours,hours].sort((a,b)=>a-b)}));
  const activeCategories=prefs.notificationCategories??notificationCategoryOptions.map(option=>option.value);
  const toggleCategory=(category:Notification["category"])=>setPrefs(p=>{const current=p.notificationCategories??notificationCategoryOptions.map(option=>option.value);return {...p,notificationCategories:current.includes(category)?current.filter(value=>value!==category):[...current,category]}});
  return <PageFrame><Heading eyebrow="Set up a week that fits" title="Settings" subtitle="Your availability and session preferences guide the plan. Adjust them whenever life shifts."/>
    {isSignedIn&&<details className="card" style={{marginBottom:16}}><summary>Account deletion controls</summary><AccountDeletion disabled={saving||saveError||deletingAccountData}/></details>}
    {isSignedIn&&<p className="card-caption">Deleting saved semester data below also cancels queued reminders and removes saved Calendar credentials. Your sign-in account stays open unless you choose permanent account deletion above.</p>}
    <div className="grid-main"><form className="card" onSubmit={save} data-testid="form-preferences"><div className="section-row" style={{marginTop:0}}><div><h2 className="card-title">Study preferences</h2><p className="card-caption">Used to shape your weekly plan.</p></div>{saved&&<span className="pill lime" data-testid="status-preferences-saved">Saved</span>}</div>
      <div className="form-grid" style={{marginTop:17}}>
        <div className="form-field"><label htmlFor="pref-start">Semester starts</label><input id="pref-start" className="field" type="date" value={prefs.semesterStart} onChange={e=>setPrefs({...prefs,semesterStart:e.target.value})} data-testid="input-semester-start"/></div>
        <div className="form-field"><label htmlFor="pref-end">Semester ends</label><input id="pref-end" className="field" type="date" value={prefs.semesterEnd} onChange={e=>setPrefs({...prefs,semesterEnd:e.target.value})} data-testid="input-semester-end"/></div>
        <div className="form-field"><label htmlFor="pref-timezone">Time zone</label><input id="pref-timezone" className="field" value={prefs.timezone} onChange={e=>setPrefs({...prefs,timezone:e.target.value})} data-testid="input-timezone"/></div>
        <div className="form-field"><label htmlFor="pref-time">Best time to study</label><select id="pref-time" className="field-select" value={prefs.preferredTime} onChange={e=>setPrefs({...prefs,preferredTime:e.target.value as Preferences["preferredTime"]})} data-testid="select-preferred-time"><option value="morning">Morning</option><option value="afternoon">Afternoon</option><option value="evening">Evening</option></select></div>
        <div className="form-field"><label htmlFor="pref-duration">Session length (minutes)</label><input id="pref-duration" type="number" min="15" max="180" step="5" className="field" value={prefs.sessionDurationMinutes} onChange={e=>setPrefs({...prefs,sessionDurationMinutes:Number(e.target.value)})} data-testid="input-session-duration"/></div>
        <div className="form-field"><label htmlFor="pref-break">Break between sessions</label><input id="pref-break" type="number" min="0" max="60" step="5" className="field" value={prefs.breakMinutes} onChange={e=>setPrefs({...prefs,breakMinutes:Number(e.target.value)})} data-testid="input-break-duration"/></div>
        <div className="form-field"><label htmlFor="pref-limit">Daily study limit (hours)</label><input id="pref-limit" type="number" min="1" max="12" className="field" value={prefs.dailyStudyLimit} onChange={e=>setPrefs({...prefs,dailyStudyLimit:Number(e.target.value)})} data-testid="input-daily-limit"/></div>
        <div className="form-field"><label htmlFor="pref-start-time">Available from</label><input id="pref-start-time" type="time" className="field" value={prefs.availabilityStart} onChange={e=>setPrefs({...prefs,availabilityStart:e.target.value})} data-testid="input-availability-start"/></div>
        <div className="form-field"><label htmlFor="pref-end-time">Available until</label><input id="pref-end-time" type="time" className="field" value={prefs.availabilityEnd} onChange={e=>setPrefs({...prefs,availabilityEnd:e.target.value})} data-testid="input-availability-end"/></div>
        {!NOTIFICATIONS_ENABLED&&<div className="form-field full"><span className="card-caption">Notifications are planned for a future release. Email, push, and background reminders are currently disabled.</span></div>}
        {NOTIFICATIONS_ENABLED&&<><div className="form-field"><label htmlFor="pref-quiet-start">Quiet hours begin</label><input id="pref-quiet-start" type="time" className="field" value={prefs.quietHoursStart} onChange={e=>setPrefs({...prefs,quietHoursStart:e.target.value})} data-testid="input-quiet-start"/></div>
        <div className="form-field"><label htmlFor="pref-quiet-end">Quiet hours end</label><input id="pref-quiet-end" type="time" className="field" value={prefs.quietHoursEnd} onChange={e=>setPrefs({...prefs,quietHoursEnd:e.target.value})} data-testid="input-quiet-end"/></div>
        <div className="form-field full"><label>Reminder timing</label><div className="tool-row">{[2,24,72].map(hours=><button type="button" key={hours} onClick={()=>toggleReminder(hours)} className={prefs.reminderHours.includes(hours)?"pill violet":"pill"} style={{border:0,cursor:"pointer",padding:"8px 12px"}} aria-pressed={prefs.reminderHours.includes(hours)} data-testid={`button-reminder-hours-${hours}`}>{hours<24?`${hours} hours before`:`${hours/24} days before`}</button>)}</div><span className="card-caption">Applies to assignment deadlines and study sessions.</span></div>
        <div className="form-field full"><label>Notification types</label><div className="tool-row">{notificationCategoryOptions.map(option=><button type="button" key={option.value} onClick={()=>toggleCategory(option.value)} className={activeCategories.includes(option.value)?"pill violet":"pill"} style={{border:0,cursor:"pointer",padding:"8px 12px"}} aria-pressed={activeCategories.includes(option.value)} data-testid={`button-notification-category-${option.value}`}>{option.label}</button>)}</div></div>
        <div className="form-field full"><label>Delivery channels</label>
          <label style={{display:"flex",gap:9,alignItems:"center",fontWeight:600}}><input type="checkbox" checked={Boolean(prefs.emailEnabled)} disabled={!isSignedIn||( !prefs.emailEnabled&&(!deliveryStatus.data?.emailConfigured||user?.primaryEmailAddress?.verification?.status!=="verified"))} onChange={e=>setPrefs(p=>({...p,emailEnabled:e.target.checked}))} data-testid="toggle-email-reminders"/> Email reminders</label>
          {!isSignedIn&&<span className="card-caption">Sign in to manage delivery channels. The public demo never sends email or push reminders.</span>}
          {isSignedIn&&deliveryStatus.isSuccess&&!deliveryStatus.data.emailConfigured&&<span className="card-caption">Email needs a configured Resend sender. Reminders stay in the app until then.</span>}
          {deliveryStatus.data?.emailConfigured&&user?.primaryEmailAddress?.verification?.status!=="verified"&&<span className="card-caption">Verify your primary account email before enabling email reminders.</span>}
          <div className="tool-row" style={{marginTop:10,alignItems:"center"}}>
            <button type="button" className={prefs.pushEnabled?"pill violet":"quiet-button"} disabled={!isSignedIn||(!prefs.pushEnabled&&(!deliveryStatus.data?.pushConfigured||!import.meta.env.VITE_ONESIGNAL_APP_ID))||pushBusy} onClick={()=>prefs.pushEnabled?setPrefs(p=>({...p,pushEnabled:false})):void enablePush()} aria-pressed={Boolean(prefs.pushEnabled)} data-testid="button-enable-browser-push">{pushBusy?"Connecting…":prefs.pushEnabled?"Browser push enabled":"Enable browser push"}</button>
            {isSignedIn&&deliveryStatus.isSuccess&&!deliveryStatus.data.pushConfigured&&<span className="card-caption">Browser push is waiting for a verified OneSignal app connection.</span>}
          </div>
          {pushError&&<div className="notice coral" role="alert" data-testid="status-push-error">{pushError}</div>}
          <span className="card-caption">Enabling push asks this browser for permission. Save preferences after changing delivery channels.</span>
        </div></>}
        <div className="form-field full"><label>Study days</label><div className="tool-row">{["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].map((d,i)=><button type="button" key={i} onClick={()=>toggleDay(i)} className={prefs.availableDays.includes(i)?"pill violet":"pill"} style={{border:0,cursor:"pointer",padding:"8px 12px"}} aria-pressed={prefs.availableDays.includes(i)} data-testid={`button-study-day-${i}`}>{d}</button>)}</div></div>
      </div><div className="tool-row" style={{justifyContent:"flex-end",marginTop:20}}><button type="submit" className="primary-button" data-testid="button-save-preferences"><Check size={15}/> Save preferences</button></div>
    </form>
     <aside><div className="card"><div className="eyebrow">Your course documents</div><h2 className="card-title" style={{marginTop:7}}>Syllabi & policies</h2><p className="card-caption" style={{lineHeight:1.65}}>Add a syllabus to pull its dates and policies into your semester plan.</p><button className="quiet-button" style={{marginTop:15,width:"100%",justifyContent:"center"}} type="button" onClick={()=>setUploadOpen(true)} data-testid="button-upload-syllabus"><Upload size={14}/> Upload a syllabus PDF</button>
        <SyllabusHistoryList state={state} update={update}/>
      <div className="notice coral" style={{marginTop:15}} data-testid="notice-pdf-privacy">Privacy note: PDF contents are sent to Gemini for extraction. Original PDFs are not stored. The extracted details are only saved after you review and approve them.</div>
      {!isSignedIn&&<div className="notice" style={{marginTop:10}}>PDF extraction requires an account. The public demo never uploads your file or sends demo data to the server.</div>}
      </div><div className="card" style={{marginTop:16}}><div className="eyebrow">Your information</div><p className="card-caption" style={{lineHeight:1.7,marginTop:9}}>{mode==="demo"?"Demo changes are stored in this browser only. They are never sent to the account API.":"Your saved semester uses your private signed-in account."}</p>{mode==="demo"?<button type="button" className="quiet-button" style={{marginTop:8}} onClick={()=>{if(window.confirm("Reset this browser’s SemesterOS demo data to the sample semester?")){localStorage.removeItem(DEMO_STORAGE_KEY);window.location.reload();}}} data-testid="button-reset-demo">Reset demo data</button>:<><button type="button" className="quiet-button" style={{marginTop:8,color:"#a44940",borderColor:"#ecd4cf"}} disabled={deletingAccountData} onClick={()=>{if(window.confirm("Permanently delete all SemesterOS course, assignment, study session, notification, syllabus metadata, and preference data saved to your account? This cannot be undone."))deleteAccountData();}} data-testid="button-delete-account-data"><Trash2 size={14}/>{deletingAccountData?"Deleting saved semester…":"Delete my saved semester data"}</button>{deleteAccountError&&<div className="notice coral" style={{marginTop:10}} role="alert" data-testid="status-delete-account-error">We couldn’t delete your saved semester data. Please try again.</div>}</>}</div></aside></div>
    {uploadOpen&&<SyllabusUpload state={state} update={update} isSignedIn={isSignedIn} onClose={()=>setUploadOpen(false)}/>}
  </PageFrame>;
}

function AuthView({mode}:{mode:"sign-in"|"sign-up"}) {
  if (!clerkPubKey) return <PageFrame><Heading eyebrow="Public demo" title="Sign-in is not configured" subtitle="The owner can enable account services with matching Clerk keys. You can keep exploring the demo without an account."/><Link href="/" className="quiet-button">Back to demo</Link></PageFrame>;
  return <div className="auth-shell"><aside className="auth-aside"><Link href="/" className="brand" data-testid="link-auth-brand"><span className="brand-mark"><GraduationCap size={19}/></span>semester<span style={{fontWeight:500}}>os</span></Link><div><div className="eyebrow">A calmer semester starts here</div><div className="auth-aside-quote">You don’t have to hold every deadline in your head.</div><p className="subtitle" style={{marginTop:17}}>Your private companion for coursework, study time, and the space between.</p></div><p className="card-caption">Your courses. Your pace. Your plan.</p></aside><main className="auth-main"><div className="auth-card"><div className="eyebrow">{mode==="sign-in"?"Welcome back":"Start with a little breathing room"}</div><h1>{mode==="sign-in"?"Pick up where you left off.":"Make this semester yours."}</h1><p className="subtitle" style={{marginBottom:24}}>{mode==="sign-in"?"Your saved plan is waiting for you.":"Keep your semester private and available wherever you study."}</p>{mode==="sign-in"?<SignIn routing="path" path={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`}/>:<SignUp routing="path" path={`${basePath}/sign-up`} signInUrl={`${basePath}/sign-in`}/>}<Link href="/" className="quiet-button" style={{justifyContent:"center",marginTop:18}} data-testid="link-back-demo">Back to the public demo</Link></div></main></div>;
}
function HomeRoute() {
  const {state,isLoading,mode}=useS();const {user}=useUser();
  return <PageFrame>{isLoading?<p role="status">Loading your semester…</p>:<><Overview state={state} displayName={user?.firstName??undefined}/>{mode==="demo"&&<p className="card-caption">Fictional demo · Edits stay in this browser. <Link href="/sign-up">Create an account to save across devices.</Link></p>}</>}</PageFrame>;
}
function ClerkQueryClientCacheInvalidator() {
  const {addListener}=useClerk();const cache=useQueryClient();const previous=useRef<string|null|undefined>(undefined);
  useEffect(()=>{const unsubscribe=addListener(({user})=>{const id=user?.id??null;if(previous.current!==undefined&&previous.current!==id)cache.clear();previous.current=id;});return unsubscribe;},[addListener,cache]);
  return null;
}
function RouterContents() {
  const [,setLocation]=useLocation();
  const content =
    <QueryClientProvider client={queryClient}><TooltipProvider><SemesterProvider><ClerkQueryClientCacheInvalidator/>
      <ErrorBoundary resetKey="semester-os"><Switch>
        <Route path="/" component={HomeRoute}/>
        <Route path="/courses/:courseId" component={CourseDetailPage}/>
        <Route path="/assignments" component={AssignmentPage}/>
        <Route path="/study-planner" component={StudyPlannerPage}/>
        <Route path="/workload" component={WorkloadPage}/>
        <Route path="/ask" component={AskPage}/>
        <Route path="/settings" component={SettingsPage}/>
        <Route path="/sign-in/*?" component={()=><AuthView mode="sign-in"/>}/>
        <Route path="/sign-up/*?" component={()=><AuthView mode="sign-up"/>}/>
        <Route component={NotFound}/>
      </Switch></ErrorBoundary></SemesterProvider></TooltipProvider><Toaster/></QueryClientProvider>
  ;
  if (!clerkPubKey) return content;
  return <ClerkProvider publishableKey={clerkPubKey} appearance={appearance} signInUrl={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} localization={{signIn:{start:{title:"Welcome back",subtitle:"Sign in to access your semester"}},signUp:{start:{title:"Create your account",subtitle:"A calmer semester starts here"}}}} routerPush={to=>setLocation(stripBase(to))} routerReplace={to=>setLocation(stripBase(to),{replace:true})}>{content}</ClerkProvider>;
}
function App() {
  return <WouterRouter base={basePath}><RouterContents/></WouterRouter>;
}
export default App;
