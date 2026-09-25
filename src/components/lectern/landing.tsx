import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { BookOpen, Users } from "lucide-react";

function makeCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 5; i += 1) code += alphabet[Math.floor(Math.random() * alphabet.length)]!;
  return code;
}

function cleanName(raw: string) {
  const name = raw.replace(/\s+/g, " ").trim().slice(0, 18);
  return name || "Reader";
}

export function Landing() {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [joinOpen, setJoinOpen] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setName(localStorage.getItem("lectern-name") ?? "");
  }, []);

  function saveName() {
    const next = cleanName(name);
    localStorage.setItem("lectern-name", next);
    return next;
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-6xl flex-col px-4 py-8 sm:px-8 sm:py-12">
      <header className="flex items-center gap-3">
        <span className="h-3 w-3 bg-brass" aria-hidden="true" />
        <p className="text-sm font-semibold tracking-widest text-brass">LECTERN</p>
      </header>

      <div className="mt-10 grid flex-1 items-start gap-10 lg:mt-16 lg:grid-cols-2 lg:gap-16">
        <div>
          <h1 className="max-w-xl font-serif text-5xl leading-tight text-balance text-fg sm:text-6xl">
            Buzz in before the sentence finishes.
          </h1>
          <p className="mt-5 max-w-md text-lg leading-relaxed text-pretty text-muted">
            A private tossup room for friends. The question reads itself. Hit the buzzer the moment you know — early
            answers are worth more.
          </p>

          <label className="mt-8 block text-sm font-medium text-fg" htmlFor="lectern-name">
            Your name at the table
          </label>
          <input
            id="lectern-name"
            value={name}
            maxLength={18}
            autoComplete="nickname"
            placeholder="Ada"
            onChange={(e) => setName(e.target.value)}
            className="mt-2 h-12 w-full max-w-sm rounded-xl border border-line bg-surface px-3 text-fg outline-none"
          />

          <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
            <button
              type="button"
              className="inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-brass px-5 font-semibold text-ink transition-transform duration-150 ease-out active:scale-[0.96]"
              onClick={() => {
                saveName();
                void navigate({ to: "/", search: { room: "", practice: 1 } });
              }}
            >
              <BookOpen className="size-4" aria-hidden="true" />
              Practice a packet
            </button>
            <button
              type="button"
              className="inline-flex h-12 items-center justify-center gap-2 rounded-xl border border-line bg-surface px-5 font-semibold text-fg transition-transform duration-150 ease-out active:scale-[0.96]"
              onClick={() => {
                saveName();
                const room = makeCode();
                sessionStorage.setItem(`lectern-host-${room}`, "1");
                void navigate({ to: "/", search: { room, practice: 0 } });
              }}
            >
              <Users className="size-4" aria-hidden="true" />
              Open a room
            </button>
            <button
              type="button"
              className="inline-flex h-12 items-center justify-center rounded-xl px-4 font-semibold text-muted"
              onClick={() => {
                setJoinOpen((v) => !v);
                setError("");
              }}
            >
              Join with a code
            </button>
          </div>

          {joinOpen && (
            <form
              className="mt-4 flex max-w-sm flex-col gap-2 sm:flex-row"
              onSubmit={(e) => {
                e.preventDefault();
                const room = code.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 5);
                if (room.length < 4) {
                  setError("Codes are five characters.");
                  return;
                }
                saveName();
                sessionStorage.removeItem(`lectern-host-${room}`);
                void navigate({ to: "/", search: { room, practice: 0 } });
              }}
            >
              <input
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder="K7QMP"
                aria-label="Room code"
                maxLength={5}
                className="h-12 flex-1 rounded-xl border border-line bg-surface px-3 tracking-widest text-fg uppercase outline-none"
              />
              <button
                type="submit"
                className="h-12 rounded-xl bg-fg px-4 font-semibold text-bg transition-transform duration-150 ease-out active:scale-[0.96]"
              >
                Sit down
              </button>
            </form>
          )}
          {error && <p className="mt-2 text-sm text-bad">{error}</p>}

          <dl className="mt-10 grid max-w-lg grid-cols-3 gap-4 border-t border-line pt-6 text-sm">
            <div>
              <dt className="text-muted">Power</dt>
              <dd className="mt-1 font-semibold text-fg tabular-nums">15</dd>
            </div>
            <div>
              <dt className="text-muted">After the mark</dt>
              <dd className="mt-1 font-semibold text-fg tabular-nums">10</dd>
            </div>
            <div>
              <dt className="text-muted">To answer</dt>
              <dd className="mt-1 font-semibold text-fg tabular-nums">8s</dd>
            </div>
          </dl>
        </div>

        <aside className="paper-card overflow-hidden" aria-hidden="true">
          <div className="paper-rule" />
          <div className="px-6 py-6 sm:px-8 sm:py-8">
            <p className="text-xs font-semibold tracking-widest text-brass-deep">SCIENCE · MID-READ</p>
            <p className="mt-4 font-serif text-2xl leading-relaxed text-pretty text-ink sm:text-3xl">
              Henry Cavendish used a torsion balance in 1798 to measure the constant that sets the strength of this
              interaction.
              <span className="caret" />
            </p>
            <p className="mt-8 text-sm text-ink-soft">Space, or the brass button. Wrong answers step aside; the line keeps going.</p>
          </div>
        </aside>
      </div>
    </main>
  );
}

export function Seating({ label }: { label: string }) {
  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <p className="text-muted">{label}</p>
    </main>
  );
}

export function NameGate({ onSave }: { onSave: (name: string) => void }) {
  const [name, setName] = useState("");
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4">
      <p className="text-sm font-semibold tracking-widest text-brass">LECTERN</p>
      <h1 className="mt-3 font-serif text-4xl text-fg">What should we call you?</h1>
      <form
        className="mt-6 flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          const next = cleanName(name);
          localStorage.setItem("lectern-name", next);
          onSave(next);
        }}
      >
        <label className="text-sm text-muted" htmlFor="gate-name">
          Name at the table
        </label>
        <input
          id="gate-name"
          value={name}
          autoFocus
          maxLength={18}
          onChange={(e) => setName(e.target.value)}
          className="h-12 rounded-xl border border-line bg-surface px-3 text-fg outline-none"
        />
        <button
          type="submit"
          className="h-12 rounded-xl bg-brass font-semibold text-ink transition-transform duration-150 ease-out active:scale-[0.96]"
        >
          Take a seat
        </button>
      </form>
    </main>
  );
}
