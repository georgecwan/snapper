import { isCorrect } from "./judge";
import {
  getQuestion,
  inSet,
  questionView,
  QUESTIONS,
  setLabel,
  type SetId,
  type Tossup,
} from "./questions";

export type Mode = "ffa" | "teams";
export type TeamId = "gold" | "pine";
export type Phase = "lobby" | "reading" | "answer" | "reveal" | "complete";

export type Settings = {
  mode: Mode;
  negs: boolean;
  wpm: number;
  setId: SetId;
};

export type RosterEntry = {
  id: string;
  name: string;
  team: TeamId | null;
  score: number;
  online: boolean;
};

export type LogEntry = {
  id: number;
  text: string;
  tone: "play" | "good" | "bad";
};

export type ChatEntry = {
  id: number;
  name: string;
  text: string;
};

export type RevealReason = "correct" | "wrong" | "timeout" | "nobody" | "skip";

export type Reveal = {
  correct: boolean;
  playerId: string | null;
  playerName: string;
  playerAnswer: string;
  answer: string;
  delta: number;
  powered: boolean;
  reason: RevealReason;
  sealed: boolean;
};

export type State = {
  seq: number;
  phase: Phase;
  hostId: string;
  settings: Settings;
  roster: RosterEntry[];
  questionIds: string[];
  qIndex: number;
  charIndex: number;
  reading: boolean;
  graceEndsAt: number | null;
  answererId: string | null;
  answerEndsAt: number | null;
  locks: string[];
  buzzChar: number;
  powered: boolean;
  reveal: Reveal | null;
  nextAt: number | null;
  log: LogEntry[];
  chat: ChatEntry[];
  logCounter: number;
  chatCounter: number;
};

export type Action =
  | { type: "settings"; settings: Partial<Settings> }
  | { type: "team"; playerId: string; team: TeamId | null }
  | { type: "start" }
  | { type: "buzz"; playerId: string; charAt: number }
  | { type: "answer"; playerId: string; text: string }
  | { type: "skip" }
  | { type: "next" }
  | { type: "rematch" }
  | { type: "overturn" }
  | { type: "chat"; playerId: string; text: string };

export const WPM_CHOICES = [
  { wpm: 160, label: "Measured" },
  { wpm: 210, label: "Match" },
  { wpm: 320, label: "Blitz" },
] as const;

export const ANSWER_MS = 8000;
export const GRACE_MS = 2800;
export const REVEAL_MS = 5200;
export const POWER_POINTS = 15;
export const TOSSUP_POINTS = 10;
export const NEG_POINTS = -5;

const WPM_SET = new Set<number>(WPM_CHOICES.map((c) => c.wpm));

export function charsPerSecond(wpm: number): number {
  return (wpm * 5) / 60;
}

export function initialState(hostId: string, name: string): State {
  return {
    seq: 1,
    phase: "lobby",
    hostId,
    settings: { mode: "ffa", negs: false, wpm: 210, setId: "mixed" },
    roster: [{ id: hostId, name, team: null, score: 0, online: true }],
    questionIds: [],
    qIndex: 0,
    charIndex: 0,
    reading: false,
    graceEndsAt: null,
    answererId: null,
    answerEndsAt: null,
    locks: [],
    buzzChar: 0,
    powered: false,
    reveal: null,
    nextAt: null,
    log: [],
    chat: [],
    logCounter: 0,
    chatCounter: 0,
  };
}

export function currentQuestion(state: State): Tossup | null {
  const id = state.questionIds[state.qIndex];
  if (!id) return null;
  return getQuestion(id) ?? null;
}

function withLog(state: State, text: string, tone: LogEntry["tone"]): Pick<State, "log" | "logCounter"> {
  const id = state.logCounter + 1;
  return {
    logCounter: id,
    log: [...state.log, { id, text, tone }].slice(-36),
  };
}

function applyDelta(roster: RosterEntry[], playerId: string, delta: number): RosterEntry[] {
  if (!delta) return roster;
  return roster.map((r) => (r.id === playerId ? { ...r, score: r.score + delta } : r));
}

function deal(setId: SetId): string[] {
  const ids = QUESTIONS.filter((q) => inSet(setId, q)).map((q) => q.id);
  for (let i = ids.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    const a = ids[i]!;
    ids[i] = ids[j]!;
    ids[j] = a;
  }
  return ids;
}

