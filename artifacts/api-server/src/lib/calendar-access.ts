export function calendarOwnerAllowed(userId: string | null | undefined, configuredOwnerId: string | null | undefined) {
  const ownerId = configuredOwnerId?.trim();
  return Boolean(userId && ownerId && userId === ownerId);
}
