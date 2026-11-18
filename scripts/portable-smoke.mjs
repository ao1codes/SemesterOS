import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import net from "node:net";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
// Allowlist OS tooling only: no inherited identity, database, connector, provider,
// or workspace-routing settings. No secrets are read or printed.
const env = Object.fromEntries(
  ["PATH", "HOME", "SystemRoot", "ComSpec", "TEMP", "TMP", "TMPDIR", "PNPM_HOME"]
    .filter(key => process.env[key]).map(key => [key, process.env[key]]),
);
Object.assign(env, {
  SEMESTEROS_SMOKE: "true", CLERK_MODE: "disabled", NODE_ENV: "production",
  NOTIFICATION_SCHEDULER_ENABLED: "false",
  WEB_BASE_PATH: process.argv.includes("--subpath") ? "/semester/" : "/",
});
async function command(args) {
  const child = spawn(process.platform === "win32" ? "corepack.cmd" : "corepack", ["pnpm", ...args], {
    cwd: root, env, stdio: "inherit", shell: process.platform === "win32",
  });
  const [code] = await once(child, "exit");
  assert.equal(code, 0, `corepack pnpm ${args.join(" ")} failed`);
}
await command(["test"]);
await command(["build"]); // Includes typecheck; builds only product artifacts.
const probe = net.createServer();
probe.listen(0, "127.0.0.1");
await once(probe, "listening");
const port = probe.address().port;
await new Promise(resolve => probe.close(resolve));
const server = spawn(process.execPath, ["artifacts/api-server/dist/index.mjs"], {
  cwd: root, env: { ...env, PORT: String(port), SERVE_STATIC: "true" }, stdio: "inherit",
});
const origin = `http://127.0.0.1:${port}`;
try {
  let healthy = false;
  for (let attempt = 0; attempt < 80; attempt++) {
    if (server.exitCode !== null) throw new Error("Standalone server exited before health check.");
    try { healthy = (await fetch(`${origin}/api/healthz`)).ok; } catch {}
    if (healthy) break;
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  assert.ok(healthy, "Standalone production server must start without provider accounts");
  const base = env.WEB_BASE_PATH.replace(/\/$/, "");
  for (const route of ["/", "/assignments", "/settings", "/sign-in/sso-callback"]) {
    const response = await fetch(`${origin}${base}${route}`);
    assert.equal(response.status, 200, route);
    assert.match(await response.text(), /<div id="root">/);
  }
  const html = await (await fetch(`${origin}${base}/`)).text();
  const script = html.match(/src="([^"]+\.js)"/)?.[1];
  assert.ok(script, "Production HTML contains built JS");
  assert.ok((await fetch(new URL(script, origin))).ok, "Built asset resolves");
  assert.match(await (await fetch(`${origin}${base}/OneSignalSDKWorker.js`)).text(), /importScripts/);
  assert.equal((await fetch(`${origin}${base}/assets/missing.js`)).status, 404);
  const privateResponse = await fetch(`${origin}/api/semester-state`);
  assert.equal(privateResponse.status, 503);
  assert.match((await privateResponse.json()).error, /Clerk keys/);
  console.log("PASS: isolated production smoke; no inherited credentials, database, or provider calls.");
} finally {
  server.kill("SIGTERM");
  await once(server, "exit");
}
