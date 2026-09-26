# Snapper product design

Status: requirements approved; implementation locally verified. This document
records the decisions made with the owner and is the implementation contract.
See [implementation.md](implementation.md) for delivery and verification status.

Read [architecture-audit.md](architecture-audit.md) for code findings, hosting and
question-source research, architecture diagrams and the migration/test plan.
Future agents should also read [AGENTS.project.md](../AGENTS.project.md).

## Purpose and constraints

Snapper is a private game for the owner and friends, inspired by **Reach for the
Top** and **Protobowl**. It supports both long progressive quizbowl and short
trivia. Questions and responses are text; image/audio questions are outside the
selected scope.

- No spending. Free tiers may require a card only if charges are prevented.
  Free allowances with automatic paid overages are unsuitable.
- Any suitable host is acceptable; Vercel is not required.
- One active lobby at a fixed URL, without room codes.
- Up to **16 players plus 16 spectators**, using their own devices remotely.
- Players are on the same continent, potentially in different countries.
  Capacity planning assumes no more than **one hour once per week**.
- Desktop and mobile; current Chrome, Edge, Firefox and Safari, including
  iPhone and Android browsers. Keyboard controls, readable contrast, reduced
  motion and screen-reader labels are the accepted accessibility baseline.
- Continuous play until players stop, with no fixed match length. One person
  may play alone in the same lobby; no separate private practice mode.

## Access and permissions

The initial idea of unrestricted public joining was superseded by an
owner-controlled admission gate to reduce strangers' quota use.

| Role/action | Confirmed behavior |
|---|---|
| Owner identity | Existing-account sign-in. Provider choice was delegated to simplicity; implemented with GitHub OAuth and a fixed owner identity. |
| Open session | The owner must connect and open each session. |
| Admit participants | The owner personally approves every player and spectator. No shared game password. New requests after the owner leaves wait for the owner's return. |
| Saved settings | Only the owner can change the single product-wide configuration. |
| Moderation | The owner can promote a connected player for this session only. No persistent trusted-moderator list. |
| Moderator controls | Pause/resume, advance, skip a question, end a block, reset all scores, correct the current question and remove a guest for the current session. |
| Owner-only administration | Opening/closing the session, admissions, saved configuration and moderator appointments. Moderators cannot take over these owner permissions. |
| Owner departure | The session may remain open and delegated moderation may continue. |
| No moderator present | Finish the entire current format block, then pause until a moderator returns. This supersedes the earlier individual-question wording. |
| Spectators | May watch and use public chat. An already-approved spectator may claim an open player seat without another approval; answering starts at the next eligible question/block. |

The owner and moderators normally compete too. They receive no unrevealed
question content or answer keys. Friends do not need accounts.

An admission gate reduces casual unauthorized play but cannot make requests to
the public site consume zero quota. Enforced free hosting limits remain the
spending boundary.

## Session lifecycle and retention

- Keep temporary server records so a refresh or brief disconnection can restore
  the same name, score and team while the session remains active. At least one
  connected player must remain; spectators alone do not preserve the session.
- A server-issued identity, not a display name, must reclaim a player's place.
- A detected disconnection **immediately frees the player seat**. Do not reserve
  the seat for a grace period or until the session ends. Preserve the departed
  player's session identity, score, team history and fixed-block eligibility
  separately from capacity while that session is active.
- If a returning player's former player place or original team is full, they
  wait as an approved spectator with their identity and score preserved. Do not
  displace the new occupant or exceed player, team or spectator capacity.
  If spectator places are also full, show a capacity-waiting state while
  retaining the identity. Spectating does not authorize answering or reclaim a
  reserved player seat.
- The newest tab for an existing session identity takes over; the old tab
  becomes inactive. A tab handoff is a connection replacement, not a new player
  or an intentional departure that discards the identity.
- End the session and clear its live data when the **last connected player
  disconnects**, even if approved spectators remain. Spectators do not keep an
  empty session alive. Preserve the global configuration and permitted browser
  preferences. Disconnected identities and frozen-block membership do not count
  as connected players or postpone cleanup.
- Count occupied seats held by connected players, not current answer
  eligibility. A seated newcomer waiting for the next block counts; a spectator
  or pending admission does not. A spectating owner is still a spectator for
  this rule.
