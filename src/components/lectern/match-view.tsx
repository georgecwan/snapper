import { useEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Copy, LogOut, Volume2, VolumeX } from "lucide-react";
import { SETS, questionView, questionsFor, type SetId } from "@/game/questions";
import {
  WPM_CHOICES,
  currentQuestion,
  type Action,
  type RosterEntry,
  type State,
  type TeamId,
} from "@/game/engine";
import { playBad, playBuzz, playGood, setSoundEnabled, unlockSound } from "@/game/sfx";

type PeerLite = { id: string; name: string; connectionState: string };

type Props = {
  state: State;
  selfId: string;
  isHost: boolean;
  shown: number;
  clockOffset: number;
  peers: PeerLite[];
  joined: boolean;
  roomCode: string | null;
  act: (action: Action) => void;
};

function linkLabel(id: string, selfId: string, peers: PeerLite[], online: boolean) {
  if (id === selfId) return "you";
  const peer = peers.find((p) => p.id === id);
  if (!peer) return online ? "here" : "away";
  if (peer.connectionState === "connected") return "linked";
  if (peer.connectionState === "failed") return "no link";
  return "linking";
}

function teamTotal(roster: RosterEntry[], team: TeamId) {
  return roster.filter((r) => r.team === team).reduce((sum, r) => sum + r.score, 0);
}

