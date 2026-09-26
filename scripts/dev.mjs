import { spawn } from "node:child_process";
const bin = (name) => new URL(`../node_modules/.bin/${name}`, import.meta.url).pathname;
const children = [];
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill("SIGTERM");
  setTimeout(() => process.exit(code), 250).unref();
}
for (const signal of ["SIGTERM", "SIGINT"]) process.on(signal, () => stop());
const worker = spawn(
  bin("wrangler"),
  [
    "dev",
    "--env",
    "local",
    "--assets",
    "public",
    "--ip",
    "127.0.0.1",
    "--port",
    "8787",
    "--show-interactive-dev-session=false",
  ],
  { stdio: "inherit" },
);
children.push(worker);
worker.on("exit", (code) => stop(code ?? 1));
let ready = false;
for (let count = 0; count < 120 && !stopping; count++) {
  try {
    const response = await fetch("http://127.0.0.1:8787/api/snapper/status", {
      signal: AbortSignal.timeout(500),
    });
    if (response.ok) {
      ready = true;
      break;
    }
  } catch {
    // The emulator may not be listening yet; retry until the startup deadline.
  }
  await new Promise((resolve) => setTimeout(resolve, 250));
}
if (!ready) {
  console.error("The local Snapper service did not start.");
  stop(1);
} else {
  const client = spawn(
    bin("vite"),
    ["dev", "--mode", "snapper", "--host", "0.0.0.0", "--port", "8080"],
    { stdio: "inherit" },
  );
  children.push(client);
  client.on("exit", (code) => stop(code ?? 1));
}
