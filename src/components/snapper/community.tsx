import { useEffect, useRef, useState, type RefObject } from "react";
import { ArrowRight, Check, Eye, MessageCircle, MoreHorizontal, Send, Trophy } from "lucide-react";
import type { GameAction, PlayerView, SessionView } from "@/snapper/protocol";
import type { Confirm } from "./game";
import { Menu } from "./menu";

type SendAction = (action: GameAction) => boolean;

export function SeatButtons({
  state,
  send,
  disabled = false,
}: {
  state: SessionView;
  send: SendAction;
  disabled?: boolean;
}) {
  const players = state.players.filter((player) => player.connected && player.role === "player");
  return (
    <div className="seat-buttons">
      {state.config.mode === "teams" ? (
        (["A", "B"] as const).map((team) => (
          <button
            className="button primary mini"
            key={team}
            disabled={
              disabled ||
              players.length >= 16 ||
              players.filter((player) => player.team === team).length >= 8
            }
            onClick={() => send({ type: "take-seat", team })}
          >
            Join team {team}
            <ArrowRight size={15} />
          </button>
        ))
      ) : (
        <button
          className="button primary"
          disabled={disabled || players.length >= 16}
          onClick={() => send({ type: "take-seat" })}
        >
          Take a player seat <ArrowRight size={17} />
        </button>
      )}
    </div>
  );
}

function ParticipantMenu({
  player,
  state,
  self,
  send,
  confirm,
}: {
  player: PlayerView;
  state: SessionView;
  self?: PlayerView;
  send: SendAction;
  confirm: Confirm;
}) {
  if (!state.canModerate || player.id === self?.id || player.owner || player.removed) return null;
  return (
    <Menu
      className="player-menu"
      label={`Manage ${player.name}`}
      trigger={<MoreHorizontal size={18} />}
    >
      {self?.owner && player.role === "player" && player.connected && (
        <button
          onClick={() =>
            send({ type: "promote", playerId: player.id, moderator: !player.moderator })
          }
        >
          {player.moderator ? "Remove moderator" : "Make moderator"}
        </button>
      )}
      <button
        onClick={() =>
          confirm(
            `Remove ${player.name}?`,
            `${player.name} will leave this session and lose access to it. Their existing score and answers stay in the game history.`,
            () => send({ type: "kick", playerId: player.id }),
            "Remove",
          )
        }
      >
        Remove from session
      </button>
    </Menu>
  );
}

