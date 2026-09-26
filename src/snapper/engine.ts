import {
  normalizeFormats,
  actionSchema,
  configSchema,
  type AttemptView,
  type ChatMessage,
  type Format,
  type GameAction,
  type PlayerView,
  type QuestionAtom,
  type QuestionBundle,
  type RoomConfig,
  type SessionView,
  type Team,
} from "./protocol.ts";
import { judgeAnswer, type Verdict } from "./judge.ts";

const IDLE_MS = 10 * 60_000;
const CLARIFICATION_MS = 8000;
type Pause = "manual" | "idle" | "challenge" | "participants" | "moderator";
type Scores = Record<Team, number>;
interface Turn {
  primary: string;
  opponent: string | null;
}
interface Block {
  bundle: QuestionBundle;
  index: number;
  count: number;
  rosterIds: string[];
  teams: Record<string, Team | null>;
  turns: Turn[];
  bonusTeam: Team | null;
}
interface Attempt extends AttemptView {
  at: number;
  team: Team | null;
  value: number;
  clue: number;
  timeout: boolean;
}
interface Question {
  atom: QuestionAtom;
  clue: number;
  rosterIds: string[];
  teams: Record<string, Team | null>;
  readBase: number;
  readAt: number | null;
  graceAt: number | null;
  answerer: string | null;
  answerAt: number | null;
  revealAt: number | null;
  buzzValue: number;
  clarified: boolean;
  assignedStage: number;
  attempts: Attempt[];
  baseScores: Record<string, number>;
  baseTeams: Scores;
  baseBonus: Team | null;
  scoreCutoff: number;
  revealed: boolean;
  winner: string | null;
}

/** Entirely serializable private coordinator state. Never send this object to a client. */
export interface Session {
  id: string;
  revision: number;
  config: RoomConfig;
  pendingConfig: RoomConfig | null;
  players: PlayerView[];
  usedIds: string[];
  needsBlock: boolean;
  phase: SessionView["phase"];
  teamScores: Scores;
  block: Block | null;
  question: Question | null;
  chat: ChatMessage[];
  challenge: SessionView["challenge"];
  notice: string | null;
  pauses: Pause[];
  pausedAt: number | null;
  started: boolean;
  lastActivity: number;
  serial: number;
  wantedRoles: Record<string, PlayerView["role"]>;
  pendingTeams: Record<string, Team>;
  removedIds: string[];
  blockNumber: number;
}

const clone = <T>(value: T): T => structuredClone(value);
const active = (state: Session) =>
  state.players.filter((player) => player.connected && player.role === "player");
const moderators = (state: Session) =>
  state.players.some((player) => player.connected && (player.owner || player.moderator));
const isModerator = (player: PlayerView) => player.owner || player.moderator;
const frozen = (format?: Format) => format === "assigned" || format === "team";
const bump = (state: Session) => {
  state.revision++;
  return state;
};
const charsPerMs = (state: Session) => (state.config.wpm * 5) / 60_000;
function textOf(question: Question): string {
  return question.atom.clues
    ? question.atom.clues.slice(0, question.clue + 1).join("\n\n")
    : question.atom.text;
}
function readPosition(state: Session, now: number): number {
  const q = state.question;
  if (!q) return 0;
  return Math.min(
    textOf(q).length,
    q.readBase + (q.readAt === null ? 0 : Math.max(0, now - q.readAt) * charsPerMs(state)),
  );
}
function readEnd(state: Session): number | null {
  const q = state.question;
  return !q || q.readAt === null
    ? null
    : q.readAt + Math.max(0, textOf(q).length - q.readBase) / charsPerMs(state);
}
function setPause(state: Session, reason: Pause, now: number): void {
  if (state.pauses.includes(reason)) return;
  if (state.pauses.length === 0) state.pausedAt = now;
  state.pauses.push(reason);
  state.needsBlock = false;
}
function clearPause(state: Session, reason: Pause, now: number): void {
  if (!state.pauses.includes(reason)) return;
  state.pauses = state.pauses.filter((value) => value !== reason);
  if (state.pauses.length || state.pausedAt === null) return;
  const duration = Math.max(0, now - state.pausedAt);
  const q = state.question;
  if (q) {
    if (q.readAt !== null) q.readAt += duration;
    if (q.graceAt !== null) q.graceAt += duration;
    if (q.answerAt !== null) q.answerAt += duration;
    if (q.revealAt !== null) q.revealAt += duration;
  }
  state.pausedAt = null;
}
function applyPendingTeams(state: Session): void {
  for (const [id, team] of Object.entries(state.pendingTeams)) {
    const player = state.players.find((value) => value.id === id);
    if (!player) {
      delete state.pendingTeams[id];
      continue;
    }
    if (active(state).filter((value) => value.id !== id && value.team === team).length >= 8)
      continue;
    player.team = team;
    delete state.pendingTeams[id];
  }
}
function applyConfiguration(state: Session): void {
  if (!state.pendingConfig) return;
  if (state.config.mode !== state.pendingConfig.mode) {
    state.players.forEach((player) => {
      player.score = 0;
    });
    state.teamScores = { A: 0, B: 0 };
    state.notice = "Mode changed. Scores reset; chat and question history retained.";
  }
  state.config = state.pendingConfig;
  state.pendingConfig = null;
  if (state.config.mode === "teams") {
    // FFA reconnects can restore more than eight historical assignments to one
    // team. Re-establish the cap at the settings boundary without taking seats
    // away. Stable player order retains eight assignments; others choose again.
    const occupied: Scores = { A: 0, B: 0 };
    for (const player of active(state)) {
      if (!player.team) continue;
      if (occupied[player.team] >= 8) player.team = null;
      else occupied[player.team]++;
    }
  }
}
function waitingState(state: Session, now: number): void {
  state.phase = "waiting";
  state.block = null;
  state.question = null;
  state.challenge = null;
  clearPause(state, "challenge", now);
  clearPause(state, "participants", now);
  applyConfiguration(state);
  applyPendingTeams(state);
  if (!moderators(state)) setPause(state, "moderator", now);
  else clearPause(state, "moderator", now);
  state.needsBlock = state.started && state.pauses.length === 0 && active(state).length > 0;
}

