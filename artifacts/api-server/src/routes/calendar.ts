import { getAuth } from "@clerk/express";
import {
  ExportSemesterEventsToGoogleBody,
  ExportSemesterEventsToGoogleResponse,
  GetGoogleCalendarStatusResponse,
  ListGoogleBusyEventsQueryParams,
  ListGoogleBusyEventsResponse,
  ListGoogleCalendarsResponse,
} from "@workspace/api-zod";
import { Router, type IRouter, type Request, type Response } from "express";
import { isValidTimeZone, zonedDateTimeToUtc } from "../lib/calendar-time";
import {
  consumeGoogleOAuthState,
  createGoogleAuthorizationUrl,
  disconnectGoogleCalendar,
  exchangeGoogleAuthorizationCode,
  getGoogleOAuthRedirectUri,
  googleCalendarFetch,
  hasGoogleCalendarConnection,
  saveGoogleCalendarTokens,
} from "../lib/google-calendar-service";
import { hasStoredSemesterState, readSemesterState } from "../lib/semester-store";
import { webBasePath } from "../lib/runtime-config";

const router: IRouter = Router();

type GoogleCalendarListResponse = {
  items?: Array<{
    id?: string;
    summary?: string;
    primary?: boolean;
    timeZone?: string;
  }>;
  nextPageToken?: string;
};

type GoogleEventsResponse = {
  items?: Array<{
    id?: string;
    summary?: string;
    status?: string;
    transparency?: string;
    start?: { date?: string; dateTime?: string };
    end?: { date?: string; dateTime?: string };
    extendedProperties?: { private?: Record<string, string> };
  }>;
  nextPageToken?: string;
};

type ExportSelection = {
  sourceId: string;
  summary: string;
  description?: string;
  date: string;
  time?: string | null;
  duration: number;
  allDay?: boolean;
  allDayEndDate?: string;
};

async function requireConnectedUser(req: Request, res: Response) {
  const userId = getAuth(req).userId;
  if (!userId) {
    res.status(401).json({ error: "Sign in to use Google Calendar." });
    return null;
  }
  if (!(await hasGoogleCalendarConnection(userId))) {
    res.status(403).json({ error: "Connect your Google Calendar account first." });
    return null;
  }
  return userId;
}

async function googleGet<T>(userId: string, path: string): Promise<T> {
  const response = await googleCalendarFetch(userId, path, { method: "GET" });
  return response.json() as Promise<T>;
}

