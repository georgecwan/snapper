import test from "node:test";
import assert from "node:assert/strict";
import { beginGitHubSignIn, completeGitHubSignIn } from "./oauth.ts";
import { pkceChallenge, signToken, verifyToken, type AuthEnv } from "./security.ts";

const env: AuthEnv = {
  ENVIRONMENT: "production",
  APP_ORIGIN: "https://snapper.example",
  GITHUB_CLIENT_ID: "test-client",
  GITHUB_CLIENT_SECRET: "test-provider-secret",
  OWNER_GITHUB_ID: "1234",
  SESSION_SECRET: "oauth-test-signing-secret-longer-than-thirty-two-characters",
};
const state = "test-state-with-enough-random-length";
const verifier = "test-verifier-with-at-least-thirty-two-characters";

function cookieValue(response: Response, name: string): string | undefined {
  return response.headers
    .getSetCookie()
    .find((value) => value.startsWith(`${name}=`))
    ?.split(";")[0]
    ?.slice(name.length + 1);
}
async function callback(
  overrides: { state?: string; code?: string; exp?: number } = {},
): Promise<Request> {
  const token = await signToken(
    { kind: "oauth", state, verifier, exp: overrides.exp ?? Math.floor(Date.now() / 1000) + 600 },
    env.SESSION_SECRET!,
  );
  const url = new URL("/api/snapper/auth/github/callback", env.APP_ORIGIN);
  url.searchParams.set("state", overrides.state ?? state);
  url.searchParams.set("code", overrides.code ?? "one-time-code");
  return new Request(url, { headers: { Cookie: `__Host-snapper_oauth=${token}` } });
}
function failed(response: Response, message: RegExp): void {
  assert.equal(response.status, 302);
  const target = new URL(response.headers.get("Location")!, env.APP_ORIGIN);
  assert.equal(target.pathname, "/");
  assert.match(target.searchParams.get("authError")!, message);
  assert.equal(cookieValue(response, "__Host-snapper_owner"), undefined);
  assert.equal(cookieValue(response, "__Host-snapper_oauth"), "");
  assert.match(response.headers.get("Set-Cookie")!, /Max-Age=0/);
}

test("GitHub authorization binds a signed state cookie to its S256 challenge", async () => {
  const response = await beginGitHubSignIn(env);
  assert.equal(response.status, 302);
  const url = new URL(response.headers.get("Location")!);
  assert.equal(url.origin, "https://github.com");
  assert.equal(url.pathname, "/login/oauth/authorize");
  assert.equal(url.searchParams.get("client_id"), env.GITHUB_CLIENT_ID);
  assert.equal(
    url.searchParams.get("redirect_uri"),
    `${env.APP_ORIGIN}/api/snapper/auth/github/callback`,
  );
  assert.equal(url.searchParams.get("scope"), null);
  const token = await verifyToken(
    cookieValue(response, "__Host-snapper_oauth"),
    env.SESSION_SECRET,
  );
  assert.equal(token?.kind, "oauth");
  if (token?.kind !== "oauth") throw new Error("Expected OAuth state");
  assert.equal(url.searchParams.get("state"), token.state);
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.equal(url.searchParams.get("code_challenge"), await pkceChallenge(token.verifier));
});

test("OAuth callback exchanges the verifier and checks the immutable owner identity", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetcher = (async (input, init) => {
    calls.push({ url: String(input), init });
    return Response.json(
      calls.length === 1
        ? { access_token: "provider-token" }
        : { id: 1234, login: "renamed-owner" },
    );
  }) as typeof fetch;
  const response = await completeGitHubSignIn(await callback(), env, fetcher);
  assert.equal(response.status, 302);
  assert.equal(response.headers.get("Location"), "/");
  assert.equal(calls[0]?.url, "https://github.com/login/oauth/access_token");
  assert.equal(calls[0]?.init?.method, "POST");
  assert.deepEqual(JSON.parse(String(calls[0]?.init?.body)), {
    client_id: env.GITHUB_CLIENT_ID,
    client_secret: env.GITHUB_CLIENT_SECRET,
    code: "one-time-code",
    code_verifier: verifier,
    redirect_uri: `${env.APP_ORIGIN}/api/snapper/auth/github/callback`,
  });
  assert.equal(calls[1]?.url, "https://api.github.com/user");
  assert.equal(new Headers(calls[1]?.init?.headers).get("Authorization"), "Bearer provider-token");
  const token = await verifyToken(
    cookieValue(response, "__Host-snapper_owner"),
    env.SESSION_SECRET,
  );
  assert.equal(token?.kind, "owner");
  if (token?.kind !== "owner") throw new Error("Expected owner identity");
  assert.equal(token.sub, "1234");
  assert.equal(cookieValue(response, "__Host-snapper_oauth"), "");
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.equal(response.headers.get("Referrer-Policy"), "no-referrer");
});

test("OAuth rejects invalid state, missing code, expired and missing cookies before provider calls", async () => {
  const fetcher = (async () => {
    throw new Error("Provider must not be called");
  }) as typeof fetch;
  const requests = [
    await callback({ state: "wrong-state" }),
    await callback({ code: "" }),
    await callback({ exp: 1 }),
    new Request(`${env.APP_ORIGIN}/api/snapper/auth/github/callback?state=${state}&code=code`),
  ];
  for (const request of requests)
    failed(await completeGitHubSignIn(request, env, fetcher), /expired/);
});

test("OAuth never grants ownership to a different GitHub numeric ID", async () => {
  let calls = 0;
  const fetcher = (async () =>
    Response.json(
      ++calls === 1 ? { access_token: "provider-token" } : { id: 9999, login: "owner" },
    )) as typeof fetch;
  failed(await completeGitHubSignIn(await callback(), env, fetcher), /not the owner/);
});

test("GitHub rejects an invalid authorization code without issuing an owner cookie", async () => {
  let calls = 0;
  const fetcher = (async () => {
    calls++;
    return Response.json({ error: "bad_verification_code" }, { status: 400 });
  }) as typeof fetch;
  failed(await completeGitHubSignIn(await callback(), env, fetcher), /unsuccessful/);
  assert.equal(calls, 1);
});

test("GitHub transport and malformed responses clear OAuth state and return to the app", async () => {
  const fetchers = [
    (async () => {
      throw new Error("network failure");
    }) as typeof fetch,
    (async () => new Response("upstream unavailable", { status: 502 })) as typeof fetch,
  ];
  for (const fetcher of fetchers)
    failed(await completeGitHubSignIn(await callback(), env, fetcher), /could not be reached/);
  let calls = 0;
  const identityFailure = (async () =>
    ++calls === 1
      ? Response.json({ access_token: "provider-token" })
      : new Response("upstream unavailable", { status: 502 })) as typeof fetch;
  failed(
    await completeGitHubSignIn(await callback(), env, identityFailure),
    /could not be reached/,
  );
});
