# Repository questions

These are English question snapshots for Snapper's local question pool. `questions/`
contains generated, playable JSON shards. `sources/` contains the complete
compressed source snapshots, checksums and license text. **Neither directory is
a public website directory.** The Worker alone reads the question assets; it
reveals only the current allowed text/answer through the game protocol.

Current import: **115,929 unique playable additions**: 71,101 long QANTA tossups,
33,869 OpenTriviaQA, 7,189 The Trivia API, 3,697 OpenTDB and 73 LearnClash short
questions. Alongside the 147 original atoms, that is **116,076 playable question atoms**. Authored group
parts are shared with short questions and are not counted twice. The archives
retain 182,793 source records, including duplicates and held-out entries.

The generated catalog has 26,551 medium, 2,568 easy, 52,868 hard and 33,942 unrated
additions across 78 category/format/difficulty groups and 951 shards, separate
from the Worker bundle. This expansion adds a net **37,982** playable questions
over the prior 77,947 imported bank; a small number of old duplicates/conflicts
are held out as the combined corpus is reconciled.

## Rights and provenance

Imported questions retain **their individual source licenses**, including the
adaptations. QANTA, OpenTriviaQA and OpenTDB use [CC BY-SA 4.0](sources/CC-BY-SA-4.0.txt);
The Trivia API uses [CC BY-NC 4.0](sources/CC-BY-NC-4.0.txt), for noncommercial use
only; LearnClash uses [CC BY 4.0](sources/CC-BY-4.0.txt). Do not describe the mixed
collection as entirely BY-SA or commercially reusable. These notices apply to
question data, not the application code. Each playable question retains its
attribution, source link, license and modifications, displayed at answer reveal.
Do not strip those fields.