async function googlePost<T>(userId: string, path: string, body: unknown, method="POST"): Promise<T> {
  const response = await googleCalendarFetch(userId, path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return response.json() as Promise<T>;
}

async function listCalendars(userId: string) {
  const calendars: NonNullable<GoogleCalendarListResponse["items"]> = [];
  let pageToken: string | undefined;
  do {
    const params = new URLSearchParams({ maxResults: "250", fields: "items(id,summary,primary,timeZone),nextPageToken" });
    if (pageToken) params.set("pageToken", pageToken);
    const page = await googleGet<GoogleCalendarListResponse>(userId, `/calendar/v3/users/me/calendarList?${params}`);
    calendars.push(...(page.items ?? []));
    pageToken = page.nextPageToken;
  } while (pageToken);
  return calendars;
}

async function listEvents(userId: string, calendarId: string, timeMin: string, timeMax: string, fields: string) {
  const events: NonNullable<GoogleEventsResponse["items"]> = [];
  let pageToken: string | undefined;
  do {
    const params = new URLSearchParams({
      maxResults: "2500",
      singleEvents: "true",
      orderBy: "startTime",
      timeMin,
      timeMax,
      fields: `items(${fields}),nextPageToken`,
    });
    if (pageToken) params.set("pageToken", pageToken);
    const page = await googleGet<GoogleEventsResponse>(
      userId,
      `/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?${params}`,
    );
    events.push(...(page.items ?? []));
    pageToken = page.nextPageToken;
  } while (pageToken);
  return events;
}

function allDayDateTime(date: string) {
  return `${date}T00:00:00.000Z`;
}

function dateKey(value: Date | string) {
  return value instanceof Date ? value.toISOString().slice(0, 10) : value.slice(0, 10);
}

router.get("/calendar/google/oauth/start", async (req, res): Promise<void> => {
  const userId = getAuth(req).userId;
  if (!userId) {
    res.status(401).json({ error: "Sign in before connecting Google Calendar." });
    return;
  }
  try {
    const redirectUri = getGoogleOAuthRedirectUri(req);
    const url = await createGoogleAuthorizationUrl(userId, redirectUri);
    res.redirect(302, url);
  } catch (error) {
    req.log.error({ err: error }, "Google Calendar authorization could not start");
    res.status(503).json({ error: "Google Calendar connection is not configured yet." });
  }
});

router.get("/calendar/google/oauth/callback", async (req, res): Promise<void> => {
  const state = typeof req.query.state === "string" ? req.query.state : "";
  if (!state) {
    res.redirect(302, `${webBasePath()}/settings?googleCalendar=failed`);
    return;
  }
  try {
    const authorization = await consumeGoogleOAuthState(state);
    if (typeof req.query.error === "string") {
      res.redirect(302, `${webBasePath()}/settings?googleCalendar=cancelled`);
      return;
    }
    const code = typeof req.query.code === "string" ? req.query.code : "";
    if (!code) throw new Error("Google did not return an authorization code.");
    const tokens = await exchangeGoogleAuthorizationCode(
      code,
      authorization.codeVerifier,
      getGoogleOAuthRedirectUri(req),
    );
    await saveGoogleCalendarTokens(authorization.userId, tokens);
    res.redirect(302, `${webBasePath()}/settings?googleCalendar=connected`);
  } catch (error) {
    req.log.warn({ err: error }, "Google Calendar authorization callback failed");
    res.redirect(302, `${webBasePath()}/settings?googleCalendar=failed`);
  }
});

router.delete("/calendar/google/connection", async (req, res): Promise<void> => {
  const userId = getAuth(req).userId;
  if (!userId) {
    res.status(401).json({ error: "Sign in to disconnect Google Calendar." });
    return;
  }
  try {
    await disconnectGoogleCalendar(userId);
    res.json({ disconnected: true });
  } catch (error) {
    req.log.error({ err: error }, "Google Calendar disconnect failed");
    res.status(500).json({ error: "Google Calendar could not be disconnected. Try again." });
  }
});

router.get("/calendar/google/status", async (req, res): Promise<void> => {
  const userId = getAuth(req).userId;
  const enabled = userId ? await hasGoogleCalendarConnection(userId) : false;
  const configured = Boolean(
    process.env.GOOGLE_OAUTH_CLIENT_ID &&
    process.env.GOOGLE_OAUTH_CLIENT_SECRET &&
    process.env.SESSION_SECRET,
  );
  res.json(GetGoogleCalendarStatusResponse.parse({
    enabled,
    message: enabled
      ? null
      : !userId
        ? "Sign in to connect your own Google Calendar account."
        : configured
          ? "Connect your own Google Calendar account to import busy times and review exports."
          : "The app owner needs to configure Google OAuth before users can connect calendars.",
  }));
});

router.get("/calendar/google/calendars", async (req, res): Promise<void> => {
  const userId = await requireConnectedUser(req, res);
  if (!userId) return;
  try {
    const calendars = await listCalendars(userId);
    res.json(ListGoogleCalendarsResponse.parse(calendars.flatMap((calendar) => {
      if (!calendar.id) return [];
      return [{
        id: calendar.id,
        summary: calendar.summary || "Untitled calendar",
        primary: calendar.primary === true,
        timeZone: calendar.timeZone ?? null,
      }];
    })));
  } catch (error) {
    req.log.error({ err: error }, "Google Calendar list failed");
    res.status(502).json({ error: "Google Calendar could not be reached. Try again later." });
  }
});

router.get("/calendar/google/events", async (req, res): Promise<void> => {
  const userId = await requireConnectedUser(req, res);
  if (!userId) return;
  const parsed = ListGoogleBusyEventsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Choose a valid calendar and date range." });
    return;
  }
  const { calendarId, startDate, endDate } = parsed.data;
  const start = new Date(`${startDate}T12:00:00Z`);
  const end = new Date(`${endDate}T12:00:00Z`);
  if (start > end || (end.getTime() - start.getTime()) / 86_400_000 > 366) {
    res.status(400).json({ error: "Choose a range of 366 days or less." });
    return;
  }

  try {
    const params = new URLSearchParams({
      timeMin: `${startDate}T00:00:00-14:00`,
      timeMax: `${endDate}T23:59:59+14:00`,
    });
    const events = await listEvents(
      userId,
      calendarId,
      params.get("timeMin")!,
      params.get("timeMax")!,
      "id,summary,status,transparency,start,end",
    );
    const busyEvents = events.flatMap((event) => {
      const startValue = event.start?.dateTime || (event.start?.date ? allDayDateTime(event.start.date) : null);
      const endValue = event.end?.dateTime || (event.end?.date ? allDayDateTime(event.end.date) : null);
      if (!event.id || !startValue || !endValue || event.status === "cancelled" || event.transparency === "transparent") {
        return [];
      }
      return [{
        id: event.id,
        summary: event.summary || "Busy",
        start: startValue,
        end: endValue,
        allDay: Boolean(event.start?.date && !event.start?.dateTime),
      }];
    });
    res.json(ListGoogleBusyEventsResponse.parse(busyEvents));
  } catch (error) {
    req.log.error({ err: error }, "Google Calendar event read failed");
    res.status(502).json({ error: "Google Calendar events could not be loaded. Try again later." });
  }
});

