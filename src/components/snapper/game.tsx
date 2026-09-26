import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import {
  ArrowRight,
  Check,
  CircleHelp,
  Clock3,
  Crown,
  Eye,
  Flag,
  Hand,
  MessageCircle,
  MoreHorizontal,
  Pause,
  Play,
  Radio,
  RotateCcw,
  Settings2,
  ShieldCheck,
  SkipForward,
  Trophy,
  Users,
  X,
  Zap,
} from "lucide-react";
import {
  FORMAT_LABELS,
  type GameAction,
  type PlayerView,
  type SessionView,
} from "@/snapper/protocol";
import type { SessionController } from "@/snapper/use-session";
import { gameShortcut, moderationActions } from "@/snapper/shortcuts";
import { Chat, Scoreboard, SeatButtons } from "./community";
import { Menu } from "./menu";

export type Confirm = (
  title: string,
  text: string,
  action: () => boolean | void,
  label?: string,
) => void;

export function Game({
  session,
  unlockSound,
  confirm,
}: {
  session: SessionController;
  unlockSound: () => void;
  confirm: Confirm;
}) {
  const state = session.view!;
  const self = state.players.find((player) => player.id === state.selfId);
  const [tab, setTab] = useState<"game" | "scores" | "chat">("game");
  const [localAnswer, setLocalAnswer] = useState<{ windowId: string | null; text: string }>({
    windowId: null,
    text: "",
  });
  const inputWindowId = state.answerWindowId
    ? `${session.answerInputVersion}:${state.answerWindowId}`
    : null;
  // A new attempt must never publish the previous attempt's text during an effect reset.
  const answer = localAnswer.windowId === inputWindowId ? localAnswer.text : "";
  const setAnswer = useCallback(
    (text: string) => setLocalAnswer({ windowId: inputWindowId, text }),
    [inputWindowId],
  );
  const [submitted, setSubmitted] = useState(false);
  const [now, setNow] = useState(Date.now());
  const answerInput = useRef<HTMLInputElement>(null);
  const chatInput = useRef<HTMLInputElement>(null);
  const chatFocusRequested = useRef(false);
  const buzzZone = useRef<HTMLDivElement>(null);
  const [actionsHeight, setActionsHeight] = useState(180);
  const [keyboardInset, setKeyboardInset] = useState(0);
  const question = state.question;
  const connected = session.connection === "connected",
    paused = state.pausedReasons.length > 0;
  const canBuzz = state.canBuzz && connected && !paused,
    canAnswer = state.canAnswer && connected && !paused;
  const currentAnswerer = state.players.find((player) => player.id === state.answererId);
  const seconds = state.deadline
    ? Math.max(0, (state.deadline - now - session.clockOffset) / 1000)
    : null;
  const send = session.send;
  const { updateAnswerDraft, cancelAnswerDraft } = session;
  const buzz = useCallback(() => {
    if (canBuzz) {
      unlockSound();
      send({ type: "buzz" });
    }
  }, [canBuzz, unlockSound, send]);
  const skip = useCallback(() => {
    if (!moderationActions(state, connected).skip) return;
    confirm(
      "Skip this question?",
      "Reveal this answer and continue. This question stays in the session's seen history.",
      () => send({ type: "skip" }),
    );
  }, [state, connected, confirm, send]);
  useEffect(() => {
    if (tab !== "chat" || !chatFocusRequested.current) return;
    chatFocusRequested.current = false;
    if (connected) chatInput.current?.focus();
  }, [tab, connected]);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    setAnswer("");
    setSubmitted(false);
  }, [question?.id, setAnswer]);
  useEffect(() => {
    if (canAnswer && !submitted) updateAnswerDraft(answer);
    else cancelAnswerDraft();
  }, [answer, canAnswer, submitted, updateAnswerDraft, cancelAnswerDraft]);
  useEffect(() => {
    setSubmitted(false);
  }, [state.attempts.length, state.canAnswer]);
  useEffect(() => {
    if (!canAnswer || submitted) return;
    setTab("game");
    const frame = requestAnimationFrame(() => answerInput.current?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(frame);
  }, [canAnswer, submitted]);
  useEffect(() => {
    const element = buzzZone.current;
    if (!element) return;
    const measure = () => setActionsHeight(Math.ceil(element.getBoundingClientRect().height));
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    measure();
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const measure = () =>
      setKeyboardInset(Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop));
    viewport.addEventListener("resize", measure);
    viewport.addEventListener("scroll", measure);
    measure();
    return () => {
      viewport.removeEventListener("resize", measure);
      viewport.removeEventListener("scroll", measure);
    };
  }, []);
  useEffect(() => {
    if (session.error) setSubmitted(false);
  }, [session.error]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      const blocked = Boolean(
        document.querySelector("dialog[open], details[data-action-menu][open]") ||
        target?.closest(
          "input,textarea,select,button,a,summary,[role='button'],[role='textbox'],[contenteditable]:not([contenteditable='false'])",
        ),
      );
      const action = gameShortcut(
        event,
        { ...moderationActions(state, connected), canBuzz, canChat: connected },
        blocked,
      );
      if (!action) return;
      event.preventDefault();
      if (action === "buzz") buzz();
      else if (action === "skip") skip();
      else if (action === "chat") {
        if (tab === "chat") chatInput.current?.focus();
        else {
          chatFocusRequested.current = true;
          setTab("chat");
        }
      } else send({ type: action });
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [buzz, canBuzz, connected, send, skip, state, tab]);
  const players = state.players.filter((player) => player.role === "player" && player.connected);
  const spectators = state.players.filter(
    (player) => player.role === "spectator" && player.connected,
  );
  const assignedTo =
    state.block?.format === "assigned" && state.phase !== "reveal"
      ? state.players.find((player) => player.id === (state.answererId ?? state.eligibleIds[0]))
      : undefined;
  const eligibility = !connected
    ? "Reconnecting — your score stays with you."
    : self?.role === "spectator"
      ? "You're watching this round."
      : paused
        ? "The game is paused."
        : canAnswer
          ? "Type your answer."
          : state.phase === "answering"
            ? `${currentAnswerer?.name ?? "A player"} has the buzzer.`
            : state.phase === "reveal"
              ? state.config.autoAdvance
                ? "The next question will start automatically."
                : "Ready when the moderator advances."
              : canBuzz
                ? "Buzz to answer."
                : state.phase === "waiting"
                  ? "Waiting for a moderator to start."
                  : "You are not eligible to buzz on this question.";
  return (
    <main
      id="main-content"
      className="game-shell"
      style={
        {
          "--mobile-actions-height": `${actionsHeight}px`,
          "--keyboard-inset": `${keyboardInset}px`,
        } as CSSProperties
      }
    >
      <div className="game-topline">
        <div>
          <span className="eyebrow">ACTIVE SESSION</span>
          <h1>{state.config.mode === "teams" ? "Two teams" : "Free-for-all"}</h1>
        </div>
        <div className="lobby-counts">
          <span>
            <Users size={16} />
            {players.length}/16 playing
          </span>
          <span>
            <Eye size={16} />
            {spectators.length}/16 watching
          </span>
        </div>
      </div>
      {state.canModerate && (
        <Moderation
          state={state}
          self={self}
          send={send}
          connected={connected}
          confirm={confirm}
          skip={skip}
        />
      )}
      {state.pendingConfig && (
        <div className="pending-config">
          <Settings2 size={15} /> New lobby rules are ready for the next block.
          {state.pendingConfig.mode !== state.config.mode && " The mode change will reset scores."}
        </div>
      )}
      {self?.owner && state.pendingAdmissions.length > 0 && (
        <Admissions state={state} send={send} />
      )}
      {state.notice && (
        <div className="inline-notice" role="status">
          <CircleHelp size={17} />
          <span>{state.notice}</span>
        </div>
      )}
      {!connected && (
        <div className="inline-notice reconnect-notice" role="status">
          <Radio size={17} />
          <span>Connection interrupted. Rejoining automatically; the game clock continues.</span>
        </div>
      )}
      <nav className="mobile-tabs" aria-label="Game panels">
        {(
          [
            ["game", Zap, "Play"],
            ["scores", Trophy, "Scores"],
            ["chat", MessageCircle, "Chat"],
          ] as const
        ).map(([value, Icon, label]) => (
          <button
            key={value}
            onClick={() => setTab(value)}
            className={tab === value ? "selected" : ""}
            aria-current={tab === value ? "page" : undefined}
          >
            <Icon size={18} />
            {label}
          </button>
        ))}
      </nav>
      <div className="game-grid">
        <section
          className={`play-column mobile-panel ${tab === "game" ? "mobile-active" : ""}`}
          aria-label="Current game"
        >
          <div className="question-card">
            <div className="question-header">
              <span className={`format-badge format-${state.block?.format ?? "snapper"}`}>
                <Zap size={14} fill="currentColor" />
                {state.block ? FORMAT_LABELS[state.block.format] : "Waiting"}
              </span>
              <div className="question-meta">
                {question && <span>{question.category}</span>}
                {state.block && state.block.count > 1 && (
                  <span>
                    Part {state.block.index + 1} / {state.block.count}
                  </span>
                )}
              </div>
            </div>
            {paused && (
              <div className="pause-strip" role="status">
                <Pause size={17} fill="currentColor" />
                <span>
                  {state.challenge
                    ? `${state.challenge.name} challenged this ruling.`
                    : state.pausedReasons.join(". ")}
                </span>
                {state.canModerate && (
                  <button
                    onClick={() => send({ type: state.challenge ? "resolve-challenge" : "resume" })}
                  >
                    {state.challenge ? "Resolve challenge" : "Resume"}
                    <Play size={13} />
                  </button>
                )}
              </div>
            )}
            <div className={`question-body ${state.phase === "answering" ? "is-answering" : ""}`}>
              {question ? (
                <>
                  <div className="question-context">
                    <span>
                      {state.block?.title}
                      {assignedTo && (
                        <span className="assigned-to">Answering: {assignedTo.name}</span>
                      )}
                    </span>
                    {question.clueNumber !== null && (
                      <span className="clue-marker">Clue {question.clueNumber} of 4</span>
                    )}
                  </div>
                  <p className="question-text" aria-live="off">
                    {question.text || (
                      <span className="question-start">Here comes your question…</span>
                    )}
                    {state.phase === "reading" && !question.readingComplete && !paused && (
                      <span className="reading-caret" aria-hidden="true" />
                    )}
                  </p>
                  {question.sequenceLength !== null && (
                    <p className="sequence-hint">
                      Give {question.sequenceLength} items in order, separated by commas.
                    </p>
                  )}
                  {state.phase === "answering" &&
                    state.answerWindowId &&
                    currentAnswerer &&
                    currentAnswerer.id !== self?.id && (
                      <section
                        className="live-guess"
                        aria-label={`Live guess from ${currentAnswerer.name}`}
                        aria-live="off"
                      >
                        <div className="live-guess-heading">
                          <strong>
                            {currentAnswerer.name}
                            {connected && currentAnswerer.connected && !paused
                              ? " is typing…"
                              : "’s guess"}
                          </strong>
                          <span>Not submitted</span>
                        </div>
                        <p className={state.answerDraft ? "" : "live-guess-empty"}>
                          {state.answerDraft || "No text yet"}
                        </p>
                      </section>
                    )}
                  {question.answer !== null && (
                    <div className="answer-reveal">
                      <span className="answer-label">
                        <Check size={16} />
                        THE ANSWER
                      </span>
                      <h2>{question.answer}</h2>
                      {question.provenance && (
                        <p>
                          {question.provenance.url ? (
                            <a href={question.provenance.url} target="_blank" rel="noreferrer">
                              {question.provenance.label}
                            </a>
                          ) : (
                            question.provenance.label
                          )}
                          <span> · {question.provenance.license}</span>
                          {question.provenance.authors && (
                            <span> · {question.provenance.authors}</span>
                          )}
                        </p>
                      )}
                    </div>
                  )}
                </>
              ) : (
                <div className="waiting-stage">
                  <span className="stage-star">✦</span>
                  <h2>Ready to start</h2>
                  <p>
                    {state.canModerate
                      ? "Start the first round whenever your friends are ready."
                      : "A moderator will start the questions. Your buzzer will be ready."}
                  </p>
                  {state.canModerate && (
                    <button
                      className="button primary"
                      onClick={() => send({ type: "start" })}
                      disabled={!connected}
                    >
                      <Play size={19} fill="currentColor" /> Start game
                    </button>
                  )}
                </div>
              )}
            </div>
            <div className="question-bottom">
              <span className={`phase-label phase-${state.phase}`}>
                <span className="status-dot" />
                {paused
                  ? "Paused"
                  : state.phase === "reading"
                    ? question?.readingComplete
                      ? "Last chance to buzz"
                      : "Question unfolding"
                    : state.phase === "answering"
                      ? "Answer in progress"
                      : state.phase === "reveal"
                        ? "Answer revealed"
                        : "Waiting for the first round"}
              </span>
              {seconds !== null &&
                !paused &&
                (state.phase !== "reveal" || state.config.autoAdvance) && (
                  <span
                    className={`countdown ${seconds < 3 ? "is-urgent" : ""}`}
                    aria-label={`${state.phase === "answering" ? "Answer" : "Round"} timer`}
                    aria-live="off"
                  >
                    <Clock3 size={16} />
                    <span aria-hidden="true">
                      {seconds.toFixed(1)}
                      <small>s</small>
                    </span>
                  </span>
                )}
            </div>
          </div>
          <div className="buzz-zone" ref={buzzZone}>
            <div className="buzz-copy" role="status" aria-live="polite">
              <span className="your-name">
                {self?.name ?? "Your seat"}
                {self?.owner && <Crown size={13} />}
              </span>
              <span>{eligibility}</span>
            </div>
            {self?.role === "spectator" ? (
              <div className="spectator-actions">
                <span>
                  <Eye size={22} />
                  Spectating
                </span>
                <SeatButtons state={state} send={send} disabled={!connected} />
              </div>
            ) : (
              <>
                {state.config.mode === "teams" && !self?.team && (
                  <div className="choose-team-callout">
                    <strong>Choose your team to play</strong>
                    {(["A", "B"] as const).map((team) => (
                      <button
                        className="button secondary mini"
                        key={team}
                        onClick={() => send({ type: "team", team })}
                      >
                        Team {team}
                      </button>
                    ))}
                  </div>
                )}
                {state.phase === "answering" && state.answererId === self?.id && (
                  <p className="answer-visibility">The lobby can see what you type.</p>
                )}
                <form
                  className={`answer-form ${canAnswer ? "is-answering" : ""}`}
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (
                      canAnswer &&
                      answer.trim() &&
                      !submitted &&
                      send({ type: "answer", text: answer.trim() })
                    ) {
                      setSubmitted(true);
                      setAnswer("");
                    }
                  }}
                >
                  <label className="sr-only" htmlFor="answer-input">
                    Your answer
                  </label>
                  <input
                    ref={answerInput}
                    id="answer-input"
                    type="text"
                    autoComplete="off"
                    autoCorrect="off"
                    spellCheck={false}
                    enterKeyHint="send"
                    value={answer}
                    onChange={(event) => setAnswer(event.target.value)}
                    disabled={!canAnswer || submitted}
                    maxLength={500}
                    placeholder={
                      canAnswer
                        ? question?.sequenceLength
                          ? "Your answers, in order…"
                          : "Type your answer…"
                        : "Buzz first. Then type your answer."
                    }
                  />
                  <button
                    className="answer-send"
                    aria-label="Submit answer"
                    type="submit"
                    disabled={!canAnswer || !answer.trim() || submitted}
                  >
                    <ArrowRight size={23} />
                  </button>
                </form>
                <button
                  className={`buzzer ${canBuzz ? "buzzer-ready" : ""}`}
                  disabled={!canBuzz}
                  onClick={buzz}
                >
                  <span>
                    <Zap size={27} fill="currentColor" />
                    {canAnswer
                      ? "YOU'RE UP!"
                      : state.phase === "answering"
                        ? "BUZZER CLAIMED"
                        : "BUZZ IN"}
                  </span>
                  <kbd>SPACE</kbd>
                </button>
              </>
            )}
          </div>
          {question && (
            <div className="question-actions">
              <button
                className="text-link subtle"
                disabled={Boolean(state.challenge) || !connected || !state.attempts.length}
                onClick={() => send({ type: "challenge" })}
              >
                <Flag size={15} />
                {state.challenge ? "Challenge pending" : "Challenge a ruling"}
              </button>
              <span>Current question only.</span>
            </div>
          )}
          {state.attempts.length > 0 && <Attempts state={state} send={send} confirm={confirm} />}
        </section>
        <aside className="side-column">
          <section
            className={`score-panel mobile-panel ${tab === "scores" ? "mobile-active" : ""}`}
          >
            <Scoreboard state={state} self={self} send={send} confirm={confirm} />
          </section>
          <section className={`chat-panel mobile-panel ${tab === "chat" ? "mobile-active" : ""}`}>
            <Chat state={state} send={send} connected={connected} inputRef={chatInput} />
          </section>
        </aside>
      </div>
    </main>
  );
}