- After cleanup, the ended session cannot be recovered. The owner must open a
  new session; old admissions, scores and moderator grants do not carry over.
  Remaining spectators see that the session ended and cannot revive it by
  claiming a seat after cleanup.
- Clearing the live application is sufficient; the hosting provider may retain
  recovery history. Do not claim immediate physical deletion from backups.
- Scores, chat, admissions, moderator grants, progress and seen-question history
  are session-only. No permanent player profiles or leaderboards.
- The owner explicitly permits browser-local nickname and sound preferences
  between sessions. This is an exception to the configuration-only persistence
  requirement, not permission to save gameplay history.
- Pause after ten minutes without a buzz, answer submission or chat message.
  A moderator may resume. Idle pausing is separate from session deletion.

## Participants and teams

- Support **free-for-all** and **exactly two teams**.
- Players choose their team, with up to eight players on each team. Include
  everyone in special formats; do not impose four active seats and substitutes.
- Points stay with the team that earned them if a player changes teams.
- Approved spectators can take seats as soon as they open. Taking a seat does
  not bypass the next-question/fixed-block eligibility rule or the eight-player
  team limit.
- Late joiners answer starting with the next question. For roster-dependent
  blocks, including Assigned and scramble/bonuses, late joins and team changes wait
  until the block ends. Reconnection retains the existing identity/eligibility.
- Freeze starting rosters for these blocks independently of occupied lobby
  seats. A disconnect frees a seat but does not remove an unscored block member
  or let a replacement inherit their turn. New occupants wait until the next
  eligible question/block.
- On a disconnect, timers continue and missed turns are forfeited. Preserve the
  player's block membership for recovery while the session remains active. Run
  normal deadlines and completion transitions
  first: a fully locked-out question reveals, completed allocations end the
  block, and an absent Assigned player's timer can expire. Pause at a
  progression boundary if continuing would require an eligible disconnected
  player. A moderator can end the block if the missing player will not return.
  Last-player cleanup takes precedence over finishing a block or waiting for a
  disconnected participant; spectators cannot keep either process alive.

## Progression and configuration

One versioned global configuration survives sessions. Only the owner edits it.
Changes are saved for future use and take effect at the **next format block**;
the active block keeps its existing rules.

Switching between FFA and team mode at that boundary **resets scores**. Chat
and seen-question history remain in the same session; switching modes must not
make previously used questions eligible again.

An individual question is one prompt/scoring opportunity. A block groups linked
questions under a format, such as an Assigned round or scramble/bonuses. A long
tossup or standalone Snapper can be a one-question block.

- Choose enabled, currently playable formats **independently at random, weighted
  by matching question inventory**, at block boundaries. A format with more
  questions under the saved filters appears more often. Consecutive repeats are
  allowed; do not use a shuffled cycle. This supersedes uniform format choice.
  Weight formats, not subject categories. Assigned uses the short-question pool;
  grouped formats count eligible question parts. Imported inventory comes from
  manifest counts rather than scanning every question or querying live services.
  These are matching inventory estimates, not exact remaining unseen counts;
  exhausted formats are still skipped by the normal no-repeat selection.
- Within a selected format and the saved filters, sample the eligible unseen
  repository questions fairly, without preferring early entries or depleted
  groups. A new lobby draws afresh; do not reuse a fixed opening sequence or
  persist question history between lobbies.
- Automatic/manual advancement and the delay are configurable.
- Content topics, difficulty and available languages are configurable. Do not
  show working filters for content the system cannot actually supply.
- Starting content is **English**, broad topics, regular high-school quizbowl
  and medium short trivia. The two source difficulty labels are not equivalent.
  No special Canadian weighting or excluded topics were specified.
- Initial defaults are FFA, all compatible formats enabled, progressive short
  questions, 210 words/minute, 2.8 seconds of final buzz time, and automatic
  advancement 5.2 seconds after reveal. All are owner-configurable.

## Common play and judging rules

- The **first valid buzz received by the shared server** wins. No latency
  compensation scheme is required. Geographic/network delay can still matter.
- Keep future words, clues and answer keys off all participant devices until
  their reveal point. This includes owners, moderators and spectators.
