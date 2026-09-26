import { useCallback, useEffect, useRef, useState } from "react";
import type { SessionView } from "./protocol";
import { GameSoundDetector, SOUND_NOTES, type GameSound } from "./sounds";

interface Voice {
  oscillator: OscillatorNode;
  gain: GainNode;
}

export function useSound(state: SessionView | null, connected: boolean) {
  const [muted, setMuted] = useState(true);
  const [ready, setReady] = useState(false);
  const mutedRef = useRef(true);
  const audio = useRef<AudioContext | null>(null);
  const mounted = useRef(true);
  const voices = useRef(new Set<Voice>());
  const detector = useRef(new GameSoundDetector());

  const stop = useCallback(() => {
    for (const voice of voices.current) {
      try {
        voice.gain.gain.cancelScheduledValues(0);
        voice.gain.gain.value = 0;
        voice.oscillator.stop();
      } catch {
        // Already stopped/closed audio nodes need no further work.
      }
      voice.oscillator.disconnect();
      voice.gain.disconnect();
    }
    voices.current.clear();
  }, []);

  const unlock = useCallback(() => {
    if (mutedRef.current) return;
    try {
      if (!audio.current || audio.current.state === "closed") {
        audio.current = new AudioContext();
        const created = audio.current;
        created.onstatechange = () => {
          if (!mounted.current || audio.current !== created) return;
          const running = created.state === "running";
          if (!running) {
            stop();
            detector.current.reset();
          }
          setReady(running);
        };
      }
      const context = audio.current;
      if (context.state === "running") {
        setReady(true);
        return;
      }
      // Resume only inside the user's gesture. Events observed while the
      // browser has audio locked are baselined, never saved for later playback.
      detector.current.reset();
      void context.resume().then(
        () => {
          if (mounted.current && audio.current === context && !mutedRef.current)
            setReady(context.state === "running");
        },
        () => {
          if (mounted.current && audio.current === context) setReady(false);
        },
      );
    } catch {
      // Audio is optional, including on browsers without Web Audio support.
    }
  }, [stop]);

  const play = useCallback(
    (kind: GameSound) => {
      const context = audio.current;
      if (mutedRef.current || !context || context.state !== "running") return;
      stop();
      try {
        const start = context.currentTime + 0.005;
        for (const note of SOUND_NOTES[kind]) {
          const oscillator = context.createOscillator();
          const gain = context.createGain();
          const voice = { oscillator, gain };
          voices.current.add(voice);
          const at = start + note.at;
          const end = at + note.duration;
          oscillator.type = note.wave;
          oscillator.frequency.setValueAtTime(note.frequency, at);
          if (note.endFrequency)
            oscillator.frequency.exponentialRampToValueAtTime(note.endFrequency, end);
          gain.gain.setValueAtTime(0.0001, at);
          gain.gain.exponentialRampToValueAtTime(note.volume, at + 0.006);
          gain.gain.exponentialRampToValueAtTime(0.0001, end);
          oscillator.connect(gain);
          gain.connect(context.destination);
          oscillator.onended = () => {
            oscillator.disconnect();
            gain.disconnect();
            voices.current.delete(voice);
          };
          oscillator.start(at);
          oscillator.stop(end + 0.01);
        }
      } catch {
        stop();
      }
    },
    [stop],
  );

  useEffect(() => {
    mounted.current = true;
    const soundDetector = detector.current;
    try {
      const preference = localStorage.getItem("snapper-muted") !== "false";
      mutedRef.current = preference;
      setMuted(preference);
    } catch {
      // Keep the existing default of muted when browser storage is unavailable.
    }
    return () => {
      mounted.current = false;
      soundDetector.reset();
      stop();
      const context = audio.current;
      audio.current = null;
      if (context) {
        context.onstatechange = null;
        try {
          void context.close().catch(() => undefined);
        } catch {
          // An already-closed context is harmless during teardown.
        }
      }
    };
  }, [stop]);

  useEffect(() => {
    if (muted) return;
    const gesture = (event: Event) => {
      if (event.isTrusted) unlock();
    };
    const options = { capture: true, passive: true };
    document.addEventListener("pointerdown", gesture, options);
    document.addEventListener("keydown", gesture, options);
    document.addEventListener("touchend", gesture, options);
    return () => {
      document.removeEventListener("pointerdown", gesture, options);
      document.removeEventListener("keydown", gesture, options);
      document.removeEventListener("touchend", gesture, options);
    };
  }, [muted, unlock]);

  useEffect(() => {
    const audible = !muted && ready && audio.current?.state === "running";
    const kind = detector.current.observe(state, connected, audible);
    if (!connected) stop();
    if (kind) play(kind);
  }, [state, connected, muted, ready, play, stop]);

  const toggle = useCallback(() => {
    const next = !mutedRef.current;
    mutedRef.current = next;
    detector.current.reset();
    setMuted(next);
    try {
      localStorage.setItem("snapper-muted", String(next));
    } catch {
      // Sound preferences are optional browser-local data.
    }
    if (next) {
      stop();
      setReady(false);
      try {
        void audio.current?.suspend().catch(() => undefined);
      } catch {
        // Muting has already stopped every scheduled and active voice.
      }
    } else unlock();
  }, [stop, unlock]);

  return { muted, toggle, unlock };
}