export function createSession(
  id: string,
  owner: PlayerView,
  config: RoomConfig,
  now: number,
): Session {
  return {
    id,
    revision: 1,
    config: clone(configSchema.parse(config)),
    pendingConfig: null,
    players: [{ ...clone(owner), score: 0 }],
    usedIds: [],
    needsBlock: false,
    phase: "waiting",
    teamScores: { A: 0, B: 0 },
    block: null,
    question: null,
    chat: [],
    challenge: null,
    notice: null,
    pauses: [],
    pausedAt: null,
    started: false,
    lastActivity: now,
    serial: 0,
    wantedRoles: { [owner.id]: owner.role },
    pendingTeams: {},
    removedIds: [],
    blockNumber: 0,
  };
}

/** Upgrade trusted coordinator snapshots without replaying or rejudging play. */
export function migrateSession(previous: Session, now: number): Session {
  const formats = normalizeFormats(previous.config.mode, previous.config.formats);
  const pendingFormats = previous.pendingConfig
    ? normalizeFormats(previous.pendingConfig.mode, previous.pendingConfig.formats)
    : null;
  const sameFormats = (a: readonly string[], b: readonly string[]) =>
    a.length === b.length && a.every((value, index) => value === b[index]);
  const legacyBlock = (previous.block?.bundle.format as string | undefined) === "shootout";
  if (
    !legacyBlock &&
    sameFormats(formats, previous.config.formats) &&
    (!previous.pendingConfig || sameFormats(pendingFormats!, previous.pendingConfig.formats)) &&
    !(previous.block && "shoot" in previous.block) &&
    !(previous.question && "baseShoot" in previous.question)
  )
    return previous;

  const state = clone(previous);
  state.config.formats = formats;
  if (state.pendingConfig) state.pendingConfig.formats = pendingFormats!;
  if (state.block) delete (state.block as Block & { shoot?: unknown }).shoot;
  if (state.question) delete (state.question as Question & { baseShoot?: unknown }).baseShoot;
  if (legacyBlock && state.block) {
    const block = state.block;
    const presented = block.index + (state.question ? 1 : 0);
    const keptIds = new Set(block.bundle.atoms.slice(0, presented).map((atom) => atom.id));
    if (state.question) keptIds.add(state.question.atom.id);
    const unaskedIds = new Set(block.bundle.atoms.slice(presented).map((atom) => atom.id));
    state.usedIds = state.usedIds.filter((id) => !unaskedIds.has(id) || keptIds.has(id));
    if (state.question) {
      // Keep the index so question, answer-window and attempt identities stay
      // stable; count makes the current question the last one in this block.
      block.bundle.format = "snapper";
      block.bundle.title = "Quick snapper";
      block.bundle.atoms = block.bundle.atoms.slice(0, presented);
      block.count = presented;
      block.turns = [];
      block.bonusTeam = null;
      state.needsBlock = false;
    } else {
      state.block = null;
      state.phase = "waiting";
      applyConfiguration(state);
      applyPendingTeams(state);
    }
    // Retirement no longer restricts who can play or blocks completion. Other
    // holds retain their original pause instant and the question's deadlines.
    clearPause(state, "participants", now);
    refreshHolds(state, now);
  }
  return bump(state);
}

