import { DurableObject } from "cloudflare:workers";
import {
  addParticipant,
  configureSession,
  createSession,
  nextDeadline,
  publicView,
  readyFormats,
  setConnected,
  startBlock,
  tick,
  transition,
  type Session,
} from "../src/snapper/engine";
import { selectBundle } from "../src/snapper/catalog";
import {
  commandSchema,
  configSchema,
  DEFAULT_CONFIG,
  type ClientCommand,
  type PendingAdmission,
  type PlayerView,
  type RoomConfig,
  type ServerMessage,
  type SiteStatus,
} from "../src/snapper/protocol";
import type { Env } from "./index";
import type { GuestToken } from "./security";
import { QuestionPacks } from "./question-packs";

const PENDING_MS = 5 * 60_000;
const STALE_MS = 90_000;
const MAX_PENDING = 32;
const MAX_IDENTITIES = 512;
interface SocketIdentity {
  sid: string;
  pid: string;
  connectionId: string;
  connectedAt: number;
  owner: boolean;
  windowStart: number;
  count: number;
}
interface Receipt {
  pid: string;
  id: string;
  error?: string;
}
interface SessionRecord {
  game: Session;
  pending: PendingAdmission[];
  rejected: string[];
  revoked: string[];
  connections: Record<string, string>;
  receipts: Receipt[];
  hadConnectedPlayer: boolean;
  createdAt: number;
  notice: string | null;
  contentBlocked: boolean;
  waitingForPlayers?: boolean;
}
interface InternalRequest {
  operation: string;
  owner: boolean;
  guest: GuestToken | null;
  name?: string;
  role?: "player" | "spectator";
  config?: RoomConfig;
}
function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
function failure(error: string, status = 400): Response {
  return json({ error }, status);
}
const uid = () => crypto.randomUUID();