function Admissions({
  state,
  send,
}: {
  state: SessionView;
  send: (action: GameAction) => boolean;
}) {
  return (
    <section className="admission-panel" aria-label="Join requests">
      <div>
        <Hand size={19} />
        <h2>Join requests</h2>
        <span className="count-badge">{state.pendingAdmissions.length}</span>
      </div>
      <ul>
        {state.pendingAdmissions.map((request) => (
          <li key={request.id}>
            <span>
              <strong>{request.name}</strong>
              <small>{request.role === "spectator" ? "Spectator" : "Player"}</small>
            </span>
            <div>
              <button
                className="button mini secondary"
                onClick={() => send({ type: "reject", requestId: request.id })}
              >
                Decline
              </button>
              <button
                className="button mini primary"
                onClick={() => send({ type: "approve", requestId: request.id })}
              >
                <Check size={15} /> Approve
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Attempts({
  state,
  send,
  confirm,
}: {
  state: SessionView;
  send: (action: GameAction) => boolean;
  confirm: Confirm;
}) {
  return (
    <section className="attempts-panel" aria-label="Answers to the current question">
      <div className="attempts-heading">
        <span>THIS QUESTION</span>
        <span>
          {state.attempts.length} {state.attempts.length === 1 ? "attempt" : "attempts"}
        </span>
      </div>
      <ol>
        {state.attempts.map((attempt) => (
          <li key={attempt.id}>
            <span className={`verdict-icon verdict-${attempt.verdict}`}>
              {attempt.verdict === "accept" ? (
                <Check size={16} />
              ) : attempt.verdict === "prompt" ? (
                <CircleHelp size={16} />
              ) : (
                <X size={16} />
              )}
            </span>
            <div className="attempt-content">
              <strong>{attempt.name}</strong>
              <span className="attempt-answer">{attempt.answer || "Time ran out"}</span>
              <small>
                {attempt.verdict === "prompt"
                  ? "Asked to be more specific"
                  : attempt.verdict === "accept"
                    ? "Correct"
                    : "Not accepted"}
                {attempt.corrected ? " · Corrected" : ""}
              </small>
            </div>
            <strong className={`attempt-points ${attempt.points > 0 ? "positive" : ""}`}>
              {attempt.points > 0 ? "+" : ""}
              {attempt.points}
            </strong>
            {state.canModerate && (
              <Menu className="correction-menu" trigger="Correct">
                {(["accept", "reject"] as const).map((verdict) => (
                  <button
                    key={verdict}
                    disabled={attempt.verdict === verdict}
                    onClick={() =>
                      confirm(
                        `Correct ${attempt.name}'s answer?`,
                        `Mark “${attempt.answer || "No answer"}” as ${verdict === "accept" ? "correct" : "incorrect"}. Scores and this question's eligibility will be recalculated.`,
                        () => {
                          send({ type: "correct", attemptId: attempt.id, verdict });
                        },
                      )
                    }
                  >
                    {verdict === "accept" ? "Mark correct" : "Mark incorrect"}
                  </button>
                ))}
              </Menu>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}

function Moderation({
  state,
  self,
  send,
  connected,
  confirm,
  skip,
}: {
  state: SessionView;
  self?: PlayerView;
  send: (action: GameAction) => boolean;
  connected: boolean;
  confirm: Confirm;
  skip: () => void;
}) {
  const controls = moderationActions(state, connected);
  return (
    <section className="moderation-panel" aria-label="Moderator controls">
      <div className="moderation-label">
        <ShieldCheck size={15} />
        <span>{self?.owner ? "HOST CONTROLS" : "MODERATOR CONTROLS"}</span>
      </div>
      <div className="moderation-buttons">
        {state.phase === "waiting" ? (
          <button
            className="button primary mini"
            disabled={!connected}
            onClick={() => send({ type: "start" })}
          >
            <Play size={15} />
            Start game
          </button>
        ) : (
          <>
            <button
              className="button secondary mini"
              disabled={!controls.pause}
              onClick={() => controls.pause && send({ type: controls.pause })}
              title={`${state.pausedReasons.length ? "Resume" : "Pause"} (P)`}
              aria-keyshortcuts="P"
            >
              {state.pausedReasons.length ? <Play size={15} /> : <Pause size={15} />}
              {state.pausedReasons.length ? "Resume" : "Pause"}
              <kbd aria-hidden="true">P</kbd>
            </button>
            <button
              className="button secondary mini"
              disabled={!controls.next}
              onClick={() => send({ type: "next" })}
              title="Next question (N)"
              aria-keyshortcuts="N"
            >
              <ArrowRight size={15} />
              Next
              <kbd aria-hidden="true">N</kbd>
            </button>
            <button
              className="button secondary mini"
              disabled={!controls.skip}
              onClick={skip}
              title="Skip question (S)"
              aria-keyshortcuts="S"
            >
              <SkipForward size={15} />
              Skip
              <kbd aria-hidden="true">S</kbd>
            </button>
            <button
              className="button quiet mini"
              disabled={!connected}
              onClick={() =>
                confirm(
                  "End this format block?",
                  "Finish the current block and move to the next playable format. Current question rulings become final when play advances.",
                  () => {
                    send({ type: "end-block" });
                  },
                )
              }
            >
              End block
            </button>
          </>
        )}
        <Menu
          className="more-controls"
          triggerClassName="button quiet mini"
          trigger={
            <>
              <MoreHorizontal size={18} /> More
            </>
          }
        >
          <button
            onClick={() =>
              confirm(
                "Reset everyone's scores?",
                "Set player and team scores back to zero. The questions already seen and the chat stay in this session.",
                () => {
                  send({ type: "reset-scores" });
                },
              )
            }
          >
            <RotateCcw size={15} />
            Reset all scores
          </button>
          {self?.owner && (
            <button
              className="danger-text"
              onClick={() =>
                confirm(
                  "End this session?",
                  "Close the lobby for everyone and clear this session's scores, chat and approvals. Your saved lobby settings stay ready for next time.",
                  () => {
                    send({ type: "close-session" });
                  },
                )
              }
            >
              <Flag size={15} />
              End the session
            </button>
          )}
        </Menu>
      </div>
    </section>
  );
}
