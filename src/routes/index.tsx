import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Landing, NameGate, Seating } from "@/components/lectern/landing";
import { MatchView } from "@/components/lectern/match-view";
import { useRoomMatch } from "@/game/use-room";
import { useSoloMatch } from "@/game/use-solo";

export const Route = createFileRoute("/")({
  validateSearch: (search: Record<string, unknown>) => {
    const raw = typeof search.room === "string" ? search.room : "";
    const room = raw.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 5);
    const practice = search.practice === "1" || search.practice === 1 ? 1 : 0;
    return { room, practice } as const;
  },
  component: Home,
});

function Home() {
  const { room, practice } = Route.useSearch();
  if (room) return <RoomGate code={room} />;
  if (practice === 1) return <PracticeGate />;
  return <Landing />;
}

function PracticeGate() {
  const [ready, setReady] = useState(false);
  const [name, setName] = useState("");
  useEffect(() => {
    setName(localStorage.getItem("lectern-name") || "Reader");
    setReady(true);
  }, []);
  if (!ready) return <Seating label="Setting a packet on the lectern…" />;
  return <SoloTable name={name} />;
}

function SoloTable({ name }: { name: string }) {
  const match = useSoloMatch(name);
  return (
    <MatchView
      state={match.state}
      selfId={match.selfId}
      isHost
      shown={match.shown}
      clockOffset={0}
      peers={[]}
      joined
      roomCode={null}
      act={match.act}
    />
  );
}

function RoomGate({ code }: { code: string }) {
  const [ready, setReady] = useState(false);
  const [name, setName] = useState("");
  const [claimHost, setClaimHost] = useState(false);
  useEffect(() => {
    setName(localStorage.getItem("lectern-name") || "");
    setClaimHost(sessionStorage.getItem(`lectern-host-${code}`) === "1");
    setReady(true);
  }, [code]);
  if (!ready) return <Seating label="Finding the room…" />;
  if (!name) return <NameGate onSave={setName} />;
  return <RoomTable key={`${code}:${name}`} code={code} name={name} claimHost={claimHost} />;
}

function RoomTable({ code, name, claimHost }: { code: string; name: string; claimHost: boolean }) {
  const match = useRoomMatch(code, name, claimHost);
  if (!match.state || match.waiting) {
    return <Seating label={match.joined ? "Waiting for the reader…" : "Pulling up a chair…"} />;
  }
  return (
    <MatchView
      state={match.state}
      selfId={match.selfId}
      isHost={match.isHost}
      shown={match.shown}
      clockOffset={match.clockOffset}
      peers={match.peers}
      joined={match.joined}
      roomCode={code}
      act={match.act}
    />
  );
}
