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
  normalized-content identity. Live fetches are session-only; explicit licensed
  offline imports are maintained separately under `data/`.
- `src/snapper/bank.ts`: original fallback questions plus the original 35 tossups
  in `src/game/questions.ts`. The old bank is now imported only into the Worker.
- `worker/question-packs.ts`: bounded private asset loader, category/rating filters,
  unseen-ID sampling and validation. `data/questions/` has generated shards;
  `data/sources/` has compressed licensed snapshots, never deployed.
- `worker/index.ts`: public HTTP boundary, private asset guard, GitHub OAuth and guest cookies.
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
only current-session identity, chat, approvals, scores, question history, avatars,
team names, reactions and private content. It is deleted when the session closes or the final connected
player disappears. Spectators do not retain it. Provider recovery history may
outlive live deletion, as approved by the owner.

The playing owner's browser receives the same unrevealed-content protection as
other browsers. Public question IDs do not disclose source IDs or answer words.
The server sends only the revealed question prefix and retains full answer rules.

Live guesses use a separate `answer-draft` WebSocket frame, scoped to the session,
question and answer attempt. `src/snapper/answer-draft.ts` coalesces edits to five
updates per second; `worker/answer-drafts.ts` independently validates and limits
them. Only the current answerer's current connection can publish. Drafts live in
memory, outside engine actions, storage and command receipts, and never score or
extend a timer. Snapshots include the current draft for new observers. Pause
freezes it; attempt changes, departure and connection replacement clear it.
The input is also scoped to its connection and seat so reconnecting cannot
republish an old guess. Socket projections update in message order before React
renders them, keeping authority checks current even when renders are batched.

## Play feedback and participant identity

- `src/components/snapper/play-effects.tsx` and its CSS render the current winner,
  awarded points, brief celebration, reveal reactions and format reminder.
  `src/snapper/play-feedback.ts` derives feedback from the current public ruling
  and applied points, including corrections and score resets. Team lead changes
  use each attempt's original scoring team, not its player's current membership.
  Reconnects do not replay the scoring celebration.
- `src/components/snapper/community-extras.tsx` and its CSS contain animated score
  values, the mobile score strip, avatar picker and owner team-name dialog.
  `src/components/snapper/community.tsx` places these controls in the scoreboard
  and displays avatars in the roster and chat. `src/snapper/identity.ts` derives
  stable default avatars and colours from participant IDs, independently of rank.
- `src/components/snapper/game.tsx` places feedback next to the question and uses
  the existing server deadline for the automatic next-question countdown. The
  mobile strip shows your score and the leader in FFA, or both named team totals;
  spectators see the leaders. Format cues contain only public rules and points.
  Reduced motion is respected. Effects do not delay progression or add sounds.

Avatar, team-name and reaction changes use ordinary validated engine commands and
authoritative snapshots. Connected approved players and spectators may choose
only their own avatar. Only the verified owner may rename team labels; stable A/B
IDs still govern membership and historical scoring. Both choices last for the
session, survive reconnects and never write the saved configuration.

Reactions require the currently revealed question and an active approved socket.
The Worker rejects stale question IDs and retired/revoked connections. The engine
enforces a two-second per-participant cooldown and keeps at most 64 reactions for
the current question. `reactionReadyAt` projects the viewing participant's next
allowed server time, so reconnects and fast advances retain the correct button
state. New questions and waiting states clear the visible list; session cleanup
also clears cooldowns. Reactions do not score, reset idle activity or alter clocks.
`migrateSession` idempotently supplies defaults to older stored sessions while
preserving current play and the existing legacy-format migration.

No session highlights, streaks, badges or milestone awards are implemented. All
feedback uses public current-question data; no future content or answer keys are
added to client payloads.

## Keyboard controls, Help and sound

- `src/snapper/shortcuts.ts` shares current permission/phase gates with the game
  buttons. Bare Space suppresses page scrolling even while buzzing is unavailable
  or the key repeats. Editable fields, native controls, modifiers, composition
  and open menus/dialogs retain their normal behavior. C challenges the current
  ruling; P/N/S remain moderator-only, and T focuses chat.
- Skip/S and End block execute immediately; their old confirmations are removed.
  Other destructive actions keep their confirmations. Explicit Start clears a
  moderator's manual pause after ending a paused block; End block itself still
  preserves that pause until the moderator starts play again.
