import { spawn, execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile, unlink, open } from "node:fs/promises";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
const pidFile = new URL("../.grok/snapper-preview.pid", import.meta.url);
const logFile = new URL("../.grok/snapper-preview.log", import.meta.url);
const command = process.argv[2] ?? "restart";
const runner = fileURLToPath(new URL("../node_modules/wrangler/bin/wrangler.js", import.meta.url));
await mkdir(new URL("../.grok/", import.meta.url), { recursive: true });
// The PID file only tracks the detached preview process created by this script.
try {
  const pid = Number(await readFile(pidFile, "utf8"));
  if (Number.isInteger(pid) && pid > 1) {
    try {
      const running = execFileSync("ps", ["-p", String(pid), "-o", "command="], {
        encoding: "utf8",
      });
      if (running.includes(runner) && running.includes("--port 8081"))
        process.kill(-pid, "SIGTERM");
    } catch {
      /* Stale PID or process already stopped. Never kill an unverified process. */
    }
  }
  await unlink(pidFile);
} catch {
  // A missing PID file means there is no managed preview to stop.
}
if (command === "stop") process.exit(0);
await new Promise((resolve) => setTimeout(resolve, 300));
const log = await open(logFile, "a");
const child = spawn(
  process.execPath,
  [
    runner,
    "dev",
    "--env",
    "local",
    "--ip",
    "127.0.0.1",
    "--port",
    "8081",
    "--var",
    "APP_ORIGIN:http://127.0.0.1:8081",
    "--persist-to",
    ".wrangler/preview",
    "--show-interactive-dev-session=false",
  ],
  { cwd: root, detached: true, stdio: ["ignore", log.fd, log.fd] },
);
await writeFile(pidFile, String(child.pid));
child.unref();
await log.close();
for (let i = 0; i < 120; i++) {
  try {
    const response = await fetch("http://127.0.0.1:8081/api/snapper/status", {
      signal: AbortSignal.timeout(500),
    });
    if (response.ok) {
      console.log("Snapper built preview is ready.");
      process.exit(0);
    }
  } catch {
    // The emulator may not be listening yet; retry until the startup deadline.
  }
  await new Promise((resolve) => setTimeout(resolve, 250));
}
console.error("Preview failed to start; inspect .grok/snapper-preview.log.");
process.exitCode = 1;
