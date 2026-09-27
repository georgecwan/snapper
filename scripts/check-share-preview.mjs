import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import jpeg from "jpeg-js";

// Check the real built Worker response as a crawler: no cookies or JavaScript.
const origin = new URL(process.argv[2] ?? "http://127.0.0.1:8081").origin;
const site = JSON.parse(await readFile(new URL("../src/lib/og/site.json", import.meta.url)));
const read = (path, options) =>
  fetch(new URL(path, origin), { signal: AbortSignal.timeout(10_000), ...options });
const decode = (value) =>
  value.replaceAll("&quot;", '"').replaceAll("&#39;", "'").replaceAll("&amp;", "&");
const agents = [
  "facebookexternalhit/1.1",
  "Twitterbot/1.0",
  "Discordbot/2.0",
  "Slackbot-LinkExpanding 1.0",
];

for (const agent of agents) {
  const response = await read("/?ref=shared&auth_error=private-value", {
    headers: {
      "User-Agent": agent,
      Accept: "*/*",
      "X-Forwarded-Host": "untrusted.example",
    },
  });
  assert.equal(response.status, 200, agent);
  assert.match(response.headers.get("content-type"), /text\/html/);
  assert.equal(response.headers.get("set-cookie"), null);
  const html = await response.text();
  const head = html.match(/<head\b[^>]*>([\s\S]*?)<\/head>/i)?.[1];
  assert.ok(head, "The card must be in the initial HTML head");
  const metadata = new Map();
  for (const match of head.matchAll(/<meta\b[^>]*>/gi)) {
    const key = match[0].match(/(?:property|name)="([^"]+)"/i)?.[1];
    const value = match[0].match(/content="([^"]*)"/i)?.[1];
    if (!key || value === undefined) continue;
    assert.ok(!metadata.has(key), `Duplicate metadata: ${key}`);
    metadata.set(key, decode(value));
  }
  for (const key of ["og:title", "twitter:title", "og:site_name"])
    assert.equal(metadata.get(key), site.title, key);
  for (const key of ["description", "og:description", "twitter:description"])
    assert.equal(metadata.get(key), site.description, key);
  assert.equal(metadata.get("og:url"), `${origin}/`);
  assert.equal(metadata.get("og:type"), "x:game");
  assert.equal(metadata.get("twitter:card"), "summary_large_image");
  assert.equal(metadata.get("og:image:type"), "image/jpeg");
  assert.equal(metadata.get("og:image:alt"), site.imageAlt);
  assert.equal(metadata.get("twitter:image:alt"), site.imageAlt);
  assert.equal(metadata.get("twitter:image"), metadata.get("og:image"));
  assert.ok(head.includes(`<link rel="canonical" href="${origin}/">`));
  assert.doesNotMatch(head, /private-value|untrusted\.example/);
  assert.match(head, /grok-app-builder\/extensions\.js/);
  assert.match(head, /__grok\/manifest\.webmanifest/);

  for (const [key, filename, width, height] of [
    ["og:image", "og.jpg", 1200, 630],
    ["x:game:image", "x-banner.jpg", 1200, 264],
  ]) {
    const url = new URL(metadata.get(key));
    assert.equal(url.origin, origin);
    assert.equal(url.pathname, `/${filename}`);
    assert.equal(url.searchParams.get("v"), site.imageVersion);
    assert.equal(metadata.get(`${key}:width`), String(width));
    assert.equal(metadata.get(`${key}:height`), String(height));
    const image = await read(url);
    assert.equal(image.status, 200);
    assert.match(image.headers.get("content-type"), /^image\/jpeg/);
    const data = Buffer.from(await image.arrayBuffer());
    assert.ok(data.length < 600 * 1024, "Keep card downloads lightweight");
    assert.deepEqual(data, await readFile(new URL(`../public/${filename}`, import.meta.url)));
    const decoded = jpeg.decode(data, { maxResolutionInMP: 2 });
    assert.equal(decoded.width, width);
    assert.equal(decoded.height, height);
  }
}

const status = await read("/api/snapper/status");
assert.equal(status.status, 200);
assert.match(status.headers.get("content-type"), /application\/json/);
for (const path of [
  "/_question-packs/manifest.json",
  "/%5fquestion-packs/manifest.json?install=1",
]) {
  const response = await read(path);
  assert.equal(response.status, 404, "Private answer packs must remain inaccessible");
}
const tutorial = await read("/?install=1&platform=ios");
assert.equal(tutorial.status, 200);
assert.match(await tutorial.text(), /__grok\/install\//);
console.log(
  "Share preview passed: four crawlers, unique metadata, current JPEGs and dimensions, preserved PWA, API and private-asset boundaries.",
);