- Answers are typed and judged automatically, with accepted aliases and
  conservative typo tolerance. Do not use unrestricted substring matching.
- While the current answerer types, all admitted players and spectators see
  their unsubmitted answer text live. A draft is presentation only: it does not
  submit an answer, create an attempt, change scores or enter chat/history.
  Only the current answerer's active connection may update it, within the
  current answer window. Reject stale, expired and impersonated updates.
- Drafts are transient and are never saved with session records or browser
  preferences. Clear them on submission, timeout, clarification, answerer
  disconnection/removal, tab takeover and question end. A pause freezes the
  existing draft; editing resumes in the same answer window after the pause.
  A participant joining during an answer sees the latest valid draft.
- An insufficiently specific answer gets one clarification attempt with a fresh
  **8-second** timer. Authored prompt aliases and conservative complete-word
  partials qualify: **1970** for **January 1, 1970** prompts for the full answer.
  Correct ordered sequence prefixes or correctly positioned partial names can
  also prompt. This awards no points and reveals no missing answer details.
  Explicit rejections take precedence; accepted aliases still count as correct.
  Wrong extra words, negations, digit/word fragments and wrong sequence order do
  not qualify. A second incomplete response is incorrect. Show a clear prompt
  beside the answer field and focus the new answer window.
- Standard answer window: **8 seconds**. Sequence answer window: **20 seconds**.
  These values are configurable.
- A wrong answer or timeout on ordinary buzzer questions locks that player out
  for the question in FFA, or the whole team in team mode. Four-clue questions
  reset eligibility at each clue.
- Optional negative scoring initially applies only to long tossups, and is off
  by default.

### Corrections and challenges

Only the **current question** can be corrected, including its reveal interval.
A Challenge button pauses advancement until a moderator resolves it.

An unresolved challenge or a disconnected-participant hold still prevents
advancement when all moderators are absent. Finishing the block on moderator
departure does not bypass these holds. Manual Next remains moderator-only, so
manual play waits until a moderator is connected.

The earliest submission now judged correct becomes the winner; later scoring
for that question is undone. Recompute score and eligibility effects from the
question's starting state.
Once an answer is revealed, correction must not reopen it for more attempts.
After the next question starts, the prior ruling is final: no late score
adjustments or cascading rewinds.

## Seven text formats

These are Snapper house rules, not a promise of exact official Reach rules.
Scores and timing are configurable by the owner.

| Format | Confirmed starting rules |
|---|---|
| Long tossup | Progressive question; 10 normal points, 15 before an authored power mark; optional −5, off initially. |
| Short Snapper | 10 points; ordinary buzzing and lockout rules. |
| Grouped Open Questions | Authored groups of three or four related, independently scored questions; 10 per part. |
| Ordered Sequence | 20 points for the complete correctly ordered list; no partial credit. 20-second answer window. |
| Team scramble/bonuses | 10-point scramble, followed by three exclusive 10-point bonuses. First winning-team member to buzz gets its one attempt. No opposing steals. Team-dependent, so unavailable in FFA. |
| Assigned | 10 points. Assigned player answers first; a wrong answer/timeout gives one designated opponent an attempt. In FFA, use the next player in the rotating order. |
| Four-clue Who/What Am I | Four clues worth 40/30/20/10. One player/team attempt per clue, with eligibility reset for the next clue. |

Use meaningful individual adaptations in FFA and disable inherently
team-dependent formats. A one-player Assigned game cannot pass an answer back
to the same player as an opponent.

**Shootout is removed from both modes.** This supersedes its earlier team-only
status and all player-retirement/cycle rules. Reuse those short questions as
ordinary Snappers and in Assigned rounds. Legacy settings map Shootout to one
Snapper entry, even if Shootout was the only enabled format. A stored active
Shootout converts to Snapper and ends after its current question, retaining
attempts, scores and answer-window identities. Unasked tail questions return to
the available pool; no presented question becomes repeatable.

### Equal opportunities for unequal teams

Let `N` be the larger team's size at block start.

