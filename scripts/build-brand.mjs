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
const art = await readFile(new URL("og.svg", publicDir), "utf8");
for (const [name, svg] of [
  ["og.jpg", art],
  [
    "x-banner.jpg",
    art
      .replace('width="1200" height="630"', 'width="1500" height="330"')
      .replace('viewBox="0 0 1200 630"', 'viewBox="0 175 1200 264"'),
  ],
]) {
  const image = new Resvg(svg, { background: "#f8f7f3", font: { loadSystemFonts: true } }).render();
  await writeFile(
    new URL(name, publicDir),
    jpeg.encode({ data: image.pixels, width: image.width, height: image.height }, 86).data,
  );
}
