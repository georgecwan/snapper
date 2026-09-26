import { z } from "zod";

export interface AuthEnv {
  SESSION_SECRET?: string;
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
  OWNER_GITHUB_ID?: string;
  APP_ORIGIN?: string;
  DEV_AUTH?: string;
  ENVIRONMENT?: string;
}

const tokenSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("owner"), sub: z.string().min(1), exp: z.number().int() }).strict(),
  z
    .object({
      kind: z.literal("guest"),
      sid: z.string().min(1),
      pid: z.string().min(1),
      exp: z.number().int(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("oauth"),
      state: z.string().min(20),
      verifier: z.string().min(32),
      exp: z.number().int(),
    })
    .strict(),
]);
export type Token = z.infer<typeof tokenSchema>;
export type GuestToken = Extract<Token, { kind: "guest" }>;
const encoder = new TextEncoder();

export function loopback(host: string): boolean {
  return host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host === "::1";
}

export function localDev(request: Request, env: AuthEnv): boolean {
  if (env.ENVIRONMENT !== "local" || env.DEV_AUTH !== "true") return false;
  try {
    return (
      loopback(new URL(request.url).hostname) && loopback(new URL(env.APP_ORIGIN ?? "").hostname)
    );
  } catch {
    return false;
  }
}

export function configured(request: Request, env: AuthEnv): boolean {
  if (!env.SESSION_SECRET || env.SESSION_SECRET.length < 32) return false;
  if (localDev(request, env)) return true;
  if (env.SESSION_SECRET === "snapper-local-development-only-secret-not-for-production")
    return false;
  try {
    const origin = new URL(env.APP_ORIGIN ?? "");
    return (
      env.ENVIRONMENT !== "local" &&
      env.DEV_AUTH !== "true" &&
      origin.protocol === "https:" &&
      !loopback(origin.hostname) &&
      Boolean(
        env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET && /^\d+$/.test(env.OWNER_GITHUB_ID ?? ""),
      )
    );
  } catch {
    return false;
  }
}

export function validOrigin(request: Request, env: AuthEnv): boolean {
  const origin = request.headers.get("Origin");
  if (!origin || origin === "null") return false;
  try {
    return origin === new URL(env.APP_ORIGIN ?? "").origin;
  } catch {
    return false;
  }
}

function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function decode(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("Invalid encoding");
  return Uint8Array.from(atob(value.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
}

async function key(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

export async function signToken(token: Token, secret: string): Promise<string> {
  if (secret.length < 32) throw new Error("Session signing is not configured");
  const body = base64url(encoder.encode(JSON.stringify(tokenSchema.parse(token))));
  const payload = `v1.${body}`;
  return `${payload}.${base64url(new Uint8Array(await crypto.subtle.sign("HMAC", await key(secret), encoder.encode(payload))))}`;
}

export async function verifyToken(
  raw: string | undefined,
  secret: string | undefined,
  now = Date.now(),
): Promise<Token | null> {
  if (!raw || raw.length > 4096 || !secret || secret.length < 32) return null;
  try {
    const [version, body, signature, extra] = raw.split(".");
    if (version !== "v1" || !body || !signature || extra !== undefined) return null;
    if (
      !(await crypto.subtle.verify(
        "HMAC",
        await key(secret),
        decode(signature),
        encoder.encode(`${version}.${body}`),
      ))
    )
      return null;
    const parsed = tokenSchema.safeParse(JSON.parse(new TextDecoder().decode(decode(body))));
    return parsed.success && parsed.data.exp > Math.floor(now / 1000) ? parsed.data : null;
  } catch {
    return null;
  }
}

export function cookieName(kind: Token["kind"], dev: boolean): string {
  return `${dev ? "" : "__Host-"}snapper_${kind}`;
}

export function readCookie(request: Request, name: string): string | undefined {
  const matches = (request.headers.get("Cookie") ?? "")
    .split(";")
    .map((v) => v.trim())
    .filter((v) => v.startsWith(`${name}=`));
  return matches.length === 1 ? matches[0]!.slice(name.length + 1) : undefined;
}

export function cookie(kind: Token["kind"], value: string, dev: boolean, maxAge: number): string {
  return `${cookieName(kind, dev)}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${dev ? "" : "; Secure"}`;
}

export async function claims(
  request: Request,
  env: AuthEnv,
): Promise<{ owner: boolean; guest: GuestToken | null }> {
  const dev = localDev(request, env);
  const owner = await verifyToken(
    readCookie(request, cookieName("owner", dev)),
    env.SESSION_SECRET,
  );
  const guest = await verifyToken(
    readCookie(request, cookieName("guest", dev)),
    env.SESSION_SECRET,
  );
  return {
    owner: owner?.kind === "owner" && owner.sub === (dev ? "local-owner" : env.OWNER_GITHUB_ID),
    guest: guest?.kind === "guest" ? guest : null,
  };
}

export function randomToken(): string {
  return base64url(crypto.getRandomValues(new Uint8Array(32)));
}

export async function pkceChallenge(verifier: string): Promise<string> {
  return base64url(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(verifier))));
}

/** A small bounded guard before expensive work. The DO enforces per-identity limits too. */
export class RateGuard {
  private entries = new Map<string, { count: number; until: number }>();
  allow(id: string, limit: number, period: number, now = Date.now()): boolean {
    let entry = this.entries.get(id);
    if (!entry || entry.until <= now) {
      if (this.entries.size >= 2048) {
        for (const [key, value] of this.entries) if (value.until <= now) this.entries.delete(key);
        if (this.entries.size >= 2048) return false;
      }
      entry = { count: 0, until: now + period };
      this.entries.set(id, entry);
    }
    entry.count++;
    return entry.count <= limit;
  }
}

export async function readJson(request: Request): Promise<unknown> {
  if (!(request.headers.get("Content-Type") ?? "").toLowerCase().startsWith("application/json"))
    throw new Error("Use a JSON request");
  if (Number(request.headers.get("Content-Length") ?? 0) > 8192)
    throw new Error("Request is too large");
  const reader = request.body?.getReader();
  if (!reader) throw new Error("A request body is required");
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const item = await reader.read();
    if (item.done) break;
    size += item.value.byteLength;
    if (size > 8192) {
      await reader.cancel();
      throw new Error("Request is too large");
    }
    chunks.push(item.value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}