**Assigned:** each team receives `N` primary questions. Cycle through the
smaller roster to give its extra turns only after everyone has had a turn.
The opposing attempt uses a designated rotating opponent. Freeze the schedule
for the block; do not replace a disconnected player's turn with a stronger
teammate.

For three versus five players, each team gets five Assigned primary turns.
This provides equal primary allocations, not equal individual turns or winning
odds.

## Question sourcing and fallback

- Mixed sourcing gives local and live content an equal chance to be tried first
  for Tossup, Snapper and Assigned blocks, then falls back to the other source if
  needed. This supersedes live-first priority: a working provider must not starve
  the much larger repository bank. Bundled-only mode never calls live providers;
  authored-only formats continue using suitable repository content. Preserve
  filters and session deduplication across both sources.
- A temporary pack-manifest failure may use the original fallback, but must not
  permanently disable imported questions. Retry on a later selection after a
  one-minute cooldown; do not poll or repeatedly retry during the cooldown.
- The meaning of “new” remains explicitly undecided. Do not assume current-news
  generation or add a paid AI dependency.
- Maintain curated packs in the repository. No in-game editor or pack upload.
- No question repeats within the current session. Seen history is cleared
  between sessions. Deduplicate underlying questions as well as groups so a
  bonus part does not reappear as a Snapper.
- If an enabled format has no unseen compatible content, temporarily skip it.
  Pause if none remains. Preserve saved filters and the no-repeat rule.
- Do not silently change language, topic or difficulty to fill an empty pool.
- Free APIs do not cover all seven formats ready to play. The repository pack
  supplies authored sequences, four-clue items and related groups; future pack
  expansion remains repository content work.
- Preserve source identity, author/packet information where supplied, rights
  notices and required attribution. An available API does not automatically
  authorize copying its whole corpus into the repository.
- The owner requested as many useful local questions as possible. The repository
  now includes licensed QANTA 2018, OpenTriviaQA and OpenTDB snapshots, with 77,947
  filtered additions. See [question data](../data/README.md) for exact attribution,
  conversion limits and counts. Imports are screened and sampled, not all
  individually fact-checked. Unrated source questions stay explicitly Unrated;
  existing saved/default filters are not silently expanded.

## Visual and interaction direction

- Keep the interface a functional game lobby. The owner explicitly rejected
  marketing headlines, slogans, promotional sections and sales language during
  implementation. Bright colors, scores and a prominent buzzer remain wanted;
  labels should describe actions directly (Join, Approve, Start, Settings).

- Name: **Snapper**. Use a **bright game-show style**, bold colors, large scores
  and a prominent buzzer. The former Lectern green/brass paper-card style does
  not guide this redesign.
- Public text chat shared by admitted players and spectators. No private/team
  chat, in-app voice or video is part of the selected scope.
- Optional, distinct sound effects for your confirmed buzz, another player's
  buzz, correct and incorrect answers, clarification, answer timeout and the
  next question. Use brief motifs with different rhythms and tones, an individual
  mute control and the existing remembered browser preference. Muting stops
  active sounds; reconnecting or enabling audio must not replay old events.
- Prioritize question readability and mobile typing. Keep the question,
  eligibility, answer field and deadline usable with the phone keyboard open.
- Keyboard buzzing must respect focused inputs and buttons. Do not announce
  every progressive character or live answer keystroke through a screen reader
  or convey eligibility solely through color. Respect reduced-motion preferences.
- Reserve bare Space on the gameplay page even while ineligible, spectating,
  paused or reconnecting, so it never scrolls the page. Holding it must not
  trigger another buzz; spaces in inputs and native control activation still work.
- Clearly distinguish waiting for approval, connecting, reconnecting, paused,
  full, exhausted content and temporarily unavailable service.
- Host/moderator controls belong at the top to minimize scrolling. Action menus
  close on outside click and Escape. P pauses/resumes, N advances and S skips
  when the corresponding moderator action is allowed. Skip and End block act
  immediately without confirmation, superseding the earlier confirmation flow.
  Skip remains available during a pause, but not while waiting, after reveal,
  during an unresolved challenge or while disconnected.
- T focuses the chat input for any connected player or spectator, including
  while waiting, paused or resolving a challenge. On mobile it opens the Chat
  panel first. It does not insert a T into the message. Shortcuts never fire
  during typing, text composition, repeated key presses, modifier combinations
  or while a menu/dialog is open.
