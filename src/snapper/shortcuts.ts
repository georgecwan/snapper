import type { SessionView } from "./protocol.ts";

type ModerationState = Pick<SessionView, "canModerate" | "phase" | "pausedReasons" | "challenge">;
export function moderationActions(state: ModerationState, connected: boolean) {
  const enabled = connected && state.canModerate && state.phase !== "waiting" && !state.challenge;
  return {
    pause: enabled ? (state.pausedReasons.length ? ("resume" as const) : ("pause" as const)) : null,
    next: enabled && state.phase === "reveal" && state.pausedReasons.length === 0,
    skip: enabled && state.phase !== "reveal",
  };
}

type ShortcutEvent = Pick<
  KeyboardEvent,
  | "key"
  | "code"
  | "repeat"
  | "isComposing"
  | "altKey"
  | "ctrlKey"
  | "metaKey"
  | "shiftKey"
  | "defaultPrevented"
>;
type Controls = ReturnType<typeof moderationActions> & { canBuzz: boolean; canChat: boolean };

/** Resolve only actions currently enabled by the corresponding game controls. */
export function gameShortcut(event: ShortcutEvent, controls: Controls, blocked: boolean) {
  if (
    blocked ||
    event.defaultPrevented ||
    event.repeat ||
    event.isComposing ||
    event.altKey ||
    event.ctrlKey ||
    event.metaKey ||
    event.shiftKey
  )
    return null;
  if (event.code === "Space" && controls.canBuzz) return "buzz" as const;
  if (event.key.toLowerCase() === "p") return controls.pause;
  if (event.key.toLowerCase() === "n" && controls.next) return "next" as const;
  if (event.key.toLowerCase() === "s" && controls.skip) return "skip" as const;
  if (event.key.toLowerCase() === "t" && controls.canChat) return "chat" as const;
  return null;
}