| Collection | Attribution and permission | Snapshot |
|---|---|---|
| QANTA | University of Maryland QANTA team and original question authors. The [official leaderboard](https://pinafore.github.io/qanta-leaderboard/) explicitly licenses the **dataset** under CC BY-SA 4.0. | Train/dev/test version `2018.04.18`, 119,247 records. Dead upstream download links were replaced by an [exact version-pinned mirror](https://huggingface.co/datasets/TasnimKabir12/qanta/tree/12d2ce9c99e55643c0116f4623d3ac72656f7f7d); raw file hashes are in the source manifest. These are whole tossups, not sentence fragments. |
| OpenTriviaQA | uberspot and contributors; [the publisher's dataset license](https://github.com/uberspot/OpenTriviaQA/blob/dd31530bfbb19f9505b160b89c9df4b1127e3c70/README.md). The publisher describes the questions as gathered; individual upstream authors are not supplied. | Commit `dd31530bfbb19f9505b160b89c9df4b1127e3c70`, 49,716 records. Deliberately predates a later experimental LLM rewrite. |
| Open Trivia DB | PixelTail Games and contributors; [API data license](https://opentdb.com/api_config.php). | All 5,298 verified questions retrieved on 2026-09-26, using a token and the documented five-second request limit. Pending/rejected questions were not downloaded. |
| The Trivia API | Trivia Services Ltd.; [publisher's CC BY-NC 4.0 notice](https://the-trivia-api.com/). | 8,432 unique English text-choice records retrieved on 2026-10-01 through the free, unauthenticated API in 1,163 bounded requests. Category/difficulty coverage is recorded in the snapshot; regional exclusions and random sampling mean it is not a complete export. No paid search, sessions, translations or answer-checking services are used. |
| LearnClash | Pluxia GmbH; [publisher's CC BY 4.0 notice](https://github.com/Pluxia-GmbH/learnclash-open-trivia/blob/219b618fe569982a4a4b11a275a8f0d98b4661cd/README.md). | All 100 English records from the pinned HTML snapshot, read as data without executing its scripts. [Reviewed exclusions and answer adaptations](reviews/learnclash.json) separate explanatory detail from typed answers and retain explicit equivalent names. |

The source manifest records checksums, retrieval URLs and license evidence.
The archive retains source data that is unsuitable for automatic play so future
curation can recover additional questions without downloading it again. An
archive record is **not** counted as a playable question.

## Conversion and quality

The importer is intentionally conservative. It normalizes whitespace, basic
entities and escaped quote artifacts; removes multiple-choice distractors;
retains only self-contained short prompts; rejects missing keys, media
dependencies, obvious temporal wording and malformed extraction; and deduplicates
normalized question text against all imported sources and the original pack.
Conflicting canonical answers to the same prompt are held out instead of merged.

Quizbowl imports keep only simple canonical answers and explicitly supported,
unconditional accept/prompt/reject rules. Protobowl-origin QANTA records now
support balanced `{required words}`: the full answer remains the display name,
and all marked spans together form an accepted alias. Required spans are never
treated as independent alternatives. This follows the source's
[bold-word parsing and judging](https://github.com/neotenic/protobowl/blob/300633f8b5e8368247981374a8208f8ecee69493/shared/checker2.coffee).
Unknown-source markup, malformed/nested braces, conditional instructions,
pronunciation annotations, comma-separated alias lists and multipart bonus dumps
remain excluded. Canonical answers and every accepted alias must pass Snapper's
actual judge; conflicts with explicit rejects are held out.
One explicit `(*)` marker becomes a character-based power boundary; absent markers
never receive an invented bonus. Double-power/multiple-marker questions are held
out. The visibly corrupted PACE NSC 2013 QuizDB batch is also held out.

This is automated screening plus sampled review, **not individual fact-checking
of every question**. Old facts, imperfect source categories, missing accepted
variants and residual extraction errors can remain. Use current-question
moderator corrections, and improve the source adapter or add a reviewed override
in the repository when a repeatable issue is found. Do not call these imports
the same individually reviewed content as the small original Snapper pack.
The Trivia API adapter also excludes subjective superlatives, explanatory
parentheses in answer keys, lyric-identification prompts, ambiguous recurring
book-character templates and unanchored changing records. Simple “how many”
answers from zero through twenty accept both the word and digit form. Its
[reviewed exclusions](reviews/the-trivia-api.json) hold out known inaccurate or
ambiguous sampled records and assert the original text/key on future rebuilds.

Difficulty is kept explicit. OpenTDB retains its own easy/medium/hard labels.
The Trivia API likewise retains its supplied ratings. OpenTriviaQA and LearnClash
have no supplied rating and are **Unrated**; choose Unrated or Any to play them.
QANTA uses approximate house bands relative to Snapper's high-school
baseline: middle school/easy high school → easy; generic/regular high school →
medium; college/open/hard or national high school → hard. Original difficulty
labels remain in attribution. These bands are not equivalent provider scales.
New categories are available in settings; existing saved filters and initial
medium difficulty are preserved.

## Maintenance

- `npm run questions:import` rebuilds `questions/` **offline** from the checked-in
  source snapshots, verifies their SHA-256 hashes, and reports import/rejection/
  duplicate counts. It does not fetch services during deployments or game play.
- `npm run questions:check` validates all shard/index identities, cross-pack
  duplicates, canonical answers and aliases, source-specific licenses, power
  boundaries and file limits. It also selects unseen questions from every group
  through the actual Worker loader to verify runtime schemas and filters.
- `npm run questions:download:opentdb` is an explicit maintenance download to
  ignored `.question-cache/`, taking roughly ten minutes. Review a new snapshot,
  compress it into `sources/`, update its checksum/retrieval metadata, then
  rebuild and verify before committing it. Do not run downloads in CI builds.
- `npm run questions:download:trivia-api` resumes an explicit maintenance download
  in ignored `.question-cache/the-trivia-api.json`. It requests at most 50 records
  at a time, sequentially below the observed 20 requests / 5 seconds limit, with
  a 2,400-request run budget, bounded retries and a no-new-record stopping rule.
  It never supplies credentials. Review the result, gzip it into `sources/`,
  update the source manifest's hashes/retrieval time, then rebuild and check.
  Use `npm run questions:download:trivia-api -- --fresh` for a new collection
  rather than resuming a prior run; resuming does not revalidate every old record
  or remove records the provider has since withdrawn.
- LearnClash's snapshot is pinned; its reviewed overrides assert the original
  question and answer so a source update cannot silently reuse an old correction.
- Preserve the original authored Open groups, team bonuses, Sequences and
  four-clue questions in `src/snapper/bank.ts`; unrelated imported questions do
  not automatically become authored groups or clue rounds.

## Further sources

TriviaQA remains deferred: its repository declares Apache 2.0 for code and data,
but its dataset homepage says the university does not own the underlying
questions/documents. No TriviaQA corpus has been copied while that discrepancy
is unresolved. QBReader remains a live tossup provider; access to its API is not
treated as blanket permission to redistribute every packet. Wikidata-derived
questions need authored templates and review and are not included in these counts.

## Hosting boundary

Builds copy only generated shards to `dist/snapper/_question-packs/`. The
Cloudflare Worker runs first for every request and returns 404 for private pack
paths, including encoded or ambiguous aliases. Its Durable Object reads shards
directly through `ASSETS`; no raw-pack HTTP route exists. The manifest/index and
shard caches are bounded, and the full archive never enters the JavaScript
bundle or a participant's browser. A failed manifest lookup is retried on demand
after a one-minute cooldown so temporary failures do not permanently restrict
play to the original small pack. Keep `run_worker_first: true`; never create
asset redirects/rewrites into the private prefix. Source archives are not
deployed. Development keeps packs outside `public/` and blocks filesystem access.

Static assets do not add storage charges on Workers Free; the deployment remains
subject to the Free account's enforced limits. Worker-first requests consume
Worker request quota, including public files, and fail rather than bypassing the
guard at the daily limit. See [Cloudflare's asset limits](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/).
