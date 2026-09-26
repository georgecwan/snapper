import { useCallback, useEffect, useRef, useState } from "react";
import { initialState, reduce, tick, type Action, type State } from "./engine";

export function useSoloMatch(name: string) {
  const selfId = "you";
  const ref = useRef<State>(initialState(selfId, name));
  const [state, setState] = useState<State>(ref.current);

  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const cur = ref.current;
      const result = tick(cur, dt, Date.now());
      if (result.state !== cur) {
        ref.current = result.state;
        if (result.kind === "event" || Math.floor(result.state.charIndex) !== Math.floor(cur.charIndex)) {
          setState(result.state);
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  const act = useCallback((action: Action) => {
    const next = reduce(ref.current, action, Date.now());
    if (next === ref.current) return;
    ref.current = next;
    setState(next);
  }, []);

  return {
    state,
    selfId,
    isHost: true,
    shown: Math.floor(state.charIndex),
    clockOffset: 0,
    joined: true,
    peers: [] as { id: string; name: string; connectionState: string }[],
    act,
  };
}
