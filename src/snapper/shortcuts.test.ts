import test from "node:test";
import assert from "node:assert/strict";
import { gameShortcut, moderationActions } from "./shortcuts.ts";

const state = { canModerate: true, phase: "reading" as const, pausedReasons: [], challenge: null };
const event = {
  key: "p",
  code: "KeyP",
  repeat: false,
  isComposing: false,
  altKey: false,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  defaultPrevented: false,
};
const press = (key: string, overrides = {}) => ({
  ...event,
  key,
  code: `Key${key.toUpperCase()}`,
  ...overrides,
});

test("P pauses and resumes only when the moderator button is enabled", () => {
  assert.equal(
    gameShortcut(event, { ...moderationActions(state, true), canBuzz: false }, false),
    "pause",
  );
  assert.equal(
    gameShortcut(
      event,
      {
        ...moderationActions({ ...state, pausedReasons: ["Paused by a moderator"] }, true),
        canBuzz: false,
      },
      false,
    ),
    "resume",
  );
  for (const controls of [
    moderationActions({ ...state, canModerate: false }, true),
    moderationActions(state, false),
    moderationActions({ ...state, phase: "waiting" }, true),
    moderationActions({ ...state, challenge: { playerId: "guest", name: "Guest" } }, true),
  ])
    assert.equal(gameShortcut(event, { ...controls, canBuzz: true }, false), null);
});

test("N advances only an unpaused reveal with moderator permission", () => {
  const reveal = { ...state, phase: "reveal" as const };
  assert.equal(
    gameShortcut(press("n"), { ...moderationActions(reveal, true), canBuzz: false }, false),
    "next",
  );
  for (const controls of [
    moderationActions(state, true),
    moderationActions({ ...state, phase: "answering" }, true),
    moderationActions({ ...reveal, pausedReasons: ["Paused"] }, true),
    moderationActions({ ...reveal, challenge: { playerId: "guest", name: "Guest" } }, true),
    moderationActions({ ...reveal, canModerate: false }, true),
    moderationActions(reveal, false),
  ])
    assert.equal(gameShortcut(press("n"), { ...controls, canBuzz: true }, false), null);
});

test("typing, dialogs, composition, repeated keys and modifier shortcuts never send game actions", () => {
  const controls = { pause: "pause" as const, next: true, canBuzz: true };
  for (const key of ["p", "n", " "]) {
    const base = press(key, key === " " ? { code: "Space" } : {});
    assert.equal(gameShortcut(base, controls, true), null);
    for (const flag of [
      "repeat",
      "isComposing",
      "altKey",
      "ctrlKey",
      "metaKey",
      "shiftKey",
      "defaultPrevented",
    ] as const)
      assert.equal(gameShortcut({ ...base, [flag]: true }, controls, false), null, flag);
  }
  assert.equal(gameShortcut(press(" ", { code: "Space" }), controls, false), "buzz");
  assert.equal(gameShortcut(press("P"), controls, false), "pause");
  assert.equal(gameShortcut(press("x"), controls, false), null);
});
