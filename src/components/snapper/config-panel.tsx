import { useState } from "react";
import { Check, ChevronDown, SlidersHorizontal } from "lucide-react";
import {
  CATEGORIES,
  configSchema,
  FORMATS,
  FORMAT_LABELS,
  normalizeFormats,
  type RoomConfig,
} from "@/snapper/protocol";

interface Props {
  config: RoomConfig;
  editable: boolean;
  onSave: (config: RoomConfig) => void;
  pending: boolean;
}

export function ConfigPanel({ config, editable, onSave, pending }: Props) {
  const [edited, setDraft] = useState<RoomConfig>(() => configSchema.parse(config));
  const draft = editable ? edited : configSchema.parse(config);
  const [error, setError] = useState("");
  const update = <K extends keyof RoomConfig>(key: K, value: RoomConfig[K]) =>
    setDraft((current) => {
      const next = { ...current, [key]: value };
      return { ...next, formats: normalizeFormats(next.mode, next.formats) };
    });
  const numeric = (
    label: string,
    key: "wpm" | "answerMs" | "sequenceMs" | "graceMs" | "revealMs",
    min: number,
    max: number,
    seconds = false,
  ) => (
    <label className="setting-field" key={key}>
      <span>{label}</span>
      <div className="number-field">
        <input
          type="number"
          min={min}
          max={max}
          step={seconds ? 0.1 : 1}
          value={seconds ? draft[key] / 1000 : draft[key]}
          onChange={(event) =>
            update(key, Math.round(Number(event.target.value) * (seconds ? 1000 : 1)))
          }
        />
        <span>{seconds ? "sec" : "wpm"}</span>
      </div>
    </label>
  );
  return (
    <form
      className="config-form"
      onSubmit={(event) => {
        event.preventDefault();
        const parsed = configSchema.safeParse(draft);
        if (!parsed.success) {
          setError("Check the selected options and number ranges before saving.");
          return;
        }
        onSave(parsed.data);
      }}
    >
      <p className="panel-intro">
        {editable
          ? "Saved settings take effect at the next format block."
          : "These are the rules currently in play. The owner can change them for the next block."}
      </p>
      {pending && (
        <div className="inline-notice">
          <SlidersHorizontal size={17} /> A rules update is queued for the next block.
        </div>
      )}
      <fieldset disabled={!editable}>
        <legend>How we play</legend>
        <div className="segmented mode-choice">
          <button
            type="button"
            className={draft.mode === "ffa" ? "selected" : ""}
            aria-pressed={draft.mode === "ffa"}
            onClick={() => update("mode", "ffa")}
          >
            Free-for-all
          </button>
          <button
            type="button"
            className={draft.mode === "teams" ? "selected" : ""}
            aria-pressed={draft.mode === "teams"}
            onClick={() => update("mode", "teams")}
          >
            Two teams
          </button>
        </div>
        <p className="field-hint">Switching modes resets scores at the next block.</p>
        <div className="setting-check">
          <input
            id="automatic"
            type="checkbox"
            checked={draft.autoAdvance}
            onChange={(event) => update("autoAdvance", event.target.checked)}
          />
          <label htmlFor="automatic">
            <strong>Automatic advance</strong>
            <span>Automatically advance after the answer reveal.</span>
          </label>
        </div>
        <div className="setting-check">
          <input
            id="progressive"
            type="checkbox"
            checked={draft.shortProgressive}
            onChange={(event) => update("shortProgressive", event.target.checked)}
          />
          <label htmlFor="progressive">
            <strong>Reveal short questions gradually</strong>
            <span>Long tossups always reveal progressively.</span>
          </label>
        </div>
      </fieldset>
      <fieldset disabled={!editable}>
        <legend>The question mix</legend>
        <p className="field-hint">
          Each new block picks a playable format at random. Formats may repeat; questions do not.
        </p>
        <div className="option-grid">
          {FORMATS.map((format) => (
            <label
              className={`check-tile ${draft.formats.includes(format) ? "checked" : ""}`}
              key={format}
            >
              <input
                type="checkbox"
                checked={draft.formats.includes(format)}
                disabled={
                  (format === "shootout" && draft.mode === "ffa") ||
                  (draft.formats.length === 1 && draft.formats.includes(format))
                }
                onChange={(event) =>
                  update(
                    "formats",
                    event.target.checked
                      ? [...draft.formats, format]
                      : draft.formats.filter((item) => item !== format),
                  )
                }
              />
              <span>
                {FORMAT_LABELS[format]}
                {(format === "team" || format === "shootout") && <small>Two teams required</small>}
              </span>
              <Check size={15} aria-hidden="true" />
            </label>
          ))}
        </div>
        <div className="settings-two">
          <label className="setting-field">
            <span>Difficulty</span>
            <div className="select-wrap">
              <select
                value={draft.difficulty}
                onChange={(event) =>
                  update("difficulty", event.target.value as RoomConfig["difficulty"])
                }
              >
                <option value="easy">Easy</option>
                <option value="medium">Medium</option>
                <option value="hard">Hard</option>
                <option value="unrated">Unrated</option>
                <option value="any">Any difficulty</option>
              </select>
              <ChevronDown size={16} />
            </div>
          </label>
          <label className="setting-field">
            <span>Question language</span>
            <div className="select-wrap">
              <select value={draft.language} onChange={() => undefined}>
                <option value="en">English</option>
              </select>
              <ChevronDown size={16} />
            </div>
          </label>
        </div>
        <p className="field-hint">
          Medium uses regular high-school quizbowl and medium short trivia. Difficulty varies
          between sources.
        </p>
        <label className="setting-field">
          <span>Question sources</span>
          <div className="select-wrap">
            <select
              value={draft.source}
              onChange={(event) => update("source", event.target.value as RoomConfig["source"])}
            >
              <option value="mixed">Fresh questions + built-in packs</option>
              <option value="bundled">Built-in packs only</option>
            </select>
            <ChevronDown size={16} />
          </div>
        </label>
        <div className="topic-options">
          {CATEGORIES.map((category) => (
            <label className="topic-chip" key={category}>
              <input
                type="checkbox"
                checked={draft.categories.includes(category)}
                disabled={draft.categories.length === 1 && draft.categories.includes(category)}
                onChange={(event) =>
                  update(
                    "categories",
                    event.target.checked
                      ? [...draft.categories, category]
                      : draft.categories.filter((item) => item !== category),
                  )
                }
              />
              <span>{category}</span>
            </label>
          ))}
        </div>
        <p className="field-hint">
          Empty formats are skipped. Play pauses when no unseen questions match your choices.
        </p>
      </fieldset>
      <fieldset disabled={!editable}>
        <legend>Pace & timers</legend>
        <div className="settings-two">
          {numeric("Reading speed", "wpm", 80, 500)}
          {numeric("Time to answer", "answerMs", 3, 60, true)}
          {numeric("Sequence answer time", "sequenceMs", 5, 120, true)}
          {numeric("Buzz after reading", "graceMs", 1, 30, true)}
          {numeric("Answer reveal", "revealMs", 1, 60, true)}
        </div>
      </fieldset>
      <fieldset disabled={!editable}>
        <legend>Scoring</legend>
        <div className="settings-two">
          {(
            [
              ["Regular correct answer", "regular", 1, 100],
              ["Early tossup answer", "power", 1, 200],
              ["Complete sequence", "sequence", 1, 200],
              ["Tossup penalty", "penalty", -100, 0],
            ] as const
          ).map(([label, key, min, max]) => (
            <label className="setting-field" key={key}>
              <span>{label}</span>
              <div className="number-field">
                <input
                  type="number"
                  min={min}
                  max={max}
                  step="1"
                  value={draft.points[key]}
                  onChange={(event) =>
                    update("points", { ...draft.points, [key]: Number(event.target.value) })
                  }
                />
                <span>pts</span>
              </div>
            </label>
          ))}
        </div>
        <div className="setting-check">
          <input
            id="negs"
            type="checkbox"
            checked={draft.negs}
            onChange={(event) => update("negs", event.target.checked)}
          />
          <label htmlFor="negs">
            <strong>Enable tossup penalties</strong>
            <span>Only long tossups use negative scoring.</span>
          </label>
        </div>
        <label className="setting-label">Who / What am I? — points by clue</label>
        <div className="clue-points">
          {draft.points.clues.map((value, index) => (
            <label key={index}>
              <span>Clue {index + 1}</span>
              <input
                aria-label={`Points for clue ${index + 1}`}
                type="number"
                min="1"
                max="200"
                step="1"
                value={value}
                onChange={(event) => {
                  const clues = [...draft.points.clues] as RoomConfig["points"]["clues"];
                  clues[index] = Number(event.target.value);
                  update("points", { ...draft.points, clues });
                }}
              />
            </label>
          ))}
        </div>
      </fieldset>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {editable && (
        <div className="config-save">
          <button className="button primary" type="submit">
            <Check size={18} /> Save for next block
          </button>
          <span>Only room rules are saved between sessions.</span>
        </div>
      )}
    </form>
  );
}
