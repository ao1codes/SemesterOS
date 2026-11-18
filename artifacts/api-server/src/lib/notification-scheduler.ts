import { and, eq, lte, or } from "drizzle-orm";
import { clerkClient } from "@clerk/express";
import { GetSemesterStateResponse } from "@workspace/api-zod";
import { db, notificationDeliveries, semesterStates } from "@workspace/db";
import { logger } from "./logger";
import { releaseExpiredSnoozes } from "./notification-utils";
import {
  retryDelayMs,
  sendNotificationDelivery,
  stableDeliveryKey,
  type DeliveryChannel,
  type ProviderResult,
} from "./notification-delivery";
import { commitScheduledState, readSemesterState } from "./semester-store";
import { weeklyWorkload, localInstant } from "@workspace/academic";
import { normalizeWireDates } from "./state-revision";

type SemesterState = ReturnType<typeof GetSemesterStateResponse.parse>;
type SemesterNotification = SemesterState["notifications"][number];

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

function safeTimezone(timezone: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(new Date());
    return timezone;
  } catch {
    return "UTC";
  }
}

function zonedParts(date: Date, timezone: string) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: safeTimezone(timezone),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    hourCycle: "h23",
  });
  const values = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour: Number(values.hour),
    minute: Number(values.minute),
    weekday: values.weekday,
  };
}