- `src/components/snapper/help.tsx` provides the top Help menu: gameplay basics,
  formats, shortcuts and sound meanings. It uses the shared dismissible menu and
  modal components. The former Question formats footer is removed. Challenge is
  a prominent button beside the gameplay controls, including the fixed mobile bar.
- `src/snapper/sounds.ts` detects new public game events and defines seven short
  Web Audio motifs: your buzz, another player's buzz, correct, incorrect, prompt,
  timeout and a new question. `use-sound.ts` manages trusted-gesture unlocking,
  browser-local mute preferences and audio cleanup. Reconnects, first snapshots,
  unmuting and unchanged score recalculations do not replay past sounds. Muting
  stops scheduled and active notes; no external assets or services are used.

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

The original reviewed fallback contains 35 long tossups, 96 short atoms, 24
related four-part groups, eight sequences and eight four-clue questions. The
large imported pack adds **77,947** unique playable atoms: 40,356 QANTA tossups,
33,892 OpenTriviaQA short questions and 3,699 OpenTDB short questions. Combined
with the originals there are 78,094 atoms; group reuse is not counted twice.

Read [the data guide](../data/README.md) for licenses, exact pinned snapshots,
quality limits, source difficulty mapping and offline rebuild commands. All
imports retain CC BY-SA 4.0 attribution. They have automated structural screening
and sampled review, not individual fact-checking. Unknown difficulty stays
Unrated; the initial medium and previously saved filters remain unchanged.

`npm run questions:import` regenerates shards offline; `npm run questions:check`
checks every record and index. Builds copy generated shards into the private
`/_question-packs` asset prefix without bundling them into client JavaScript or
Worker code. The Durable Object loads only selected indexes/shards, with bounded
caches. `run_worker_first: true` and the Worker guard block every public download
of raw packs before auth or SPA routing. The dev server also blocks filesystem
access. Do not add public asset redirects to the private prefix. The compressed
source archives are kept in Git but are never deployed.

Repository selection draws from unseen content on each call, with no cached
opening order or cross-session history. Lazy group weighting uses an acceptance
step when an index reveals fewer unseen questions than its manifest count.
Reservoir samples are shuffled before a group contributes only part of a block;
taking an unshuffled prefix would favor early index entries. Index/shard reads
and caches remain bounded.

Format choices are independently weighted by matching question inventory:
Tossup/Snapper use authored plus imported counts, Assigned uses the same short
inventory when a full block is possible, and Open/team count distinct question
parts of fully eligible groups. Sequence/clues use authored item counts.
`QuestionPacks.counts` reads only the cached manifest and respects the saved
language/category/difficulty filters. Imported counts describe matching inventory,
not exact unseen remainder or remote provider inventory. Authored counts exclude
seen content. Exhausted choices fall through to another format; no-repeat and
filter rules remain authoritative. Missing manifests retain safe fallback paths
without adding provider requests or eagerly reading all shards.

Mixed sourcing now randomly tries repository or live content first with equal
probability for each supported block, falling back to the other if necessary.
This supersedes unconditional live-first selection. A local success needs no
provider request; source blending does not add calls or widen filters. Manifest
lookup failures are retried on demand after 60 seconds; concurrent lookups share
one request and successful immutable manifests remain cached. A transient error
must not strand every subsequent lobby on the tiny authored bank.

Live tossups still use QB Reader; live short questions use OpenTDB. Unsupported
answer rules and choice-dependent prompts are rejected. Live failures or missing
format coverage use eligible repository content, with the original pack retained
if generated assets cannot be loaded. No-repeat identity applies across live,
imported, standalone and grouped content. Exhaustion pauses rather than changing
saved filters. Imported shorts also feed Assigned; authored grouped,
sequence and four-clue formats retain their existing content.

Shootout is removed from both modes. Legacy configuration parsing maps it to a
single Snapper entry. `migrateSession` runs before Durable Object presence recovery:
it preserves the active question, scores, attempts and timer/answer-window IDs,
converts an old block to Snapper ending after that question, and frees its unasked
tail IDs. Obsolete retirement/cycle fields are removed; manual/challenge holds
are preserved. Settings and format descriptions expose seven formats.

Automatic judging recognizes conservative whole-word partials of accepted answers,
including a complete date component such as `1970` for `January 1, 1970`. Explicit
rejects take precedence; full aliases/typo acceptance stay unchanged. Correctly
ordered incomplete sequences can prompt without partial credit. The existing
single clarification gives a fresh fixed eight seconds; the UI explicitly asks
for the full answer beside its refocused input. No hidden answer content is sent.

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