router.post("/calendar/google/export", async (req, res): Promise<void> => {
  const userId = await requireConnectedUser(req, res);
  if (!userId) return;
  const parsed = ExportSemesterEventsToGoogleBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Choose one or more events to export." });
    return;
  }

  try {
    if (!(await hasStoredSemesterState(userId))) {
      res.status(400).json({ error: "Save your semester before exporting calendar events." });
      return;
    }
    const state = await readSemesterState(userId);
    const timezone = isValidTimeZone(state.preferences.timezone) ? state.preferences.timezone : "UTC";
    const selections = parsed.data.eventIds.flatMap((value): ExportSelection[] => {
      const separator = value.indexOf(":");
      if (separator < 0) return [];
      const kind = value.slice(0, separator);
      const id = value.slice(separator + 1);
      if (kind === "session") {
        const session = state.sessions.find((item) => item.id === id);
        return session && session.status !== "skipped" && session.status !== "busy"
          ? [{ sourceId: value, summary: session.title, date: dateKey(session.date), time: session.startTime, duration: session.durationMinutes }]
          : [];
      }
      if (kind === "assignment") {
        const assignment = state.assignments.find((item) => item.id === id);
        if (!assignment?.dueDate) return [];
        const dueDate = dateKey(assignment.dueDate);
        const nextDate = new Date(`${dueDate}T12:00:00Z`);
        nextDate.setUTCDate(nextDate.getUTCDate() + 1);
        const allDayEndDate = `${nextDate.getUTCFullYear()}-${String(nextDate.getUTCMonth() + 1).padStart(2, "0")}-${String(nextDate.getUTCDate()).padStart(2, "0")}`;
        return [{
          sourceId: value,
          summary: `Due: ${assignment.title}`,
          description: `${state.courses.find((course) => course.id === assignment.courseId)?.code || "Course"} · ${assignment.type}`,
          date: dueDate,
          allDayEndDate,
          time: assignment.dueTime,
          duration: 30,
          allDay: !assignment.dueTime,
        }];
      }
      return [];
    });
    const messages: string[] = [];
    const skipped = parsed.data.eventIds.length - selections.length;
    if (skipped) messages.push(`${skipped} selected item${skipped === 1 ? " was" : "s were"} no longer available and were skipped.`);
    if (!selections.length) {
      res.status(400).json({ error: "None of the selected items can be exported." });
      return;
    }

    const dates = selections.map((item) => item.date).sort();
    const rangeStart = zonedDateTimeToUtc(dates[0], "00:00", timezone);
    const lastDate = dates[dates.length - 1];
    const dayAfterLast = new Date(`${lastDate}T12:00:00Z`);
    dayAfterLast.setUTCDate(dayAfterLast.getUTCDate() + 2);
    const endDate = `${dayAfterLast.getUTCFullYear()}-${String(dayAfterLast.getUTCMonth() + 1).padStart(2, "0")}-${String(dayAfterLast.getUTCDate()).padStart(2, "0")}`;
    const rangeEnd = zonedDateTimeToUtc(endDate, "00:00", timezone);
    const existing = await listEvents(
      userId,
      parsed.data.calendarId,
      rangeStart.toISOString(),
      rangeEnd.toISOString(),
      "id,extendedProperties,start,end",
    );
    const existingSourceIds = new Set(
      existing.map((event) => event.extendedProperties?.private?.semesterOsSourceId).filter(Boolean),
    );
    let created = 0;
    let updated = 0;
    let alreadyPresent = 0;

    for (const item of selections) {
      // Search by source, not the new date range: a revision may move an event out of that range.
      const sourceQuery=new URLSearchParams({privateExtendedProperty:`semesterOsSourceId=${item.sourceId}`,maxResults:"250",fields:"items(id,extendedProperties),nextPageToken"});
      const sourceEvents:GoogleEventsResponse=await googleGet<GoogleEventsResponse>(userId,`/calendar/v3/calendars/${encodeURIComponent(parsed.data.calendarId)}/events?${sourceQuery}`);
      const previous:NonNullable<GoogleEventsResponse["items"]>[number]|undefined=sourceEvents.items?.find(e=>e.extendedProperties?.private?.semesterOsSourceId===item.sourceId);
      if (previous && (!parsed.data.updateExisting || previous.extendedProperties?.private?.semesterOsUserId!==userId)) {
        alreadyPresent += 1;
        if(parsed.data.updateExisting)messages.push(`“${item.summary}” was not updated because its ownership tag could not be verified.`);
        continue;
      }
      const startDateTime = item.allDay ? undefined : zonedDateTimeToUtc(item.date, item.time || "00:00", timezone);
      const endDateTime = item.allDay
        ? undefined
        : new Date(startDateTime!.getTime() + item.duration * 60_000);
      const start = item.allDay
        ? { date: item.date }
        : { dateTime: startDateTime!.toISOString(), timeZone: timezone };
      const end = item.allDay
        ? { date: item.allDayEndDate || endDate }
        : { dateTime: endDateTime!.toISOString(), timeZone: timezone };

      try {
        await googlePost(
          userId,
          `/calendar/v3/calendars/${encodeURIComponent(parsed.data.calendarId)}/events${previous?`/${encodeURIComponent(previous.id!)}`:""}`,
          {
            summary: item.summary,
            description: item.description || "Created from SemesterOS.",
            start,
            end,
            extendedProperties: { private: { semesterOsSourceId: item.sourceId,semesterOsUserId:userId } },
          },
          previous?"PATCH":"POST",
        );
        if(previous)updated+=1;else created += 1;
        existingSourceIds.add(item.sourceId);
      } catch (error) {
        req.log.warn({ err: error, sourceId: item.sourceId }, "Google Calendar event export failed");
        messages.push(`Could not export “${item.summary}”.`);
      }
    }
    if (alreadyPresent) messages.push(`${alreadyPresent} event${alreadyPresent === 1 ? " was" : "s were"} already in that calendar.`);
    res.json(ExportSemesterEventsToGoogleResponse.parse({
      created,
      updated,
      skipped: skipped + (selections.length - created - updated),
      messages,
    }));
  } catch (error) {
    req.log.error({ err: error }, "Google Calendar export failed");
    res.status(502).json({ error: "Google Calendar could not complete the export. Some approved operations may have succeeded; review the calendar before retrying." });
  }
});

export default router;