/** One object named main-lobby: all roles, order and state changes are decided here. */
export class Lobby extends DurableObject<Env> {
  private config: RoomConfig = structuredClone(DEFAULT_CONFIG);
  private record: SessionRecord | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private readTimer: ReturnType<typeof setTimeout> | null = null;
  private deadlineTimer: ReturnType<typeof setTimeout> | null = null;
  private lastReading = "";
  private questionPacks: QuestionPacks;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.questionPacks = new QuestionPacks(env.ASSETS);
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
    ctx.blockConcurrencyWhile(async () => {
      const savedConfig = await ctx.storage.get<RoomConfig>("config");
      const parsed = configSchema.safeParse(savedConfig);
      if (parsed.success) this.config = parsed.data;
      this.record = (await ctx.storage.get<SessionRecord>("session")) ?? null;
      // A restart can interrupt the gap between replacing/deleting an identity and
      // closing its socket. Never keep a socket outside the recovered session alive.
      for (const ws of ctx.getWebSockets()) {
        const id = this.identity(ws);
        if (
          !id ||
          !this.record ||
          id.sid !== this.record.game.id ||
          this.record.connections[id.pid] !== id.connectionId
        ) {
          try {
            ws.close(1000, "Session connection expired");
          } catch {
            /* already closed */
          }
        }
      }
      if (this.record) {
        // Hibernation preserves sockets; a runtime/deployment restart may not.
        const alive = new Set(
          this.sockets()
            .map((ws) => this.identity(ws)?.pid)
            .filter((id): id is string => Boolean(id)),
        );
        let changed = false;
        for (const player of this.record.game.players) {
          if (player.connected && !alive.has(player.id)) {
            this.record.game = setConnected(this.record.game, player.id, false, Date.now());
            delete this.record.connections[player.id];
            changed = true;
          }
        }
        if (this.record.hadConnectedPlayer && !this.connectedPlayers())
          await this.end("The last player disconnected. The session has ended.");
        else {
          if (changed) await this.save();
          await this.schedule();
        }
      }
    });
  }

  private serial<T>(task: () => Promise<T>): Promise<T> {
    const result = this.queue.then(task, task);
    this.queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private identity(ws: WebSocket): SocketIdentity | null {
    try {
      return ws.deserializeAttachment() as SocketIdentity | null;
    } catch {
      return null;
    }
  }

  private sockets(): WebSocket[] {
    return this.ctx.getWebSockets().filter((ws) => {
      const id = this.identity(ws);
      return (
        ws.readyState === WebSocket.OPEN &&
        Boolean(
          id &&
          this.record &&
          id.sid === this.record.game.id &&
          this.record.connections[id.pid] === id.connectionId,
        )
      );
    });
  }

  private connectedPlayers(): number {
    return this.record?.game.players.filter((p) => p.connected && p.role === "player").length ?? 0;
  }

  private send(ws: WebSocket, message: ServerMessage): void {
    try {
      ws.send(JSON.stringify(message));
    } catch {
      /* close/error events own disconnection cleanup */
    }
  }

  private broadcast(): void {
    if (!this.record) return;
    for (const ws of this.sockets()) {
      const id = this.identity(ws)!;
      const view = publicView(this.record.game, id.pid, Date.now());
      view.pendingAdmissions = id.owner ? this.record.pending.map((p) => ({ ...p })) : [];
      view.notice = this.record.notice ?? view.notice;
      if (this.record.contentBlocked) {
        view.pausedReasons = [
          ...view.pausedReasons,
          this.record.waitingForPlayers
            ? "Waiting for eligible players"
            : "Waiting for suitable questions",
        ];
        view.needsBlock = false;
      }
      this.send(ws, { type: "state", state: view });
    }
  }

  private async save(): Promise<void> {
    if (this.record) await this.ctx.storage.put("session", this.record);
  }

  private async end(message: string): Promise<void> {
    const sockets = this.sockets();
    this.record = null;
    if (this.readTimer) clearTimeout(this.readTimer);
    if (this.deadlineTimer) clearTimeout(this.deadlineTimer);
    this.readTimer = this.deadlineTimer = null;
    this.lastReading = "";
    await this.ctx.storage.delete("session");
    await this.ctx.storage.deleteAlarm();
    for (const ws of sockets) {
      this.send(ws, { type: "ended", message });
      try {
        ws.close(1000, "Session ended");
      } catch {
        /* already closed */
      }
    }
  }

  private async advance(now = Date.now()): Promise<boolean> {
    if (!this.record) return false;
    const before = this.record.game;
    this.record.game = tick(before, now);
    let changed = this.record.game.revision !== before.revision;
    if (
      this.record.contentBlocked &&
      this.record.waitingForPlayers &&
      readyFormats(this.record.game).length
    ) {
      this.record.contentBlocked = false;
      this.record.waitingForPlayers = false;
      this.record.notice = null;
      changed = true;
    }
    if (this.record.game.needsBlock && !this.record.contentBlocked) {
      const formats = readyFormats(this.record.game);
      if (!formats.length) {
        this.record.contentBlocked = true;
        this.record.waitingForPlayers = true;
        this.record.notice =
          "The selected formats need eligible players or teams before the next block can begin.";
        return true;
      }
      const sid = this.record.game.id;
      const result = await selectBundle(
        { ...this.record.game.config, formats },
        this.record.game.usedIds,
        this.record.game.players,
        fetch,
        Math.random,
        this.questionPacks.select,
      );
      if (this.record?.game.id !== sid) return changed;
      if (result.bundle) {
        const next = startBlock(this.record.game, result.bundle, Date.now());
        if (next === this.record.game || !next.block) {
          this.record.contentBlocked = true;
          this.record.waitingForPlayers = false;
          this.record.notice =
            "This question pack cannot run with the current settings. The owner can change settings, then resume.";
        } else {
          this.record.game = next;
          this.record.notice = result.message ?? null;
        }
        changed = true;
      } else {
        this.record.notice =
          result.message ??
          "No unseen questions match these settings. Change the saved settings to continue.";
        this.record.contentBlocked = true;
        this.record.waitingForPlayers = false;
        // Do not repeatedly call a failed/empty provider from word frames or polls.
        changed = true;
      }
    }
    return changed;
  }

  private prunePending(now = Date.now()): boolean {
    if (!this.record) return false;
    const expired = this.record.pending.filter((p) => p.requestedAt + PENDING_MS <= now);
    if (!expired.length) return false;
    this.record.rejected = [...this.record.rejected, ...expired.map((p) => p.id)].slice(-128);
    this.record.pending = this.record.pending.filter((p) => p.requestedAt + PENDING_MS > now);
    return true;
  }

  private async schedule(): Promise<void> {
    if (this.deadlineTimer) clearTimeout(this.deadlineTimer);
    if (this.readTimer) clearTimeout(this.readTimer);
    this.deadlineTimer = this.readTimer = null;
    if (!this.record) return;
    const now = Date.now();
    const engineDeadline = nextDeadline(this.record.game);
    const pendingDeadline = this.record.pending.length
      ? Math.min(...this.record.pending.map((p) => p.requestedAt + PENDING_MS))
      : null;
    const connected = this.sockets();
    const presenceDeadline = connected.length
      ? Math.min(
          ...connected.map(
            (ws) =>
              (this.ctx.getWebSocketAutoResponseTimestamp(ws)?.getTime() ??
                this.identity(ws)!.connectedAt) +
              STALE_MS +
              1,
          ),
        )
      : this.record.createdAt + 60_000;
    const candidates = [engineDeadline, pendingDeadline, presenceDeadline].filter(
      (n): n is number => n !== null && Number.isFinite(n),
    );
    const at = Math.max(now + 20, Math.min(...candidates));
    const existing = await this.ctx.storage.getAlarm();
    if (existing !== at && (existing === null || Math.abs(existing - at) > 20))
      await this.ctx.storage.setAlarm(at);
    // Native timers give responsive in-session deadlines; the alarm is the durable fallback.
    if (engineDeadline !== null && engineDeadline < now + 45_000) {
      this.deadlineTimer = setTimeout(
        () => {
          this.ctx.waitUntil(this.serial(() => this.onDeadline()));
        },
        Math.max(10, engineDeadline - now),
      );
    }
    const view = this.record.game.players[0]
      ? publicView(this.record.game, this.record.game.players[0].id, now)
      : null;
    if (view?.phase === "reading" && !view.pausedReasons.length && !view.question?.readingComplete)
      this.readTimer = setTimeout(() => this.readingFrame(), 100);
  }

  private readingFrame(): void {
    this.readTimer = null;
    if (!this.record || !this.sockets().length) return;
    const now = Date.now();
    const first = this.record.game.players[0];
    if (!first) return;
    const view = publicView(this.record.game, first.id, now);
    if (view.phase !== "reading" || view.pausedReasons.length || !view.question) return;
    const textKey = `${view.question.id}:${view.question.text}:${view.question.readingComplete}`;
    if (textKey !== this.lastReading) {
      this.lastReading = textKey;
      for (const ws of this.sockets())
        this.send(ws, {
          type: "reading",
          questionId: view.question.id,
          text: view.question.text,
          readingComplete: view.question.readingComplete,
          serverTime: now,
        });
    }
    if (!view.question.readingComplete) this.readTimer = setTimeout(() => this.readingFrame(), 100);
  }

  private async onDeadline(): Promise<void> {
    if (!this.record) return;
    const now = Date.now();
    let changed = this.prunePending(now);
    for (const ws of this.sockets()) {
      const id = this.identity(ws)!;
      const pong = this.ctx.getWebSocketAutoResponseTimestamp(ws)?.getTime() ?? id.connectedAt;
      if (now - pong > STALE_MS) {
        try {
          ws.close(1001, "Connection expired");
        } catch {
          /* already closed */
        }
        this.record.game = setConnected(this.record.game, id.pid, false, now);
        delete this.record.connections[id.pid];
        changed = true;
      }
    }
    if (
      (this.record.hadConnectedPlayer && !this.connectedPlayers()) ||
      (!this.record.hadConnectedPlayer && now - this.record.createdAt >= 60_000)
    ) {
      await this.end("The last player disconnected. The owner can open a new session.");
      return;
    }
    changed = (await this.advance(now)) || changed;
    if (changed) {
      await this.save();
      this.broadcast();
    }
    await this.schedule();
  }

  async alarm(): Promise<void> {
    return this.serial(() => this.onDeadline());
  }

  async fetch(request: Request): Promise<Response> {
    return this.serial(async () => {
      if (new URL(request.url).pathname === "/connect") return this.connectClient(request);
      const input = (await request.json()) as InternalRequest;
      if (this.prunePending()) {
        await this.save();
        this.broadcast();
      }
      if (input.operation === "status") {
        const guest = input.guest?.sid === this.record?.game.id ? input.guest : null;
        let admission: SiteStatus["admission"] = "none";
        let message: string | undefined;
        if (guest && this.record) {
          const participant = this.record.game.players.find((p) => p.id === guest.pid);
          if (this.record.revoked.includes(guest.pid) || this.record.rejected.includes(guest.pid)) {
            admission = "rejected";
            message = "The request was declined or has expired. Ask the owner before trying again.";
          } else if (participant?.owner && !input.owner)
            message = "Your owner sign-in expired. Sign in again to return to your seat.";
          else if (participant) admission = "approved";
          else if (this.record.pending.some((p) => p.id === guest.pid)) admission = "pending";
        }
        return json({
          owner: input.owner,
          active: Boolean(this.record),
          sessionId: this.record?.game.id ?? null,
          config: this.config,
          admission,
          ...(message ? { message } : {}),
        });
      }
      if (input.operation === "open") {
        if (!input.owner) return failure("Only the owner may open a session.", 403);
        if (!this.record) {
          const player: PlayerView = {
            id: uid(),
            name: input.name!,
            team: null,
            score: 0,
            role: "player",
            connected: false,
            owner: true,
            moderator: true,
          };
          this.record = {
            game: createSession(uid(), player, this.config, Date.now()),
            pending: [],
            rejected: [],
            revoked: [],
            connections: {},
            receipts: [],
            hadConnectedPlayer: false,
            createdAt: Date.now(),
            notice: null,
            contentBlocked: false,
          };
        }
        const owner = this.record.game.players.find((p) => p.owner);
        if (!owner) return failure("The owner identity could not be restored.", 409);
        await this.save();
        await this.schedule();
        return json({ sid: this.record.game.id, pid: owner.id });
      }
      if (input.operation === "request") {
        if (!this.record) return failure("The owner has not opened a session yet.", 409);
        const guest = input.guest;
        if (
          guest?.sid === this.record.game.id &&
          this.record.game.players.some((p) => p.id === guest.pid && p.owner) &&
          !input.owner
        )
          return failure("Sign in as the owner again to return to your seat.", 403);
        if (
          guest?.sid === this.record.game.id &&
          (this.record.pending.some((p) => p.id === guest.pid) ||
            this.record.game.players.some((p) => p.id === guest.pid)) &&
          !this.record.revoked.includes(guest.pid)
        )
          return json({ sid: guest.sid, pid: guest.pid });
        if (this.record.pending.length >= MAX_PENDING)
          return failure("The approval queue is full. Please try again later.", 429);
        if (this.record.game.players.length >= MAX_IDENTITIES)
          return failure(
            "This session has reached its identity limit. The owner can start a new session.",
            409,
          );
        const pid = uid();
        this.record.pending.push({
          id: pid,
          name: input.name!,
          role: input.role!,
          requestedAt: Date.now(),
        });
        await this.save();
        this.broadcast();
        await this.schedule();
        return json({ sid: this.record.game.id, pid });
      }
      if (input.operation === "config") {
        if (!input.owner) return failure("Only the owner can save settings.", 403);
        const validated = configSchema.safeParse(input.config);
        if (!validated.success) return failure("Invalid settings.");
        if (this.record) {
          this.record.game = configureSession(this.record.game, validated.data, Date.now());
          this.record.contentBlocked = false;
          this.record.waitingForPlayers = false;
          this.record.notice = null;
        }
        this.config = validated.data;
        await this.ctx.storage.put("config", this.config);
        await this.advance();
        await this.save();
        this.broadcast();
        await this.schedule();
        return json({ ok: true });
      }
      if (input.operation === "logout") {
        const pid =
          input.guest && input.guest.sid === this.record?.game.id ? input.guest.pid : null;
        if (pid && this.record) {
          for (const ws of this.sockets())
            if (this.identity(ws)?.pid === pid) {
              this.send(ws, { type: "ended", message: "You signed out." });
              try {
                ws.close(1000, "Signed out");
              } catch {
                /* already closed */
              }
            }
          this.record.game = setConnected(this.record.game, pid, false, Date.now());
          delete this.record.connections[pid];
          if (this.record.hadConnectedPlayer && !this.connectedPlayers())
            await this.end("The last player left. The session has ended.");
          else {
            await this.save();
            this.broadcast();
            await this.schedule();
          }
        }
        return json({ ok: true });
      }
      return failure("Not found", 404);
    });
  }

  private async connectClient(request: Request): Promise<Response> {
    const sid = request.headers.get("X-Snapper-Session"),
      pid = request.headers.get("X-Snapper-Player");
    if (!this.record || sid !== this.record.game.id || !pid || this.record.revoked.includes(pid))
      return failure("This session is no longer available.", 403);
    const player = this.record.game.players.find((p) => p.id === pid);
    if (!player) return failure("Wait for owner approval before connecting.", 403);
    const owner = request.headers.get("X-Snapper-Owner") === "true";
    if (player.owner && !owner) return failure("Sign in as the owner again.", 403);
    const oldSockets = this.sockets().filter((ws) => this.identity(ws)?.pid === pid);
    // A replacement must not disconnect/reseat the identity, or discard frozen-block membership.
    const connectedGame = oldSockets.length
      ? this.record.game
      : setConnected(this.record.game, pid, true, Date.now());
    const seated = connectedGame.players.find((p) => p.id === pid)!;
    if (!seated.connected)
      return failure(
        "All player and spectator places are full. Please retry when a place opens.",
        409,
      );
    if (this.sockets().length - oldSockets.length >= 32)
      return failure("All places are full. Please retry when a place opens.", 409);
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket];
    const connectionId = uid();
    const identity: SocketIdentity = {
      sid,
      pid,
      connectionId,
      connectedAt: Date.now(),
      owner: seated.owner && owner,
      windowStart: Date.now(),
      count: 0,
    };
    server.serializeAttachment(identity);
    this.ctx.acceptWebSocket(server, [pid]);
    this.record.game = connectedGame;
    this.record.connections[pid] = connectionId;
    if (seated.role === "player") this.record.hadConnectedPlayer = true;
    for (const old of oldSockets) {
      this.send(old, { type: "replaced", message: "A newer tab has taken over this seat." });
      try {
        old.close(1000, "Replaced by newer tab");
      } catch {
        /* old close cannot remove the new connection */
      }
    }
    await this.advance();
    await this.save();
    this.broadcast();
    await this.schedule();
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, data: string | ArrayBuffer): Promise<void> {
    return this.serial(async () => {
      const id = this.identity(ws);
      if (
        !id ||
        !this.record ||
        id.sid !== this.record.game.id ||
        this.record.connections[id.pid] !== id.connectionId
      )
        return;
      if (typeof data !== "string" || new TextEncoder().encode(data).length > 8192) {
        ws.close(1009, "Message is too large");
        return;
      }
      if (data === "ping") {
        ws.send("pong");
        return;
      }
      const now = Date.now();
      if (now - id.windowStart >= 5000) {
        id.count = 0;
        id.windowStart = now;
      }
      id.count++;
      ws.serializeAttachment(id);
      if (id.count > 30) {
        this.send(ws, { type: "error", message: "Too many actions. Please slow down." });
        if (id.count > 60) ws.close(1008, "Action limit exceeded");
        return;
      }
      let command: ClientCommand;
      try {
        command = commandSchema.parse(JSON.parse(data));
      } catch {
        this.send(ws, { type: "error", message: "That action is invalid." });
        return;
      }
      if (command.sessionId !== this.record.game.id) {
        this.send(ws, { type: "error", commandId: command.id, message: "That session has ended." });
        return;
      }
      const receipt = this.record.receipts.find((r) => r.pid === id.pid && r.id === command.id);
      if (receipt) {
        this.send(
          ws,
          receipt.error
            ? { type: "error", commandId: command.id, message: receipt.error }
            : { type: "ack", commandId: command.id },
        );
        return;
      }
      await this.advance(now);
      if (!this.record) return;
      // Use one instant for the deadline transition, stale-question check and action.
      // Otherwise a boundary between projection and transition could buzz the next question.
      const actionNow = Date.now();
      this.record.game = tick(this.record.game, actionNow);
      const current = publicView(this.record.game, id.pid, actionNow);
      let message: string | undefined;
      const questionActions = [
        "buzz",
        "answer",
        "correct",
        "challenge",
        "resolve-challenge",
        "next",
        "skip",
        "end-block",
      ];
      if (
        questionActions.includes(command.action.type) &&
        command.questionId !== (current.question?.id ?? null)
      )
        message = "That question has changed. Please try again.";
      else message = await this.apply(command, id, actionNow);
      if (!this.record) return;
      this.record.receipts.push({
        pid: id.pid,
        id: command.id,
        ...(message ? { error: message } : {}),
      });
      this.record.receipts = this.record.receipts.slice(-1000);
      await this.save();
      this.broadcast();
      await this.schedule();
      this.send(
        ws,
        message
          ? { type: "error", commandId: command.id, message }
          : { type: "ack", commandId: command.id },
      );
    });
  }

  private async apply(
    command: ClientCommand,
    actor: SocketIdentity,
    now: number,
  ): Promise<string | undefined> {
    if (!this.record) return "The session ended.";
    const action = command.action;
    if (
      ["approve", "reject", "close-session", "configure", "promote"].includes(action.type) &&
      !actor.owner
    )
      return "Only the owner can do that.";
    if (action.type === "close-session") {
      await this.end("The owner ended this session.");
      return;
    }
    if (action.type === "approve" || action.type === "reject") {
      const pending = this.record.pending.find((p) => p.id === action.requestId);
      if (!pending) return "That request is no longer waiting.";
      if (pending.requestedAt + PENDING_MS <= now) return "That request expired.";
      if (action.type === "approve") {
        if (this.record.game.players.length >= MAX_IDENTITIES)
          return "This session has reached its identity limit. Open a new session to admit more people.";
        this.record.game = addParticipant(
          this.record.game,
          {
            id: pending.id,
            name: pending.name,
            role: pending.role,
            team: null,
            score: 0,
            owner: false,
            moderator: false,
            connected: false,
          },
          now,
        );
      } else this.record.rejected = [...this.record.rejected, pending.id].slice(-128);
      this.record.pending = this.record.pending.filter((p) => p.id !== pending.id);
      return;
    }
    const result = transition(this.record.game, actor.pid, action, now);
    if (result.error) return result.error;
    this.record.game = result.state;
    if (action.type === "configure") {
      this.config = action.config;
      await this.ctx.storage.put("config", this.config);
    }
    if (action.type === "kick") {
      this.record.revoked.push(action.playerId);
      for (const ws of this.sockets())
        if (this.identity(ws)?.pid === action.playerId) {
          this.send(ws, { type: "ended", message: "A moderator removed you from this session." });
          try {
            ws.close(1000, "Removed from session");
          } catch {
            /* already closed */
          }
        }
      this.record.game = setConnected(this.record.game, action.playerId, false, now);
      delete this.record.connections[action.playerId];
    }
    if (this.record.hadConnectedPlayer && !this.connectedPlayers()) {
      await this.end("No connected players remain. The session has ended.");
      return;
    }
    if (
      action.type === "start" ||
      action.type === "next" ||
      action.type === "resume" ||
      action.type === "configure"
    ) {
      this.record.notice = null;
      this.record.contentBlocked = false;
      this.record.waitingForPlayers = false;
    }
    await this.advance();
    return;
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    try {
      ws.close(1000, "Connection closed");
    } catch {
      /* already closed */
    }
    return this.disconnected(ws);
  }
  async webSocketError(ws: WebSocket): Promise<void> {
    return this.disconnected(ws);
  }
  private disconnected(ws: WebSocket): Promise<void> {
    return this.serial(async () => {
      const id = this.identity(ws);
      if (
        !id ||
        !this.record ||
        id.sid !== this.record.game.id ||
        this.record.connections[id.pid] !== id.connectionId
      )
        return;
      this.record.game = setConnected(this.record.game, id.pid, false, Date.now());
      delete this.record.connections[id.pid];
      if (this.record.hadConnectedPlayer && !this.connectedPlayers()) {
        await this.end("The last player disconnected. The owner can open a new session.");
        return;
      }
      await this.advance();
      await this.save();
      this.broadcast();
      await this.schedule();
    });
  }
}
