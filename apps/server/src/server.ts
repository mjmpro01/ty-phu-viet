import { createServer } from "node:http";
import { randomBytes, randomInt, randomUUID, createHash } from "node:crypto";
import { Server, Socket } from "socket.io";
import { createAdapter } from "@socket.io/redis-adapter";
import jsonPatch from "fast-json-patch";
import {
  apply,
  createState,
  envelopeSchema,
  BOARD,
  CARDS,
  DEFAULT_RULES,
} from "@tpv/shared";
import type { State, PublicState, Input } from "@tpv/shared";
import { RedisStore, type Store } from "./store";
import { persistence } from "./persistence";
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
const configHash = hash(JSON.stringify({ BOARD, CARDS, DEFAULT_RULES }));
const shuffle = (xs: string[]) => {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};
const code = () =>
  Array.from(
    { length: 6 },
    () => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[randomInt(32)],
  ).join("");
export function projection(state: State, viewer: string): PublicState {
  const { decks: _d, discard: _r, ...s } = structuredClone(state);
  for (const p of Object.values(s.players)) if (p.id !== viewer) p.cards = [];
  s.trades = Object.fromEntries(
    Object.entries(s.trades).filter(([, t]) =>
      t.sides.some((x) => x.playerId === viewer),
    ),
  );
  return s;
}
export function sanitizeChat(text: string) {
  return text
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/\b(dmm|dm|fuck|shit)\b/gi, "***");
}
interface View {
  code: string;
  userId: string;
  role: "PLAYER" | "SPECTATOR";
  state?: PublicState;
  seq: number;
  streamId: string;
  patches: unknown[];
  chain: Promise<void>;
}
export function createGameServer(options: {
  store: Store;
  origin?: string;
  databaseUrl?: string;
  tickMs?: number;
}) {
  const store = options.store,
    origins = (options.origin || "http://localhost:3000").split(","),
    http = createServer((req, res) => {
      res.setHeader("Content-Type", "application/json");
      res.statusCode = req.url === "/health" ? 200 : 404;
      res.end(JSON.stringify({ ok: req.url === "/health" }));
    });
  const io = new Server(http, {
    cors: { origin: origins, credentials: true },
    transports: ["websocket"],
    maxHttpBufferSize: 16384,
    allowRequest: (req, cb) =>
      cb(null, !req.headers.origin || origins.includes(req.headers.origin)),
  });
  const db = persistence(options.databaseUrl),
    views = new Map<string, View>(),
    authLimits = new Map<string, { n: number; reset: number }>();
  let running = false,
    draining = false,
    stopped = false,
    lastPresenceSweep = 0;
  let pub: RedisStore["redis"] | undefined,
    sub: RedisStore["redis"] | undefined;
  if (store instanceof RedisStore) {
    pub = store.redis.duplicate();
    sub = store.redis.duplicate();
    io.adapter(createAdapter(pub, sub));
  }
  const emitError = (socket: Socket, commandId: string, code: string) =>
    socket.emit("COMMAND_REJECTED", {
      commandId,
      code,
      messageKey: `errors.${code}`,
    });
  async function publish(socket: Socket, force = false) {
    const view = views.get(socket.id);
    if (!view) return;
    const raw = await store.get(view.code);
    if (!raw) return;
    const next = projection(raw, view.role === "PLAYER" ? view.userId : "");
    if (!force && view.state && next.version <= view.state.version) return;
    if (!view.state || force) {
      view.seq++;
      view.state = next;
      view.patches = [];
      socket.emit("STATE_SNAPSHOT", {
        streamId: view.streamId,
        seq: view.seq,
        state: next,
        serverTime: Date.now(),
      });
    } else {
      const operations = jsonPatch.compare(view.state, next);
      const message = {
        streamId: view.streamId,
        baseSeq: view.seq,
        seq: ++view.seq,
        stateVersion: next.version,
        serverTime: Date.now(),
        operations,
      };
      view.state = next;
      view.patches.push(message);
      if (view.patches.length > 128) view.patches.shift();
      socket.emit("STATE_PATCH", message);
    }
  }
  function queuePublish(socket: Socket, force = false) {
    const v = views.get(socket.id);
    if (v)
      v.chain = v.chain
        .then(() => publish(socket, force))
        .catch(() => {
          socket.emit("SERVER_STATUS", { status: "RECOVERING" });
        });
  }
  store.onChange((c) => {
    for (const socket of io.sockets.sockets.values())
      if (views.get(socket.id)?.code === c) queuePublish(socket);
  });
  async function execute(
    c: string,
    actor: string,
    commandId: string,
    input: Input,
    turnId?: string,
  ) {
    return store.transact(c, `${actor}:${commandId}`, async (tx) => {
      if (
        input.type !== "TICK" &&
        ![
          "JOIN",
          "LEAVE",
          "CONNECTED",
          "DISCONNECTED",
          "START_GAME",
          "SET_READY",
          "UPDATE_ROOM_RULES",
        ].includes(input.type)
      ) {
        const outOfTurn = [
          "AUCTION_BID",
          "AUCTION_PASS",
          "TRADE_CONFIRM",
          "TRADE_CANCEL",
          "TRADE_REJECT",
        ];
        if (!outOfTurn.includes(input.type) && turnId !== tx.state.turn?.id)
          throw Error("STALE_TURN");
      }
      const now = Date.now(),
        next = apply(tx.state, actor, input, {
          now,
          dice: [randomInt(1, 7), randomInt(1, 7)],
          shuffle,
        });
      const receipt = { version: next.version };
      if (next !== tx.state)
        await tx.commit(next, receipt, {
          state: next,
          commandId,
          actorId: actor,
          input,
          at: now,
        });
      return receipt;
    });
  }
  io.use(async (socket, next) => {
    try {
      const ip = socket.handshake.address,
        now = Date.now();
      if (authLimits.size > 10000)
        for (const [key, v] of authLimits)
          if (v.reset < now) authLimits.delete(key);
      const limit = authLimits.get(ip);
      if (limit && limit.reset > now && limit.n++ > 60)
        throw Error("RATE_LIMITED");
      if (!limit || limit.reset < now)
        authLimits.set(ip, { n: 1, reset: now + 60000 });
      const token = socket.handshake.auth.token;
      if (
        token !== undefined &&
        (typeof token !== "string" || token.length !== 64)
      )
        throw Error("INVALID_SESSION");
      if (token) {
        const user = await store.session(hash(token));
        if (!user) throw Error("INVALID_SESSION");
        socket.data.user = user;
      } else {
        const credential = randomBytes(32).toString("hex"),
          id = randomUUID();
        await store.saveSession(hash(credential), id, "Người chơi");
        socket.data.user = { id, name: "Người chơi" };
        socket.data.newToken = credential;
      }
      next();
    } catch (e) {
      next(new Error((e as Error).message));
    }
  });
  async function join(
    socket: Socket,
    c: string,
    role: "PLAYER" | "SPECTATOR",
    name: string,
    commandId: string,
    resume = false,
  ) {
    if (views.has(socket.id)) throw Error("ALREADY_IN_ROOM");
    let s = await store.get(c);
    if (!s) throw Error("ROOM_NOT_FOUND");
    const id = socket.data.user.id;
    if (s.players[id]) {
      role = "PLAYER";
      const peers = await io.in(`seat:${s.roomId}:${id}`).fetchSockets();
      for (const peer of peers)
        if (peer.id !== socket.id) peer.emit("SESSION_REPLACED");
      for (const peer of peers)
        if (peer.id !== socket.id) peer.disconnect(true);
      await socket.join(`seat:${s.roomId}:${id}`);
      await execute(c, "@server", commandId, {
        type: "CONNECTED",
        playerId: id,
      });
    } else if (resume) throw Error("SEAT_NOT_FOUND");
    else if (role === "PLAYER") {
      await execute(c, "@server", commandId, {
        type: "JOIN",
        playerId: id,
        name,
      });
      s = (await store.get(c))!;
    }
    views.set(socket.id, {
      code: c,
      userId: id,
      role,
      seq: 0,
      streamId: randomUUID(),
      patches: [],
      chain: Promise.resolve(),
    });
    await socket.join(`room:${c}`);
    if (role === "PLAYER") await socket.join(`seat:${s.roomId}:${id}`);
    socket.emit("ROOM_JOINED", { code: c, roomId: s.roomId, userId: id, role });
    queuePublish(socket, true);
  }
  io.on("connection", (socket) => {
    socket.emit("SESSION", {
      userId: socket.data.user.id,
      ...(socket.data.newToken ? { token: socket.data.newToken } : {}),
    });
    let budget = 30,
      refilled = Date.now(),
      chatAt = 0;
    const createReceipts = new Map<string, string>();
    socket.on("COMMAND", async (raw) => {
      const parsed = envelopeSchema.safeParse(raw);
      const commandId = typeof raw?.commandId === "string" ? raw.commandId : "";
      if (!parsed.success) {
        emitError(socket, commandId, "INVALID_PAYLOAD");
        return;
      }
      const now = Date.now();
      budget = Math.min(30, budget + (now - refilled) * 0.008);
      refilled = now;
      if (budget < 1) {
        emitError(socket, commandId, "RATE_LIMITED");
        return;
      }
      budget--;
      const { payload, turnId } = parsed.data;
      const type = payload.type;
      try {
        if (type === "TIME_SYNC") {
          socket.emit("TIME_SYNC_RESULT", {
            clientSentAt: payload.clientSentAt,
            serverTime: Date.now(),
          });
          return;
        }
        if (type === "LIST_ROOMS") {
          socket.emit(
            "ROOM_LIST",
            (await store.list())
              .filter(
                (s) => s.visibility === "PUBLIC" && s.status !== "FINISHED",
              )
              .slice(0, 100)
              .map((s) => ({
                code: s.code,
                status: s.status,
                players: s.order.length,
                host: s.players[s.hostPlayerId]?.name,
              })),
          );
          return;
        }
        if (type === "CREATE_ROOM") {
          if (createReceipts.has(commandId)) {
            socket.emit("COMMAND_ACK", {
              commandId,
              code: createReceipts.get(commandId),
            });
            return;
          }
          if (views.has(socket.id)) throw Error("ALREADY_IN_ROOM");
          const id = socket.data.user.id;
          let s: State;
          do {
            s = createState(
              randomUUID(),
              code(),
              id,
              payload.name as string,
              payload.rules as object,
              payload.visibility as "PUBLIC" | "PRIVATE",
            );
            s.configHash = configHash;
          } while (!(await store.create(s)));
          createReceipts.set(commandId, s.code);
          await join(
            socket,
            s.code,
            "PLAYER",
            payload.name as string,
            commandId,
          );
          socket.emit("COMMAND_ACK", { commandId, code: s.code });
          return;
        }
        if (type === "JOIN_ROOM" || type === "RESUME_ROOM") {
          await join(
            socket,
            payload.code as string,
            type === "RESUME_ROOM"
              ? "PLAYER"
              : (payload.role as "PLAYER" | "SPECTATOR"),
            type === "RESUME_ROOM" ? "" : (payload.name as string),
            commandId,
            type === "RESUME_ROOM",
          );
          socket.emit("COMMAND_ACK", { commandId });
          return;
        }
        const view = views.get(socket.id);
        if (!view) throw Error("NOT_IN_ROOM");
        if (type === "SYNC_REQUEST") {
          const seq = payload.lastStreamSeq as number;
          const patches = view.patches as { baseSeq: number; seq: number }[];
          const replay = patches.filter((x) => x.seq > seq);
          if (replay.length && replay[0].baseSeq === seq)
            for (const p of replay) socket.emit("STATE_PATCH", p);
          else queuePublish(socket, true);
          return;
        }
        if (type === "CHAT_SEND" || type === "REACTION_SEND") {
          if (now - chatAt < 700) throw Error("RATE_LIMITED");
          chatAt = now;
          const data = {
            id: randomUUID(),
            userId: view.userId,
            at: now,
            ...(type === "CHAT_SEND"
              ? { text: sanitizeChat(payload.text as string) }
              : { emojiId: payload.emojiId }),
          };
          io.to(`room:${view.code}`).emit(
            type === "CHAT_SEND" ? "CHAT_MESSAGE" : "REACTION",
            data,
          );
          socket.emit("COMMAND_ACK", { commandId });
          return;
        }
        if (type === "LEAVE_ROOM") {
          views.delete(socket.id);
          await socket.leave(`room:${view.code}`);
          if (view.role === "PLAYER") {
            const s = await store.get(view.code);
            await socket.leave(`seat:${s!.roomId}:${view.userId}`);
            await execute(view.code, "@server", commandId, {
              type: "LEAVE",
              playerId: view.userId,
            });
          }
          socket.emit("ROOM_LEFT");
          return;
        }
        if (view.role !== "PLAYER") throw Error("SPECTATOR_FORBIDDEN");
        const receipt = await execute(
          view.code,
          view.userId,
          commandId,
          payload as Input,
          turnId,
        );
        socket.emit("COMMAND_ACK", {
          commandId,
          appliedVersion: receipt.version,
        });
      } catch (e) {
        emitError(socket, commandId, (e as Error).message);
      }
    });
    socket.on("disconnect", async () => {
      const view = views.get(socket.id);
      views.delete(socket.id);
      if (view?.role === "PLAYER") {
        try {
          const s = await store.get(view.code);
          const peers = await io
            .in(`seat:${s!.roomId}:${view.userId}`)
            .fetchSockets();
          if (!peers.length)
            await execute(view.code, "@server", randomUUID(), {
              type: "DISCONNECTED",
              playerId: view.userId,
            });
        } catch (e) {
          console.error("disconnect persistence", e);
        }
      }
    });
  });
  const timer = setInterval(async () => {
    if (running || stopped) return;
    running = true;
    try {
      const states = await store.list();
      const sweep = Date.now() - lastPresenceSweep > 5000;
      if (sweep) lastPresenceSweep = Date.now();
      for (const s of states) {
        if (sweep && s.status !== "FINISHED")
          for (const p of Object.values(s.players))
            if (p.connected) {
              const peers = await io
                .in(`seat:${s.roomId}:${p.id}`)
                .fetchSockets();
              if (!peers.length)
                await execute(s.code, "@server", randomUUID(), {
                  type: "DISCONNECTED",
                  playerId: p.id,
                });
            }
        if (
          s.status === "PLAYING" ||
          Object.values(s.players).some((p) => p.reconnectDeadlineAt !== null)
        )
          await execute(s.code, "@server", randomUUID(), { type: "TICK" });
      }
    } catch (e) {
      console.error("room scheduler", e);
      io.emit("SERVER_STATUS", { status: "RECOVERING" });
    } finally {
      running = false;
    }
  }, options.tickMs ?? 150);
  const outbox = setInterval(async () => {
    if (draining || stopped || !options.databaseUrl) return;
    draining = true;
    try {
      await store.drain(db.write);
    } catch (e) {
      console.error("outbox retry", e);
    } finally {
      draining = false;
    }
  }, 1000);
  return {
    io,
    http,
    store,
    execute,
    async listen(port = 0) {
      await new Promise<void>((r) => http.listen(port, "0.0.0.0", r));
      return (http.address() as { port: number }).port;
    },
    async close() {
      stopped = true;
      clearInterval(timer);
      clearInterval(outbox);
      await new Promise<void>((r) => io.close(() => r()));
      while (running || draining) await new Promise((r) => setTimeout(r, 10));
      await pub?.quit();
      await sub?.quit();
      await db.close();
      await store.close();
    },
  };
}