function dateKey(parts: { year: number; month: number; day: number }) {
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

function asDateKey(value: Date | string) {
  if (typeof value === "string") return value;
  return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, "0")}-${String(value.getUTCDate()).padStart(2, "0")}`;
}

function dateKeyOffset(value: string, days: number) {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days, 12));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

function mondayOf(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  const weekday = new Date(Date.UTC(year, month - 1, day, 12)).getUTCDay();
  return dateKeyOffset(value, -((weekday + 6) % 7));
}

function localDateTimeToUtc(value: string, time: string, timezone: string) {
  const instant = localInstant(value,time,timezone);
  if (instant != null) return new Date(instant);
  // Invalid/nonexistent times are omitted rather than delivered at an invented time.
  return new Date(NaN);
}

function isQuietHours(now: Date, state: SemesterState) {
  const parts = zonedParts(now, state.preferences.timezone);
  const current = parts.hour * 60 + parts.minute;
  const startParts = state.preferences.quietHoursStart.split(":").map(Number);
  const endParts = state.preferences.quietHoursEnd.split(":").map(Number);
  const start = startParts[0] * 60 + startParts[1];
  const end = endParts[0] * 60 + endParts[1];
  if (!Number.isFinite(start) || !Number.isFinite(end) || start === end) return false;
  return start < end ? current >= start && current < end : current >= start || current < end;
}

function categoryEnabled(state: SemesterState, category: SemesterNotification["category"]) {
  return state.preferences.notificationCategories?.includes(category) ?? true;
}

function makeNotification(
  id: string,
  category: SemesterNotification["category"],
  title: string,
  message: string,
  createdAt: Date,
): SemesterNotification {
  return { id, category, title, message, createdAt:createdAt.toISOString(), isRead: false, dismissed: false, snoozedUntil: null };
}

function workloadScore(
  assignments: SemesterState["assignments"],
  state: SemesterState,
  start: string,
) {
  return weeklyWorkload({...state,assignments},start).level;
}

function deliveryChannels(state: SemesterState): DeliveryChannel[] {
  const channels: DeliveryChannel[] = [];
  if (state.preferences.emailEnabled && process.env.RESEND_FROM_EMAIL && process.env.RESEND_API_KEY) {
    channels.push("email");
  }
  if (
    state.preferences.pushEnabled &&
    process.env.ONESIGNAL_APP_ID &&
    process.env.ONESIGNAL_REST_API_KEY &&
    process.env.ONESIGNAL_API_READY === "true"
  ) {
    channels.push("push");
  }
  return channels;
}

export function buildScheduledNotifications(
  state: SemesterState,
  now = new Date(),
): SemesterNotification[] {
  if (isQuietHours(now, state)) return [];
  const notifications: SemesterNotification[] = [];
  const existingIds = new Set(state.notifications.map((notification) => notification.id));
  const createdAt = now;
  const add = (notification: SemesterNotification) => {
    if (!existingIds.has(notification.id)) {
      notifications.push(notification);
      existingIds.add(notification.id);
    }
  };
  const timezone = safeTimezone(state.preferences.timezone);
  const reminderHours = [...new Set(state.preferences.reminderHours ?? [])]
    .filter((hours) => Number.isFinite(hours) && hours >= 0)
    .sort((a, b) => b - a);

  for (const assignment of state.assignments) {
    if (!assignment.dueDate || assignment.status === "completed") continue;
    const category = assignment.type === "exam" ? "exam" : "deadline";
    if (!categoryEnabled(state, category)) continue;
    const dueDate = asDateKey(assignment.dueDate);
    const dueAt = localDateTimeToUtc(dueDate, assignment.dueTime || "23:59", timezone);
    const hoursUntil = (dueAt.getTime() - now.getTime()) / HOUR_MS;
    if (!Number.isFinite(hoursUntil) || hoursUntil <= 0) continue;
    for (const hours of reminderHours) {
      if (hoursUntil > hours) continue;
      add(makeNotification(
        `deadline-${assignment.id}-${dueDate}-${assignment.dueTime||"23:59"}-${hours}`,
        category,
        category === "exam" ? "Exam coming up" : "Assignment deadline coming up",
        `${assignment.title} is due ${dueDate}${assignment.dueTime ? ` at ${assignment.dueTime}` : ""}.`,
        createdAt,
      ));
    }
  }

  for (const session of state.sessions) {
    if (session.status === "skipped") continue;
    const sessionDate = asDateKey(session.date);
    const sessionAt = localDateTimeToUtc(sessionDate, session.startTime, timezone);
    const endAt = new Date(sessionAt.getTime() + session.durationMinutes * MINUTE_MS);
    const hoursUntil = (sessionAt.getTime() - now.getTime()) / HOUR_MS;
    if (
      session.status === "planned" &&
      session.assignmentId &&
      endAt.getTime() <= now.getTime() &&
      categoryEnabled(state, "missed_session")
    ) {
      add(makeNotification(
        `missed-session-${session.id}`,
        "missed_session",
        "Study session missed",
        `${session.title} was planned for ${sessionDate} at ${session.startTime}. Re-plan the remaining work when you’re ready.`,
        createdAt,
      ));
    }
    if (
      session.status === "planned" &&
      Number.isFinite(hoursUntil) && hoursUntil > 0 &&
      categoryEnabled(state, "study_session")
    ) {
      for (const hours of reminderHours) {
        if (hoursUntil > hours) continue;
        add(makeNotification(
          `study-session-${session.id}-${sessionDate}-${session.startTime}-${hours}`,
          "study_session",
          "Study session coming up",
          `${session.title} is planned for ${sessionDate} at ${session.startTime}.`,
          createdAt,
        ));
      }
    }
  }

  if (categoryEnabled(state, "conflict")) {
    const sessions = state.sessions.filter((session) => session.status !== "skipped");
    for (let firstIndex = 0; firstIndex < sessions.length; firstIndex += 1) {
      const first = sessions[firstIndex];
      const [firstHour, firstMinute] = first.startTime.split(":").map(Number);
      const firstStart = firstHour * 60 + firstMinute;
      for (let secondIndex = firstIndex + 1; secondIndex < sessions.length; secondIndex += 1) {
        const second = sessions[secondIndex];
        if (asDateKey(first.date) !== asDateKey(second.date)) continue;
        const [secondHour, secondMinute] = second.startTime.split(":").map(Number);
        const secondStart = secondHour * 60 + secondMinute;
        if (
          firstStart < secondStart + second.durationMinutes &&
          firstStart + first.durationMinutes > secondStart
        ) {
          const pair = [first.id, second.id].sort().join("-");
          add(makeNotification(
            `conflict-${pair}`,
            "conflict",
            "Study schedule conflict",
            `${first.title} and ${second.title} overlap on ${asDateKey(first.date)}.`,
            createdAt,
          ));
        }
      }
    }
  }

  const localNow = zonedParts(now, timezone);
  const today = dateKey(localNow);
  const thisWeek = mondayOf(today);
  const score = workloadScore(state.assignments, state, thisWeek);
  if (score != null && score >= 75 && categoryEnabled(state, "workload")) {
    add(makeNotification(
      `workload-week-${thisWeek}`,
      "workload",
      "A very heavy week is coming up",
      `Your workload score for the week of ${thisWeek} is ${score}/100. Review the deadlines and make room for study sessions.`,
      createdAt,
    ));
  }

  if (
    localNow.weekday === "Mon" &&
    localNow.hour >= 9 &&
    categoryEnabled(state, "progress")
  ) {
    const lastWeek = dateKeyOffset(thisWeek, -7);
    const lastWeekEnd = dateKeyOffset(lastWeek, 6);
    const completedSessions = state.sessions.filter(
      (session) =>
        session.status === "completed" &&
        asDateKey(session.date) >= lastWeek &&
        asDateKey(session.date) <= lastWeekEnd,
    );
    const completedAssignments = state.assignments.filter(
      (assignment) =>
        assignment.status === "completed" &&
        assignment.dueDate != null &&
        asDateKey(assignment.dueDate) >= lastWeek &&
        asDateKey(assignment.dueDate) <= lastWeekEnd,
    );
    add(makeNotification(
      `weekly-progress-${lastWeek}`,
      "progress",
      "Your weekly progress summary",
      `Last week you completed ${completedSessions.length} study sessions and ${completedAssignments.length} assignments.`,
      createdAt,
    ));
  }

  return notifications;
}

export async function runNotificationSweep(now = new Date()) {
  const rows = await db
    .select({
      userId: semesterStates.userId,
      state: semesterStates.state,
      updatedAt: semesterStates.updatedAt,
    })
    .from(semesterStates);
  let createdCount = 0;

  for (const row of rows) {
    const parsed = GetSemesterStateResponse.safeParse(normalizeWireDates(row.state));
    if (!parsed.success) {
      logger.warn({ userId: row.userId }, "Skipping notifications for invalid semester data");
      continue;
    }
    const notifications = releaseExpiredSnoozes(parsed.data.notifications, now);
    const stateForSchedule = notifications === parsed.data.notifications
      ? parsed.data
      : { ...parsed.data, notifications };
    const fresh = buildScheduledNotifications(stateForSchedule, now);
    if (!fresh.length && notifications === parsed.data.notifications) continue;
    const nextState = GetSemesterStateResponse.parse({
      ...stateForSchedule,
      notifications: [...notifications, ...fresh],
    });
    const channels = deliveryChannels(nextState);
    const deliveries = fresh.flatMap((notification) =>
      channels.map((channel) => ({
        notificationId: notification.id,
        channel,
        idempotencyKey: stableDeliveryKey(row.userId, notification.id, channel),
      })),
    );
    const saved = await commitScheduledState(
      row.userId,
      row.state,
      row.updatedAt,
      nextState,
      deliveries,
      now,
    );
    if (saved) createdCount += fresh.length;
  }

  await deliverPendingNotifications(now);
  if (createdCount) logger.info({ createdCount }, "Scheduled in-app notifications");
}

const MAX_DELIVERY_ATTEMPTS = 5;
const DELIVERY_LEASE_MS = 10 * MINUTE_MS;

async function getVerifiedPrimaryEmail(userId: string) {
  const user = await clerkClient.users.getUser(userId);
  const email = user.emailAddresses.find(
    (address) =>
      address.id === user.primaryEmailAddressId &&
      address.verification?.status === "verified",
  );
  return email?.emailAddress ?? null;
}

async function deliverOne(
  delivery: typeof notificationDeliveries.$inferSelect,
): Promise<ProviderResult> {
  const state = await readSemesterState(delivery.userId);
  const notification = state.notifications.find(
    (item) => item.id === delivery.notificationId,
  );
  if (!notification) return { status: "skipped", errorCode: "notification_not_found" };
  if (!categoryEnabled(state,notification.category)) return {status:"skipped",errorCode:"category_disabled"};
  if (notification.id.startsWith("deadline-") && !state.assignments.some(a=>a.dueDate&&a.status!=="completed"&&notification.id.startsWith(`deadline-${a.id}-${a.dueDate}-${a.dueTime||"23:59"}-`)))
    return {status:"skipped",errorCode:"deadline_changed"};
  if (notification.id.startsWith("study-session-") && !state.sessions.some(s=>s.status==="planned"&&notification.id.startsWith(`study-session-${s.id}-${s.date}-${s.startTime}-`)))
    return {status:"skipped",errorCode:"session_changed"};
  const enabled =
    delivery.channel === "email"
      ? state.preferences.emailEnabled
      : state.preferences.pushEnabled;
  if (!enabled) return { status: "skipped", errorCode: "channel_disabled" };
  if (notification.dismissed) {
    return { status: "skipped", errorCode: "notification_dismissed" };
  }
  if (
    notification.snoozedUntil &&
    Date.parse(String(notification.snoozedUntil)) > Date.now()
  ) {
    return { status: "skipped", errorCode: "notification_snoozed" };
  }

  let recipientEmail: string | undefined;
  if (delivery.channel === "email") {
    try {
      recipientEmail = (await getVerifiedPrimaryEmail(delivery.userId)) ?? undefined;
    } catch {
      return { status: "failed", errorCode: "clerk_lookup_failed", retryable: true };
    }
  }
  return sendNotificationDelivery(
    {
      channel: delivery.channel as DeliveryChannel,
      userId: delivery.userId,
      notification,
      idempotencyKey: delivery.idempotencyKey,
      recipientEmail,
      senderEmail: process.env.RESEND_FROM_EMAIL,
      oneSignalAppId: process.env.ONESIGNAL_APP_ID,
    },
  );
}

async function deliverPendingNotifications(now: Date) {
  const due = await db
    .select()
    .from(notificationDeliveries)
    .where(
      and(
        lte(notificationDeliveries.nextAttemptAt, now),
        or(
          eq(notificationDeliveries.status, "pending"),
          eq(notificationDeliveries.status, "sending"),
        ),
      ),
    )
    .limit(100);

  for (const delivery of due) {
    const current=await readSemesterState(delivery.userId);
    const item=current.notifications.find(n=>n.id===delivery.notificationId);
    const snooze=item?.snoozedUntil?Date.parse(item.snoozedUntil):0;
    if(isQuietHours(now,current)||snooze>now.getTime()){
      await db.update(notificationDeliveries).set({nextAttemptAt:new Date(Math.max(now.getTime()+15*MINUTE_MS,snooze||0))})
        .where(and(eq(notificationDeliveries.idempotencyKey,delivery.idempotencyKey),eq(notificationDeliveries.attempts,delivery.attempts),eq(notificationDeliveries.status,delivery.status)));
      continue;
    }
    const claimed = await db
      .update(notificationDeliveries)
      .set({
        status: "sending",
        attempts: delivery.attempts + 1,
        nextAttemptAt: new Date(now.getTime() + DELIVERY_LEASE_MS),
        updatedAt: now,
      })
      .where(
        and(
          eq(notificationDeliveries.userId, delivery.userId),
          eq(notificationDeliveries.notificationId, delivery.notificationId),
          eq(notificationDeliveries.channel, delivery.channel),
          eq(notificationDeliveries.status, delivery.status),
          eq(notificationDeliveries.attempts, delivery.attempts),
          lte(notificationDeliveries.nextAttemptAt, now),
        ),
      )
      .returning();
    if (!claimed.length) continue;

    const attempt = claimed[0];
    let result: ProviderResult;
    try {
      result = await deliverOne(attempt);
    } catch {
      result = { status: "failed", errorCode: "delivery_unexpected_error", retryable: true };
    }

    const retry =
      result.status === "failed" &&
      result.retryable &&
      attempt.attempts < MAX_DELIVERY_ATTEMPTS;
    const status =
      result.status === "sent"
        ? "sent"
        : result.status === "skipped"
          ? "skipped"
          : retry
            ? "pending"
            : "failed";
    const nextAttemptAt = retry
      ? new Date(now.getTime() + retryDelayMs(attempt.attempts))
      : now;
    await db
      .update(notificationDeliveries)
      .set({
        status,
        providerMessageId: result.status === "sent" ? result.providerMessageId : null,
        lastErrorCode: result.status === "sent" ? null : result.errorCode,
        nextAttemptAt,
        sentAt: result.status === "sent" ? now : null,
        updatedAt: now,
      })
      .where(
        and(
          eq(notificationDeliveries.userId, attempt.userId),
          eq(notificationDeliveries.notificationId, attempt.notificationId),
          eq(notificationDeliveries.channel, attempt.channel),
          eq(notificationDeliveries.status, "sending"),
          eq(notificationDeliveries.attempts, attempt.attempts),
        ),
      );

    if (result.status === "failed" && status === "failed") {
      logger.warn(
        { channel: attempt.channel, deliveryId: attempt.idempotencyKey, errorCode: result.errorCode },
        "Notification delivery failed",
      );
    }
  }
}

export function startNotificationScheduler() {
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      await runNotificationSweep();
    } catch (error) {
      logger.error({ err: error }, "Notification sweep failed");
    } finally {
      running = false;
    }
  };

  void run();
  const interval = setInterval(() => void run(), 15 * MINUTE_MS);
  interval.unref();
  return interval;
}