function restoreConnection(state: Session, player: PlayerView): void {
  const wanted = state.wantedRoles[player.id] ?? player.role;
  const playerSpace = active(state).filter((value) => value.id !== player.id).length < 16;
  const teamSpace =
    state.config.mode !== "teams" ||
    !player.team ||
    active(state).filter((value) => value.id !== player.id && value.team === player.team).length <
      8;
  if (wanted === "player" && playerSpace && teamSpace) {
    player.role = "player";
    player.connected = true;
    return;
  }
  const spectatorSpace =
    state.players.filter(
      (value) => value.id !== player.id && value.connected && value.role === "spectator",
    ).length < 16;
  player.role = "spectator";
  player.connected = spectatorSpace;
  state.notice = spectatorSpace
    ? "Waiting as a spectator for an available player/team place."
    : "All player and spectator places are occupied.";
}

export function addParticipant(previous: Session, player: PlayerView, now: number): Session {
  const state = clone(previous);
  const existing = state.players.find((value) => value.id === player.id);
  if (existing) return setConnected(previous, player.id, player.connected, now);
  const newcomer = {
    ...clone(player),
    name: player.name.trim().slice(0, 32) || "Player",
    score: 0,
    connected: false,
  };
  state.players.push(newcomer);
  state.wantedRoles[player.id] = player.role;
  if (player.connected) restoreConnection(state, newcomer);
  refreshHolds(state, now);
  return bump(state);
}

export function setConnected(
  previous: Session,
  id: string,
  connected: boolean,
  now: number,
): Session {
  const original = previous.players.find((player) => player.id === id);
  if (!original || previous.removedIds.includes(id) || original.connected === connected)
    return previous;
  const state = clone(previous);
  const player = state.players.find((value) => value.id === id)!;
  if (connected) restoreConnection(state, player);
  else player.connected = false;
  refreshHolds(state, now);
  return bump(state);
}

export function readyFormats(state: Session): Format[] {
  const config = state.pendingConfig && !state.block ? state.pendingConfig : state.config;
  const players = active(state);
  if (!players.length) return [];
  const bothTeams =
    players.some((player) => player.team === "A") && players.some((player) => player.team === "B");
  return normalizeFormats(config.mode, config.formats).filter((format) => {
    if (config.mode === "ffa") return format !== "team";
    if (!players.some((player) => player.team)) return false;
    return !["team", "assigned"].includes(format) || bothTeams;
  });
}

/** The coordinator must verify owner identity before calling this non-player API. */
export function configureSession(previous: Session, config: RoomConfig, now: number): Session {
  const state = clone(tick(previous, now));
  state.pendingConfig = clone(configSchema.parse(config));
  if (!state.block) {
    applyConfiguration(state);
    refreshHolds(state, now);
  }
  state.notice = state.block ? "Configuration saved for the next block." : "Configuration saved.";
  return bump(state);
}

function participantsFor(state: Session, block: Block, index: number): string[] {
  if (block.bundle.format === "assigned") {
    const turn = block.turns[index];
    return turn ? [turn.primary, ...(turn.opponent ? [turn.opponent] : [])] : [];
  }
  if (block.bundle.format === "team" && index > 0)
    return block.rosterIds.filter((id) => block.teams[id] === block.bonusTeam);
  return frozen(block.bundle.format)
    ? block.rosterIds
    : active(state)
        .filter((player) => state.config.mode === "ffa" || player.team)
        .map((player) => player.id);
}

function questionCanStart(state: Session, index: number): boolean {
  const b = state.block;
  if (!b) return false;
  const potential = participantsFor(state, b, index);
  return active(state).some((player) => potential.includes(player.id));
}

function refreshHolds(state: Session, now: number): void {
  if (!state.block) {
    if (moderators(state)) clearPause(state, "moderator", now);
    else if (state.started) setPause(state, "moderator", now);
    state.needsBlock = state.started && state.pauses.length === 0 && active(state).length > 0;
  }
  if (state.pauses.includes("participants") && state.block) {
    const index = state.question ? state.block.index + 1 : state.block.index;
    if (questionCanStart(state, index)) clearPause(state, "participants", now);
  }
}

