# Snapper implementation guide

This file supplements the authoritative [product design](product-design.md).
The architecture audit describes the old Lectern prototype and migration
reasoning; it is not a description of the active runtime.

## Runtime and ownership

- `src/snapper/client.tsx`: static React entry, minimal TanStack router, retained
  AuthProvider and PreviewHostBridge. `src/components/snapper/` contains the UI.
- `src/snapper/protocol.ts`: validated configuration/commands and public views.
  Import types here in UI; **never import bank, catalog or engine into UI**.
- `src/snapper/engine.ts`: deterministic session state machine. The server passes
  timestamps and selected content in; no browser is authoritative for rules.
- `src/snapper/judge.ts`: authored aliases, explicit clarifications and conservative
  typo tolerance. Ordered answers require every item in order.
- `src/snapper/catalog.ts`: filtered format selection, source adapters and
  normalized-content identity. Live content is never committed to the repository.
- `src/snapper/bank.ts`: original fallback questions plus the original 35 tossups
  in `src/game/questions.ts`. The old bank is now imported only into the Worker.
- `worker/index.ts`: public HTTP boundary, GitHub OAuth and guest cookies.
- `worker/oauth.ts`: GitHub authorization/callback flow, with mocked-provider
  regressions covering success, identity mismatch, invalid state and outages.
- `worker/lobby.ts`: the singleton `main-lobby` Durable Object, admission,
  WebSocket identity and serialization, timers, storage, cleanup and projection.
- `worker/security.ts`: signed identities, owner allowlist, origin/size/rate checks.
- `wrangler.jsonc`: SQLite Durable Object and static asset bindings. The local
  environment has an explicit development identity shortcut; production refuses
  missing credentials and never accepts this shortcut.

Presence uses WebSocket close/error events and a 20-second automatic heartbeat.
A silently broken connection is expired after 90 seconds. There is no additional
seat reservation once a disconnect is detected. The newest tab takes over
atomically, so closing its predecessor does not release the replacement seat.

The Durable Object stores `config` separately from `session`. The latter contains
only current-session identity, chat, approvals, scores, question history and
private content. It is deleted when the session closes or the final connected
player disappears. Spectators do not retain it. Provider recovery history may
outlive live deletion, as approved by the owner.

The playing owner's browser receives the same unrevealed-content protection as
other browsers. Public question IDs do not disclose source IDs or answer words.
The server sends only the revealed question prefix and retains full answer rules.

## Development and build

Use Node.js 24 (the version in `.nvmrc`); Node.js 22.18 or newer is required.
`npm ci` installs the exact lockfile dependencies. `npm run dev` uses the existing
app-environment wrapper to launch Vite on 8080 and a local Cloudflare emulator on
8787. `startup.sh` is idempotent and starts the same command in the background.
Use the local owner button only on a loopback origin. The Vite API/WebSocket
proxy checks the actual connection address as well as the Worker’s origin checks;
network clients cannot use the public development key by forging Host/Origin. No production account or
external database is required for local development.

`npm run build` creates `dist/snapper`, including generated PWA manifest and
installation tutorial. `npm run check:worker` packages the Worker in dry-run mode.
`npm run preview:restart` serves the built assets and actual Worker together on
8081 with isolated preview storage; `npm run preview:stop` stops that process.

`npm run typecheck` checks both frontend and Worker targets.
`npm run lint:snapper` checks the active Snapper runtime and new tooling with
zero warnings allowed. The original template-wide lint command remains available.
`npm run test:snapper` checks deterministic game rules, judging, content and
security. `npm run test:integration` starts an isolated local Worker, exercises real
WebSockets with 32 participants, and removes its temporary storage afterward.

The original Vite configuration's TanStack Start/Nitro path remains available as
`npm run build:legacy`. Snapper's explicit Vite `snapper` mode uses static assets,
keeps the PWA/branding plugin, and does not initialize PostgreSQL or PGLite.
The old `/api/rtc` route has been retired. Existing platform helpers remain intact.
`vercel.json` disables automatic Git deployments to the retired Vercel target.
Cloudflare Workers Builds is the preferred deployment flow: once the owner connects
GitHub, pushes to `main` build and deploy automatically. The agent has not configured
that account connection. `keep_vars: true` preserves dashboard-managed runtime
values on subsequent deployments; secrets are also retained.

## Question content

The fallback pack contains 35 long tossups, 96 short atoms, 24 authored related
four-part groups, eight sequences and eight four-clue questions. Short atoms are
shared by standalone, Assigned, Shootout, Open and Team formats; the content
identity prevents repeating them through a different format in the same session.
All fallback content is initially rated medium. Narrow filters or larger blocks
can exhaust the pack quickly; that pauses play instead of changing filters.

Live tossups use QB Reader. Its complex answerlines are rejected unless this
adapter can represent them safely. Live short questions use Open Trivia DB;
only suitable self-contained multiple-choice prompts are adapted to typed
answers. Choice-dependent/negative prompts are discarded. Source attribution is
shown on reveal. Open Trivia DB adaptations retain CC BY-SA attribution.
Timeouts, failures and absent format coverage use the original fallback pack.

