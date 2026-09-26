import { z } from "zod";
import { configSchema, DEFAULT_CONFIG, type SiteStatus } from "../src/snapper/protocol";
import {
  claims,
  configured,
  cookie,
  localDev,
  RateGuard,
  readJson,
  signToken,
  validOrigin,
  type AuthEnv,
} from "./security";
import { beginGitHubSignIn, completeGitHubSignIn } from "./oauth";
import { privateAssetPath } from "./question-packs";
export { Lobby } from "./lobby";

export interface Env extends AuthEnv {
  LOBBY: DurableObjectNamespace;
  ASSETS: Fetcher;
}
const guard = new RateGuard();
const nameSchema = z
  .string()
  .trim()
  .min(1)
  .max(32)
  .refine((v) =>
    [...v].every((character) => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127),
  );
const openSchema = z.object({ name: nameSchema }).strict();
const requestSchema = z
  .object({ name: nameSchema, role: z.enum(["player", "spectator"]) })
  .strict();
export function json(value: unknown, status = 200, headers?: HeadersInit): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...Object.fromEntries(new Headers(headers)),
    },
  });
}
function error(message: string, status = 400): Response {
  return json({ error: message }, status);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    // This precedes auth, installation-page routing, and every ASSETS fetch.
    // Pack contents are server-only even when the requester is the owner.
    if (privateAssetPath(url.pathname)) return error("Not found", 404);
    if (!url.pathname.startsWith("/api/snapper/")) {
      if (url.searchParams.get("install") === "1") {
        url.pathname = "/__grok/install.html";
        url.search = "";
        return env.ASSETS.fetch(new Request(url, request));
      }
      return env.ASSETS.fetch(request);
    }
    const path = url.pathname.slice("/api/snapper".length);
    const dev = localDev(request, env);
    const ready = configured(request, env);
    const who = ready ? await claims(request, env) : { owner: false, guest: null };
    if (request.method === "POST" || path === "/connect") {
      if (!validOrigin(request, env)) return error("This request did not come from Snapper.", 403);
    }
    if (!ready) {
      if (path === "/status" && request.method === "GET")
        return json({
          owner: false,
          ownerConfigured: false,
          devAuth: false,
          active: false,
          sessionId: null,
          config: DEFAULT_CONFIG,
          admission: "none",
          message: "Owner sign-in is not configured on this installation.",
        } satisfies SiteStatus);
      return error("Owner sign-in is not configured on this installation.", 503);
    }
    const ip = request.headers.get("CF-Connecting-IP") ?? "local";
    const rateIdentity =
      (path === "/status" || path === "/connect") && who.guest ? who.guest.pid : ip;
    const rateKey = `${path === "/status" ? "status" : path === "/connect" ? "connect" : "action"}:${rateIdentity}`;
    if (!guard.allow(rateKey, path === "/status" ? 120 : path === "/connect" ? 60 : 180, 60_000))
      return error("Please wait a moment before trying again.", 429);
    const stub = env.LOBBY.get(env.LOBBY.idFromName("main-lobby"));
    const call = (operation: string, input: Record<string, unknown> = {}) =>
      stub.fetch("https://lobby.internal/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ operation, owner: who.owner, guest: who.guest, ...input }),
      });
    try {
      if (path === "/status" && request.method === "GET") {
        const response = await call("status");
        const result = (await response.json()) as Omit<SiteStatus, "ownerConfigured" | "devAuth">;
        return json({ ...result, ownerConfigured: true, devAuth: dev }, response.status);
      }
      if (path === "/dev-owner" && request.method === "POST") {
        if (!dev) return error("Not found", 404);
        const token = await signToken(
          { kind: "owner", sub: "local-owner", exp: Math.floor(Date.now() / 1000) + 43_200 },
          env.SESSION_SECRET!,
        );
        return json({ ok: true }, 200, { "Set-Cookie": cookie("owner", token, true, 43_200) });
      }
      if (path === "/auth/github" && request.method === "GET") {
        if (dev) return error("Use local owner sign-in in the development environment.");
        return beginGitHubSignIn(env);
      }
      if (path === "/auth/github/callback" && request.method === "GET") {
        return completeGitHubSignIn(request, env);
      }
      if (path === "/logout" && request.method === "POST") {
        await call("logout");
        const headers = new Headers();
        headers.append("Set-Cookie", cookie("owner", "", dev, 0));
        headers.append("Set-Cookie", cookie("guest", "", dev, 0));
        headers.set("Content-Type", "application/json");
        headers.set("Cache-Control", "no-store");
        return new Response(JSON.stringify({ ok: true }), { headers });
      }
      if (path === "/open" && request.method === "POST") {
        if (!who.owner) return error("Only the owner can open a session.", 403);
        const parsed = openSchema.safeParse(await readJson(request));
        if (!parsed.success) return error("Enter a name between 1 and 32 characters.");
        const response = await call("open", parsed.data);
        if (!response.ok) return response;
        const result = (await response.json()) as { sid: string; pid: string };
        const signed = await signToken(
          {
            kind: "guest",
            sid: result.sid,
            pid: result.pid,
            exp: Math.floor(Date.now() / 1000) + 86_400,
          },
          env.SESSION_SECRET!,
        );
        return json({ ok: true }, 200, { "Set-Cookie": cookie("guest", signed, dev, 86_400) });
      }
      if (path === "/request" && request.method === "POST") {
        const parsed = requestSchema.safeParse(await readJson(request));
        if (!parsed.success)
          return error("Enter a name between 1 and 32 characters and choose player or spectator.");
        const response = await call("request", parsed.data);
        if (!response.ok) return response;
        const result = (await response.json()) as { sid: string; pid: string };
        const signed = await signToken(
          {
            kind: "guest",
            sid: result.sid,
            pid: result.pid,
            exp: Math.floor(Date.now() / 1000) + 86_400,
          },
          env.SESSION_SECRET!,
        );
        return json({ ok: true }, 200, { "Set-Cookie": cookie("guest", signed, dev, 86_400) });
      }
      if (path === "/config" && request.method === "POST") {
        if (!who.owner) return error("Only the owner can save settings.", 403);
        const input = await readJson(request);
        const wrapped = z.object({ config: configSchema }).strict().safeParse(input);
        const parsed = configSchema.safeParse(input);
        if (!wrapped.success && !parsed.success) return error("Those settings are invalid.");
        return call("config", { config: wrapped.success ? wrapped.data.config : parsed.data });
      }
      if (path === "/connect" && request.method === "GET") {
        if (!who.guest || request.headers.get("Upgrade")?.toLowerCase() !== "websocket")
          return error("Request approval before connecting.", 403);
        return stub.fetch("https://lobby.internal/connect", {
          headers: {
            Upgrade: "websocket",
            "X-Snapper-Session": who.guest.sid,
            "X-Snapper-Player": who.guest.pid,
            "X-Snapper-Owner": who.owner ? "true" : "false",
          },
        });
      }
      return error("Not found", 404);
    } catch (cause) {
      if (
        cause instanceof SyntaxError ||
        cause instanceof z.ZodError ||
        (cause instanceof Error &&
          /JSON request|Request is too large|body is required/.test(cause.message))
      )
        return error("The request could not be read. Please try again.");
      console.error(
        "Snapper request failed",
        cause instanceof Error ? cause.name : "Unknown error",
      );
      return error("Snapper is temporarily unavailable. Please try again shortly.", 503);
    }
  },
} satisfies ExportedHandler<Env>;
