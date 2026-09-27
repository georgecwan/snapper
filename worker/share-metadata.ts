import site from "../src/lib/og/site.json";

function escapeAttribute(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("'", "&#39;");
}

/** The request origin works on workers.dev and custom domains without a build-time hostname. */
function shareTags(request: Request): [string, string][] {
  const origin = new URL(request.url).origin;
  const image = new URL(`/og.jpg?v=${encodeURIComponent(site.imageVersion)}`, origin).href;
  const banner = new URL(`/x-banner.jpg?v=${encodeURIComponent(site.imageVersion)}`, origin).href;
  return [
    ["description", site.description],
    ["og:site_name", site.title],
    ["og:title", site.title],
    ["og:description", site.description],
    ["og:type", site.type],
    // There is one lobby. Never copy sign-in codes or tracking parameters into a share card.
    ["og:url", `${origin}/`],
    ["og:image", image],
    ["og:image:type", "image/jpeg"],
    ["og:image:width", "1200"],
    ["og:image:height", "630"],
    ["og:image:alt", site.imageAlt],
    ["twitter:card", "summary_large_image"],
    ["twitter:title", site.title],
    ["twitter:description", site.description],
    ["twitter:image", image],
    ["twitter:image:alt", site.imageAlt],
    ["x:game:image", banner],
    ["x:game:image:width", "1200"],
    ["x:game:image:height", "264"],
  ];
}

/** Supply crawlable HTML before React runs, preserving platform branding and PWA tags. */
export function withShareMetadata(request: Request, response: Response): Response {
  if (
    request.method !== "GET" ||
    response.status !== 200 ||
    response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "text/html"
  )
    return response;

  const tags = shareTags(request);
  const keys = new Set(tags.map(([key]) => key));
  const head = tags
    .map(([key, value]) => {
      const attribute = key.startsWith("og:") || key.startsWith("x:") ? "property" : "name";
      return `<meta ${attribute}="${key}" content="${escapeAttribute(value)}">`;
    })
    .join("");
  const canonical = escapeAttribute(`${new URL(request.url).origin}/`);
  const html = new Response(response.body, response);
  // Asset validators describe the unmodified file, not this origin-specific head.
  html.headers.delete("etag");
  html.headers.delete("content-length");
  html.headers.delete("last-modified");
  html.headers.set("cache-control", "no-cache");
  return new HTMLRewriter()
    .on("head meta", {
      element(element) {
        const key = element.getAttribute("property") ?? element.getAttribute("name") ?? "";
        if (keys.has(key.toLowerCase())) element.remove();
      },
    })
    .on('head link[rel="canonical"]', {
      element(element) {
        element.remove();
      },
    })
    .on("head", {
      element(element) {
        element.append(`${head}<link rel="canonical" href="${canonical}">`, { html: true });
      },
    })
    .transform(html);
}