export function startBlock(previous: Session, bundle: QuestionBundle, now: number): Session {
  if (
    !previous.needsBlock ||
    previous.block ||
    previous.pauses.length ||
    !readyFormats(previous).includes(bundle.format)
  )
    return previous;
  const state = clone(previous);
  const players = active(state).filter((player) => state.config.mode === "ffa" || player.team);
  const rosterIds = players.map((player) => player.id);
  const teams = Object.fromEntries(players.map((player) => [player.id, player.team]));
  const turns: Turn[] = [];
  let count = bundle.atoms.length;
  if (bundle.format === "assigned") {
    if (state.config.mode === "ffa") {
      rosterIds.forEach((id, index) =>
        turns.push({
          primary: id,
          opponent: rosterIds.length > 1 ? rosterIds[(index + 1) % rosterIds.length]! : null,
        }),
      );
    } else {
      const a = rosterIds.filter((id) => teams[id] === "A"),
        b = rosterIds.filter((id) => teams[id] === "B");
      const n = Math.max(a.length, b.length);
      for (let i = 0; i < n; i++) {
        const ai = a[(i + state.blockNumber) % a.length]!,
          bi = b[(i + state.blockNumber) % b.length]!;
        const pair = [
          { primary: ai, opponent: bi },
          { primary: bi, opponent: ai },
        ];
        turns.push(...(state.blockNumber % 2 ? pair.reverse() : pair));
      }
    }
    count = turns.length;
  } else if (bundle.format === "team") count = 4;
  else if (bundle.format !== "open") count = 1;
  const selected = bundle.atoms.slice(0, count);
  if (
    selected.length !== count ||
    selected.some((atom) => state.usedIds.includes(atom.id)) ||
    new Set(selected.map((atom) => atom.id)).size !== count
  )
    return previous;
  if (bundle.format === "clues" && !selected[0]?.clues) return previous;
  if (bundle.format === "sequence" && !selected[0]?.answer.orderedItems?.length) return previous;
  state.block = {
    bundle: { ...clone(bundle), atoms: selected },
    index: 0,
    count,
    rosterIds,
    teams,
    turns,
    bonusTeam: null,
  };
  state.blockNumber++;
  state.usedIds.push(...selected.map((atom) => atom.id));
  state.needsBlock = false;
  state.notice = null;
  beginQuestion(state, 0, now);
  return bump(state);
}

function beginQuestion(state: Session, index: number, now: number): void {
  const block = state.block!;
  if (!frozen(block.bundle.format)) applyPendingTeams(state);
  block.index = index;
  state.challenge = null;
  clearPause(state, "challenge", now);
  const people = frozen(block.bundle.format)
    ? block.rosterIds
    : active(state)
        .filter((player) => state.config.mode === "ffa" || player.team)
        .map((player) => player.id);
  const teams = frozen(block.bundle.format)
    ? clone(block.teams)
    : Object.fromEntries(state.players.map((player) => [player.id, player.team]));
  state.question = {
    atom: clone(block.bundle.atoms[index]!),
    clue: 0,
    rosterIds: [...people],
    teams,
    readBase: 0,
    readAt: null,
    graceAt: null,
    answerer: null,
    answerAt: null,
    revealAt: null,
    buzzValue: 0,
    clarified: false,
    assignedStage: 0,
    attempts: [],
    baseScores: Object.fromEntries(state.players.map((player) => [player.id, player.score])),
    baseTeams: clone(state.teamScores),
    baseBonus: block.bonusTeam,
    scoreCutoff: 0,
    revealed: false,
    winner: null,
  };
  state.phase = "reading";
  continueReading(state, now);
}

function continueReading(state: Session, now: number): void {
  const q = state.question!;
  state.phase = "reading";
  q.answerer = null;
  q.answerAt = null;
  q.revealAt = null;
  q.clarified = false;
  const progressive = state.block!.bundle.format === "tossup" || state.config.shortProgressive;
  if (!progressive) q.readBase = textOf(q).length;
  if (q.readBase < textOf(q).length) {
    q.readAt = now;
    q.graceAt = null;
  } else {
    q.readAt = null;
    if (state.block!.bundle.format === "assigned") startAssignedAnswer(state, now);
    else q.graceAt = now + state.config.graceMs;
  }
}

function assignedId(state: Session): string | null {
  const b = state.block!,
    q = state.question!;
  const turn = b.turns[b.index];
  return !turn
    ? null
    : q.assignedStage === 0
      ? turn.primary
      : q.assignedStage === 1
        ? turn.opponent
        : null;
}
function startAssignedAnswer(state: Session, now: number): void {
  const id = assignedId(state);
  if (!id) {
    reveal(state, now);
    return;
  }
  state.phase = "answering";
  const q = state.question!;
  q.answerer = id;
  q.answerAt = now + state.config.answerMs;
  q.graceAt = null;
  q.buzzValue = state.config.points.regular;
  q.clarified = false;
}