export function MatchView({ state, selfId, isHost, shown, clockOffset, peers, joined, roomCode, act }: Props) {
  const navigate = useNavigate();
  const [draft, setDraft] = useState("");
  const [chat, setChat] = useState("");
  const [copied, setCopied] = useState(false);
  const [sound, setSound] = useState(true);
  const [now, setNow] = useState(() => Date.now());
  const answerRef = useRef<HTMLInputElement>(null);
  const soundRef = useRef(true);
  const prevReveal = useRef<string>("");

  const q = currentQuestion(state);
  const view = q ? questionView(q) : null;
  const me = state.roster.find((r) => r.id === selfId);
  const answerer = state.roster.find((r) => r.id === state.answererId);
  const locked =
    !!me &&
    (state.locks.includes(me.id) ||
      (state.settings.mode === "teams" &&
        !!me.team &&
        state.roster.some((r) => r.team === me.team && state.locks.includes(r.id))));
  const needsTeam = state.settings.mode === "teams" && !me?.team;
  const iAmAnswering = state.phase === "answer" && state.answererId === selfId;
  const revealLen = view ? view.visible.length : 0;
  const visibleCount =
    state.phase === "reveal" || state.phase === "complete" ? revealLen : Math.max(0, Math.min(shown, revealLen));
  const inPower = !!view && view.powerAt > 0 && visibleCount <= view.powerAt && state.phase === "reading";
  const ranked = [...state.roster].sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));

  useEffect(() => {
    const stored = localStorage.getItem("lectern-sound");
    if (stored === "0") {
      soundRef.current = false;
      setSound(false);
      setSoundEnabled(false);
    }
  }, []);

  useEffect(() => {
    const onPointer = () => unlockSound();
    window.addEventListener("pointerdown", onPointer);
    return () => window.removeEventListener("pointerdown", onPointer);
  }, []);

  useEffect(() => {
    if (state.phase !== "answer" && state.phase !== "reveal" && state.phase !== "reading") return;
    const id = window.setInterval(() => setNow(Date.now()), 100);
    return () => window.clearInterval(id);
  }, [state.phase]);

  useEffect(() => {
    if (!iAmAnswering) {
      setDraft("");
      return;
    }
    answerRef.current?.focus();
  }, [iAmAnswering, state.qIndex]);

  useEffect(() => {
    const reveal = state.reveal;
    const key = reveal ? `${state.qIndex}:${reveal.playerId}:${reveal.correct}:${reveal.reason}:${reveal.sealed}` : "";
    if (state.phase !== "reveal" || !reveal || key === prevReveal.current) return;
    prevReveal.current = key;
    if (!soundRef.current) return;
    if (reveal.playerId === selfId) {
      if (reveal.correct) playGood();
      else if (reveal.reason !== "skip") playBad();
    }
  }, [selfId, state.phase, state.qIndex, state.reveal]);

  function buzz() {
    if (state.phase !== "reading" || locked || needsTeam) return;
    unlockSound();
    if (soundRef.current) playBuzz();
    act({ type: "buzz", playerId: selfId, charAt: visibleCount });
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing = target?.tagName === "INPUT" || target?.tagName === "TEXTAREA";
      if (e.repeat) return;
      if (e.code === "Space" && !typing) {
        e.preventDefault();
        if (state.phase === "reading") buzz();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const hostNow = now + clockOffset;
  const answerLeft =
    state.phase === "answer" && state.answerEndsAt ? Math.max(0, (state.answerEndsAt - hostNow) / 1000) : 0;
  const graceLeft =
    state.phase === "reading" && !state.reading && state.graceEndsAt
      ? Math.max(0, (state.graceEndsAt - hostNow) / 1000)
      : 0;

  function leave() {
    void navigate({ to: "/", search: { room: "", practice: 0 } });
  }

  async function copyCode() {
    if (!roomCode) return;
    try {
      await navigator.clipboard.writeText(roomCode);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="min-h-screen" data-phase={state.phase}>
      <header className="sticky top-0 z-20 border-b border-line bg-bg/95 backdrop-blur-sm">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-4 py-3">
          <button type="button" onClick={leave} className="text-sm font-semibold tracking-widest text-brass">
            LECTERN
          </button>
          {roomCode ? (
            <button
              type="button"
              onClick={() => void copyCode()}
              className="inline-flex h-11 items-center gap-2 rounded-lg border border-line bg-surface px-3 text-sm font-semibold tracking-widest text-fg"
            >
              {roomCode}
              <Copy className="size-3.5 text-muted" aria-hidden="true" />
              <span className="sr-only">Copy room code</span>
              {copied && <span className="text-xs font-medium tracking-normal text-brass">Copied</span>}
            </button>
          ) : (
            <span className="text-sm text-muted">Practice</span>
          )}
          <div className="ml-auto flex items-center gap-2">
            <div className="flex rounded-lg border border-line p-0.5">
              {WPM_CHOICES.map((choice) => (
                <button
                  key={choice.wpm}
                  type="button"
                  disabled={!isHost}
                  onClick={() => act({ type: "settings", settings: { wpm: choice.wpm } })}
                  className={`h-9 rounded-md px-2.5 text-xs font-semibold sm:text-sm ${
                    state.settings.wpm === choice.wpm ? "bg-brass text-ink" : "text-muted"
                  } disabled:opacity-60`}
                >
                  {choice.label}
                </button>
              ))}
            </div>
            <button
              type="button"
              aria-label={sound ? "Mute sounds" : "Unmute sounds"}
              className="inline-flex size-11 items-center justify-center rounded-lg border border-line text-fg"
              onClick={() => {
                const next = !sound;
                setSound(next);
                soundRef.current = next;
                setSoundEnabled(next);
                localStorage.setItem("lectern-sound", next ? "1" : "0");
                if (next) unlockSound();
              }}
            >
              {sound ? <Volume2 className="size-4" /> : <VolumeX className="size-4" />}
            </button>
            <button
              type="button"
              onClick={leave}
              className="inline-flex size-11 items-center justify-center rounded-lg border border-line text-muted"
              aria-label="Leave"
            >
              <LogOut className="size-4" />
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-6xl gap-4 px-4 pt-4 pb-40 lg:grid-cols-[15rem_minmax(0,1fr)_16rem]">
        <aside className="order-2 lg:order-none">
          {state.settings.mode === "teams" && (
            <div className="mb-3 grid grid-cols-2 gap-2">
              <TeamScore name="Gold" score={teamTotal(state.roster, "gold")} brass />
              <TeamScore name="Pine" score={teamTotal(state.roster, "pine")} />
            </div>
          )}
          <ol className="flex gap-2 overflow-x-auto lg:flex-col lg:overflow-visible">
            {ranked.map((player, index) => (
              <li
                key={player.id}
                className={`min-w-36 shrink-0 rounded-xl border border-line bg-surface px-3 py-2 lg:min-w-0 ${
                  player.online ? "" : "opacity-50"
                }`}
              >
                <div className="flex items-baseline justify-between gap-2">
                  <p className="truncate text-sm font-medium text-fg">
                    <span className="mr-1 text-muted tabular-nums">{index + 1}</span>
                    {player.name}
                    {player.id === selfId && <span className="text-muted"> · you</span>}
                  </p>
                  <p key={player.score} className="score-pop text-lg font-semibold text-brass tabular-nums">
                    {player.score}
                  </p>
                </div>
                <p className="text-xs text-muted">
                  {player.team === "gold" ? "Gold" : player.team === "pine" ? "Pine" : "Open"}
                  {" · "}
                  {linkLabel(player.id, selfId, peers, player.online)}
                </p>
              </li>
            ))}
          </ol>
          {roomCode && !joined && <p className="mt-3 text-sm text-muted">Connecting the room…</p>}
          {roomCode && joined && peers.length === 0 && state.phase === "lobby" && (
            <p className="mt-3 text-sm text-pretty text-muted">Share the code. Friends join from their own phones.</p>
          )}
        </aside>

        <section className="order-1 min-w-0 lg:order-none">
          {state.phase === "lobby" ? (
            <Lobby state={state} isHost={isHost} selfId={selfId} act={act} />
          ) : state.phase === "complete" ? (
            <Complete state={state} isHost={isHost} act={act} />
          ) : (
            <article className="paper-card overflow-hidden">
              <div className="paper-rule" />
              <div className="px-5 py-5 sm:px-8 sm:py-7">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-semibold tracking-widest text-brass-deep">
                  <span>
                    {q?.category ?? "TOSSUP"} · {state.qIndex + 1}/{Math.max(state.questionIds.length, 1)}
                  </span>
                  <span>{inPower ? "15 IF YOU BUZZ" : "10 POINTS"}</span>
                </div>
                <p className="mt-4 min-h-48 font-serif text-2xl leading-relaxed text-pretty text-ink sm:text-3xl">
                  {view ? view.visible.slice(0, visibleCount) : "The packet is missing this card."}
                  {state.phase === "reading" && state.reading && <span className="caret" />}
                </p>
                {graceLeft > 0 && (
                  <p className="mt-4 text-sm font-medium text-brass-deep">
                    Last call — {graceLeft.toFixed(1)}s to buzz
                  </p>
                )}
                {state.phase === "reveal" && state.reveal && <RevealBlock reveal={state.reveal} />}
              </div>
            </article>
          )}

          {state.phase !== "lobby" && (
            <ul className="mt-4 space-y-1" aria-live="polite">
              {state.log.slice(-4).map((line) => (
                <li
                  key={line.id}
                  className={`text-sm ${
                    line.tone === "good" ? "text-good" : line.tone === "bad" ? "text-bad" : "text-muted"
                  }`}
                >
                  {line.text}
                </li>
              ))}
            </ul>
          )}

          <div className="mt-4 lg:hidden">
            <Chat state={state} selfId={selfId} chat={chat} setChat={setChat} act={act} />
          </div>
        </section>

        <aside className="hidden lg:block">
          <Chat state={state} selfId={selfId} chat={chat} setChat={setChat} act={act} />
        </aside>
      </div>

      {state.phase !== "lobby" && (
        <div className="buzz-dock fixed inset-x-0 bottom-0 z-30">
          <div className="mx-auto flex max-w-3xl flex-col gap-2 px-4 pt-3">
            {isHost && (state.phase === "reading" || state.phase === "answer") && (
              <div className="flex justify-end">
                <button type="button" className="h-10 px-2 text-sm text-muted" onClick={() => act({ type: "skip" })}>
                  Skip tossup
                </button>
              </div>
            )}
            {state.phase === "reading" && needsTeam && (
              <div className="flex gap-2">
                <button
                  type="button"
                  className="h-11 flex-1 rounded-xl bg-brass font-semibold text-ink"
                  onClick={() => act({ type: "team", playerId: selfId, team: "gold" })}
                >
                  Join Gold
                </button>
                <button
                  type="button"
                  className="h-11 flex-1 rounded-xl border border-line font-semibold text-fg"
                  onClick={() => act({ type: "team", playerId: selfId, team: "pine" })}
                >
                  Join Pine
                </button>
              </div>
            )}
            {state.phase === "reading" && (
              <button
                type="button"
                className="buzz-btn h-16 rounded-2xl bg-brass text-lg font-semibold text-ink transition-transform duration-150 ease-out active:scale-[0.96] disabled:bg-surface-2 disabled:text-muted"
                disabled={locked || needsTeam}
                onPointerDown={(e) => {
                  e.preventDefault();
                  buzz();
                }}
              >
                {needsTeam ? "Pick a side first" : locked ? "Locked out" : "Buzz"}
              </button>
            )}
            {iAmAnswering && (
              <form
                className="flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  act({ type: "answer", playerId: selfId, text: draft });
                }}
              >
                <input
                  ref={answerRef}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder="Your answer"
                  aria-label="Your answer"
                  className="h-14 min-w-0 flex-1 rounded-xl border border-line bg-paper px-3 font-serif text-lg text-ink outline-none"
                />
                <button type="submit" className="h-14 rounded-xl bg-brass px-4 font-semibold text-ink">
                  {answerLeft.toFixed(1)}s
                </button>
                <button
                  type="button"
                  className="h-14 rounded-xl border border-line px-3 text-sm text-fg"
                  onClick={() => act({ type: "answer", playerId: selfId, text: "" })}
                >
                  Pass
                </button>
              </form>
            )}
            {state.phase === "answer" && !iAmAnswering && (
              <p className="flex h-16 items-center justify-center rounded-2xl bg-surface text-fg">
                {answerer?.name ?? "Someone"} has the floor
                <span className="ml-2 tabular-nums text-brass">{answerLeft.toFixed(1)}s</span>
              </p>
            )}
            {state.phase === "reveal" && (
              <div className="flex gap-2">
                {isHost && state.reveal && !state.reveal.sealed && state.reveal.playerId && (
                  <button
                    type="button"
                    className="h-14 flex-1 rounded-xl border border-line font-semibold text-fg"
                    onClick={() => act({ type: "overturn" })}
                  >
                    Overturn
                  </button>
                )}
                {isHost ? (
                  <button
                    type="button"
                    className="h-14 flex-1 rounded-xl bg-brass font-semibold text-ink"
                    onClick={() => act({ type: "next" })}
                  >
                    Next tossup
                  </button>
                ) : (
                  <p className="flex h-14 flex-1 items-center justify-center text-muted">Waiting for the next card</p>
                )}
              </div>
            )}
            {state.phase === "complete" && isHost && (
              <button
                type="button"
                className="h-14 rounded-2xl bg-brass font-semibold text-ink"
                onClick={() => act({ type: "start" })}
              >
                Another packet
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function TeamScore({ name, score, brass }: { name: string; score: number; brass?: boolean }) {
  return (
    <div className={`rounded-xl px-3 py-2 ${brass ? "bg-brass text-ink" : "border border-line bg-surface text-fg"}`}>
      <p className="text-xs font-semibold tracking-widest uppercase">{name}</p>
      <p className="text-2xl font-semibold tabular-nums">{score}</p>
    </div>
  );
}

function RevealBlock({ reveal }: { reveal: NonNullable<State["reveal"]> }) {
  const headline =
    reveal.reason === "correct"
      ? `${reveal.playerName} for +${reveal.delta}${reveal.powered ? " on the power" : ""}`
      : reveal.reason === "nobody"
        ? "Nobody took it"
        : reveal.reason === "skip"
          ? "Passed over"
          : reveal.playerName
            ? `${reveal.playerName} did not have it`
            : "No score";
  return (
    <div className="mt-6 border-t border-ink/15 pt-4">
      <p className="text-sm font-medium text-ink-soft">{headline}</p>
      <p className="mt-1 font-serif text-3xl text-ink">{reveal.answer}</p>
      {reveal.playerAnswer && <p className="mt-2 text-sm text-ink-soft">Heard: {reveal.playerAnswer}</p>}
    </div>
  );
}

function Lobby({
  state,
  isHost,
  selfId,
  act,
}: {
  state: State;
  isHost: boolean;
  selfId: string;
  act: (action: Action) => void;
}) {
  const count = questionsFor(state.settings.setId).length;
  const me = state.roster.find((r) => r.id === selfId);
  return (
    <div className="rounded-2xl border border-line bg-surface p-5 sm:p-7">
      <h1 className="font-serif text-4xl text-balance text-fg">The packet is closed.</h1>
      <p className="mt-2 max-w-prose text-pretty text-muted">
        {isHost
          ? "You keep the clock. Pick a desk, then open it when the table is ready."
          : "The reader will open the packet. Sit tight, or talk on the side."}
      </p>
      <p className="mt-3 text-sm text-muted">
        Buzz on space. Before the hidden power mark is 15; after it, 10. A miss locks you out
        {state.settings.negs ? " and costs 5" : ""}. The reader can overturn a bad call.
      </p>

      <fieldset className="mt-6" disabled={!isHost}>
        <legend className="text-sm font-medium text-fg">Packet</legend>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {SETS.map((set) => (
            <button
              key={set.id}
              type="button"
              onClick={() => act({ type: "settings", settings: { setId: set.id as SetId } })}
              className={`rounded-xl border px-3 py-3 text-left ${
                state.settings.setId === set.id ? "border-brass bg-bg" : "border-line"
              }`}
            >
              <span className="block font-medium text-fg">{set.label}</span>
              <span className="mt-1 block text-sm text-muted">{set.blurb}</span>
            </button>
          ))}
        </div>
      </fieldset>

      <div className="mt-5 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={!isHost}
          onClick={() =>
            act({ type: "settings", settings: { mode: state.settings.mode === "ffa" ? "teams" : "ffa" } })
          }
          className="h-11 rounded-xl border border-line px-3 text-sm font-semibold text-fg disabled:opacity-60"
        >
          {state.settings.mode === "ffa" ? "Open floor" : "Two sides"}
        </button>
        <button
          type="button"
          disabled={!isHost}
          onClick={() => act({ type: "settings", settings: { negs: !state.settings.negs } })}
          className="h-11 rounded-xl border border-line px-3 text-sm font-semibold text-fg disabled:opacity-60"
        >
          {state.settings.negs ? "Negs on · −5" : "Negs off"}
        </button>
      </div>

      {state.settings.mode === "teams" && (
        <div className="mt-4">
          <p className="text-sm text-muted">Your side</p>
          <div className="mt-2 flex gap-2">
            <SideButton
              label="Gold"
              active={me?.team === "gold"}
              brass
              onClick={() => act({ type: "team", playerId: selfId, team: "gold" })}
            />
            <SideButton
              label="Pine"
              active={me?.team === "pine"}
              onClick={() => act({ type: "team", playerId: selfId, team: "pine" })}
            />
          </div>
        </div>
      )}

      {isHost ? (
        <button
          type="button"
          className="mt-6 h-14 w-full rounded-2xl bg-brass text-lg font-semibold text-ink transition-transform duration-150 ease-out active:scale-[0.96]"
          onClick={() => act({ type: "start" })}
        >
          Open the packet · {count} tossups
        </button>
      ) : (
        <p className="mt-6 text-sm text-muted">Waiting for the reader to start.</p>
      )}
    </div>
  );
}

function SideButton({
  label,
  active,
  brass,
  onClick,
}: {
  label: string;
  active: boolean;
  brass?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`h-11 rounded-xl px-4 text-sm font-semibold ${
        active
          ? brass
            ? "bg-brass text-ink"
            : "bg-fg text-bg"
          : "border border-line text-muted"
      }`}
    >
      {label}
    </button>
  );
}

function Complete({ state, isHost, act }: { state: State; isHost: boolean; act: (action: Action) => void }) {
  const ranked = [...state.roster].sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  return (
    <div className="rounded-2xl border border-line bg-surface p-5 sm:p-7">
      <h1 className="font-serif text-4xl text-fg">Packet closed.</h1>
      <ol className="mt-6 space-y-2">
        {ranked.map((player, index) => (
          <li key={player.id} className="flex items-baseline justify-between gap-3 border-b border-line py-2">
            <span className="text-fg">
              <span className="mr-2 text-muted tabular-nums">{index + 1}</span>
              {player.name}
            </span>
            <span className="text-xl font-semibold text-brass tabular-nums">{player.score}</span>
          </li>
        ))}
      </ol>
      {isHost && (
        <button
          type="button"
          className="mt-6 h-12 rounded-xl border border-line px-4 font-semibold text-fg"
          onClick={() => act({ type: "rematch" })}
        >
          Back to the lobby
        </button>
      )}
    </div>
  );
}

function Chat({
  state,
  selfId,
  chat,
  setChat,
  act,
}: {
  state: State;
  selfId: string;
  chat: string;
  setChat: (v: string) => void;
  act: (action: Action) => void;
}) {
  return (
    <div className="flex h-full flex-col rounded-2xl border border-line bg-surface p-3">
      <p className="px-1 text-xs font-semibold tracking-widest text-muted">TABLE TALK</p>
      <ul className="mt-2 max-h-48 flex-1 space-y-2 overflow-y-auto lg:max-h-80">
        {state.chat.length === 0 && <li className="px-1 text-sm text-muted">Quiet, for now.</li>}
        {state.chat.map((line) => (
          <li key={line.id} className="text-sm">
            <span className="font-medium text-fg">{line.name}</span>{" "}
            <span className="text-muted">{line.text}</span>
          </li>
        ))}
      </ul>
      <form
        className="mt-2 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const text = chat.trim();
          if (!text) return;
          act({ type: "chat", playerId: selfId, text });
          setChat("");
        }}
      >
        <input
          value={chat}
          onChange={(e) => setChat(e.target.value)}
          placeholder="Say something"
          aria-label="Table talk"
          maxLength={200}
          className="h-11 min-w-0 flex-1 rounded-lg border border-line bg-bg px-2 text-sm text-fg outline-none"
        />
        <button type="submit" className="h-11 rounded-lg bg-fg px-3 text-sm font-semibold text-bg">
          Send
        </button>
      </form>
    </div>
  );
}
