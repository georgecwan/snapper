import { FORMAT_LABELS, type SessionView, type Team } from "./protocol.ts";
import { teamName } from "./identity.ts";

export interface LeadChange {
  kind: "lead" | "tie";
  mode: "ffa" | "teams";
  ids: string[];
}

export interface ScoringFeedback {
  attemptId: string;
  playerId: string;
  name: string;
  points: number;
  corrected: boolean;
  leadChange: LeadChange | null;
}

function leaders(scores: Map<string, number>): string[] {
  const highest = Math.max(...scores.values());
  return [...scores].filter(([, score]) => score === highest).map(([id]) => id);
}

/** Rebuild only this question's starting scores, never invent session history. */
function changedLead(state: SessionView): LeadChange | null {
  const after = new Map<string, number>();
  const deltas = new Map<string, number>();
  if (state.config.mode === "teams") {
    after.set("A", state.teamScores.A);
    after.set("B", state.teamScores.B);
    for (const attempt of state.attempts) {
      if (!attempt.points) continue;
      // Old snapshots do not include the original scoring team. A participant's
      // present team is not reliable after they leave and reclaim another seat.
      if (attempt.team !== "A" && attempt.team !== "B") return null;
      deltas.set(attempt.team, (deltas.get(attempt.team) ?? 0) + attempt.points);
    }
  } else {
    for (const player of state.players)
      if (player.role === "player" || player.score !== 0) after.set(player.id, player.score);
    for (const attempt of state.attempts)
      deltas.set(attempt.playerId, (deltas.get(attempt.playerId) ?? 0) + attempt.points);
  }
  if (after.size < 2) return null;
  const before = new Map([...after].map(([id, score]) => [id, score - (deltas.get(id) ?? 0)]));
  const priorLeaders = leaders(before);
  const currentLeaders = leaders(after);
  if (
    currentLeaders.length === priorLeaders.length &&
    currentLeaders.every((id) => priorLeaders.includes(id))
  )
    return null;
  return {
    kind: currentLeaders.length === 1 ? "lead" : "tie",
    mode: state.config.mode,
    ids: currentLeaders,
  };
}

export function scoringFeedback(state: SessionView): ScoringFeedback | null {
  if (state.phase !== "reveal" || !state.question) return null;
  // The earliest accepted attempt wins, including after moderator corrections.
  const winner = state.attempts.find((attempt) => attempt.verdict === "accept");
  if (!winner) return null;
  return {
    attemptId: winner.id,
    playerId: winner.playerId,
    name: winner.name,
    points: Math.max(0, winner.points),
    corrected: state.attempts.some((attempt) => attempt.corrected),
    // A reset keeps the ruling but sets its applied points to zero.
    leadChange: winner.points > 0 ? changedLead(state) : null,
  };
}

export function formatReminder(state: SessionView): { label: string; points: string } | null {
  const format = state.question?.format;
  if (!format) return null;
  const points = state.config.points;
  switch (format) {
    case "tossup":
      return {
        label: FORMAT_LABELS.tossup,
        points: `${points.regular} points · ${points.power} if power applies${state.config.negs ? ` · ${points.penalty} for a miss` : ""}`,
      };
    case "sequence":
      return { label: FORMAT_LABELS.sequence, points: `${points.sequence} points · all in order` };
    case "clues":
      return { label: FORMAT_LABELS.clues, points: `${points.clues.join(" / ")} points by clue` };
    case "team":
      return {
        label: state.block && state.block.index > 0 ? "Team bonus" : FORMAT_LABELS.team,
        points: `${points.regular} points${state.block && state.block.index > 0 ? " · winning team only" : ""}`,
      };
    default:
      return { label: FORMAT_LABELS[format], points: `${points.regular} points` };
  }
}

export function leadChangeText(state: SessionView, change: LeadChange): string {
  if (change.kind === "tie") return "Tied for the lead";
  const id = change.ids[0]!;
  const name =
    change.mode === "teams"
      ? teamName(state, id as Team)
      : state.players.find((player) => player.id === id)?.name;
  return name ? `${name} takes the lead` : "New leader";
}