function lockedIds(state: Session): Set<string> {
  const q = state.question!,
    locked = new Set<string>();
  for (const attempt of q.attempts) {
    if (attempt.verdict === "accept") break;
    if (
      attempt.verdict !== "reject" ||
      (state.block!.bundle.format === "clues" && attempt.clue !== q.clue)
    )
      continue;
    if (state.config.mode === "teams" && attempt.team)
      q.rosterIds.filter((id) => q.teams[id] === attempt.team).forEach((id) => locked.add(id));
    else locked.add(attempt.playerId);
  }
  return locked;
}
function potentialEligible(state: Session): string[] {
  const b = state.block,
    q = state.question;
  if (!b || !q || state.phase !== "reading") return [];
  if (b.bundle.format === "assigned") {
    const id = assignedId(state);
    return id ? [id] : [];
  }
  const locked = lockedIds(state);
  return participantsFor(state, b, b.index).filter(
    (id) => q.rosterIds.includes(id) && !locked.has(id),
  );
}
function eligible(state: Session): string[] {
  const potential = potentialEligible(state);
  return active(state)
    .filter((player) => potential.includes(player.id))
    .map((player) => player.id);
}
function valueAtBuzz(state: Session, now: number): number {
  const q = state.question!,
    format = state.block!.bundle.format;
  if (format === "sequence") return state.config.points.sequence;
  if (format === "clues") return state.config.points.clues[q.clue]!;
  if (
    format === "tossup" &&
    q.atom.powerAt !== undefined &&
    readPosition(state, now) <= q.atom.powerAt
  )
    return state.config.points.power;
  return state.config.points.regular;
}

function recompute(state: Session): void {
  const q = state.question!,
    b = state.block!;
  state.players.forEach((player) => {
    if (q.baseScores[player.id] !== undefined) player.score = q.baseScores[player.id]!;
  });
  state.teamScores = clone(q.baseTeams);
  b.bonusTeam = q.baseBonus;
  q.winner = null;
  for (let i = 0; i < q.attempts.length; i++) {
    const attempt = q.attempts[i]!;
    attempt.points = 0;
    if (q.winner) continue;
    if (attempt.verdict === "prompt") continue;
    const correct = attempt.verdict === "accept";
    const points = correct
      ? attempt.value
      : b.bundle.format === "tossup" && state.config.negs && !attempt.timeout
        ? state.config.points.penalty
        : 0;
    if (i >= q.scoreCutoff) {
      attempt.points = points;
      const player = state.players.find((value) => value.id === attempt.playerId);
      if (player) player.score += points;
      if (state.config.mode === "teams" && attempt.team) state.teamScores[attempt.team] += points;
    }
    if (!correct) continue;
    q.winner = attempt.playerId;
    if (b.bundle.format === "team" && b.index === 0) b.bonusTeam = attempt.team;
  }
}

function reveal(state: Session, now: number): void {
  const q = state.question!;
  state.phase = "reveal";
  q.revealed = true;
  q.readAt = null;
  q.graceAt = null;
  q.answerAt = null;
  q.answerer = null;
  q.revealAt = now + state.config.revealMs;
}

function exhaustedQuestion(state: Session, now: number): void {
  const q = state.question!;
  if (state.block!.bundle.format === "clues" && q.clue < 3) {
    q.readBase = textOf(q).length;
    q.clue++;
    continueReading(state, now);
  } else reveal(state, now);
}

function submit(state: Session, text: string, now: number, timeout = false): void {
  const q = state.question!,
    id = q.answerer!,
    player = state.players.find((value) => value.id === id);
  const verdict: Verdict = timeout ? "reject" : judgeAnswer(text, q.atom.answer, q.clarified);
  q.attempts.push({
    id: `${state.id}:attempt:${++state.serial}`,
    playerId: id,
    name: player?.name ?? "Player",
    answer: text,
    verdict,
    points: 0,
    corrected: false,
    at: now,
    team: q.teams[id] ?? null,
    value: q.buzzValue,
    clue: q.clue,
    timeout,
  });
  recompute(state);
  if (verdict === "prompt") {
    q.clarified = true;
    q.answerAt = now + CLARIFICATION_MS;
    return;
  }
  if (q.winner) {
    reveal(state, now);
    return;
  }
  const b = state.block!;
  if (b.bundle.format === "assigned") {
    q.assignedStage++;
    if (!assignedId(state)) reveal(state, now);
    else continueReading(state, now);
  } else if (b.bundle.format === "team" && b.index > 0) reveal(state, now);
  else {
    continueReading(state, now);
    if (potentialEligible(state).length === 0) exhaustedQuestion(state, now);
  }
}