export function Scoreboard({
  state,
  self,
  send,
  confirm,
}: {
  state: SessionView;
  self?: PlayerView;
  send: SendAction;
  confirm: Confirm;
}) {
  const sorted = [...state.players]
    .filter((player) => player.role === "player" || player.score !== 0)
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  const playerCount = state.players.filter(
    (player) => player.connected && player.role === "player",
  ).length;
  const spectators = state.players.filter(
    (player) => player.role === "spectator" && player.connected && !player.removed,
  );
  return (
    <>
      <div className="panel-heading">
        <h2>
          <Trophy size={18} /> Scoreboard
        </h2>
        <span>{playerCount}/16</span>
      </div>
      {state.config.mode === "teams" && (
        <div className="team-scores">
          {(["A", "B"] as const).map((team) => (
            <div className={`team-score team-${team.toLowerCase()}`} key={team}>
              <span>TEAM {team}</span>
              <strong>{state.teamScores[team]}</strong>
              <small>
                {
                  state.players.filter(
                    (player) =>
                      player.connected && player.role === "player" && player.team === team,
                  ).length
                }
                /8 players
              </small>
            </div>
          ))}
        </div>
      )}
      <ol className="player-list">
        {sorted.map((player, index) => (
          <li
            key={player.id}
            className={`${player.id === state.selfId ? "is-self" : ""} ${!player.connected ? "is-offline" : ""}`}
          >
            <span className="player-rank">
              {index === 0 && player.score > 0 ? (
                <Trophy size={16} />
              ) : (
                String(index + 1).padStart(2, "0")
              )}
            </span>
            <div className={`player-avatar avatar-${index % 4}`}>
              {player.name.slice(0, 1).toUpperCase()}
            </div>
            <div className="player-name">
              <strong>
                {player.name}
                {player.id === state.selfId && <small>you</small>}
              </strong>
              <span>
                {[
                  player.removed
                    ? "Removed"
                    : !player.connected
                      ? "Away"
                      : player.role === "spectator"
                        ? "Watching"
                        : "",
                  player.owner ? "Owner" : player.moderator ? "Moderator" : "",
                  player.team ? `Team ${player.team}` : "",
                  player.connected &&
                  !player.owner &&
                  !player.moderator &&
                  !player.team &&
                  player.role === "player"
                    ? state.eligibleIds.includes(player.id)
                      ? "Ready to buzz"
                      : "In the lobby"
                    : "",
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            </div>
            <strong className="player-score">{player.score}</strong>
            <ParticipantMenu
              player={player}
              state={state}
              self={self}
              send={send}
              confirm={confirm}
            />
          </li>
        ))}
      </ol>
      {sorted.length === 0 && (
        <p className="empty-copy">Scoreboard is waiting for its first contenders.</p>
      )}
      {self && (
        <div className="seat-controls">
          {state.config.mode === "teams" && self.role === "player" && (
            <div className="team-choice">
              <span>Your team</span>
              {(["A", "B"] as const).map((team) => (
                <button
                  key={team}
                  className={self.team === team ? "selected" : ""}
                  aria-pressed={self.team === team}
                  disabled={
                    self.team === team ||
                    state.players.filter(
                      (player) =>
                        player.connected && player.role === "player" && player.team === team,
                    ).length >= 8
                  }
                  onClick={() => send({ type: "team", team })}
                >
                  Team {team}
                  {self.team === team && <Check size={13} />}
                </button>
              ))}
            </div>
          )}
          {self.role === "player" ? (
            <button
              className="text-link subtle"
              onClick={() =>
                confirm(
                  "Switch to spectator?",
                  "Your score stays with you while the session is active. If no connected players remain, the session ends for everyone.",
                  () => {
                    send({ type: "spectate" });
                  },
                )
              }
            >
              <Eye size={14} /> Switch to watching
            </button>
          ) : (
            <SeatButtons state={state} send={send} />
          )}
        </div>
      )}
      <div className="spectator-list">
        <div>
          <Eye size={13} />
          <span>{spectators.length ? "SPECTATORS" : "No spectators yet"}</span>
        </div>
        {spectators.map((player) => (
          <div key={player.id}>
            <span>
              {player.name}
              {player.id === self?.id && " (you)"}
            </span>
            <ParticipantMenu
              player={player}
              state={state}
              self={self}
              send={send}
              confirm={confirm}
            />
          </div>
        ))}
      </div>
    </>
  );
}

export function Chat({
  state,
  send,
  connected,
  inputRef,
}: {
  state: SessionView;
  send: SendAction;
  connected: boolean;
  inputRef: RefObject<HTMLInputElement | null>;
}) {
  const [text, setText] = useState("");
  const list = useRef<HTMLDivElement>(null);
  const lastMessageId = state.chat[state.chat.length - 1]?.id;
  const previousMessageId = useRef(lastMessageId);
  useEffect(() => {
    const node = list.current;
    if (
      node &&
      lastMessageId !== previousMessageId.current &&
      node.scrollHeight - node.scrollTop - node.clientHeight < 180
    )
      node.scrollTop = node.scrollHeight;
    previousMessageId.current = lastMessageId;
  }, [lastMessageId]);
  return (
    <>
      <div className="panel-heading">
        <h2>
          <MessageCircle size={18} /> Chat
        </h2>
        <span>LOBBY CHAT</span>
      </div>
      <div
        className="chat-messages"
        ref={list}
        role="log"
        aria-label="Public lobby chat"
        aria-live="polite"
        aria-relevant="additions"
      >
        {state.chat.length ? (
          state.chat.map((message) => (
            <div
              className={`chat-message ${message.playerId === state.selfId ? "chat-self" : ""}`}
              key={message.id}
            >
              <div>
                <strong>{message.name}</strong>
                <time dateTime={new Date(message.at).toISOString()}>
                  {new Date(message.at).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </time>
              </div>
              <p>{message.text}</p>
            </div>
          ))
        ) : (
          <div className="chat-empty">
            <span>✳</span>
            <p>No messages yet.</p>
          </div>
        )}
      </div>
      <form
        className="chat-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (text.trim() && send({ type: "chat", text: text.trim() })) setText("");
        }}
      >
        <label className="sr-only" htmlFor="chat-input">
          Message the whole lobby
        </label>
        <input
          id="chat-input"
          ref={inputRef}
          title="Type in chat (T)"
          aria-keyshortcuts="T"
          value={text}
          onChange={(event) => setText(event.target.value)}
          maxLength={500}
          placeholder="Message the lobby…"
          autoComplete="off"
          disabled={!connected}
          enterKeyHint="send"
        />
        <button aria-label="Send chat message" disabled={!connected || !text.trim()}>
          <Send size={17} />
        </button>
      </form>
      <p className="chat-note">Everyone in the lobby can see this chat. Press T to type.</p>
    </>
  );
}