Keyboard controls, Help and distinct sounds, verified locally on 2026-09-26:

- `npm test`: **169 passing tests**, including ineligible/held Space, C permission
  and input guards, sound-event transitions and reconnect/unmute baselines, and
  restarting after ending a paused block without clearing question history.
- Frontend/Worker typechecking, scoped lint, production build and Worker
  packaging dry run pass. No production deployment was performed by these checks.
- Two-player browser checks confirm that Space cannot scroll during another
  player's answer, while spaces/C still type normally in chat. Eligible Space
  buzzes and focuses the answer field. C pauses for a challenge; S and End block
  act without dialogs. Native focused controls still respond normally to Space.
  Pause → End block → Start starts a fresh playable question in the real browser.
- Desktop/mobile review covered the prominent Challenge control, the Help
  menu's viewport bounds, outside-click/Escape dismissal, focus restoration,
  format/shortcut/sound guides and prompt/correct-answer flow with sound enabled.
  A temporary development reload error while files were being added was resolved;
  fresh dev and built smoke checks show no console/page errors or overflow.
- Development and built desktop/mobile verdicts match, with both viewport images
  reviewed (`screenshots/snapper-controls-dev*` and `snapper-controls-built*`).
  Temporary local test sessions were ended. No production room settings changed.

Play feedback, reactions and participant identity, verified locally on 2026-09-26:

- `npm test`: **154 passing unit tests**. Coverage includes social-action
  permissions, avatar ownership, session-only names, reaction cooldown/bounds,
  unchanged clocks and idle expiry, recovery/migration, question cleanup,
  corrected scoring feedback, historical team attribution and stable identity.
- `npm run test:integration`: **7 passing real Worker integration tests**.
  The added WebSocket scenario covers players and spectators, owner-only naming,
  shared avatars/reactions, duplicate receipts, cooldowns, tab recovery, stale
  question rejection, removal and new-session defaults. Saved configuration is
  unchanged by social actions and unrevealed answers remain private.
- Frontend/Worker typechecking, scoped lint, the production build and Worker
  packaging dry run pass. No production deployment was performed as part of
  these checks.
- Interactive desktop/mobile checks verified shared reactions and cooldowns,
  animated points, ties and team lead changes, avatar selection and Escape/focus
  restoration, long team names, mobile score navigation, automatic advancement
  and paused countdowns. Reconnection preserves identity and scores without
  replaying the celebration. Browser logs were clear; temporary settings were
  restored and the test session ended.
- Final development and built desktop/mobile smoke checks match, with visible
  content, no horizontal overflow, console errors or brand/auth warnings. Both
  viewport images were reviewed (`screenshots/snapper-social-dev*` and
  `screenshots/snapper-social-built*`).

Partial clarification, question variety and complete Shootout removal, verified
locally on 2026-09-26:

- `npm test`: **136 passing tests**. Coverage includes the exact `1970` / `January
  1, 1970` case, one fresh eight-second clarification, conservative rejection,
  ordered prefixes, deterministic format weighting/filter changes, manifest-only
  counts, source blending/fallback, pack recovery after temporary failure, and
  idempotent recovery of old blocks without losing current play.
- An offline real-pack audit of 1,000 continuous-session blocks produced 1,137
  questions with zero repeated IDs. A separate fresh-lobby sample confirmed that
  weighting substantially reduces recurrence from tiny authored pools. This is
  not a cross-session no-repeat guarantee: last-player cleanup clears history,
  and differently worded questions about the same fact can still occur.
- `npm run test:integration`: **6 passing tests**. Real Worker/WebSocket checks
  confirm both-mode legacy settings normalize to Snapper, questions stay novel,
  and incomplete sequence answers prompt without scoring, leaking keys or
  retaining drafts; a complete elaboration earns the full score.
- Frontend/Worker typechecking, scoped lint, production build and Worker dry run
  pass. No deployment was performed as part of this verification.
- Interactive desktop/mobile checks confirm the prompt is visible beside the
  refocused answer field, the countdown restarts, and a complete answer scores.
  Both modes expose seven formats without Shootout, with the inventory-weighting
  explanation in settings. Temporary local settings were restored and test
  sessions closed.
- Desktop/mobile dev and built smoke checks match with no overflow, console
  errors or brand/auth warnings. Both viewport screenshots were reviewed
  (`screenshots/snapper-prompt-dev*` and `snapper-prompt-built*`).

