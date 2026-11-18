type SnoozableNotification = {
  isRead: boolean;
  snoozedUntil?: Date | string | null;
};

export function releaseExpiredSnoozes<T extends SnoozableNotification>(
  notifications: T[],
  now = new Date(),
): T[] {
  let changed = false;
  const released = notifications.map((notification) => {
    if (!notification.snoozedUntil) return notification;
    const snoozedUntil = notification.snoozedUntil instanceof Date
      ? notification.snoozedUntil.getTime()
      : Date.parse(notification.snoozedUntil);
    if (Number.isFinite(snoozedUntil) && snoozedUntil > now.getTime()) return notification;
    changed = true;
    return { ...notification, isRead: false, snoozedUntil: null };
  });
  return changed ? released : notifications;
}
