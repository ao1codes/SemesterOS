import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetGoogleCalendarStatusQueryKey,
  getListGoogleBusyEventsQueryKey,
  getListGoogleCalendarsQueryKey,
  useExportSemesterEventsToGoogle,
  useGetGoogleCalendarStatus,
  useListGoogleBusyEvents,
  useListGoogleCalendars,
} from "@workspace/api-client-react";
import type { SemesterState, StudySession } from "@workspace/api-client-react";
import { CalendarDays, Check, ExternalLink, RefreshCw } from "lucide-react";
import { useDialogFocus } from "@/hooks/use-dialog-focus";

type GoogleCalendarPanelProps = {
  state: SemesterState;
  update: (recipe: (current: SemesterState) => SemesterState) => void;
  isSignedIn: boolean;
  startDate: string;
  endDate: string;
};

function zonedParts(instant: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    date: `${values.year}-${values.month}-${values.day}`,
    time: `${values.hour}:${values.minute}`,
  };
}

function toBusySession(event: { id: string; summary: string; start: string; end: string; allDay: boolean }, timezone: string): StudySession {
  if (event.allDay) {
    const endDate = new Date(`${event.end.slice(0, 10)}T12:00:00Z`);
    const startDate = new Date(`${event.start.slice(0, 10)}T12:00:00Z`);
    const days = Math.max(1, Math.round((endDate.getTime() - startDate.getTime()) / 86_400_000));
    return {
      id: `google-${event.id}`,
      calendarEventId: event.id,
      assignmentId: null,
      title: `Busy · ${event.summary}`,
      date: event.start.slice(0, 10),
      startTime: "00:00",
      durationMinutes: days * 1440,
      status: "busy",
      completedMinutes: null,
    };
  }
  const start = new Date(event.start);
  const end = new Date(event.end);
  const local = zonedParts(start, timezone);
  return {
    id: `google-${event.id}`,
    calendarEventId: event.id,
    assignmentId: null,
    title: `Busy · ${event.summary}`,
    date: local.date,
    startTime: local.time,
    durationMinutes: Math.max(5, Math.round((end.getTime() - start.getTime()) / 60_000)),
    status: "busy",
    completedMinutes: null,
  };
}

function exportCandidates(state: SemesterState, startDate: string, endDate: string) {
  const sessions = state.sessions
    .filter((session) => session.status === "planned" && session.date >= startDate && session.date <= endDate)
    .map((session) => ({ id: `session:${session.id}`, label: `${session.date} · ${session.startTime} · ${session.title}` }));
  const assignments = state.assignments
    .filter((assignment) => assignment.dueDate && assignment.dueDate >= startDate && assignment.dueDate <= endDate)
    .map((assignment) => ({ id: `assignment:${assignment.id}`, label: `${assignment.dueDate} · Due: ${assignment.title}` }));
  return [...sessions, ...assignments];
}