function advance(state: Session, now: number): void {
  const b = state.block;
  if (!b) {
    waitingState(state, now);
    return;
  }
  if (b.index + 1 >= b.count || (b.bundle.format === "team" && b.index === 0 && !b.bonusTeam)) {
    waitingState(state, now);
    return;
  }
  if (!questionCanStart(state, b.index + 1)) {
    setPause(state, "participants", now);
    return;
  }
  beginQuestion(state, b.index + 1, now);
}

export function nextDeadline(state: Session): number | null {
  if (state.pauses.length) return null;
  const deadlines = [state.lastActivity + IDLE_MS];
  const q = state.question;
  if (q) {
    if (state.phase === "reading") {
      const end = readEnd(state);
      if (end !== null) deadlines.push(end);
      else if (q.graceAt !== null) deadlines.push(q.graceAt);
    }
    if (state.phase === "answering" && q.answerAt !== null) deadlines.push(q.answerAt);
    if (state.phase === "reveal" && state.config.autoAdvance && q.revealAt !== null)
      deadlines.push(q.revealAt);
  }
  return Math.ceil(Math.min(...deadlines));
}

export function tick(previous: Session, now: number): Session {
  const first = nextDeadline(previous);
  if (first === null || first > now) return previous;
  const state = clone(previous);
  for (let guard = 0; guard < 256; guard++) {
    const deadline = nextDeadline(state);
    if (deadline === null || deadline > now) break;
    if (deadline >= state.lastActivity + IDLE_MS) {
      setPause(state, "idle", deadline);
      break;
    }
    const q = state.question;
    if (!q) break;
    if (state.phase === "reading") {
      if (q.readAt !== null) {
        q.readBase = textOf(q).length;
        q.readAt = null;
        if (state.block!.bundle.format === "assigned") startAssignedAnswer(state, deadline);
        else q.graceAt = deadline + state.config.graceMs;
      } else exhaustedQuestion(state, deadline);
    } else if (state.phase === "answering") submit(state, "", deadline, true);
    else if (state.phase === "reveal") advance(state, deadline);
    else break;
  }
  return bump(state);
}

