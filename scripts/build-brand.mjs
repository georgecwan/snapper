import { readFile, writeFile, mkdir } from "node:fs/promises";
import { Resvg } from "@resvg/resvg-js";
import jpeg from "jpeg-js";
const publicDir = new URL("../public/", import.meta.url);
const icon = await readFile(new URL("favicon.svg", publicDir), "utf8");
await mkdir(new URL("__grok/", publicDir), { recursive: true });
for (const size of [180, 512]) {
  const rendered = new Resvg(icon, { fitTo: { mode: "width", value: size } }).render();
  await writeFile(new URL(`__grok/icon-${size}.png`, publicDir), rendered.asPng());
}
// Each aspect ratio has its own composition. The SVGs include outlined
// lettering, so CI and local builds never depend on installed system fonts.
for (const name of ["og", "x-banner"]) {
  const svg = await readFile(new URL(`${name}.svg`, publicDir), "utf8");
  const image = new Resvg(svg, {
    background: "#f8f7f3",
    font: { loadSystemFonts: false },
  }).render();
  const encoded = jpeg.encode(
    { data: image.pixels, width: image.width, height: image.height },
    90,
  ).data;
  if (encoded.byteLength > 600_000) {
    throw new Error(`${name}.jpg exceeds the 600 kB social image budget`);
  }
  await writeFile(new URL(`${name}.jpg`, publicDir), encoded);
}
