import { Link } from "wouter";
import { ArrowRight, CalendarDays, Clock3, AlertCircle, Check } from "lucide-react";
import type { SemesterState, Assignment, StudySession } from "@workspace/api-client-react";
import { zonedNow, addDays, mondayOf, effectiveWeight, priorityAssignments, weeklyWorkload, availableMinutes, semesterDateRange } from "@workspace/academic";
import "./overview.css";

type Workload = { thisWeek?: Assignment[]; hours?: number; completed?: number; level?: number|null; category?: string; capacity?: number; free?: number; unknownDates?: number; defaultedHours?: number; startKey?: string; endKey?: string };

const DAY = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const levelClass = (l?: string) => { const v = (l || "").toLowerCase().replace(/[_\s]+/g, "-"); return ["light", "moderate", "heavy", "very-heavy"].includes(v) ? v : "no-score"; };
const fmtDate = (k: string) => { const [y, m, d] = k.split("-").map(Number); return new Date(y, m - 1, d).toLocaleDateString("en-US", { month: "short", day: "numeric" }); };
const diffDays = (a: string, b: string) => { const p = (k: string) => { const [y, m, d] = k.split("-").map(Number); return Date.UTC(y, m - 1, d); }; return Math.round((p(b) - p(a)) / 864e5); };
const h = (n: number) => `${(Math.round(n * 10) / 10).toString()}h`;
const sessionMins = (s: StudySession) => s.status === "completed" || s.status === "partial" ? (s.completedMinutes ?? s.durationMinutes) : s.durationMinutes;
const isStudy = (s: StudySession) => s.status !== "busy" && s.status !== "skipped";

