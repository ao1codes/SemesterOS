import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
if (!process.env.SEMESTEROS_SMOKE && existsSync(path.join(root, ".env"))) process.loadEnvFile(path.join(root, ".env"));
const children = new Set();
const corepack = process.platform === "win32" ? "corepack.cmd" : "corepack";
function run(args, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(corepack, ["pnpm", ...args], {
      cwd: root, stdio: "inherit", env: { ...process.env, ...env },
      shell: process.platform === "win32",
    });
    children.add(child);
    child.on("error", reject);
    child.on("exit", (code) => {
      children.delete(child);
      code === 0 ? resolve() : reject(new Error(`corepack pnpm ${args.join(" ")} exited ${code}`));
    });
  });
}
function stop() { for (const child of children) child.kill("SIGTERM"); }
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, stop);
const api = (command, env) => run(["--filter", "@workspace/api-server", "run", command], env);
const web = (command, env) => run(["--filter", "@workspace/semester-os", "run", command], env);
try {
  switch (process.argv[2]) {
    case "dev": {
      const webPort = process.env.WEB_PORT || "5173";
      await Promise.all([
        api("dev", { PORT: process.env.API_PORT || "3001", WEB_PORT: webPort, NODE_ENV: "development" }),
        web("dev", { PORT: webPort, NODE_ENV: "development" }),
      ]);
      break;
    }
    case "build":
      await run(["run", "typecheck"]);
      await web("build", { NODE_ENV: "production" });
      await api("build");
      break;
    case "start":
      await api("start", { NODE_ENV: "production", SERVE_STATIC: "true", PORT: process.env.PORT || process.env.API_PORT || "3001" });
      break;
    case "test":
      await web("test");
      await api("test");
      break;
    case "db:push":
      await run(["--filter", "@workspace/db", "run", "push"]);
      break;
    case "db:inventory":
      await api("inventory");
      break;
    default: throw new Error("Use dev, build, start, test, db:push, or db:inventory.");
  }
} catch (error) {
  console.error(error.message);
  stop();
  process.exitCode = 1;
}
