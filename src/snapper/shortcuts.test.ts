import test from "node:test";
import assert from "node:assert/strict";
import { gameShortcut, moderationActions, reservesGameSpace } from "./shortcuts.ts";

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

test("Space never falls through to page scrolling when a participant cannot buzz", () => {
  const space = press(" ", { code: "Space" });
  for (const connected of [false, true])
    for (const phase of ["waiting", "reading", "answering", "reveal"] as const)
      for (const pausedReasons of [[], ["Paused"]]) {
        const controls = {
          ...moderationActions({ ...state, phase, pausedReasons }, connected),
          // Includes spectators, lockouts, and another player's answer window.
          canBuzz: false,
          canChat: connected,
        };
        assert.equal(gameShortcut(space, controls, false), null);
        assert.equal(reservesGameSpace(space, false), true);
      }
});

test("holding Space consumes repeats without buzzing again", () => {
  const controls = { ...moderationActions(state, true), canBuzz: true, canChat: true };
  const space = press(" ", { code: "Space" });
  assert.equal(gameShortcut(space, controls, false), "buzz");
  assert.equal(reservesGameSpace(space, false), true);
  assert.equal(gameShortcut({ ...space, repeat: true }, controls, false), null);
  assert.equal(reservesGameSpace({ ...space, repeat: true }, false), true);
  assert.equal(reservesGameSpace({ ...space, code: "" }, false), true);
});

test("reserved Space preserves typing, native controls, overlays and modified shortcuts", () => {
  const space = press(" ", { code: "Space" });
  assert.equal(reservesGameSpace(space, true), false);
  for (const flag of [
    "defaultPrevented",
    "isComposing",
    "altKey",
    "ctrlKey",
    "metaKey",
    "shiftKey",
  ] as const)
    assert.equal(reservesGameSpace({ ...space, [flag]: true }, false), false, flag);
  assert.equal(reservesGameSpace(press("p"), false), false);
});

test("C challenges only when the current-question Challenge button is available", () => {
  const c = press("c");
  const controls = { ...moderationActions(state, false), canBuzz: false, canChat: true };
  // A connected spectator may challenge even without buzz/moderator permission.
  assert.equal(gameShortcut(c, { ...controls, canChallenge: true }, false), "challenge");
  assert.equal(gameShortcut(press("C"), { ...controls, canChallenge: true }, false), "challenge");
  assert.equal(gameShortcut(c, { ...controls, canChallenge: false }, false), null);
  assert.equal(gameShortcut(c, controls, false), null);
  assert.equal(gameShortcut(c, { ...controls, canChallenge: true }, true), null);
  for (const flag of [
    "defaultPrevented",
    "isComposing",
    "repeat",
    "altKey",
    "ctrlKey",
    "metaKey",
    "shiftKey",
  ] as const)
    assert.equal(
      gameShortcut({ ...c, [flag]: true }, { ...controls, canChallenge: true }, false),
      null,
      flag,
    );
});

test("P pauses and resumes only when the moderator button is enabled", () => {
  assert.equal(
    gameShortcut(
      event,
      { ...moderationActions(state, true), canBuzz: false, canChat: true },
      false,
    ),
    "pause",
  );
  assert.equal(
    gameShortcut(
      event,
      {
        ...moderationActions({ ...state, pausedReasons: ["Paused by a moderator"] }, true),
        canBuzz: false,
        canChat: true,
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
    assert.equal(gameShortcut(event, { ...controls, canBuzz: true, canChat: true }, false), null);
});

test("N advances only an unpaused reveal with moderator permission", () => {
  const reveal = { ...state, phase: "reveal" as const };
  assert.equal(
    gameShortcut(
      press("n"),
      { ...moderationActions(reveal, true), canBuzz: false, canChat: true },
      false,
    ),
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
    assert.equal(
      gameShortcut(press("n"), { ...controls, canBuzz: true, canChat: true }, false),
      null,
    );
});

test("S requests skip only for connected moderators before reveal, including while paused", () => {
  for (const phase of ["reading", "answering"] as const)
    for (const pausedReasons of [[], ["Paused by a moderator"]]) {
      const controls = moderationActions({ ...state, phase, pausedReasons }, true);
      assert.equal(controls.skip, true);
      assert.equal(
        gameShortcut(press("s"), { ...controls, canBuzz: false, canChat: true }, false),
        "skip",
      );
    }
  for (const controls of [
    moderationActions({ ...state, canModerate: false }, true),
    moderationActions(state, false),
    moderationActions({ ...state, phase: "waiting" }, true),
    moderationActions({ ...state, phase: "reveal" }, true),
    moderationActions({ ...state, challenge: { playerId: "guest", name: "Guest" } }, true),
    moderationActions(
      {
        ...state,
        pausedReasons: ["Answer challenged"],
        challenge: { playerId: "guest", name: "Guest" },
      },
      true,
    ),
  ]) {
    assert.equal(controls.skip, false);
    assert.equal(
      gameShortcut(press("s"), { ...controls, canBuzz: true, canChat: true }, false),
      null,
    );
  }
});

test("T focuses chat for connected participants regardless of moderator permission or game holds", () => {
  for (const connected of [false, true])
    for (const canModerate of [false, true])
      for (const phase of ["waiting", "reading", "answering", "reveal"] as const)
        for (const pausedReasons of [[], ["Paused by a moderator"]])
          for (const challenge of [null, { playerId: "guest", name: "Guest" }]) {
            const controls = {
              ...moderationActions({ canModerate, phase, pausedReasons, challenge }, connected),
              // Chat is available to spectators and players without buzz eligibility.
              canBuzz: false,
              canChat: connected,
            };
            assert.equal(
              gameShortcut(press("t"), controls, false),
              connected ? "chat" : null,
              `connected=${connected}, moderator=${canModerate}, phase=${phase}, paused=${pausedReasons.length > 0}, challenge=${Boolean(challenge)}`,
            );
          }
});

test("typing, dialogs, composition, repeated keys and modifier shortcuts never trigger actions", () => {
  const controls = {
    pause: "pause" as const,
    next: true,
    skip: true,
    canBuzz: true,
    canChat: true,
  };
  for (const key of ["p", "n", "s", "t", " "]) {
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
  assert.equal(gameShortcut(press("S"), controls, false), "skip");
  assert.equal(gameShortcut(press("T"), controls, false), "chat");
  assert.equal(gameShortcut(press("x"), controls, false), null);
});