export function Overview({ state, displayName }: { state: SemesterState; displayName?: string }) {
  const now = zonedNow(state.preferences.timezone);
  const today = now.date;
  const monday = mondayOf(today);
  const courseOf = (id: string) => state.courses.find(c => c.id === id);
  const open = state.assignments.filter(a => a.status !== "completed");
  const overdue = open.filter(a => a.dueDate && a.dueDate < today);
  const undated = open.filter(a => !a.dueDate);
  const upcoming = open.filter(a => a.dueDate && a.dueDate >= today).sort((a, b) => (a.dueDate! + (a.dueTime || "")).localeCompare(b.dueDate! + (b.dueTime || "")));
  const dueThisWeek = upcoming.filter(a => a.dueDate! <= addDays(monday, 6));
  const priorities = priorityAssignments(state);
  const focus = priorities[0];

  const todayStudy = state.sessions.filter(s => s.date === today && isStudy(s)).sort((a, b) => a.startTime.localeCompare(b.startTime));
  const todayBusy = state.sessions.filter(s => s.date === today && s.status === "busy");
  const plannedToday = todayStudy.reduce((t, s) => t + sessionMins(s), 0) / 60;
  const freeToday = Math.max(0, availableMinutes(state, today)) / 60;
  const unfinished = state.sessions.filter(s => s.status === "planned" || s.status === "partial").filter(s => s.date < today || (s.date === today && s.startTime < now.time)).sort((a, b) => b.date.localeCompare(a.date));

  const week = DAY.map((label, i) => {
    const key = addDays(monday, i);
    const hrs = state.sessions.filter(s => s.date === key && isStudy(s)).reduce((t, s) => t + sessionMins(s), 0) / 60;
    const due = open.filter(a => a.dueDate === key).length;
    return { label, key, hrs, due };
  });
  const maxHrs = Math.max(state.preferences.dailyStudyLimit, ...week.map(d => d.hrs), 1);
  const wl = weeklyWorkload(state, monday) as unknown as Workload;

  const { start: semStart, end: semEnd } = semesterDateRange(state);
  const weeks: { key: string; idx: number; wl: Workload }[] = [];
  if (semStart && semEnd && semStart <= semEnd) {
    let m = mondayOf(semStart), i = 1;
    while (m <= semEnd && i <= 40) { weeks.push({ key: m, idx: i, wl: weeklyWorkload(state, m) as unknown as Workload }); m = addDays(m, 7); i++; }
  }

  const name = displayName?.trim().split(/\s+/)[0];
  const dueLabel = (a: Assignment) => { if (!a.dueDate) return "No date yet"; const d = diffDays(today, a.dueDate); return d < 0 ? `${-d}d overdue` : d === 0 ? "Due today" : d === 1 ? "Tomorrow" : `In ${d} days`; };

  return <div className="ov fade-in" data-testid="page-overview">
    <div className="hero-card" data-testid="panel-semester-overview">
      <div className="eyebrow">{name ? `Hi ${name} · ` : ""}{new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}</div>
      <div className="hero-title">{focus ? <>One clear next step,<br />not the whole semester.</> : "Your semester, one calm step at a time."}</div>
      <p className="hero-copy">{focus ? `${focus.title} is your top priority${focus.dueDate ? ` (${dueLabel(focus).toLowerCase()})` : ""}. You have about ${h(freeToday)} of open study time left today.` : "Add a course or assignment to begin building a study rhythm that works for you."}</p>
      <div className="tool-row">
        <Link href="/assignments" className="primary-button" data-testid="button-view-assignments">See what’s due <ArrowRight size={15} /></Link>
        <Link href="/study-planner" className="quiet-button" data-testid="button-open-planner">Open study planner</Link>
      </div>
    </div>

    <div className="stats-row ov-stats">
      <div className="stat-card"><div className="stat-value" data-testid="text-due-this-week">{dueThisWeek.length}</div><div className="stat-label">due this week</div></div>
      <div className="stat-card"><div className="stat-value" data-testid="text-open-count">{open.length}</div><div className="stat-label">open assignments</div></div>
      <div className="stat-card"><div className="stat-value" data-testid="text-free-today">{h(freeToday)}</div><div className="stat-label">free study time today</div></div>
      <div className="stat-card"><div className="stat-value" data-testid="text-week-hours">{h(wl.hours ?? 0)}</div><div className="stat-label">estimated this week{wl.capacity ? ` of ${h(wl.capacity)}` : ""}</div></div>
    </div>

    {(overdue.length > 0 || undated.length > 0) && <div className="ov-notices" role="status">
      {overdue.length > 0 && <Link href="/assignments" className="notice coral ov-notice" data-testid="link-overdue"><AlertCircle size={14} /> {overdue.length} {overdue.length === 1 ? "item is" : "items are"} past due and still open. Mark done or reschedule when you’re ready.</Link>}
      {undated.length > 0 && <Link href="/assignments" className="notice ov-notice" data-testid="link-undated"><CalendarDays size={14} /> {undated.length} open {undated.length === 1 ? "item has" : "items have"} no due date, so they aren’t in weekly totals.</Link>}
    </div>}

    <div className="grid-two" style={{ marginTop: 16 }}>
      <section className="card" data-testid="panel-daily-brief" aria-labelledby="ov-today">
        <div className="section-row" style={{ margin: "0 0 10px", gap: 10, flexWrap: "wrap" }}>
          <div><div className="eyebrow">Daily brief</div><h2 id="ov-today" style={{ margin: "6px 0 0" }}>Today, at a glance</h2></div>
          <span className="pill sky" data-testid="text-capacity-left">{h(freeToday)} open</span>
        </div>
        <div className="daily-brief-list">
          <div className="course-row"><Clock3 size={15} color="#6758E8" /><span className="course-name">Study planned</span><b>{h(plannedToday)}</b></div>
          <div className="course-row"><CalendarDays size={15} color="#ff856f" /><span className="course-name">Deadlines today</span><b>{week.find(d => d.key === today)?.due ?? 0}</b></div>
          <div className="course-row"><Clock3 size={15} color="#777589" /><span className="course-name">Busy blocks (not study)</span><b>{todayBusy.length}</b></div>
          {todayStudy.length ? todayStudy.map(s => <div className="daily-brief-item" key={s.id}><span>{s.startTime}</span><b>{s.title}</b><small>{s.status === "completed" ? "Done" : `${s.durationMinutes} min`}</small></div>)
            : <p className="card-caption" style={{ marginTop: 12 }}>Nothing planned yet today. A short session is enough to start.</p>}
          {upcoming.filter(a => a.dueDate === today).map(a => <div className="daily-brief-item deadline" key={a.id}><span>{a.dueTime || "Due today"}</span><b>{a.title}</b><small>{courseOf(a.courseId)?.code}</small></div>)}
        </div>
      </section>

      <section className="card" data-testid="panel-priorities" aria-labelledby="ov-prio">
        <div className="eyebrow">Priorities</div>
        <h2 id="ov-prio" style={{ margin: "6px 0 12px" }}>{focus ? `Start with ${focus.title}` : "Nothing urgent right now"}</h2>
        {priorities.length ? <ol className="ov-prio">{priorities.slice(0, 4).map((a, i) => {
          const w = effectiveWeight(a, state.courses, state.assignments); const c = courseOf(a.courseId);
          return <li key={a.id} data-testid={`row-priority-${a.id}`}><span className="ov-rank">{i + 1}</span><div className="ov-min"><div className="deadline-title ov-ellip">{a.title}</div><div className="deadline-meta">{c?.code || "Course"} · {w == null ? "weight unknown" : `${Math.round(w * 10) / 10}% of grade`} · {a.estimatedHours == null ? "no estimate" : h(a.estimatedHours)}</div></div><span className={`pill ${a.dueDate && a.dueDate < today ? "coral" : "violet"}`}>{dueLabel(a)}</span></li>;
        })}</ol> : <p className="card-caption">Add assignments to see what matters most.</p>}
        {priorities.length > 4 && <p className="card-caption">+{priorities.length - 4} more ranked items</p>}
        <div className="tool-row" style={{ marginTop: 14 }}>
          {focus ? <Link href="/study-planner" className="primary-button" data-testid="button-next-best-move">Plan a session <ArrowRight size={14} /></Link>
            : <Link href="/settings" className="primary-button" data-testid="button-add-first-course">Add a syllabus <ArrowRight size={14} /></Link>}
        </div>
      </section>
    </div>

    <div className="grid-main">
      <section>
        <div className="section-row"><h2>Coming up</h2><Link href="/assignments" className="text-button" data-testid="link-all-deadlines">All {upcoming.length} upcoming <ArrowRight size={13} /></Link></div>
        {upcoming.length ? <div className="deadline-list">{upcoming.slice(0, 5).map(a => {
          const d = diffDays(today, a.dueDate!);
          return <div className="deadline-item" key={a.id} data-testid={`card-deadline-${a.id}`}><div className="date-block">{d === 0 ? "TODAY" : `IN ${d}`}<b>{fmtDate(a.dueDate!).split(" ")[1]}</b></div><div className="ov-min"><div className="deadline-title ov-ellip">{a.title}</div><div className="deadline-meta">{courseOf(a.courseId)?.code || "Course"} · {a.type} · {a.estimatedHours == null ? "no estimate" : `${h(a.estimatedHours)} est.`}</div></div><span className={`pill ${a.status === "in_progress" ? "sky" : ""}`}>{a.status === "in_progress" ? "In progress" : "Upcoming"}</span></div>;
        })}</div> : <div className="empty-state"><div className="empty-icon"><Check size={18} /></div><b>Clear horizon</b><div>Add an assignment when you’re ready.</div></div>}

        <div className="section-row"><h2>Unfinished sessions</h2><Link href="/study-planner" className="text-button" data-testid="link-unfinished-sessions">Reschedule <ArrowRight size={13} /></Link></div>
        <div className="card" style={{ padding: "8px 17px" }} data-testid="panel-unfinished-sessions">
          {unfinished.length ? <>{unfinished.slice(0, 4).map(s => <div className="course-row" key={s.id}><span className="course-dot" style={{ background: s.status === "partial" ? "#FF856F" : "#b8b3eb" }} /><div className="course-name ov-min"><span className="ov-ellip" style={{ display: "block" }}>{s.title}</span><div className="course-code">{fmtDate(s.date)} · {s.startTime}</div></div><span className="pill">{s.status === "partial" ? `${s.completedMinutes ?? 0}/${s.durationMinutes} min` : `${s.durationMinutes} min`}</span></div>)}
            {unfinished.length > 4 && <p className="card-caption" style={{ paddingBottom: 8 }}>+{unfinished.length - 4} more to review</p>}</>
            : <p className="card-caption" style={{ padding: "10px 0" }}>No sessions left hanging. Nice and tidy.</p>}
        </div>
      </section>

      <section>
        <div className="section-row"><h2>This week</h2><Link href="/workload" className="text-button" data-testid="link-week-workload">Details <ArrowRight size={13} /></Link></div>
        <div className="card" style={{ padding: "18px 17px" }}>
          <p className="card-caption" style={{ marginTop: 0 }}>Study planned Mon–Sun · {fmtDate(monday)} to {fmtDate(addDays(monday, 6))}</p>
          <div className="week-bars" data-testid="chart-weekly-sessions" role="list">
            {week.map(d => <div className="week-day" key={d.key} role="listitem" aria-label={`${d.label}: ${h(d.hrs)} planned, ${d.due} due`}>
              <div className="bar-track"><div className={`bar-fill ${d.key === today ? "today" : ""}`} style={{ height: `${Math.max(6, Math.min(100, d.hrs / maxHrs * 100))}%` }} /></div>
              <span>{d.label.slice(0, 1)}{d.due > 0 && <i className="ov-due-dot" aria-hidden />}</span>
            </div>)}
          </div>
          <p className="card-caption">{h(week.reduce((t, d) => t + d.hrs, 0))} planned · {dueThisWeek.length} due{wl.unknownDates ? ` · ${wl.unknownDates} undated` : ""}{wl.defaultedHours ? ` · ${wl.defaultedHours} estimated by default` : ""}</p>
        </div>

        <div className="section-row" style={{ marginTop: 23 }}><h2>Your courses</h2><span className="pill">{state.courses.length} courses</span></div>
        <div className="card" style={{ padding: "5px 17px" }}>
          {state.courses.length ? state.courses.map(c => { const n = open.filter(a => a.courseId === c.id).length; return <Link href={`/courses/${c.id}`} className="course-row" style={{ textDecoration: "none", color: "inherit" }} key={c.id} data-testid={`row-course-${c.id}`} aria-label={`Open ${c.name}, ${n} open`}><span className="course-dot" style={{ background: c.color }} /><div className="course-name ov-min"><span className="ov-ellip" style={{ display: "block" }}>{c.name}</span><div className="course-code">{c.code}</div></div><span className="pill">{n} open</span><ArrowRight size={14} /></Link>; })
            : <p className="card-caption" style={{ padding: "12px 0" }}>No courses yet. <Link href="/settings">Add a syllabus</Link>.</p>}
        </div>
      </section>
    </div>

    <section aria-labelledby="ov-sem">
      <div className="section-row" style={{ flexWrap: "wrap", gap: 10 }}><h2 id="ov-sem">Semester workload</h2>
        <div className="heatmap-legend">{["light", "moderate", "heavy", "very-heavy"].map(l => <span key={l}><i className={`heatmap-swatch ${l}`} />{l.replace("-", " ")}</span>)}</div></div>
      <div className="card">
        {weeks.length ? <div className="heatmap-grid" data-testid="chart-semester-heatmap">
          {weeks.map(w => { const cur = w.key === monday; const hrs = w.wl.hours ?? 0; const n = w.wl.thisWeek?.length ?? 0;
            return <Link key={w.key} href="/workload" className={`heatmap-cell ${levelClass(n || hrs ? w.wl.category : undefined)} ${cur ? "selected" : ""}`} data-testid={`button-week-${w.idx}`} aria-label={`Week ${w.idx}, ${fmtDate(w.key)}: ${h(hrs)}, ${n} items, ${w.wl.category || "no score"}${cur ? ", current week" : ""}`} aria-current={cur ? "date" : undefined}>
              <span>W{w.idx}</span><b>{n || hrs ? h(hrs) : "–"}</b><span>{fmtDate(w.key)}</span></Link>; })}
        </div> : <p className="card-caption">Set semester dates in <Link href="/settings">Settings</Link> to see your full workload map.</p>}
      </div>
    </section>
  </div>;
}

export default Overview;
