import { spawn } from "node:child_process";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { prepareDevAssets } from "./prepare-question-assets.mjs";
const root = fileURLToPath(new URL("../", import.meta.url));
const origin = "http://127.0.0.1:8788";
try {
  await fetch(`${origin}/api/snapper/status`, { signal: AbortSignal.timeout(500) });
  throw new Error("Port 8788 is already in use; stop that test server before running this suite.");
} catch (error) {
  if (error.message.startsWith("Port ")) throw error;
}
await mkdir(join(root, ".wrangler/logs"), { recursive: true });
const storage = await mkdtemp(join(tmpdir(), "snapper-integration-"));
const assets = await prepareDevAssets("test-assets");
const service = spawn(
  process.execPath,
  [
    join(root, "node_modules/wrangler/bin/wrangler.js"),
    "dev",
    "--env",
    "local",
    "--ip",
    "127.0.0.1",
    "--port",
    "8788",
    "--assets",
    assets,
    "--var",
    `APP_ORIGIN:${origin}`,
    "--persist-to",
    storage,
    "--show-interactive-dev-session=false",
  ],
  {
    cwd: root,
    env: {
      ...process.env,
      WRANGLER_LOG_PATH: join(root, ".wrangler/logs"),
      WRANGLER_SEND_METRICS: "false",
    },
    stdio: ["ignore", "pipe", "pipe"],
  },
);
let logs = "";
for (const stream of [service.stdout, service.stderr])
  stream.on("data", (data) => {
    logs = (logs + data).slice(-15000);
  });
try {
  let ready = false;
  for (let i = 0; i < 120; i++) {
    if (service.exitCode !== null) throw new Error(`Local worker exited: ${logs}`);
    try {
      const response = await fetch(`${origin}/api/snapper/status`, {
        signal: AbortSignal.timeout(500),
      });
      if (response.ok) {
        ready = true;
        break;
      }
    } catch {
      // Startup is asynchronous; retry connection failures until the deadline.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (!ready) throw new Error(`Local worker did not start: ${logs}`);
  const tests = spawn(process.execPath, ["--test", "worker/integration.test.mjs"], {
    cwd: root,
    env: { ...process.env, SNAPPER_TEST_ORIGIN: origin },
    stdio: "inherit",
  });
  process.exitCode = await new Promise((resolve) => tests.on("exit", (code) => resolve(code ?? 1)));
  if (process.exitCode) console.error(logs);
} finally {
  service.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => service.on("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, 2000)),
  ]);
  if (service.exitCode === null) service.kill("SIGKILL");
  await rm(storage, { recursive: true, force: true });
}