function cleanSettings(partial: Partial<Settings>, prev: Settings): Settings {
  const next = { ...prev, ...partial };
  if (!WPM_SET.has(next.wpm)) next.wpm = prev.wpm;
  if (next.mode !== "ffa" && next.mode !== "teams") next.mode = prev.mode;
  if (next.setId !== "mixed" && next.setId !== "science" && next.setId !== "humanities" && next.setId !== "canada") {
    next.setId = prev.setId;
  }
  next.negs = Boolean(next.negs);
  return next;
}

function beginQuestion(state: State, index: number): State {
  if (index >= state.questionIds.length) {
    return {
      ...state,
      phase: "complete",
      reading: false,
      graceEndsAt: null,
      answererId: null,
      answerEndsAt: null,
      reveal: null,
      nextAt: null,
      locks: [],
      ...withLog(state, "That’s the packet.", "play"),
      seq: state.seq + 1,
    };
  }
  return {
    ...state,
    phase: "reading",
    qIndex: index,
    charIndex: 0,
    reading: true,
    graceEndsAt: null,
    answererId: null,
    answerEndsAt: null,
    locks: [],
    buzzChar: 0,
    powered: false,
    reveal: null,
    nextAt: null,
    seq: state.seq + 1,
  };
}

function revealNow(
  state: State,
  now: number,
  reveal: Reveal,
  logText: string,
  tone: LogEntry["tone"],
  roster: RosterEntry[] = state.roster,
  locks: string[] = state.locks,
): State {
  const q = currentQuestion(state);
  const full = q ? questionView(q).visible.length : state.charIndex;
  return {
    ...state,
    roster,
    locks,
    phase: "reveal",
    reading: false,
    charIndex: full,
    graceEndsAt: null,
    answererId: null,
    answerEndsAt: null,
    reveal,
    nextAt: now + REVEAL_MS,
    ...withLog(state, logText, tone),
    seq: state.seq + 1,
  };
}

function lockTargets(state: State, playerId: string): string[] {
  if (state.settings.mode !== "teams") return [playerId];
  const me = state.roster.find((r) => r.id === playerId);
  if (!me?.team) return [playerId];
  return state.roster.filter((r) => r.team === me.team).map((r) => r.id);
}

function someoneCanBuzz(state: State, locks: string[]): boolean {
  return state.roster.some((r) => {
    if (!r.online || locks.includes(r.id)) return false;
    if (state.settings.mode === "teams" && !r.team) return false;
    return true;
  });
}

function resumeOrReveal(
  state: State,
  now: number,
  roster: RosterEntry[],
  locks: string[],
  logText: string,
  reveal: Reveal,
): State {
  const q = currentQuestion(state);
  const full = q ? questionView(q).visible.length : state.charIndex;
  const atEnd = state.charIndex >= full - 0.01;
  if (someoneCanBuzz({ ...state, roster }, locks)) {
    return {
      ...state,
      roster,
      locks,
      phase: "reading",
      reading: !atEnd,
      charIndex: Math.min(state.charIndex, full),
      graceEndsAt: atEnd ? now + GRACE_MS : null,
      answererId: null,
      answerEndsAt: null,
      ...withLog(state, logText, "bad"),
      seq: state.seq + 1,
    };
  }
  return revealNow(state, now, reveal, `${logText} Answer: ${reveal.answer}.`, "bad", roster, locks);
}

function judgeAnswer(state: State, playerId: string, text: string, now: number, timeout: boolean): State {
  if (state.phase !== "answer" || playerId !== state.answererId) return state;
  const q = currentQuestion(state);
  if (!q) return state;
  const guess = text.trim().slice(0, 160);
  const me = state.roster.find((r) => r.id === playerId);
  const name = me?.name ?? "Someone";
  const correct = !timeout && guess.length > 0 && isCorrect(guess, q);

  if (correct) {
    const delta = state.powered ? POWER_POINTS : TOSSUP_POINTS;
    const roster = applyDelta(state.roster, playerId, delta);
    const reveal: Reveal = {
      correct: true,
      playerId,
      playerName: name,
      playerAnswer: guess,
      answer: q.answer,
      delta,
      powered: state.powered,
      reason: "correct",
      sealed: false,
    };
    const points = `+${delta}${state.powered ? " on the power" : ""}`;
    return revealNow(state, now, reveal, `${name} — ${guess}. ${points}.`, "good", roster);
  }

  const gaveAnswer = !timeout && guess.length > 0;
  const delta = state.settings.negs && gaveAnswer ? NEG_POINTS : 0;
  const roster = applyDelta(state.roster, playerId, delta);
  const locks = [...new Set([...state.locks, ...lockTargets(state, playerId)])];
  const reason: RevealReason = timeout ? "timeout" : "wrong";
  const reveal: Reveal = {
    correct: false,
    playerId,
    playerName: name,
    playerAnswer: guess,
    answer: q.answer,
    delta,
    powered: state.powered,
    reason,
    sealed: false,
  };
  const negBit = delta ? ` ${delta}.` : "";
  const logText = timeout
    ? `${name}’s time ran out.${negBit}`
    : gaveAnswer
      ? `${name} — ${guess}. No.${negBit}`
      : `${name} passed.`;
  return resumeOrReveal(state, now, roster, locks, logText, reveal);
}

