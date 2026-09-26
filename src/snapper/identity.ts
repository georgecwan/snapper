import {
  AVATARS,
  DEFAULT_TEAM_NAMES,
  type Avatar,
  type PlayerView,
  type Team,
} from "./protocol.ts";

/** Identity stays stable when scores, names, seats or the sorting order change. */
function identityHash(id: string): number {
  let hash = 2166136261;
  for (let index = 0; index < id.length; index++)
    hash = Math.imul(hash ^ id.charCodeAt(index), 16777619);
  return hash >>> 0;
}

export function playerColor(id: string): number {
  return identityHash(id) % 4;
}

export function playerAvatar(player: Pick<PlayerView, "id" | "avatar">): Avatar {
  return player.avatar && AVATARS.includes(player.avatar)
    ? player.avatar
    : AVATARS[identityHash(player.id) % AVATARS.length]!;
}

export function teamName(state: { teamNames?: Partial<Record<Team, string>> }, team: Team): string {
  return state.teamNames?.[team]?.trim() || DEFAULT_TEAM_NAMES[team];
}

/** Match the retained score rows, excluding zero-score visitors who only watch. */
export function scoreLeaders(players: readonly PlayerView[]): PlayerView[] {
  const contenders = players.filter((player) => player.role === "player" || player.score !== 0);
  if (!contenders.length) return [];
  const highest = Math.max(...contenders.map((player) => player.score));
  return contenders.filter((player) => player.score === highest);
}

export const AVATAR_LABELS: Record<Avatar, string> = {
  "⚡": "Lightning",
  "🦊": "Fox",
  "🐸": "Frog",
  "🐙": "Octopus",
  "🐼": "Panda",
  "🦉": "Owl",
  "🐱": "Cat",
  "🐶": "Dog",
  "🦖": "Dinosaur",
  "🚀": "Rocket",
  "🌵": "Cactus",
  "🍄": "Mushroom",
  "👾": "Space invader",
  "🤖": "Robot",
  "🎲": "Dice",
  "🌈": "Rainbow",
};