export function GoogleCalendarPanel({ state, update, isSignedIn, startDate, endDate }: GoogleCalendarPanelProps) {
  const queryClient = useQueryClient();
  const status = useGetGoogleCalendarStatus({ query: { queryKey: getGetGoogleCalendarStatusQueryKey(), enabled: isSignedIn, retry: false } });
  const calendars = useListGoogleCalendars({ query: { queryKey: getListGoogleCalendarsQueryKey(), enabled: Boolean(status.data?.enabled), retry: false } });
  const [calendarId, setCalendarId] = useState("");
  const [loadBusy, setLoadBusy] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [reviewOpen, setReviewOpen] = useState(false);
  useDialogFocus(reviewOpen,()=>setReviewOpen(false));
  const [updateExisting,setUpdateExisting]=useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [message, setMessage] = useState("");
  const canConnect = status.data?.message?.startsWith("Connect your own Google Calendar account") ?? false;
  const apiBase = "/api";
  const candidates = useMemo(() => exportCandidates(state, startDate, endDate), [state, startDate, endDate]);
  const busyEvents = useListGoogleBusyEvents(
    { calendarId, startDate, endDate },
    { query: { queryKey: getListGoogleBusyEventsQueryKey({ calendarId, startDate, endDate }), enabled: Boolean(status.data?.enabled && calendarId && loadBusy && startDate <= endDate), retry: false } },
  );
  const exportMutation = useExportSemesterEventsToGoogle();

  useEffect(() => {
    const result = new URLSearchParams(window.location.search).get("googleCalendar");
    if (!result) return;
    setMessage(result === "connected"
      ? "Your Google Calendar account is connected."
      : result === "cancelled"
        ? "Google Calendar connection was cancelled."
        : "Google Calendar could not be connected. Check the OAuth setup and try again.");
    void queryClient.invalidateQueries({ queryKey: getGetGoogleCalendarStatusQueryKey() });
    const url = new URL(window.location.href);
    url.searchParams.delete("googleCalendar");
    window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
  }, [queryClient]);

  useEffect(() => {
    if (!calendarId && calendars.data?.length) {
      setCalendarId(calendars.data.find((calendar) => calendar.primary)?.id || calendars.data[0].id);
    }
  }, [calendarId, calendars.data]);

  const importBusyEvents = () => {
    if (!busyEvents.data?.length) {
      setMessage("No busy events were found in this range.");
      return;
    }
    const imported = busyEvents.data.map((event) => toBusySession(event, state.preferences.timezone));
    update((current) => {
      const incomingIds = new Set(imported.map((item) => item.calendarEventId));
      return {
        ...current,
        sessions: [
          ...current.sessions.filter((session) => !session.calendarEventId || !incomingIds.has(session.calendarEventId)),
          ...imported,
        ],
      };
    });
    setMessage(`${imported.length} busy calendar block${imported.length === 1 ? "" : "s"} added to your local planner. Your Google events were not changed.`);
  };

  const openExportReview = () => {
    setSelected(candidates.map((item) => item.id));
    setMessage("");
    setReviewOpen(true);
  };

  const submitExport = () => {
    if (!calendarId || !selected.length) return;
    exportMutation.mutate(
      { data: { calendarId, eventIds: selected,updateExisting } },
      {
        onSuccess: (result) => {
          const messages=result.messages??[];
          setMessage(`${result.created} created; ${result.updated??0} updated; ${result.skipped} skipped.${messages.length ? ` ${messages.join(" ")}` : ""}`);
          setReviewOpen(false);
        },
        onError: () => setMessage("Google Calendar could not complete the export. Your SemesterOS plan is unchanged."),
      },
    );
  };

  const disconnectCalendar = async () => {
    setDisconnecting(true);
    setMessage("");
    try {
      const response = await fetch(`${apiBase}/calendar/google/connection`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!response.ok) throw new Error("Disconnect request failed.");
      await queryClient.invalidateQueries({ queryKey: getGetGoogleCalendarStatusQueryKey() });
      await queryClient.removeQueries({ queryKey: getListGoogleCalendarsQueryKey() });
      await queryClient.removeQueries({
        queryKey: getListGoogleBusyEventsQueryKey({ calendarId, startDate, endDate }),
      });
      setCalendarId("");
      setLoadBusy(false);
      setMessage("Your Google Calendar is disconnected. SemesterOS will no longer access it.");
    } catch {
      setMessage("Google Calendar could not be disconnected. Try again.");
    } finally {
      setDisconnecting(false);
    }
  };

  const busyCount = state.sessions.filter((session) => session.status === "busy").length;

  return <>
    <section className="card" style={{marginBottom:16}} data-testid="panel-google-calendar">
      <div className="section-row" style={{marginTop:0}}>
        <div><div className="eyebrow">Calendar connection</div><h2 className="card-title" style={{marginTop:6}}>Google Calendar</h2></div>
        <span className={`pill ${status.data?.enabled ? "lime" : ""}`} data-testid="status-google-calendar">{status.data?.enabled ? "Connected" : isSignedIn ? "Not connected" : "Sign in to connect"}</span>
      </div>
      {!isSignedIn
        ? <div className="notice" style={{marginTop:12}}>Sign in to use the Google Calendar connection. Demo mode never reads or writes to a calendar.</div>
        : !status.data?.enabled
          ? <div className="notice" style={{marginTop:12}} data-testid="notice-google-calendar-owner">
            <div>{status.data?.message || "Connect your own Google Calendar account. Your calendar is never shared with other SemesterOS users."}</div>
            {canConnect&&<button type="button" className="primary-button" style={{marginTop:11}} onClick={()=>window.location.assign(`${apiBase}/calendar/google/oauth/start`)} data-testid="button-connect-google-calendar">Connect my Google Calendar</button>}
          </div>
          : <div style={{display:"grid",gap:14,marginTop:13}}>
            <div className="notice">This is your personal Google account. Busy events are read-only; exports create new events only after you review and confirm them.</div>
            {calendars.isError&&<div className="notice coral" role="alert">Your Google connection could not load its calendars. Reconnect your Google Calendar account and try again.</div>}
            <div className="tool-row" style={{alignItems:"flex-end"}}>
              <div className="form-field" style={{minWidth:220,flex:1}}><label htmlFor="google-calendar-select">Calendar</label><select id="google-calendar-select" className="field-select" value={calendarId} onChange={event=>{setCalendarId(event.target.value);setLoadBusy(false);}} data-testid="select-google-calendar"><option value="">Choose a calendar</option>{calendars.data?.map(calendar=><option key={calendar.id} value={calendar.id}>{calendar.summary}{calendar.primary?" · primary":""}</option>)}</select></div>
              <button type="button" className="quiet-button" disabled={!calendarId||busyEvents.isLoading} onClick={()=>{setLoadBusy(true);void busyEvents.refetch();}} data-testid="button-load-google-busy"><RefreshCw size={14}/> {busyEvents.isLoading?"Loading…":"Read busy times"}</button>
              <button type="button" className="quiet-button" disabled={!calendarId||!candidates.length} onClick={openExportReview} data-testid="button-review-google-export"><ExternalLink size={14}/> Review export ({candidates.length})</button>
              <button type="button" className="quiet-button" disabled={disconnecting} onClick={()=>void disconnectCalendar()} data-testid="button-disconnect-google-calendar">{disconnecting?"Disconnecting…":"Disconnect"}</button>
            </div>
            {busyEvents.isError&&<div className="notice coral" role="alert">Busy events could not be loaded. Check the calendar permission and date range, then retry.</div>}
            {busyEvents.data&&<div className="notice" data-testid="panel-google-busy-results">
              <div className="section-row" style={{marginTop:0}}><strong>{busyEvents.data.length} busy event{busyEvents.data.length===1?"":"s"} found</strong><button className="quiet-button" type="button" onClick={importBusyEvents} disabled={!busyEvents.data.length} data-testid="button-import-google-busy"><CalendarDays size={14}/> Add to planner</button></div>
              <div className="card-caption">Already imported: {busyCount}. New blocks count as busy time and cannot be moved by SemesterOS.</div>
              {busyEvents.data.slice(0,5).map(event=><div className="course-row" key={event.id}><CalendarDays size={14} color="#6758E8"/><span className="course-name">{event.summary}<span className="course-code">{event.allDay?event.start.slice(0,10):`${new Intl.DateTimeFormat("en-US",{timeZone:state.preferences.timezone,dateStyle:"medium",timeStyle:"short"}).format(new Date(event.start))}–${new Intl.DateTimeFormat("en-US",{timeZone:state.preferences.timezone,timeStyle:"short"}).format(new Date(event.end))}`}</span></span></div>)}
              {busyEvents.data.length>5&&<div className="card-caption">Showing five examples; all {busyEvents.data.length} will be added.</div>}
            </div>}
            {(calendars.isLoading||status.isLoading)&&<div className="card-caption">Checking your Google Calendar connection…</div>}
            {message&&<div className="notice" role="status" data-testid="status-google-calendar-action">{message}</div>}
          </div>}
    </section>
    {reviewOpen&&<div className="modal-backdrop" role="presentation" onMouseDown={event=>{if(event.target===event.currentTarget)setReviewOpen(false);}}>
      <section className="modal" role="dialog" aria-modal="true" aria-label="Review Google Calendar export" data-testid="dialog-google-export-review">
        <div className="modal-head"><div><h2>Review Google Calendar export</h2><p className="card-caption">Review the new dates and times below. Existing events remain unchanged unless you explicitly enable updating your own SemesterOS exports. No events are deleted.</p></div><button type="button" className="modal-close" onClick={()=>setReviewOpen(false)} aria-label="Close export review">×</button></div>
        <label className="course-row"><input type="checkbox" checked={updateExisting} onChange={e=>setUpdateExisting(e.target.checked)}/>Also update my previously exported selected items to the dates and times shown below.</label>
        <div className="notice">Selected items: {selected.length} · Calendar: {calendars.data?.find(calendar=>calendar.id===calendarId)?.summary||"Unknown"}</div>
        <div style={{maxHeight:300,overflow:"auto",marginTop:10}}>{candidates.map(item=><label key={item.id} className="course-row" style={{cursor:"pointer"}}><input type="checkbox" checked={selected.includes(item.id)} onChange={event=>setSelected(current=>event.target.checked?[...current,item.id]:current.filter(id=>id!==item.id))}/><span className="course-name">{item.label}</span></label>)}</div>
        {exportMutation.isError&&<div className="notice coral" role="alert">Export failed. Try again; the server skips SemesterOS events it already created.</div>}
        <div className="tool-row" style={{justifyContent:"flex-end",marginTop:14}}><button type="button" className="quiet-button" onClick={()=>setReviewOpen(false)}>Cancel</button><button type="button" className="primary-button" disabled={!selected.length||exportMutation.isPending} onClick={submitExport} data-testid="button-confirm-google-export"><Check size={14}/>{exportMutation.isPending?"Applying…":`Approve ${selected.length} events`}</button></div>
      </section>
    </div>}
  </>;
}
