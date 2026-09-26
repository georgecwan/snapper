import test from "node:test";
import assert from "node:assert/strict";
import WebSocket from "ws";

// Run against an isolated `wrangler dev --env local` instance, never production.
const origin = process.env.SNAPPER_TEST_ORIGIN;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test(
  "question pack assets are never available through the public Worker",
  { skip: !origin },
  async () => {
    const owner = new Client();
    await owner.http("/dev-owner", {});
    for (const path of [
      "/_question-packs/manifest.json",
      "/_question-packs/manifest.json?install=1",
      "/%5fquestion-packs/manifest.json",
      "/_question-packs%2fmanifest.json",
      "/%255fquestion-packs/manifest.json",
      "//_question-packs/manifest.json",
      "/foo/%2e%2e/_question-packs/manifest.json",
    ]) {
      for (const method of ["GET", "HEAD", "OPTIONS"]) {
        const response = await fetch(`${origin}${path}`, {
          method,
          headers: {
            Cookie: owner.cookie(),
            "Sec-Fetch-Mode": "navigate",
            Range: "bytes=0-100",
          },
          redirect: "manual",
        });
        assert.equal(response.status, 404, `${method} ${path}`);
        assert.equal(response.headers.get("Cache-Control"), "no-store");
        assert.doesNotMatch(await response.text(), /"groups"|"shards"|"canonical"/);
      }
    }
  },
);

async function eventually(check, description, timeout = 7000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const result = check();
    if (result) return result;
    await sleep(20);
  }
  throw new Error(`Timed out: ${description}`);
}