function error(state: Session, message: string) {
  return { state, error: message };
}
export function transition(
  previous: Session,
  actorId: string,
  rawAction: GameAction,
  now: number,
): { state: Session; error?: string } {
  const current = tick(previous, now);
  const parsed = actionSchema.safeParse(rawAction);
  if (!parsed.success) return error(current, "Invalid command.");
  const action = parsed.data;
  const actor = current.players.find((player) => player.id === actorId);
  if (!actor?.connected || current.removedIds.includes(actorId))
    return error(current, "An approved active connection is required.");
  const ownerActions = ["configure", "promote", "approve", "reject", "close-session"];
  const moderatorActions = [
    "start",
    "next",
    "pause",
    "resume",
    "skip",
    "end-block",
    "reset-scores",
    "correct",
    "resolve-challenge",
    "kick",
  ];
  if (ownerActions.includes(action.type) && !actor.owner)
    return error(current, "Only the owner can do that.");
  if (moderatorActions.includes(action.type) && !isModerator(actor))
    return error(current, "A moderator is required.");
  if (["approve", "reject", "close-session"].includes(action.type))
    return error(current, "This command must be handled by the session coordinator.");
  const state = clone(current),
    player = state.players.find((value) => value.id === actorId)!;
  const q = state.question;
  switch (action.type) {
    case "chat":
      state.chat.push({
        id: `${state.id}:chat:${++state.serial}`,
        playerId: actorId,
        name: player.name,
        text: action.text,
        at: now,
      });
      state.chat = state.chat.slice(-100);
      state.lastActivity = now;
      break;
    case "buzz": {
      if (state.pauses.length || state.phase !== "reading" || !eligible(state).includes(actorId))
        return error(current, "You cannot buzz right now.");
      q!.buzzValue = valueAtBuzz(state, now);
      q!.readBase = readPosition(state, now);
      q!.readAt = null;
      q!.graceAt = null;
      q!.answerer = actorId;
      q!.answerAt =
        now +
        (state.block!.bundle.format === "sequence"
          ? state.config.sequenceMs
          : state.config.answerMs);
      q!.clarified = false;
      state.phase = "answering";
      state.lastActivity = now;
      break;
    }
    case "answer":
      if (
        state.pauses.length ||
        state.phase !== "answering" ||
        q?.answerer !== actorId ||
        player.role !== "player"
      )
        return error(current, "It is not your answer window.");
      state.lastActivity = now;
      submit(state, action.text, now);
      break;
    case "team": {
      if (state.config.mode !== "teams" || player.role !== "player")
        return error(current, "Take a team-mode player seat first.");
      if (
        active(state).filter(
          (value) =>
            value.id !== actorId && (state.pendingTeams[value.id] ?? value.team) === action.team,
        ).length >= 8
      )
        return error(current, "That team is full.");
      if (state.block) {
        state.pendingTeams[actorId] = action.team;
        state.notice = frozen(state.block.bundle.format)
          ? "Team change queued for the next block."
          : "Team change queued for the next question.";
      } else player.team = action.team;
      break;
    }
    case "take-seat": {
      if (player.role === "player") return error(current, "You already have a player seat.");
      const team = action.team ?? player.team;
      if (active(state).length >= 16) return error(current, "All player seats are occupied.");
      if (state.config.mode === "teams" && !team) return error(current, "Choose a team.");
      if (
        state.config.mode === "teams" &&
        active(state).filter((value) => value.team === team).length >= 8
      )
        return error(current, "That team is full.");
      if (
        state.block &&
        frozen(state.block.bundle.format) &&
        state.block.rosterIds.includes(actorId) &&
        team !== state.block.teams[actorId]
      ) {
        return error(
          current,
          "Return to your original team for this block, or wait until it ends to change teams.",
        );
      }
      player.role = "player";
      player.team = team;
      state.wantedRoles[actorId] = "player";
      refreshHolds(state, now);
      break;
    }
    case "spectate":
      if (
        state.players.filter(
          (value) => value.id !== actorId && value.connected && value.role === "spectator",
        ).length >= 16
      )
        return error(current, "All spectator places are occupied.");
      player.role = "spectator";
      state.wantedRoles[actorId] = "spectator";
      break;
    case "configure":
      return { state: configureSession(current, action.config, now) };
    case "promote": {
      const target = state.players.find((value) => value.id === action.playerId);
      if (!target?.connected || target.role !== "player")
        return error(current, "Choose a connected player.");
      target.moderator = action.moderator;
      refreshHolds(state, now);
      break;
    }
    case "kick": {
      const target = state.players.find((value) => value.id === action.playerId);
      if (!target || target.owner) return error(current, "The owner cannot be removed.");
      if (state.removedIds.includes(target.id))
        return error(current, "That player has already been removed.");
      target.connected = false;
      target.moderator = false;
      state.removedIds.push(target.id);
      refreshHolds(state, now);
      break;
    }
    case "start":
      if (state.block) return error(current, "A block is already running.");
      if (!readyFormats(state).length)
        return error(current, "No selected format is playable with the current players/teams.");
      state.started = true;
      state.lastActivity = now;
      clearPause(state, "idle", now);
      waitingState(state, now);
      break;
    case "pause":
      setPause(state, "manual", now);
      break;
    case "resume":
      clearPause(state, "manual", now);
      clearPause(state, "idle", now);
      state.lastActivity = now;
      refreshHolds(state, now);
      break;
    case "next":
      if (state.pauses.length || state.phase !== "reveal")
        return error(current, "Finish or resolve the current question first.");
      advance(state, now);
      break;
    case "skip":
      if (!q || state.phase === "reveal")
        return error(current, "There is no active question to skip.");
      reveal(state, state.pausedAt ?? now);
      break;
    case "end-block":
      if (!state.block) return error(current, "There is no active block.");
      waitingState(state, now);
      break;
    case "reset-scores":
      state.players.forEach((value) => {
        value.score = 0;
      });
      state.teamScores = { A: 0, B: 0 };
      if (q) {
        q.baseScores = Object.fromEntries(state.players.map((value) => [value.id, 0]));
        q.baseTeams = { A: 0, B: 0 };
        q.scoreCutoff = q.attempts.length;
        recompute(state);
      }
      state.notice = "All scores reset. Question history and block eligibility retained.";
      break;
    case "challenge":
      if (!q || !q.attempts.length) return error(current, "There is no ruling to challenge.");
      if (!state.challenge) state.challenge = { playerId: actorId, name: player.name };
      setPause(state, "challenge", now);
      break;
    case "resolve-challenge":
      state.challenge = null;
      clearPause(state, "challenge", now);
      break;
    case "correct": {
      const attempt = q?.attempts.find((value) => value.id === action.attemptId);
      if (!q || !attempt)
        return error(current, "Only an attempt from the current question can be corrected.");
      if (attempt.verdict === action.verdict) {
        attempt.corrected = true;
        break;
      }
      attempt.verdict = action.verdict;
      attempt.corrected = true;
      recompute(state);
      const at = state.pausedAt ?? now;
      if (q.winner || q.revealed) reveal(state, at);
      else {
        if (state.block!.bundle.format === "assigned") {
          const turn = state.block!.turns[state.block!.index]!;
          q.assignedStage = q.attempts.some(
            (value) => value.verdict === "reject" && value.playerId === turn.opponent,
          )
            ? 2
            : q.attempts.some(
                  (value) => value.verdict === "reject" && value.playerId === turn.primary,
                )
              ? 1
              : 0;
        }
        const currentAnswerStillValid =
          state.phase === "answering" &&
          q.answerer &&
          (state.block!.bundle.format === "assigned"
            ? assignedId(state) === q.answerer
            : !lockedIds(state).has(q.answerer));
        if (!currentAnswerStillValid) {
          continueReading(state, at);
          if (state.phase === "reading" && !potentialEligible(state).length)
            exhaustedQuestion(state, at);
        }
      }
      state.notice =
        "Current-question ruling corrected; later scoring for this question was recomputed.";
      break;
    }
    default:
      return error(current, "Unsupported game command.");
  }
  return { state: bump(state) };
}

