export function authMode(env: NodeJS.ProcessEnv = process.env) {
  const mode = env.CLERK_MODE || "external";
  if (!["external", "disabled"].includes(mode)) {
    throw new Error("CLERK_MODE must be external or disabled.");
  }
  return mode;
}

export function authConfigured(env: NodeJS.ProcessEnv = process.env) {
  return authMode(env) !== "disabled" &&
    Boolean(env.CLERK_SECRET_KEY && env.CLERK_PUBLISHABLE_KEY);
}

export function corsOrigins(env: NodeJS.ProcessEnv = process.env) {
  const origins = (env.CORS_ORIGINS || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  if (env.NODE_ENV === "development") {
    const webPort = env.WEB_PORT || "5173";
    origins.push(`http://localhost:${webPort}`, `http://127.0.0.1:${webPort}`);
  }
  return [...new Set(origins)];
}

export function notificationSchedulerEnabled(env: NodeJS.ProcessEnv = process.env) {
  // Scheduling may cause real provider sends. Missing or mistyped settings must
  // remain off, including hosts which inject env vars without .env.example.
  return env.NOTIFICATION_SCHEDULER_ENABLED === "true";
}

export function webBasePath(env: NodeJS.ProcessEnv = process.env) {
  const base = env.WEB_BASE_PATH || "/";
  if (!base.startsWith("/") || base.includes("..") || /[?#\\]/.test(base)) {
    throw new Error("WEB_BASE_PATH must be an absolute URL path.");
  }
  return base.replace(/\/+$/, "");
}