Earlier random selection and team-only Shootout, verified locally on 2026-09-26
(the team-only behavior below is superseded by complete removal):

- `npm test`: **112 passing tests**. Deterministic distribution regressions
  exercise fresh-lobby openings, every position in multi-question samples and
  partially exhausted groups. Lazy asset reads and no-repeat filtering pass.
- `npm run test:integration`: **5 passing tests**, including old FFA Shootout
  settings migrating to saved Snappers, four distinct one-question blocks,
  continued eligibility after scoring, and closing/reopening the lobby.
  Team Shootout remains selectable; legacy active blocks finish normally.
- Frontend/Worker typechecking, scoped lint, production build and Worker dry run
  pass. Interactive desktop/mobile checks confirm Shootout is disabled in FFA,
  available for teams, and switching back selects only one Snapper entry.
  The test lobby was closed without saving its temporary UI edits.
- Desktop/mobile development and built smoke checks match, with no overflow,
  console errors or brand/auth warnings. Both viewport screenshots were reviewed
  (`screenshots/snapper-random-ffa-dev*` and `snapper-random-ffa-built*`).

Live answer drafts, verified locally on 2026-09-26:

- `npm test`: **106 passing tests**. Draft tests cover coalescing, deletion,
  answer-window identity, authorization, bounds, rate limits and lifecycle cleanup.
  Frontend/Worker typechecking and scoped lint pass.
- `npm run test:integration`: **4 passing tests**, including players and
  spectators observing edits, late-join snapshots, pause, submission, timeout,
  disconnect, takeover, removal and stale/spoofed-frame rejection. Typing has a
  separate quota from commands and never creates attempts or exposes answer keys.
- Browser checks exercised another player's live text on desktop/mobile, edits,
  erasure, and actual mobile answer entry followed by a correctly scored
  submission. Draft text appears directly beneath the question. No console
  errors occurred; temporary settings were restored and the test lobby ended.
- Production build and Worker packaging dry run pass. Desktop/mobile smoke
  checks pass for both development and built output, with matching verdicts,
  no overflow and no console/brand/auth warnings. Both viewport images were
  reviewed (`screenshots/snapper-live-draft-dev*` and `snapper-live-draft-built*`).

Additional shortcuts, verified locally on 2026-09-26 (the Skip confirmation below
is superseded by the immediate controls update):

- **S** opens the existing skip confirmation with the same moderator, connection,
  phase and challenge checks as the button. **T** focuses chat for connected
  participants and selects the Chat panel on mobile, without inserting a `t`.
- All five shortcut tests pass, including typing, modifiers, repeat/composition,
  disconnects, spectator chat and moderator permission boundaries. Typechecking,
  scoped lint and the production build pass.
- Interactive browser checks verified desktop/mobile chat focus, normal `s`/`t`
  typing in chat, skip confirmation and dialog focus protection. Desktop/mobile
  dev and built smoke checks match with no overflow or console errors; both
  viewport screenshots were reviewed (`screenshots/snapper-shortcuts-*`).

Question-bank and lobby-controls update, verified locally on 2026-09-26:

- `npm test`: **90 passing tests**; frontend/Worker typechecking and scoped lint
  pass. The offline importer and `questions:check` validate all 77,947 additions,
  72 indexes and 650 shards, including canonical judging and provenance.
- `npm run test:integration`: **3 passing tests** against the local Worker,
  including the 32-participant scenario, private-asset HTTP denial and removal
  permissions, clean WebSocket closure, revoked-cookie rejection and immediate
  reuse of the freed seat. Test socket teardown has a bounded timeout.
- Production build and Worker packaging dry run pass. The question JSON remains
  outside the Worker bundle (898.16 KiB uncompressed / 154.89 KiB gzip) and client
  assets. A real-corpus loader probe successfully reads all 72 groups.
- Final desktop/mobile development and built smoke checks show visible content,
  no overflow or console errors, no brand/auth warnings and matching verdicts.
  Screenshots and JSON are in ignored `screenshots/snapper-bank-dev*` and
  `screenshots/snapper-bank-built*`; both viewport images were visually reviewed.
- Interactive browser checks verify outside-click/Escape menu dismissal, P/N
  moderator shortcuts, top-positioned controls and the named removal dialog.
  Cancel starts focused and returns to the participant menu trigger. Confirmed
  removal disconnects the guest, marks the retained score row **Removed**, and
  hides its management menu. The final built-preview test session was cleared
  through last-player disconnection; saved gameplay settings were preserved.

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
