import app, { accountReady, identityReady } from "./app";
import { pool } from "@workspace/db";
import { notificationSchedulerEnabled } from "./lib/runtime-config";
import { logger } from "./lib/logger";
import { startNotificationScheduler } from "./lib/notification-scheduler";

const rawPort = process.env.PORT || process.env.API_PORT || "3001";

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const server = app.listen(port, "0.0.0.0", async () => {
  logger.info({ port }, "Server listening");
  if (accountReady && notificationSchedulerEnabled()) {
    try { await identityReady; startNotificationScheduler(); }
    catch { /* Account gate reports the reason; never schedule under unverified identities. */ }
  } else logger.info("Account services or notification scheduler disabled; public demo available");
});
server.on("error", (err) => { logger.error({ err }, "Server failed"); process.exit(1); });
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => { server.close(() => { void pool.end().then(() => process.exit(0)); }); });
}
