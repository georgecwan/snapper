# Repository questions

These are English question snapshots for Snapper's offline fallback. `questions/`
contains generated, playable JSON shards. `sources/` contains the complete
compressed source snapshots, checksums and license text. **Neither directory is
a public website directory.** The Worker alone reads the question assets; it
reveals only the current allowed text/answer through the game protocol.

Current import: **77,947 unique playable additions**: 40,356 long QANTA tossups,
33,892 OpenTriviaQA short questions and 3,699 OpenTDB short questions. Alongside
the 147 original atoms, that is **78,094 playable question atoms**. Authored group
parts are shared with short questions and are not counted twice. The archives
retain 174,261 source records, including duplicates and held-out entries.

The generated catalog has 8,685 medium, 1,843 easy, 33,527 hard and 33,892 unrated
additions across 72 category/format/difficulty groups and 650 shards. Its JSON
shards occupy about 70 MB on disk, separate from the Worker bundle.

## Rights and provenance

All imported datasets and Snapper's adaptations of them are distributed under
**[Creative Commons Attribution-ShareAlike 4.0 International](https://creativecommons.org/licenses/by-sa/4.0/)**.
See [the full license](sources/CC-BY-SA-4.0.txt). This applies to the imported
question data and its adaptations, not a new license declaration for the entire
application. Each playable question retains attribution, a source link, the
license and a description of modifications. Do not strip those fields.

| Collection | Attribution and permission | Snapshot |
|---|---|---|
| QANTA | University of Maryland QANTA team and original question authors. The [official leaderboard](https://pinafore.github.io/qanta-leaderboard/) explicitly licenses the **dataset** under CC BY-SA 4.0. | Train/dev/test version `2018.04.18`, 119,247 records. Dead upstream download links were replaced by an [exact version-pinned mirror](https://huggingface.co/datasets/TasnimKabir12/qanta/tree/12d2ce9c99e55643c0116f4623d3ac72656f7f7d); raw file hashes are in the source manifest. These are whole tossups, not sentence fragments. |
| OpenTriviaQA | uberspot and contributors; [the publisher's dataset license](https://github.com/uberspot/OpenTriviaQA/blob/dd31530bfbb19f9505b160b89c9df4b1127e3c70/README.md). The publisher describes the questions as gathered; individual upstream authors are not supplied. | Commit `dd31530bfbb19f9505b160b89c9df4b1127e3c70`, 49,716 records. Deliberately predates a later experimental LLM rewrite. |
| Open Trivia DB | PixelTail Games and contributors; [API data license](https://opentdb.com/api_config.php). | All 5,298 verified questions retrieved on 2026-09-26, using a token and the documented five-second request limit. Pending/rejected questions were not downloaded. |

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
unconditional accept/prompt/reject rules. Required-word markup, conditional
instructions, comma-separated alias lists and multipart bonus dumps are excluded.
One explicit `(*)` marker becomes a character-based power boundary; absent markers
never receive an invented bonus. Double-power/multiple-marker questions are held
out. The visibly corrupted PACE NSC 2013 QuizDB batch is also held out.

This is automated screening plus sampled review, **not individual fact-checking
of every question**. Old facts, imperfect source categories, missing accepted
variants and residual extraction errors can remain. Use current-question
moderator corrections, and improve the source adapter or add a reviewed override
in the repository when a repeatable issue is found. Do not call these imports
the same individually reviewed content as the small original Snapper pack.

Difficulty is kept explicit. OpenTDB retains its own easy/medium/hard labels.
OpenTriviaQA has no supplied rating and is **Unrated**; choose Unrated or Any to
play it. QANTA uses approximate house bands relative to Snapper's high-school
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
  duplicates, canonical answers, provenance, power boundaries and file limits.
- `npm run questions:download:opentdb` is an explicit maintenance download to
  ignored `.question-cache/`, taking roughly ten minutes. Review a new snapshot,
  compress it into `sources/`, update its checksum/retrieval metadata, then
  rebuild and verify before committing it. Do not run downloads in CI builds.
- Preserve the original authored Open groups, team bonuses, Sequences and
  four-clue questions in `src/snapper/bank.ts`; unrelated imported questions do
  not automatically become authored groups or clue rounds.

## Hosting boundary

Builds copy only generated shards to `dist/snapper/_question-packs/`. The
Cloudflare Worker runs first for every request and returns 404 for private pack
paths, including encoded or ambiguous aliases. Its Durable Object reads shards
directly through `ASSETS`; no raw-pack HTTP route exists. The manifest/index and
shard caches are bounded, and the full archive never enters the JavaScript
bundle or a participant's browser. Keep `run_worker_first: true`; never create
asset redirects/rewrites into the private prefix. Source archives are not
deployed. Development keeps packs outside `public/` and blocks filesystem access.

Static assets do not add storage charges on Workers Free; the deployment remains
subject to the Free account's enforced limits. Worker-first requests consume
Worker request quota, including public files, and fail rather than bypassing the
guard at the daily limit. See [Cloudflare's asset limits](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/).
