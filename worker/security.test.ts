import test from "node:test";
import assert from "node:assert/strict";
import {
  claims,
  configured,
  cookie,
  cookieName,
  localDev,
  pkceChallenge,
  RateGuard,
  readCookie,
  readJson,
  signToken,
  validOrigin,
  verifyToken,
} from "./security.ts";

const secret = "test-signing-key-with-more-than-thirty-two-characters";
const production = {
  ENVIRONMENT: "production",
  APP_ORIGIN: "https://snapper.example",
  GITHUB_CLIENT_ID: "client",
  GITHUB_CLIENT_SECRET: "client-secret",
  OWNER_GITHUB_ID: "1234",
  SESSION_SECRET: secret,
};
const local = {
  ENVIRONMENT: "local",
  DEV_AUTH: "true",
  APP_ORIGIN: "http://127.0.0.1:8080",
  SESSION_SECRET: secret,
};
const request = (url: string, headers?: HeadersInit) => new Request(url, { headers });

test("production refuses missing or development credentials", () => {
  const req = request("https://snapper.example/api/snapper/status");
  assert.equal(configured(req, production), true);
  for (const field of [
    "GITHUB_CLIENT_ID",
    "GITHUB_CLIENT_SECRET",
    "OWNER_GITHUB_ID",
    "SESSION_SECRET",
    "APP_ORIGIN",
  ] as const)
    assert.equal(configured(req, { ...production, [field]: undefined }), false, field);
  assert.equal(configured(req, { ...production, DEV_AUTH: "true" }), false);
  assert.equal(configured(req, { ...production, ENVIRONMENT: "local" }), false);
  assert.equal(configured(req, { ...production, APP_ORIGIN: "http://snapper.example" }), false);
  assert.equal(configured(req, { ...production, SESSION_SECRET: "short" }), false);
  assert.equal(
    configured(req, {
      ...production,
      SESSION_SECRET: "snapper-local-development-only-secret-not-for-production",
    }),
    false,
  );
});

test("development owner access requires explicit local environment and loopback URL", () => {
  assert.equal(localDev(request("http://127.0.0.1:8787/api/snapper/dev-owner"), local), true);
  assert.equal(localDev(request("http://localhost:8787/api/snapper/dev-owner"), local), true);
  assert.equal(localDev(request("https://snapper.example/api/snapper/dev-owner"), local), false);
  assert.equal(
    localDev(request("http://127.0.0.1/api/snapper/dev-owner"), {
      ...local,
      ENVIRONMENT: "production",
    }),
    false,
  );
  assert.equal(
    localDev(request("http://127.0.0.1/api/snapper/dev-owner"), {
      ...local,
      APP_ORIGIN: "https://snapper.example",
    }),
    false,
  );
});

test("state-changing origins must match the configured origin exactly", () => {
  assert.equal(
    validOrigin(
      request("https://snapper.example/api/snapper/open", { Origin: production.APP_ORIGIN }),
      production,
    ),
    true,
  );
  for (const origin of [
    "https://evil.example",
    "null",
    "https://snapper.example.evil.test",
    "http://snapper.example",
  ])
    assert.equal(
      validOrigin(
        request("https://snapper.example/api/snapper/open", { Origin: origin }),
        production,
      ),
      false,
    );
  assert.equal(validOrigin(request("https://snapper.example/api/snapper/open"), production), false);
});

test("signed identities reject tampering, wrong secrets, expiry and ambiguous encodings", async () => {
  const token = await signToken(
    { kind: "guest", sid: "session-1", pid: "player-1", exp: 2000 },
    secret,
  );
  assert.deepEqual(await verifyToken(token, secret, 1_000_000), {
    kind: "guest",
    sid: "session-1",
    pid: "player-1",
    exp: 2000,
  });
  assert.equal(await verifyToken(token, `${secret}x`, 1_000_000), null);
  assert.equal(await verifyToken(token, secret, 2_000_000), null);
  const parts = token.split(".");
  parts[1] = Buffer.from(JSON.stringify({ kind: "owner", sub: "1234", exp: 2000 })).toString(
    "base64url",
  );
  assert.equal(await verifyToken(parts.join("."), secret, 1_000_000), null);
  assert.equal(await verifyToken(`${token}.extra`, secret, 1_000_000), null);
  assert.equal(await verifyToken("x".repeat(5000), secret), null);
});

test("owner identity must match the fixed provider subject, not merely a signed login", async () => {
  const owner = await signToken(
    { kind: "owner", sub: "9999", exp: Math.floor(Date.now() / 1000) + 60 },
    secret,
  );
  assert.equal(
    (
      await claims(
        request("https://snapper.example", { Cookie: `${cookieName("owner", false)}=${owner}` }),
        production,
      )
    ).owner,
    false,
  );
  const correct = await signToken(
    { kind: "owner", sub: "1234", exp: Math.floor(Date.now() / 1000) + 60 },
    secret,
  );
  assert.equal(
    (
      await claims(
        request("https://snapper.example", { Cookie: `${cookieName("owner", false)}=${correct}` }),
        production,
      )
    ).owner,
    true,
  );
  assert.equal(
    (
      await claims(
        request("https://snapper.example", { Cookie: `snapper_owner=${correct}` }),
        production,
      )
    ).owner,
    false,
  );
});

test("production cookies protect transport and scripts; duplicates fail closed", () => {
  const value = cookie("owner", "signed", false, 60);
  assert.match(value, /^__Host-snapper_owner=/);
  assert.match(value, /; Secure/);
  assert.match(value, /; HttpOnly/);
  assert.match(value, /; SameSite=Lax/);
  assert.doesNotMatch(value, /Domain=/);
  const req = request("https://snapper.example", {
    Cookie: "__Host-snapper_owner=a; __Host-snapper_owner=b",
  });
  assert.equal(readCookie(req, "__Host-snapper_owner"), undefined);
});

test("PKCE uses the standard S256 transformation", async () => {
  assert.equal(
    await pkceChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
    "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
  );
});

test("request guards bound message size without trusting Content-Length", async () => {
  await assert.rejects(
    () =>
      readJson(
        new Request("https://snapper.example", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: "a".repeat(9000) }),
        }),
      ),
    /too large/,
  );
  await assert.rejects(
    () => readJson(new Request("https://snapper.example", { method: "POST", body: "{}" })),
    /JSON/,
  );
  assert.deepEqual(
    await readJson(
      new Request("https://snapper.example", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: '{"name":"Alice"}',
      }),
    ),
    { name: "Alice" },
  );
});

test("per-client rate windows reject bursts and recover at the window boundary", () => {
  const guard = new RateGuard();
  assert.equal(guard.allow("alice", 2, 1000, 100), true);
  assert.equal(guard.allow("alice", 2, 1000, 101), true);
  assert.equal(guard.allow("alice", 2, 1000, 102), false);
  assert.equal(guard.allow("bob", 2, 1000, 102), true);
  assert.equal(guard.allow("alice", 2, 1000, 1100), true);
});