export type TickResult = { state: State; kind: "none" | "tick" | "event" };

export function tick(state: State, dtSec: number, now: number): TickResult {
  if (state.phase === "reading" && state.reading) {
    const q = currentQuestion(state);
    if (!q) return { state, kind: "none" };
    const { visible } = questionView(q);
    const nextChar = state.charIndex + Math.max(0, dtSec) * charsPerSecond(state.settings.wpm);
    if (nextChar >= visible.length) {
      return {
        state: {
          ...state,
          charIndex: visible.length,
          reading: false,
          graceEndsAt: now + GRACE_MS,
          seq: state.seq + 1,
        },
        kind: "event",
      };
    }
    if (nextChar === state.charIndex) return { state, kind: "none" };
    return { state: { ...state, charIndex: nextChar }, kind: "tick" };
  }

  if (state.phase === "reading" && !state.reading && state.graceEndsAt != null && now >= state.graceEndsAt) {
    const q = currentQuestion(state);
    const answer = q?.answer ?? "";
    return {
      state: revealNow(
        state,
        now,
        {
          correct: false,
          playerId: null,
          playerName: "",
          playerAnswer: "",
          answer,
          delta: 0,
          powered: false,
          reason: "nobody",
          sealed: false,
        },
        `Time. Answer: ${answer}.`,
        "play",
      ),
      kind: "event",
    };
  }

  if (state.phase === "answer" && state.answerEndsAt != null && now >= state.answerEndsAt && state.answererId) {
    return { state: judgeAnswer(state, state.answererId, "", now, true), kind: "event" };
  }

  if (state.phase === "reveal" && state.nextAt != null && now >= state.nextAt) {
    return { state: beginQuestion(state, state.qIndex + 1), kind: "event" };
  }

  return { state, kind: "none" };
}

