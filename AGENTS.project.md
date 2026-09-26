# Snapper project instructions

Read [docs/product-design.md](docs/product-design.md) before planning or changing
the product. It records the owner's confirmed requirements and the remaining
open decisions. Read [docs/architecture-audit.md](docs/architecture-audit.md) for
the historical prototype's limitations, architectural reasoning, sources and
verification plan.

## Status and interpretation

- The **Snapper** implementation is locally verified. Read `docs/implementation.md`
  for entry points, verification results and outstanding deployment setup. The
  older Lectern modules are legacy references, not the active product.
- `docs/cloudflare-setup.md` contains account setup, verified free quotas and
  deployment steps. Cloudflare Workers Builds with GitHub is the preferred deploy
  flow; once connected, pushes to `main` deploy automatically. No connection has
  been configured by this agent. Vercel Git deployments are disabled.
- `data/README.md` describes the licensed repository question snapshots and
  generated bank. Read it before editing imports. Do not expose raw question
  packs through `public/`, frontend imports, asset rewrites, or an API. Keep
  `assets.run_worker_first: true` and the private-path guard; this is part of the
  unrevealed-answer boundary. Builds do not download question sources.
- All final gameplay defaults and progression rules have been approved. Continue
  implementation within that contract; do not restart requirements discovery.
  No production deployment has been made by this implementation session.
- Confirmed requirements are decisions already made with the owner. Do not ask
  them again unless new evidence creates a concrete conflict. Proposals and open
  items are not approved behavior; ask about consequential product choices
  rather than silently filling them in. Use engineering judgment for technical
  details that preserve the agreed behavior.
- Keep `docs/product-design.md` current when the owner makes a new decision or
  the implementation changes. Record superseded behavior explicitly when it
  would otherwise mislead a future session. Keep implementation status honest.
- These project decisions supersede generic template product assumptions:
  Vercel is not required, PostgreSQL is not a product requirement, owner-only
  GitHub sign-in is the owner identity mechanism, and friends join without accounts after approval.
- Do not interpret owner sign-in as requiring every guest to authenticate with
  GitHub. Owner actions need verified owner identity; guest game actions need a
  valid approved session identity and the appropriate current role.

## Constraints to preserve

- **No spending.** Use free services with enforced limits, not automatic paid
  overages. Provider terms must be rechecked before a deployment is chosen.
- One owner-opened lobby; 16 players plus 16 approved spectators. The owner
  personally approves admissions and alone edits the saved configuration.
- Disconnects immediately release player seats. Approved spectators may take
  openings, but fixed-block membership and recoverable identity are separate
  from seat occupancy; a replacement does not inherit a departed player's turn.
- End and clear the session when the last connected player disconnects, even
  with spectators present. During an active session, returners whose former
  player/team place is full wait as spectators without displacing anyone.
- One saved product configuration. Gameplay, chat, approvals, moderator grants
  and question history are session-only. The user additionally permits each
  browser to remember its nickname and sound preference.
- Use a shared game authority, not a playing browser's clock or claimed role.
  The implemented authority is one Cloudflare Durable Object on Workers Free.
- No future clues or answer keys on participants' devices before reveal,
  including the playing owner/moderator. Only current-question corrections.
- The current answerer's unsubmitted text is visible live to admitted players
  and spectators. Keep drafts transient, separate from scoring, attempts and
  chat, and accept updates only from the current connection in its valid answer
  window. Pause freezes a draft; submission, timeout, clarification, departure,
  removal, tab takeover and question end clear it. Never persist draft text.
- Seven text formats remain supported. Shootout is removed in both modes; keep
  its short questions available as ordinary Snappers and Assigned questions.
  Normalize legacy Shootout settings to Snapper once. Recover an active legacy
  block as a final-current-question Snapper and release its unasked tail back to
  the pool. Preserve equal-opportunity Assigned rounds for unequal teams.
- Select formats independently, weighted by matching question inventory under
  the saved filters. Imported weights use manifest counts, not exhaustive reads
  or provider API calls; skip exhausted pools without repeating questions.
  Mixed sources randomly try local or live first with equal probability, then
  fall back. Do not permanently cache failed pack loads or silently widen filters.
  The existing session-only history means reopened lobbies can repeat questions;
  do not add persistent recent-question history without owner approval.
- Partial answers made of complete accepted words or date/number components
  prompt once for a full answer (for example, 1970 for January 1, 1970), with a
  fresh fixed eight-second window and no points. Explicit rejects win, accepted
  aliases remain correct, and wrong/extra details or fragments do not qualify.
  Ordered sequences may prompt for a correct prefix; no partial credit.
- Free content retrieval must fall back to suitable reviewed repository packs.
  No repeated questions within a session; pause when all eligible content is
  exhausted. Keep source provenance and applicable attribution.
- Snapper uses a bright game-show direction, with desktop/mobile accessibility.
  The existing green/brass Lectern appearance is not a design preference.
- No marketing copy or promotional landing page. This is a game for friends;
  show a direct functional lobby with plain action labels.
- Keep host controls at the top, menus dismissible on outside click/Escape, and
  P (pause/resume), N (next) and S (skip confirmation) limited to permitted
  moderator actions. T focuses chat for connected players and spectators,
  switching to the Chat panel on mobile. Suppress shortcuts during text input,
  composition, repeats, modifier combinations and open menus/dialogs.

## Working in this repository

- Establish the current host environment before using paths or platform tools.
  This repository was audited on macOS outside the template's `/workspace`
  sandbox; `.grok` skills/references were not supplied in the checkout.
- Preserve the existing preview bridge, PWA/branding helpers and startup/build
  contracts while working with the prototype. A hosting migration must account
  for these explicitly, not remove them as incidental cleanup.
- Do not add a paid AI service, permanent player accounts, saved leaderboards,
  multiple rooms or a question-pack editor without a new product requirement.
- Test the changed behavior. Game verification must cover authority, clocks,
  eligibility, judging, recovery and cleanup; a successful landing-page render
  is not multiplayer validation. Documentation-only updates do not need an
  application rebuild.
