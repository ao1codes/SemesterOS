import { and, eq, gt, lt } from "drizzle-orm";
import {
  db,
  googleCalendarConnections,
  googleCalendarOAuthStates,
} from "@workspace/db";
import {
  createOAuthNonce,
  createPkceChallenge,
  decryptCalendarSecret,
  deriveCalendarEncryptionKey,
  encryptCalendarSecret,
  hashOAuthState,
} from "./google-calendar-oauth";

const calendarScopes = [
  "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
  "https://www.googleapis.com/auth/calendar.events",
];

type OAuthTokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  token_type?: string;
};

function encryptionKey() {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("Calendar token encryption is not configured.");
  return deriveCalendarEncryptionKey(secret);
}

function oauthCredentials() {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("Google Calendar OAuth credentials are not configured.");
  }
  return { clientId, clientSecret };
}

export function getGoogleOAuthRedirectUri(req: {
  protocol: string;
  get(name: string): string | undefined;
}) {
  const configured = process.env.GOOGLE_OAUTH_REDIRECT_URI?.trim();
  if (configured) return configured;
  if (process.env.APP_ORIGIN) {
    return new URL("/api/calendar/google/oauth/callback", process.env.APP_ORIGIN).toString();
  }
  const protocol = req.get("x-forwarded-proto")?.split(",")[0]?.trim() || req.protocol;
  const host = req.get("x-forwarded-host")?.split(",")[0]?.trim() || req.get("host");
  if (!host) throw new Error("The Google Calendar OAuth redirect URL is not configured.");
  return new URL("/api/calendar/google/oauth/callback", `${protocol}://${host}`).toString();
}

export async function createGoogleAuthorizationUrl(userId: string, redirectUri: string) {
  const { clientId } = oauthCredentials();
  const state = createOAuthNonce();
  const verifier = createOAuthNonce();
  const key = encryptionKey();
  const now = Date.now();

  await db.delete(googleCalendarOAuthStates).where(lt(googleCalendarOAuthStates.expiresAt, new Date(now)));
  await db.insert(googleCalendarOAuthStates).values({
    stateHash: hashOAuthState(state),
    userId,
    encryptedCodeVerifier: encryptCalendarSecret(verifier, key),
    expiresAt: new Date(now + 10 * 60_000),
  });

  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", calendarScopes.join(" "));
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent select_account");
  url.searchParams.set("include_granted_scopes", "true");
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", createPkceChallenge(verifier));
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

export async function consumeGoogleOAuthState(state: string) {
  const [record] = await db.delete(googleCalendarOAuthStates)
    .where(and(
      eq(googleCalendarOAuthStates.stateHash, hashOAuthState(state)),
      gt(googleCalendarOAuthStates.expiresAt, new Date()),
    ))
    .returning();
  if (!record) throw new Error("Google Calendar authorization expired. Please try connecting again.");
  return {
    userId: record.userId,
    codeVerifier: decryptCalendarSecret(record.encryptedCodeVerifier, encryptionKey()),
  };
}

export async function exchangeGoogleAuthorizationCode(
  code: string,
  codeVerifier: string,
  redirectUri: string,
) {
  const { clientId, clientSecret } = oauthCredentials();
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    code,
    code_verifier: codeVerifier,
    grant_type: "authorization_code",
    redirect_uri: redirectUri,
  });
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!response.ok) throw new Error(`Google authorization exchange failed with status ${response.status}.`);
  const tokens = await response.json() as OAuthTokenResponse;
  if (!tokens.access_token) throw new Error("Google did not return an access token.");
  return tokens;
}