class Client {
  cookies = new Map();
  messages = [];
  state = null;
  socket = null;
  heartbeat = null;
  closeEvents = [];
  async http(path, body, extra = {}) {
    const response = await fetch(`${origin}/api/snapper${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        Origin: origin,
        Cookie: this.cookie(),
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...extra,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    for (const value of response.headers.getSetCookie()) {
      const [entry] = value.split(";");
      const at = entry.indexOf("=");
      this.cookies.set(entry.slice(0, at), entry.slice(at + 1));
    }
    return { status: response.status, body: await response.json() };
  }
  cookie() {
    return [...this.cookies].map(([key, value]) => `${key}=${value}`).join("; ");
  }
  async connect(expected = 101) {
    const ws = new WebSocket(`${origin.replace(/^http/, "ws")}/api/snapper/connect`, {
      headers: { Origin: origin, Cookie: this.cookie() },
      // The local Worker proxy can retain TCP after both Close frames have
      // crossed. Bound ws's default 30-second transport cleanup; the removal test
      // still requires the server's normal Close code/reason and wasClean.
      closeTimeout: 1000,
    });
    this.socket = ws;
    ws.addEventListener("close", (event) => {
      this.closeEvents.push({
        socket: ws,
        code: event.code,
        reason: event.reason,
        wasClean: event.wasClean,
      });
    });
    ws.on("message", (raw) => {
      if (String(raw) === "pong") return;
      const message = JSON.parse(String(raw));
      this.messages.push(message);
      if (message.type === "state") this.state = message.state;
      if (
        message.type === "answer-draft" &&
        this.state?.phase === "answering" &&
        message.sessionId === this.state.sessionId &&
        message.questionId === this.state.question?.id &&
        message.answerWindowId === this.state.answerWindowId
      )
        this.state = { ...this.state, answerDraft: message.text };
    });
    const outcome = await new Promise((resolve, reject) => {
      ws.once("open", () => resolve(101));
      ws.once("unexpected-response", (_req, response) => {
        resolve(response.statusCode);
        response.resume();
        ws.terminate();
      });
      ws.once("error", (error) => {
        if (expected === 101) reject(error);
      });
    });
    assert.equal(outcome, expected);
    if (outcome === 101) {
      this.heartbeat = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) ws.send("ping");
      }, 20_000);
      await eventually(() => this.state, "initial state");
    }
  }
  send(action, id = crypto.randomUUID()) {
    assert.ok(this.state);
    const command = {
      id,
      sessionId: this.state.sessionId,
      questionId: this.state.question?.id ?? null,
      action,
    };
    this.socket.send(JSON.stringify(command));
    return command;
  }
  draft(text, overrides = {}) {
    assert.ok(this.state?.question && this.state.answerWindowId);
    const message = {
      type: "answer-draft",
      sessionId: this.state.sessionId,
      questionId: this.state.question.id,
      answerWindowId: this.state.answerWindowId,
      text,
      ...overrides,
    };
    this.socket.send(JSON.stringify(message));
    return message;
  }
  result(command) {
    return eventually(
      () =>
        this.messages.find(
          (message) =>
            (message.type === "ack" || message.type === "error") &&
            message.commandId === command.id,
        ),
      "command result",
    );
  }
  close() {
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = null;
    if (this.socket && this.socket.readyState < WebSocket.CLOSING) this.socket.close();
  }
}

test(
  "owner approval, authority, takeover, capacity, reconnect and session cleanup",
  { skip: !origin, timeout: 60_000 },
  async (t) => {
    assert.ok(
      ["localhost", "127.0.0.1", "[::1]"].includes(new URL(origin).hostname),
      "Integration test must use loopback",
    );
    const clients = [];
    const make = () => {
      const client = new Client();
      clients.push(client);
      return client;
    };
    t.after(() => clients.forEach((client) => client.close()));
    const owner = make();
    const first = await owner.http("/status");
    assert.equal(first.body.devAuth, true, "Only run against the local environment");
    assert.equal((await owner.http("/open", { name: "Owner" })).status, 403);
    assert.equal(
      (await owner.http("/dev-owner", {}, { Origin: "https://hostile.example" })).status,
      403,
    );
    assert.equal((await owner.http("/dev-owner", {})).status, 200);
    assert.equal((await owner.http("/open", { name: "Owner" })).status, 200);
    await owner.connect();
    if (first.body.active) {
      owner.send({ type: "close-session" });
      await eventually(
        () => owner.messages.some((m) => m.type === "ended"),
        "clear prior local session",
      );
      owner.close();
      owner.state = null;
      await owner.http("/open", { name: "Owner" });
      await owner.connect();
    }
    const sid = owner.state.sessionId;
    const configure = owner.send({
      type: "configure",
      config: {
        ...owner.state.config,
        mode: "ffa",
        difficulty: "any",
        source: "bundled",
        formats: ["snapper"],
        autoAdvance: false,
        wpm: 500,
      },
    });
    assert.equal((await owner.result(configure)).type, "ack");

    async function admit(name, role = "player") {
      const client = make();
      assert.equal((await client.http("/request", { name, role })).status, 200);
      assert.equal((await client.http("/status")).body.admission, "pending");
      const pending = await eventually(
        () => owner.state.pendingAdmissions.find((p) => p.name === name),
        "pending admission visible to owner",
      );
      const command = owner.send({ type: "approve", requestId: pending.id });
      assert.equal((await owner.result(command)).type, "ack");
      assert.equal((await client.http("/status")).body.admission, "approved");
      await sleep(185); // Exercise capacity without intentionally tripping the action burst limit.
      return client;
    }

    const friend = await admit("Friend");
    await friend.connect();
    const expiredOwner = make();
    expiredOwner.cookies = new Map(owner.cookies);
    expiredOwner.cookies.delete("snapper_owner");
    const expiredStatus = await expiredOwner.http("/status");
    assert.equal(expiredStatus.body.owner, false);
    assert.equal(
      expiredStatus.body.admission,
      "none",
      "Expired owner login must stop reconnect retries",
    );
    assert.match(expiredStatus.body.message, /sign-in expired/);
    await expiredOwner.connect(403);
    assert.equal(
      (await expiredOwner.http("/request", { name: "Owner", role: "player" })).status,
      403,
    );
    assert.equal((await expiredOwner.http("/dev-owner", {})).status, 200);
    assert.equal((await expiredOwner.http("/status")).body.admission, "approved");
    assert.equal((await friend.http("/config", { config: owner.state.config })).status, 403);
    assert.equal(
      (await friend.result(friend.send({ type: "approve", requestId: "made-up" }))).type,
      "error",
    );
    const spectator = await admit("Spectator", "spectator");
    await spectator.connect();
    assert.deepEqual(spectator.state.pendingAdmissions, []);
    const started = owner.send({ type: "start" });
    assert.equal((await owner.result(started)).type, "ack");
    await eventually(
      () => friend.state.question && friend.state.phase === "reading",
      "question starts",
    );
    assert.equal(friend.state.question.answer, null);
    assert.equal(friend.state.question.provenance, null);
    const friendBuzz = friend.send({ type: "buzz" });
    const ownerBuzz = owner.send({ type: "buzz" });
    const outcomes = await Promise.all([friend.result(friendBuzz), owner.result(ownerBuzz)]);
    assert.deepEqual(
      outcomes.map((result) => result.type).sort(),
      ["ack", "error"],
      "Only the first of two simultaneous buzzes wins",
    );
    const winner = outcomes[0].type === "ack" ? friend : owner;
    const buzz = outcomes[0].type === "ack" ? friendBuzz : ownerBuzz;
    assert.equal(winner.state.answererId, winner.state.selfId);
    winner.socket.send(JSON.stringify(buzz));
    const answer = winner.send({ type: "answer", text: "deliberately incorrect test answer 847" });
    assert.equal((await winner.result(answer)).type, "ack");
    winner.socket.send(JSON.stringify(answer));
    await eventually(() => friend.state.attempts.length === 1, "one attempt only after retry");

    const takeover = make();
    takeover.cookies = new Map(owner.cookies);
    await takeover.connect();
    await eventually(() => owner.messages.some((m) => m.type === "replaced"), "old tab replaced");
    assert.equal(takeover.state.sessionId, sid);
    assert.equal(takeover.state.selfId, owner.state.selfId);
    assert.equal(takeover.state.players.filter((p) => p.owner).length, 1);
    owner.close();
    // Keep the admission helper pointed at the new owner connection.
    owner.socket = takeover.socket;
    owner.state = takeover.state;
    owner.messages = takeover.messages;
    takeover.socket.on("message", (raw) => {
      if (String(raw) !== "pong") {
        const m = JSON.parse(String(raw));
        if (m.type === "state") owner.state = m.state;
      }
    });

    const players = [owner, friend];
    for (let i = 0; i < 14; i++) {
      const c = await admit(`Player ${i}`);
      await c.connect();
      players.push(c);
    }
    const spectators = [spectator];
    for (let i = 0; i < 15; i++) {
      const c = await admit(`Watcher ${i}`, "spectator");
      await c.connect();
      spectators.push(c);
    }
    await eventually(
      () => owner.state.players.filter((p) => p.connected).length === 32,
      "32 connected participants",
    );
    assert.equal(owner.state.players.filter((p) => p.connected && p.role === "player").length, 16);
    assert.equal(
      owner.state.players.filter((p) => p.connected && p.role === "spectator").length,
      16,
    );
    const waiting = await admit("Capacity waiting");
    await waiting.connect(409);

    const originalId = friend.state.selfId;
    friend.close();
    await eventually(
      () => owner.state.players.find((p) => p.id === originalId)?.connected === false,
      "disconnect frees seat",
    );
    assert.equal((await spectator.result(spectator.send({ type: "take-seat" }))).type, "ack");
    friend.state = null;
    friend.messages = [];
    await friend.connect();
    assert.equal(friend.state.selfId, originalId);
    assert.equal(friend.state.players.find((p) => p.id === originalId).role, "spectator");
    assert.equal(friend.state.players.find((p) => p.id === originalId).name, "Friend");

    const teams = owner.send({
      type: "configure",
      config: { ...owner.state.config, mode: "teams", difficulty: "any" },
    });
    assert.equal((await owner.result(teams)).type, "ack");
    assert.equal((await owner.result(owner.send({ type: "end-block" }))).type, "ack");
    assert.equal(owner.state.question, null);
    assert.ok(owner.state.pausedReasons.includes("Waiting for eligible players"));
    assert.equal((await owner.result(owner.send({ type: "team", team: "A" }))).type, "ack");
    await eventually(
      () => owner.state.phase === "reading" && owner.state.question,
      "team selection makes the next block playable",
    );

    // Imported short/tossup packs cover every rating. The authored sequence
    // pack is medium, so easy sequences are deliberately an empty filter.
    assert.equal(
      (
        await owner.result(
          owner.send({
            type: "configure",
            config: { ...owner.state.config, formats: ["sequence"], difficulty: "easy" },
          }),
        )
      ).type,
      "ack",
    );
    assert.equal((await owner.result(owner.send({ type: "end-block" }))).type, "ack");
    assert.equal(owner.state.question, null);
    assert.ok(owner.state.pausedReasons.includes("Waiting for suitable questions"));
    assert.equal(
      (
        await owner.result(
          owner.send({
            type: "configure",
            config: { ...owner.state.config, difficulty: "medium" },
          }),
        )
      ).type,
      "ack",
    );
    await eventually(
      () => owner.state.phase === "reading" && owner.state.question,
      "configuration change retries exhausted selection",
    );
    const stale = {
      id: crypto.randomUUID(),
      sessionId: sid,
      questionId: friendBuzz.questionId,
      action: { type: "buzz" },
    };
    owner.socket.send(JSON.stringify(stale));
    assert.match((await owner.result(stale)).message, /question has changed/);
    assert.equal(
      owner.state.answererId,
      null,
      "A delayed buzz cannot claim the following question",
    );

    await t.test(
      "moderator removal revokes access and immediately frees the full player seat",
      async () => {
        const removed = players[2];
        const removedId = removed.state.selfId;
        const moderator = players[3];
        const moderatorId = moderator.state.selfId;
        assert.equal(
          (await friend.result(friend.send({ type: "kick", playerId: removedId }))).type,
          "error",
          "An ordinary guest cannot remove another participant",
        );
        assert.equal(
          (
            await owner.result(
              owner.send({ type: "promote", playerId: moderatorId, moderator: true }),
            )
          ).type,
          "ack",
        );
        await eventually(
          () => moderator.state.players.find((p) => p.id === moderatorId)?.moderator,
          "moderator grant arrives",
        );
        const protectedOwner = await moderator.result(
          moderator.send({ type: "kick", playerId: owner.state.selfId }),
        );
        assert.equal(protectedOwner.type, "error");
        assert.match(protectedOwner.message, /owner cannot be removed/i);
        assert.equal(owner.state.players.find((p) => p.owner)?.connected, true);

        const oldIdentity = make();
        oldIdentity.cookies = new Map(removed.cookies);
        assert.equal(
          (await moderator.result(moderator.send({ type: "kick", playerId: removedId }))).type,
          "ack",
        );
        await eventually(
          () => removed.messages.some((m) => m.type === "ended" && /removed you/.test(m.message)),
          "removed guest receives the session-ended notification",
        );
        await eventually(
          () => removed.socket.readyState === WebSocket.CLOSED,
          "removed guest socket closes",
        );
        const closed = removed.closeEvents.find((event) => event.socket === removed.socket);
        assert.equal(closed?.code, 1000, "The server sends a normal protocol Close frame");
        assert.equal(closed?.reason, "Removed from session");
        assert.equal(closed?.wasClean, true, "Both peers exchange protocol Close frames");
        await eventually(
          () => owner.state.players.filter((p) => p.connected && p.role === "player").length === 15,
          "removal immediately frees a player seat",
        );
        assert.equal(owner.state.players.find((p) => p.id === removedId)?.connected, false);
        assert.equal((await oldIdentity.http("/status")).body.admission, "rejected");
        await oldIdentity.connect(403);

        await waiting.connect();
        assert.equal(
          waiting.state.players.find((p) => p.id === waiting.state.selfId)?.role,
          "player",
          "The already-approved capacity waiter occupies the newly available seat",
        );
        await eventually(
          () => owner.state.players.filter((p) => p.connected && p.role === "player").length === 16,
          "replacement restores the full player capacity",
        );
        assert.equal(
          (await removed.http("/request", { name: "Returning removed guest", role: "player" }))
            .status,
          200,
        );
        assert.equal((await removed.http("/status")).body.admission, "pending");
        await removed.connect(403);
      },
    );

    for (const client of [...players.filter((c) => c !== friend), spectator, waiting])
      client.close();
    await eventually(
      () => friend.messages.some((m) => m.type === "ended"),
      "spectators cannot preserve empty session",
    );
    const ended = await friend.http("/status");
    assert.equal(ended.body.active, false);
    assert.equal(ended.body.admission, "none");
    assert.equal(ended.body.config.source, "bundled");
    assert.equal((await owner.http("/open", { name: "Owner" })).status, 200);
    const reopened = await owner.http("/status");
    assert.notEqual(reopened.body.sessionId, sid);
    assert.equal((await friend.http("/status")).body.admission, "none");
    owner.state = null;
    owner.messages = [];
    await owner.connect();
    owner.send({ type: "close-session" });
    await eventually(() => owner.messages.some((m) => m.type === "ended"), "explicit owner close");
  },
);

test(
  "live answer drafts stay transient, authorized and scoped to the active answer window",
  { skip: !origin, timeout: 60_000 },
  async (t) => {
    assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(new URL(origin).hostname));
    const clients = [];
    const make = () => {
      const client = new Client();
      clients.push(client);
      return client;
    };
    t.after(() => clients.forEach((client) => client.close()));
    let owner = make();
    const first = await owner.http("/status");
    assert.equal(first.body.devAuth, true);
    assert.equal((await owner.http("/dev-owner", {})).status, 200);
    assert.equal((await owner.http("/open", { name: "Draft owner" })).status, 200);
    await owner.connect();
    if (first.body.active) {
      owner.send({ type: "close-session" });
      await eventually(() => owner.messages.some((m) => m.type === "ended"), "clear prior session");
      owner.close();
      owner.state = null;
      owner.messages = [];
      await owner.http("/open", { name: "Draft owner" });
      await owner.connect();
    }
    const ack = async (client, action) => {
      const result = await client.result(client.send(action));
      assert.equal(result.type, "ack", `${action.type}: ${result.message ?? ""}`);
    };
    await ack(owner, {
      type: "configure",
      config: {
        ...owner.state.config,
        mode: "ffa",
        source: "bundled",
        formats: ["snapper"],
        difficulty: "any",
        shortProgressive: false,
        autoAdvance: false,
        answerMs: 30_000,
        graceMs: 30_000,
      },
    });
    async function admit(name, role) {
      const client = make();
      assert.equal((await client.http("/request", { name, role })).status, 200);
      const pending = await eventually(
        () => owner.state.pendingAdmissions.find((request) => request.name === name),
        `${name} pending`,
      );
      await ack(owner, { type: "approve", requestId: pending.id });
      return client;
    }
    const friend = await admit("Draft answerer", "player");
    await friend.connect();
    const spectator = await admit("Draft spectator", "spectator");
    await spectator.connect();
    // Approve in advance so connecting this viewer later tests a full snapshot,
    // without requiring an intervening game command to publish the draft.
    const late = await admit("Late draft spectator", "spectator");
    let lateConnected = false;
    const observers = () => [owner, spectator, ...(lateConnected ? [late] : [])];
    const draftVisible = (text, description) =>
      eventually(
        () => observers().every((client) => client.state?.answerDraft === text),
        description,
      );
    let barriers = 0;
    async function barrier(client) {
      const text = `Draft test barrier ${++barriers}`;
      // A normal command on the same socket is processed after the preceding
      // draft frame. Its snapshot makes silent rejection assertions observable.
      await ack(client, { type: "chat", text });
      await eventually(
        () => observers().every((observer) => observer.state.chat.some((m) => m.text === text)),
        "draft validation barrier reaches observers",
      );
    }
    await ack(owner, { type: "start" });
    await eventually(() => friend.state?.canBuzz, "answerer can buzz");
    await ack(friend, { type: "buzz" });
    await eventually(
      () => observers().every((client) => client.state.answererId === friend.state.selfId),
      "answer window reaches observers",
    );
    const originalWindow = friend.state.answerWindowId;
    const originalQuestion = friend.state.question.id;
    assert.ok(originalWindow);
    const scores = Object.fromEntries(
      owner.state.players.map((player) => [player.id, player.score]),
    );
    const teamScores = { ...owner.state.teamScores };
    const assertUnsubmitted = () => {
      assert.equal(owner.state.attempts.length, 0, "Drafts do not create answer attempts");
      for (const [id, score] of Object.entries(scores))
        assert.equal(owner.state.players.find((player) => player.id === id)?.score, score);
      assert.deepEqual(owner.state.teamScores, teamScores);
      assert.equal(owner.state.question.answer, null, "Typing must not reveal the answer key");
    };
    const frame = friend.draft("Par");
    await draftVisible("Par", "player and spectator see the live draft");
    assert.ok(
      owner.messages.some((message) => message.type === "answer-draft" && message.text === "Par"),
    );
    assert.ok(
      spectator.messages.some(
        (message) => message.type === "answer-draft" && message.text === "Par",
      ),
    );
    assertUnsubmitted();
    friend.draft("");
    await draftVisible("", "deleting all text clears the live draft");
    friend.draft("Paris? Still thinking");
    await draftVisible("Paris? Still thinking", "edits replace the draft");

    await late.connect();
    lateConnected = true;
    assert.equal(
      late.state.answerDraft,
      "Paris? Still thinking",
      "New viewers receive the latest draft in their snapshot",
    );
    assert.equal(late.state.answerWindowId, originalWindow);
    assert.equal(late.state.question.answer, null);

    await ack(owner, { type: "pause" });
    assert.equal(
      owner.state.answerWindowId,
      originalWindow,
      "Pausing retains the same attempt identity",
    );
    assert.ok(owner.state.pausedReasons.length);
    await sleep(220);
    friend.draft("Must not replace the paused draft");
    await barrier(friend);
    await draftVisible("Paris? Still thinking", "pause freezes the existing draft");
    await ack(owner, { type: "resume" });
    assert.equal(
      owner.state.answerWindowId,
      originalWindow,
      "Resuming retains the same attempt identity",
    );
    await eventually(() => friend.state.canAnswer, "answerer resumes typing");

    const invalid = [
      [owner, "Another player cannot type for the answerer", {}],
      [spectator, "A spectator cannot type for the answerer", {}],
      [friend, "A stale session cannot update the draft", { sessionId: "ended-session" }],
      [friend, "A stale question cannot update the draft", { questionId: "previous-question" }],
      [friend, "A stale attempt cannot update the draft", { answerWindowId: "previous-window" }],
      [friend, "A claimed identity is not trusted", { answererId: owner.state.selfId }],
      [friend, "Oversized drafts are rejected", { text: "x".repeat(501) }],
    ];
    for (const [client, description, overrides] of invalid) {
      await sleep(220); // Each probe gets a draft token instead of testing only rate limiting.
      client.draft(description, overrides);
      await barrier(client);
      assert.equal(owner.state.answerDraft, "Paris? Still thinking", description);
      assert.equal(spectator.state.answerDraft, "Paris? Still thinking", description);
    }
    assertUnsubmitted();
    await sleep(220);
    friend.draft("A valid edit after rejected messages");
    await draftVisible(
      "A valid edit after rejected messages",
      "valid edits survive rejected traffic",
    );

    // The typing quota is independent of real game actions: excess draft
    // frames must not consume the answer submission's action allowance.
    for (let i = 0; i < 16; i++) friend.draft(`Burst typing ${i}`);
    const submitted = "deliberately incorrect integration answer 847";
    await ack(friend, { type: "answer", text: submitted });
    await eventually(
      () => owner.state.attempts.length === 1,
      "only the submitted answer becomes an attempt",
    );
    await draftVisible("", "submission clears the draft");
    assert.equal(owner.state.attempts[0].answer, submitted);
    assert.equal(owner.state.attempts[0].verdict, "reject");
    assert.equal(owner.state.answerWindowId, null);
    assert.ok(owner.state.chat.every((message) => !message.text.startsWith("Burst typing")));

    await eventually(() => owner.state.canBuzz, "another player can answer the same question");
    await ack(owner, { type: "buzz" });
    assert.equal(owner.state.question.id, originalQuestion);
    assert.notEqual(owner.state.answerWindowId, originalWindow);
    const nextWindow = owner.state.answerWindowId;
    owner.draft("Late text from the previous attempt", { answerWindowId: originalWindow });
    await barrier(owner);
    assert.equal(
      owner.state.answerDraft,
      "",
      "Even the current answerer cannot update an old window",
    );
    owner.draft("Clear this when my new tab connects");
    await draftVisible("Clear this when my new tab connects", "current answerer can type");

    const oldOwner = owner;
    const oldSocket = oldOwner.socket;
    oldSocket.on("message", (raw) => {
      if (String(raw) === "pong") return;
      if (JSON.parse(String(raw)).type === "replaced" && oldSocket.readyState === WebSocket.OPEN)
        oldSocket.send(
          JSON.stringify({
            ...frame,
            answerWindowId: nextWindow,
            text: "Superseded tab overwrite",
          }),
        );
    });
    const replacement = make();
    replacement.cookies = new Map(oldOwner.cookies);
    await replacement.connect();
    owner = replacement;
    await eventually(
      () => oldOwner.messages.some((message) => message.type === "replaced"),
      "answerer's old tab is replaced",
    );
    assert.equal(owner.state.selfId, oldOwner.state.selfId);
    assert.equal(owner.state.answerWindowId, nextWindow);
    assert.equal(owner.state.answerDraft, "", "A tab takeover does not recover unsent text");
    await barrier(owner);
    await draftVisible("", "takeover clears observers and rejects the superseded connection");
    oldOwner.close();
    owner.draft("The new tab can type");
    await draftVisible(
      "The new tab can type",
      "replacement connection owns the current answer window",
    );

    await ack(owner, { type: "configure", config: { ...owner.state.config, answerMs: 3000 } });
    await ack(owner, { type: "end-block" });
    await eventually(
      () => owner.state.question?.id !== originalQuestion && owner.state.canBuzz,
      "next block applies short answer timer",
    );
    await draftVisible("", "question end clears all draft text");
    assert.equal(owner.state.answerWindowId, null);
    assert.equal(owner.state.config.answerMs, 3000);
    await ack(owner, { type: "buzz" });
    owner.draft("An unfinished answer must not be submitted on timeout");
    await draftVisible(
      "An unfinished answer must not be submitted on timeout",
      "timeout draft is visible",
    );
    await eventually(
      () => owner.state.phase !== "answering" && owner.state.attempts.length === 1,
      "answer deadline expires",
      10_000,
    );
    await draftVisible("", "timeout clears live text");
    assert.equal(
      owner.state.attempts[0].answer,
      "",
      "Timeout must not submit the draft as an answer",
    );
    assert.equal(owner.state.attempts[0].verdict, "reject");
    assert.equal(owner.state.answerWindowId, null);

    await ack(owner, { type: "configure", config: { ...owner.state.config, answerMs: 30_000 } });
    const timeoutQuestion = owner.state.question.id;
    await ack(owner, { type: "end-block" });
    await eventually(
      () => friend.state.question?.id !== timeoutQuestion && friend.state.canBuzz,
      "fresh block for disconnect cleanup",
    );
    await ack(friend, { type: "buzz" });
    friend.draft("Clear immediately when I disconnect");
    await draftVisible("Clear immediately when I disconnect", "disconnect draft is visible");
    const disconnectedId = friend.state.selfId;
    friend.close();
    await eventually(
      () => owner.state.players.find((player) => player.id === disconnectedId)?.connected === false,
      "answerer disconnect is detected",
    );
    await draftVisible("", "disconnect clears the draft before the answer timer expires");
    assert.equal(owner.state.attempts.length, 0);

    friend.state = null;
    friend.messages = [];
    await friend.connect();
    await eventually(() => friend.state.canAnswer, "returning answerer keeps the active attempt");
    assert.equal(friend.state.answerDraft, "", "Reconnecting does not restore unsent text");
    friend.draft("Clear this if I am removed");
    await draftVisible("Clear this if I am removed", "reconnected answerer can type again");
    await ack(owner, { type: "kick", playerId: disconnectedId });
    await eventually(
      () => friend.messages.some((message) => message.type === "ended"),
      "removed answerer loses access",
    );
    await draftVisible("", "removal clears the live draft");

    owner.send({ type: "close-session" });
    await eventually(
      () => spectator.messages.some((message) => message.type === "ended"),
      "draft test session closes",
    );
  },
);

test(
  "legacy FFA Shootout settings persist as independent nonrepeating Snappers",
  { skip: !origin, timeout: 30_000 },
  async (t) => {
    assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(new URL(origin).hostname));
    const owner = new Client();
    const first = await owner.http("/status");
    assert.equal(first.body.devAuth, true, "Only run against the local environment");
    assert.equal((await owner.http("/dev-owner", {})).status, 200);
    t.after(() => owner.close());

    const open = async () => {
      owner.state = null;
      owner.messages = [];
      assert.equal((await owner.http("/open", { name: "Migration owner" })).status, 200);
      await owner.connect();
    };
    const close = async () => {
      const before = owner.messages.length;
      owner.send({ type: "close-session" });
      await eventually(
        () => owner.messages.slice(before).some((message) => message.type === "ended"),
        "migration session closes",
      );
      owner.close();
      assert.equal((await owner.http("/status")).body.active, false);
    };
    const ack = async (action) => {
      const result = await owner.result(owner.send(action));
      assert.equal(result.type, "ack", result.message);
    };
    if (first.body.active) {
      await open();
      await close();
    }

    const config = {
      ...first.body.config,
      mode: "ffa",
      formats: ["shootout"],
      categories: ["Science", "History", "Geography"],
      difficulty: "any",
      source: "bundled",
      shortProgressive: false,
      autoAdvance: false,
      graceMs: 30_000,
      answerMs: 8000,
    };
    assert.equal(
      (await owner.http("/config", { config: { ...config, mode: "teams" } })).status,
      200,
    );
    assert.deepEqual(
      (await owner.http("/status")).body.config.formats,
      ["shootout"],
      "Team Shootout remains a saved selectable format",
    );
    assert.equal((await owner.http("/config", { config })).status, 200);
    assert.deepEqual((await owner.http("/status")).body.config.formats, ["snapper"]);
    await open();
    const sessionId = owner.state.sessionId;
    assert.deepEqual(owner.state.config.formats, ["snapper"]);
    await ack({ type: "start" });

    const seenText = new Set();
    for (let round = 0; round < 4; round++) {
      await eventually(() => owner.state.phase === "reading", "independent Snapper starts");
      assert.equal(owner.state.block.format, "snapper");
      assert.equal(owner.state.block.count, 1);
      assert.equal(owner.state.block.index, 0);
      assert.equal(owner.state.question.answer, null, "No answer key is sent before reveal");
      const text = owner.state.question.text;
      assert.ok(text.length > 0);
      assert.ok(!seenText.has(text), "Each block selects a different underlying question");
      seenText.add(text);
      assert.equal(owner.state.canBuzz, true, "A previous winner remains eligible next block");
      await ack({ type: "buzz" });
      assert.equal(owner.state.answererId, owner.state.selfId);
      await ack({ type: "answer", text: "deliberately incorrect migration test answer 847" });
      assert.equal(owner.state.phase, "reveal");
      const attempt = owner.state.attempts[0];
      assert.equal(attempt.verdict, "reject");
      // Award this attempt through the normal moderator API, without consulting
      // a private answer key, to prove winners are not retired from the next block.
      await ack({ type: "correct", attemptId: attempt.id, verdict: "accept" });
      assert.equal(
        owner.state.players.find((player) => player.id === owner.state.selfId).score,
        (round + 1) * config.points.regular,
      );
      if (round < 3) await ack({ type: "next" });
    }
    await close();
    assert.deepEqual((await owner.http("/status")).body.config.formats, ["snapper"]);
    await open();
    assert.notEqual(owner.state.sessionId, sessionId);
    assert.equal(owner.state.config.mode, "ffa");
    assert.deepEqual(owner.state.config.formats, ["snapper"]);
    assert.equal(owner.state.players.find((player) => player.id === owner.state.selfId).score, 0);
    await ack({ type: "start" });
    assert.equal(owner.state.block.format, "snapper");
    assert.equal(owner.state.block.count, 1);
    await close();
  },
);
