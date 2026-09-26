import { mkdir, readFile, writeFile } from "node:fs/promises";
import { renderInstallPageHtml, renderWebManifest } from "./grok-pwa-shared.mjs";
const directory = new URL("../dist/snapper/__grok/", import.meta.url);
await mkdir(directory, { recursive: true });
const manifest = JSON.parse(renderWebManifest("snapper.workers.dev"));
Object.assign(manifest, {
  name: "Snapper",
  short_name: "Snapper",
  theme_color: "#304ffe",
  background_color: "#fff9ee",
});
await writeFile(new URL("manifest.webmanifest", directory), JSON.stringify(manifest, null, 2));
const template = await readFile(new URL("./install-page.html", import.meta.url), "utf8");
await writeFile(
  new URL("install.html", directory),
  renderInstallPageHtml(template.replaceAll("{{APP_NAME}}", "Snapper"), { url: "/" }),
);