export async function saveGoogleCalendarTokens(userId: string, tokens: OAuthTokenResponse) {
  const key = encryptionKey();
  const existing = await db.query.googleCalendarConnections.findFirst({
    where: eq(googleCalendarConnections.userId, userId),
  });
  const refreshToken = tokens.refresh_token
    ? encryptCalendarSecret(tokens.refresh_token, key)
    : existing?.encryptedRefreshToken;
  if (!refreshToken) throw new Error("Google did not grant offline calendar access. Reconnect and approve access.");
  const expiresAt = new Date(Date.now() + Math.max(60, tokens.expires_in ?? 3600) * 1000);
  await db.insert(googleCalendarConnections).values({
    userId,
    encryptedRefreshToken: refreshToken,
    encryptedAccessToken: encryptCalendarSecret(tokens.access_token!, key),
    accessTokenExpiresAt: expiresAt,
    grantedScopes: tokens.scope?.split(" ") ?? calendarScopes,
    connectedAt: new Date(),
    updatedAt: new Date(),
  }).onConflictDoUpdate({
    target: googleCalendarConnections.userId,
    set: {
      encryptedRefreshToken: refreshToken,
      encryptedAccessToken: encryptCalendarSecret(tokens.access_token!, key),
      accessTokenExpiresAt: expiresAt,
      grantedScopes: tokens.scope?.split(" ") ?? calendarScopes,
      updatedAt: new Date(),
    },
  });
}

export async function hasGoogleCalendarConnection(userId: string) {
  const connection = await db.query.googleCalendarConnections.findFirst({
    columns: { userId: true },
    where: eq(googleCalendarConnections.userId, userId),
  });
  return Boolean(connection);
}

export async function disconnectGoogleCalendar(userId: string) {
  await db.transaction(async (tx) => {
    await tx.delete(googleCalendarOAuthStates)
      .where(eq(googleCalendarOAuthStates.userId, userId));
    await tx.delete(googleCalendarConnections)
      .where(eq(googleCalendarConnections.userId, userId));
  });
}

async function refreshGoogleAccessToken(userId: string, encryptedRefreshToken: string) {
  const { clientId, clientSecret } = oauthCredentials();
  const refreshToken = decryptCalendarSecret(encryptedRefreshToken, encryptionKey());
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!response.ok) throw new Error(`Google token refresh failed with status ${response.status}.`);
  const tokens = await response.json() as OAuthTokenResponse;
  if (!tokens.access_token) throw new Error("Google did not return an access token.");
  const expiresAt = new Date(Date.now() + Math.max(60, tokens.expires_in ?? 3600) * 1000);
  await db.update(googleCalendarConnections)
    .set({
      encryptedRefreshToken: tokens.refresh_token
        ? encryptCalendarSecret(tokens.refresh_token, encryptionKey())
        : encryptedRefreshToken,
      encryptedAccessToken: encryptCalendarSecret(tokens.access_token, encryptionKey()),
      accessTokenExpiresAt: expiresAt,
      updatedAt: new Date(),
    })
    .where(eq(googleCalendarConnections.userId, userId));
  return tokens.access_token;
}

async function getGoogleAccessToken(userId: string, forceRefresh = false) {
  const connection = await db.query.googleCalendarConnections.findFirst({
    where: eq(googleCalendarConnections.userId, userId),
  });
  if (!connection) throw new Error("Connect your Google Calendar account first.");
  const key = encryptionKey();
  if (
    !forceRefresh &&
    connection.encryptedAccessToken &&
    connection.accessTokenExpiresAt &&
    connection.accessTokenExpiresAt.getTime() > Date.now() + 60_000
  ) {
    return decryptCalendarSecret(connection.encryptedAccessToken, key);
  }
  return refreshGoogleAccessToken(userId, connection.encryptedRefreshToken);
}

export async function googleCalendarFetch(
  userId: string,
  path: string,
  init: RequestInit = {},
) {
  const url = new URL(path.startsWith("/") ? path : `/${path}`, "https://www.googleapis.com");
  let accessToken = await getGoogleAccessToken(userId);
  const send = (token: string) => fetch(url, {
    ...init,
    headers: {
      ...Object.fromEntries(new Headers(init.headers).entries()),
      Authorization: `Bearer ${token}`,
    },
  });
  let response = await send(accessToken);
  if (response.status === 401) {
    accessToken = await getGoogleAccessToken(userId, true);
    response = await send(accessToken);
  }
  if (!response.ok) throw new Error(`Google Calendar returned ${response.status}.`);
  return response;
}
