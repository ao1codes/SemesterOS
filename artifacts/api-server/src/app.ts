import express, { type Express } from "express";
import cors from "cors";
import { clerkMiddleware } from "@clerk/express";
import pinoHttp from "pino-http";
import path from "node:path";
import { existsSync } from "node:fs";
import router from "./routes";
import { logger } from "./lib/logger";
import { authConfigured, corsOrigins, webBasePath } from "./lib/runtime-config";
import { verifyIdentityCutover } from "./lib/identity-safety";

const app: Express = express();
app.disable("x-powered-by");
if (process.env.TRUST_PROXY_HOPS) app.set("trust proxy", Number(process.env.TRUST_PROXY_HOPS));
export const accountReady = authConfigured() && Boolean(process.env.DATABASE_URL);
export const identityReady = accountReady ? verifyIdentityCutover() : Promise.resolve();
// Handle rejection immediately, while still returning an explicit API failure below.
identityReady.catch((err) => logger.error({ message: err.message }, "Account access disabled"));

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
          authorizationHeaderPresent: Boolean(req.headers.authorization),
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
          clerkAuthStatus: res.headers?.["x-clerk-auth-status"],
          clerkAuthReason: res.headers?.["x-clerk-auth-reason"],
        };
      },
    },
  }),
);
const allowedOrigins = corsOrigins();
app.use(cors({ credentials: true, origin: allowedOrigins }));
app.use(express.json({ limit: "15mb" }));
app.use(express.urlencoded({ extended: true }));
app.use("/api", async (req, res, next) => {
  if (req.path === "/healthz") return next();
  if (!accountReady) {
    res.status(503).json({ error: "Account services need DATABASE_URL and matching Clerk keys. Public demo remains available. See SETUP.md." });
    return;
  }
  try { await identityReady; next(); }
  catch { res.status(503).json({ error: "Clerk identity migration has not been verified. Account access is paused. See SETUP.md." }); }
});
if (authConfigured()) {
  app.use(clerkMiddleware(() => ({
    publishableKey: process.env.CLERK_PUBLISHABLE_KEY,
    secretKey: process.env.CLERK_SECRET_KEY,
    ...(allowedOrigins.length ? { authorizedParties: allowedOrigins } : {}),
  })));
}

app.use("/api", router);
app.use("/api", (_req, res) => { res.status(404).json({ error: "API route not found." }); });

if (process.env.SERVE_STATIC === "true") {
  const publicDir = path.resolve(import.meta.dirname, "../../semester-os/dist/public");
  if (!existsSync(path.join(publicDir, "index.html"))) {
    throw new Error("Web build missing. Run pnpm build before pnpm start.");
  }
  const base = webBasePath();
  app.use(base || "/", express.static(publicDir, { index: false }));
  app.get(base ? `${base}/{*path}` : "/{*path}", (req, res, next) => {
    if (path.extname(req.path)) return next();
    res.setHeader("Cache-Control", "no-cache");
    res.sendFile(path.join(publicDir, "index.html"));
  });
}
app.use((err: Error, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  req.log.error({ err }, "Request failed");
  res.status(500).json({ error: "Request failed. Check server configuration and logs." });
});

export default app;