Adding content: author QuestionAtoms with stable text, accurate category and
language, a reviewed canonical answer, useful explicit aliases, and provenance.
Use `promptAliases` only when asking for clarification is meaningful. Sequences
need `orderedItems`; clues need four authored clues. Tossup `powerAt` is a
**visible character offset**, not a word count. Keep all answer keys server-only.

## Deployment setup still required

For the full account/sign-in walkthrough and quota table, use
[Cloudflare setup](cloudflare-setup.md).

Use **Cloudflare Workers Free only** with a SQLite Durable Object. Do not upgrade
the account to Workers Paid or add a paid service: the no-spend guarantee depends
on Free-plan enforced quotas, not on application rate limits. Recheck the linked
provider terms in the audit before deploying. Rate limits and owner approval
reduce unwanted use but rejected requests still consume some quota.

1. In a Cloudflare **Workers Free** account, import `georgecwan/snapper` from
   GitHub as a Worker named `snapper`. Use production branch `main`, build command
   `npm run build`, deploy command `npx wrangler deploy --env ''`, repository root,
   Node.js 24, and disable non-production branch builds. The first deployment can
   show the closed lobby before authentication is configured. Use the provided
   `workers.dev` address; a purchased domain is unnecessary.
2. Register a GitHub OAuth app for that URL with callback
   `/api/snapper/auth/github/callback`. Guests do not need GitHub accounts.
3. Set these text values under the Worker's **Settings → Variables and Secrets**:
   `APP_ORIGIN` to the exact HTTPS origin, `GITHUB_CLIENT_ID`,
   and `OWNER_GITHUB_ID` to the owner's immutable numeric GitHub account ID.
4. In the same runtime settings screen, add `SESSION_SECRET` (at least 32 random
   characters) and `GITHUB_CLIENT_SECRET` with type **Secret**, then deploy the
   settings. Never commit real secrets or
   copy the local development secret into production.
5. Set `VITE_PUBLIC_HOSTNAME` under **Settings → Builds → Build variables and
   secrets** to the production hostname for absolute share-image metadata. Build
   variables do not configure runtime authentication. Future `main` pushes deploy
   automatically. Manual `npm run deploy` remains available to an authenticated
   developer, but local Wrangler login is unnecessary for the dashboard flow.
   **Never deploy `--env local`.**
6. Verify the real GitHub redirect, owner allowlist, two remote browsers, WebSocket
   reconnects, cleanup and provider fetches on the deployed origin.

The [Cloudflare pricing documentation](https://developers.cloudflare.com/durable-objects/platform/pricing/)
was rechecked on 2026-09-26: Workers Free supports SQLite Durable Objects and
rejects operations beyond its free limits. This guarantee depends on retaining
the Free account plan. The local Wrangler session is currently unauthenticated.

Production OAuth, geographic latency and real Free-plan usage cannot be verified
by the local emulator. No production deployment has been performed yet.

## Verification log

Verified locally on 2026-09-25/26:

- `npm run build` and frontend/Worker `npm run typecheck` pass.
- `npm test`: 66 passing tests for all formats, timings, judging, equality of team
  opportunities, score correction, participant recovery, content and security.
- `npm run test:integration`: real local Worker with 16 players and 16 spectators;
  verifies admission/role boundaries, concurrent buzzing, duplicate and stale
  commands, tab takeover, capacity waiting, spectator seat claims, restored
  identity, configuration recovery/persistence and last-player teardown.
- Final release review also verified team capacity after a mode switch, bounded
  live-question batch requests, source/packet attribution, expired owner-cookie
  recovery and OAuth provider failure handling. `npm run lint:snapper` passes
  with zero warnings.
- `npm run check:worker`: production Worker/static-asset packaging dry run passes.
- Desktop (1280×800) and mobile (390×844) browser checks show real content without
  horizontal overflow or uncaught console errors. Dev screenshots and verdicts
  are in ignored `screenshots/snapper-release-dev*`; built checks use `snapper-release-built*`
  and match the development baseline. Brand-asset checks also pass.
- Interactive browser checks verified owner opening, settings, a correct typed
  answer and score, chat, challenge hold/resolution, current-question correction,
  mobile answer entry, score-tab navigation and successful logout. A logout race
  and mobile buzzer reachability issue found during QA were fixed and rechecked.
  Approved defaults were restored and the temporary test session was cleared.
- Final browser regressions verified that a moderator confirmation opened on a
  previous question is rejected after automatic advancement, leaving the newer
  question intact. Sign-in error text is escaped, and dismissing it clears its
  URL parameter. The built-preview test session was ended afterward.
- Small live API probes produced usable questions from both free providers.
  QB Reader had one transient fetch failure before successful probes; the adapter
  rejects complex answerlines and has tested fallback behavior.
- A local-network negative probe verified that the development API proxy rejects
  non-loopback connections even with forged Host/Origin headers.
- Compiled client assets were checked for bundled answer-bank text and server
  credentials; neither was present. An independent review checked Worker role
  validation, projection, recovery and socket replacement.

Live GitHub authentication and hosting have **not** been verified: deployment
credentials and a chosen Cloudflare Free account are still required. Browser QA
used Chromium and responsive viewport emulation; physical iPhone/Android keyboard
behavior and Safari/Firefox should be checked in the first real game night.
The inherited template checks are retained separately as `test:template`; their
pre-existing fixture failures are documented in the historical audit and are not
reported as passing by this verification log.
