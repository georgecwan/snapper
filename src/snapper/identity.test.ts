import test from "node:test";
import assert from "node:assert/strict";
import { AVATARS, type PlayerView } from "./protocol.ts";
import { playerAvatar, playerColor, scoreLeaders, teamName } from "./identity.ts";

const player = (id: string, changes: Partial<PlayerView> = {}): PlayerView => ({
  id,
  name: id,
  role: "player",
  team: null,
  connected: true,
  owner: false,
  moderator: false,
  score: 0,
  ...changes,
});

test("player identity does not change when the scoreboard order or display name changes", () => {
  const before = player("stable-player");
  const after = { ...before, name: "New nickname", score: 80, team: "B" as const };
  assert.equal(playerAvatar(before), playerAvatar(after));
  assert.equal(playerColor(before.id), playerColor(after.id));
  for (let index = 0; index < 100; index++) {
    const id = `player-${index}`;
    assert.ok(Number.isInteger(playerColor(id)) && playerColor(id) >= 0 && playerColor(id) <= 3);
    assert.ok(AVATARS.includes(playerAvatar(player(id))));
  }
});

test("avatar choices override stable defaults without affecting the player's color", () => {
  for (const avatar of AVATARS)
    assert.equal(playerAvatar(player("one-player", { avatar })), avatar);
});

test("old snapshots fall back to familiar team names until this session supplies names", () => {
  assert.equal(teamName({}, "A"), "Team A");
  assert.equal(teamName({ teamNames: { A: "   " } }, "A"), "Team A");
  const state = { teamNames: { A: "Quiz Cats", B: "Brain Waves" } };
  assert.equal(teamName(state, "A"), "Quiz Cats");
  assert.equal(teamName(state, "B"), "Brain Waves");
  assert.deepEqual(state.teamNames, { A: "Quiz Cats", B: "Brain Waves" });
});

test("leader summaries preserve ties, negative scores and retained player scores", () => {
  assert.deepEqual(scoreLeaders([]), []);
  assert.deepEqual(scoreLeaders([player("watcher", { role: "spectator" })]), []);
  assert.deepEqual(
    scoreLeaders([player("a", { score: -5 }), player("watcher", { role: "spectator" })]).map(
      (person) => person.id,
    ),
    ["a"],
  );
  const tied = [player("a", { score: 10 }), player("b", { score: 10 }), player("c")];
  assert.deepEqual(
    scoreLeaders(tied).map((person) => person.id),
    ["a", "b"],
  );
  assert.deepEqual(
    scoreLeaders([...tied].reverse()).map((person) => person.id),
    ["b", "a"],
  );
  const retained = player("away", { connected: false, role: "spectator", score: 20 });
  assert.deepEqual(
    scoreLeaders([...tied, retained]).map((person) => person.id),
    ["away"],
  );
});