export function publicView(state: Session, selfId: string, now: number): SessionView {
  const q = state.question,
    b = state.block,
    self = state.players.find((player) => player.id === selfId);
  const effectiveNow = state.pausedAt ?? now;
  const fullText = q ? (q.revealed && q.atom.clues ? q.atom.clues.join("\n\n") : textOf(q)) : "";
  const text = q
    ? q.revealed
      ? fullText
      : fullText.slice(0, Math.floor(readPosition(state, effectiveNow)))
    : "";
  const pauseLabels: Record<Pause, string> = {
    manual: "Paused by a moderator",
    idle: "Paused after ten minutes idle",
    challenge: "Challenge awaiting a moderator",
    participants: "Waiting for a disconnected player",
    moderator: "Waiting for a moderator",
  };
  const eligibleIds = state.pauses.length ? [] : eligible(state);
  return {
    sessionId: state.id,
    revision: state.revision,
    serverTime: now,
    selfId,
    config: clone(state.config),
    pendingConfig: clone(state.pendingConfig),
    phase: state.phase,
    pausedReasons: state.pauses.map((reason) => pauseLabels[reason]),
    players: state.players.map((player) => ({
      ...player,
      removed: state.removedIds.includes(player.id),
    })),
    teamScores: clone(state.teamScores),
    block: b
      ? {
          id: `${state.id}:block:${state.blockNumber}`,
          format: b.bundle.format,
          title: b.bundle.title,
          index: b.index,
          count: b.count,
          rosterIds: [...b.rosterIds],
        }
      : null,
    question:
      q && b
        ? {
            id: `${state.id}:block:${state.blockNumber}:question:${b.index}`,
            text,
            category: q.atom.category,
            format: b.bundle.format,
            readingComplete: q.revealed || text.length >= fullText.length,
            answer: q.revealed ? q.atom.answer.canonical : null,
            provenance: q.revealed ? clone(q.atom.provenance) : null,
            clueNumber: q.atom.clues ? q.clue + 1 : null,
            sequenceLength: q.atom.answer.orderedItems?.length ?? null,
          }
        : null,
    attempts: q
      ? q.attempts.map(({ id, playerId, name, answer, verdict, points, corrected }) => ({
          id,
          playerId,
          name,
          answer,
          verdict,
          points,
          corrected,
        }))
      : [],
    chat: clone(state.chat),
    deadline: q
      ? state.phase === "answering"
        ? q.answerAt
        : state.phase === "reveal"
          ? q.revealAt
          : q.graceAt
      : null,
    answererId: q?.answerer ?? null,
    answerWindowId:
      state.phase === "answering" && q?.answerer && b
        ? `${state.id}:block:${state.blockNumber}:question:${b.index}:answer:${q.attempts.length}:${q.answerer}`
        : null,
    answerDraft: "",
    eligibleIds,
    canBuzz: !!self?.connected && eligibleIds.includes(selfId),
    canAnswer:
      !!self?.connected &&
      self.role === "player" &&
      !state.pauses.length &&
      state.phase === "answering" &&
      q?.answerer === selfId,
    canModerate: !!self?.connected && isModerator(self),
    needsBlock: state.needsBlock,
    challenge: clone(state.challenge),
    pendingAdmissions: [],
    notice: state.notice,
  };
}