- C triggers Challenge when a ruling exists for the current question and no
  challenge is already pending. It uses the button's connection and eligibility
  checks, including for spectators. Make Challenge a prominent button beside the
  gameplay controls, reachable on phones; it pauses play for moderator review.
- Put Question formats in a top Help menu alongside How to play, Keyboard
  shortcuts and Sounds. Remove the old bottom formats link. Help is available
  before joining as well as during play and dismisses with outside click/Escape.
- Removing a player uses a named confirmation with explicit Cancel/Remove
  actions and reliable keyboard focus. Removal remains session-only and follows
  the existing owner/moderator permission rules.

### Play feedback and personality

The owner approved scoring celebrations, post-answer reactions, a mobile score
strip, emoji avatars/custom team names, and clearer transitions. Animations are
wanted. Session highlights, streaks, badges and milestone awards were explicitly
excluded; do not add them as part of this work.

- Show the current winner and awarded points beside the revealed answer, animate
  score changes, and mark a genuine change of leader. Ties are explicit. Respect
  corrections and score resets; do not award extra points or replay celebrations
  merely because someone reconnects.
- Keep celebrations brief, within the game layout, and inside the existing reveal
  interval. They must not block answers, cover question text or delay the next
  question. Honour reduced-motion preferences and the existing sound mute.
- Approved players and spectators may react with 😂, 👏, 😮 or 💀 only after an
  answer is revealed. The server enforces a two-second per-person cooldown and a
  bounded list of current-question reactions. Clear reactions on the next
  question/session; reactions do not extend timers, score or prevent idle pause.
- Mobile keeps a compact score comparison visible while reading: your score and
  the leader in FFA, both named team totals in team mode. Spectators see the
  leaders. The full scoreboard stays available with one tap.
- Participants choose their own emoji avatar from the provided set. Colours and
  default avatars follow player identity rather than scoreboard position. Avatar
  choices survive reconnects within the active session, not future game nights.
- The owner can name the two teams for the current session. Names are labels;
  stable A/B identities still control membership and previously earned points.
  Team names do not modify saved gameplay settings or grant extra permissions.
- At each new question, briefly show its format and scoring reminder. Show an
  explicit automatic next-question countdown during reveal, or indicate manual
  advancement. These use existing server deadlines and revealed metadata, never
  future content or client-owned progression.

## Architecture and implementation status

Snapper uses a static React frontend, one Cloudflare Worker
on its Free plan, and one fixed-identity Durable Object as session authority.
One persistent configuration record is separate from temporary game state.
GitHub verifies only the owner; friends use approved session identities.
The legacy Lectern modules remain in the repository for reference but the
Snapper entry point does not use their browser-owned engine or SQL signaling.
See [implementation.md](implementation.md) for current code, checks and setup.
No production deployment has been made during implementation.

## Final approved defaults and progression details

The owner approved these during the implementation handoff; do not ask again:

- Start in FFA with all compatible formats enabled, progressive short questions,
  210 words/minute, 2.8 seconds of final buzz time, and automatic advancement
  5.2 seconds after reveal. All remain configurable.
- Open groups use their authored three or four parts.
- FFA Assigned gives each player one primary turn.
- An unanswered scramble skips its bonuses. Freeze the entire scramble/bonus
  roster for the block.
- Require two nonempty teams for team Assigned and scramble with
  bonuses; temporarily skip these otherwise without changing saved settings.
- Manual Next stays restricted to moderators. With none present, manual play
  waits even though automatic advancement may finish the current block.

## Open product direction

“New questions” remains intentionally open-ended. Live free-source adapters plus
original repository fallback meet the initial scope; paid generation is not
required. Further content expansion and visual refinement may follow real play.
The exact palette and layout are implementation design choices within the
approved bright game-show direction, not a missing permission gate.

## Maintaining this document

Update confirmed sections when the owner answers an open item. Remove obsolete
questions from the register, and note superseded rules where confusion is
likely. Keep the distinction between a requirement, a recommendation, verified
implementation and remaining work. Do not treat completed discovery questions
as decisions that must be asked again in every agent session.