export function reduce(state: State, action: Action, now: number): State {
  switch (action.type) {
    case "settings": {
      const wpmOnly = state.phase !== "lobby";
      const partial = wpmOnly ? { wpm: action.settings.wpm } : action.settings;
      const settings = cleanSettings(partial, state.settings);
      if (
        settings.wpm === state.settings.wpm &&
        settings.mode === state.settings.mode &&
        settings.negs === state.settings.negs &&
        settings.setId === state.settings.setId
      ) {
        return state;
      }
      return { ...state, settings, seq: state.seq + 1 };
    }
    case "team": {
      if (state.settings.mode !== "teams") return state;
      const pickingLate = state.phase === "reading" || state.phase === "answer";
      if (state.phase !== "lobby" && state.phase !== "reveal" && state.phase !== "complete" && !pickingLate) {
        return state;
      }
      const me = state.roster.find((r) => r.id === action.playerId);
      if (pickingLate && me?.team) return state;
      const team = action.team === "gold" || action.team === "pine" ? action.team : null;
      let changed = false;
      const roster = state.roster.map((r) => {
        if (r.id !== action.playerId || r.team === team) return r;
        changed = true;
        return { ...r, team };
      });
      if (!changed) return state;
      return { ...state, roster, seq: state.seq + 1 };
    }
    case "start": {
      if (state.phase !== "lobby" && state.phase !== "complete") return state;
      const questionIds = deal(state.settings.setId);
      if (questionIds.length === 0) return state;
      const roster = state.roster.map((r) => ({ ...r, score: 0 }));
      const opened: State = {
        ...state,
        roster,
        questionIds,
        ...withLog(
          state,
          `${setLabel(state.settings.setId)} · ${questionIds.length} tossups${state.settings.negs ? " · negs on" : ""}.`,
          "play",
        ),
      };
      return beginQuestion(opened, 0);
    }
    case "buzz": {
      if (state.phase !== "reading") return state;
      const me = state.roster.find((r) => r.id === action.playerId);
      if (!me?.online) return state;
      if (state.locks.includes(me.id)) return state;
      if (state.settings.mode === "teams") {
        if (!me.team) return state;
        if (state.roster.some((r) => r.team === me.team && state.locks.includes(r.id))) return state;
      }
      const q = currentQuestion(state);
      if (!q) return state;
      const view = questionView(q);
      const shown = state.charIndex;
      const claimed = Number.isFinite(action.charAt) ? action.charAt : shown;
      const fair = claimed > shown + 36 ? shown : Math.max(0, Math.min(claimed, view.visible.length));
      const powered = view.powerAt > 0 && fair <= view.powerAt;
      return {
        ...state,
        phase: "answer",
        reading: false,
        graceEndsAt: null,
        answererId: me.id,
        answerEndsAt: now + ANSWER_MS,
        buzzChar: fair,
        powered,
        ...withLog(state, `${me.name} buzzed${powered ? " on the power" : ""}.`, "play"),
        seq: state.seq + 1,
      };
    }
    case "answer":
      return judgeAnswer(state, action.playerId, action.text, now, false);
    case "skip": {
      if (state.phase !== "reading" && state.phase !== "answer") return state;
      const q = currentQuestion(state);
      if (!q) return state;
      return revealNow(
        state,
        now,
        {
          correct: false,
          playerId: null,
          playerName: "",
          playerAnswer: "",
          answer: q.answer,
          delta: 0,
          powered: false,
          reason: "skip",
          sealed: true,
        },
        `Passed over. Answer: ${q.answer}.`,
        "play",
      );
    }
    case "next": {
      if (state.phase !== "reveal") return state;
      return beginQuestion(state, state.qIndex + 1);
    }
    case "rematch": {
      if (state.phase !== "complete" && state.phase !== "reveal") return state;
      return {
        ...initialState(state.hostId, state.roster.find((r) => r.id === state.hostId)?.name ?? "Reader"),
        settings: state.settings,
        roster: state.roster.map((r) => ({ ...r, score: 0 })),
        chat: state.chat,
        chatCounter: state.chatCounter,
        seq: state.seq + 1,
      };
    }
    case "overturn": {
      const reveal = state.reveal;
      if (state.phase !== "reveal" || !reveal || reveal.sealed || !reveal.playerId) return state;
      if (reveal.reason === "skip" || reveal.reason === "nobody") return state;
      const q = currentQuestion(state);
      if (!q) return state;
      if (reveal.correct) {
        const roster = applyDelta(state.roster, reveal.playerId, -reveal.delta);
        return {
          ...state,
          roster,
          reveal: { ...reveal, correct: false, delta: 0, reason: "wrong", sealed: true },
          ...withLog(state, `Reader overturned ${reveal.playerName}. Points back.`, "play"),
          seq: state.seq + 1,
        };
      }
      const delta = reveal.powered ? POWER_POINTS : TOSSUP_POINTS;
      const roster = applyDelta(state.roster, reveal.playerId, delta - reveal.delta);
      return {
        ...state,
        roster,
        reveal: { ...reveal, correct: true, delta, reason: "correct", sealed: true },
        ...withLog(state, `Reader accepted ${reveal.playerName} for +${delta}.`, "good"),
        seq: state.seq + 1,
      };
    }
    case "chat": {
      const text = action.text.replace(/\s+/g, " ").trim().slice(0, 200);
      if (!text) return state;
      const name = state.roster.find((r) => r.id === action.playerId)?.name ?? "Player";
      const id = state.chatCounter + 1;
      return {
        ...state,
        chatCounter: id,
        chat: [...state.chat, { id, name, text }].slice(-40),
        seq: state.seq + 1,
      };
    }
    default:
      return state;
  }
}

export function syncRoster(
  state: State,
  people: { id: string; name: string }[],
): State {
  const ids = new Set(people.map((p) => p.id));
  const prev = new Map(state.roster.map((r) => [r.id, r]));
  let changed = false;
  const roster: RosterEntry[] = [];

  for (const p of people) {
    const name = p.name.trim().slice(0, 18) || "Player";
    const old = prev.get(p.id);
    if (!old) {
      changed = true;
      roster.push({ id: p.id, name, team: null, score: 0, online: true });
      continue;
    }
    if (!old.online || old.name !== name) changed = true;
    roster.push({ ...old, name, online: true });
  }

  for (const r of state.roster) {
    if (ids.has(r.id)) continue;
    if (r.online) changed = true;
    roster.push({ ...r, online: false });
  }

  if (!changed) return state;
  return { ...state, roster, seq: state.seq + 1 };
}

export function playerName(state: State, id: string | null): string {
  if (!id) return "";
  return state.roster.find((r) => r.id === id)?.name ?? "Player";
}
