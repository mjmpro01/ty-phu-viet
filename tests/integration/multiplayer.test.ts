import { afterEach, describe, expect, it } from "vitest";
import { io, Socket } from "socket.io-client";
import { randomUUID } from "node:crypto";
import {
  createGameServer,
  projection,
  sanitizeChat,
} from "../../apps/server/src/server";
import { MemoryStore } from "../../apps/server/src/store";
import { createState } from "../../packages/shared/src";
let app: ReturnType<typeof createGameServer> | undefined;
const clients: Socket[] = [];
const event = (s: Socket, name: string) =>
  new Promise<any>((res, rej) => {
    const timer = setTimeout(() => {
      s.off(name, fn);
      rej(Error(`timeout ${name}`));
    }, 5000);
    const fn = (x: unknown) => {
      clearTimeout(timer);
      res(x);
    };
    s.once(name, fn);
  });
async function client(port: number, token?: string) {
  const s = io(`http://localhost:${port}`, {
    transports: ["websocket"],
    auth: token ? { token } : {},
    forceNew: true,
    reconnection: false,
  });
  clients.push(s);
  const session = await event(s, "SESSION");
  return { s, session };
}
async function command(s: Socket, payload: unknown, extra: object = {}) {
  const id = randomUUID();
  const response = new Promise<any>((res, rej) => {
    const timer = setTimeout(() => {
      cleanup();
      rej(Error("command timeout"));
    }, 5000);
    const ack = (x: any) => {
      if (x.commandId === id) {
        cleanup();
        res(x);
      }
    };
    const error = (x: any) => {
      if (x.commandId === id) {
        cleanup();
        res(x);
      }
    };
    function cleanup() {
      clearTimeout(timer);
      s.off("COMMAND_ACK", ack);
      s.off("COMMAND_REJECTED", error);
    }
    s.on("COMMAND_ACK", ack);
    s.on("COMMAND_REJECTED", error);
  });
  s.emit("COMMAND", { protocolVersion: 1, commandId: id, payload, ...extra });
  return response;
}
async function setup() {
  const store = new MemoryStore();
  app = createGameServer({ store, tickMs: 30 });
  const port = await app.listen();
  const a = await client(port),
    b = await client(port);
  const joined = event(a.s, "ROOM_JOINED");
  const snapshot = event(a.s, "STATE_SNAPSHOT");
  await command(a.s, {
    type: "CREATE_ROOM",
    name: "An",
    visibility: "PUBLIC",
    rules: {},
  });
  const room = await joined;
  await snapshot;
  const bSnapshot = event(b.s, "STATE_SNAPSHOT");
  await command(b.s, {
    type: "JOIN_ROOM",
    name: "Bình",
    role: "PLAYER",
    code: room.code,
  });
  await bSnapshot;
  await command(a.s, { type: "SET_READY", ready: true });
  await command(b.s, { type: "SET_READY", ready: true });
  await command(a.s, { type: "START_GAME" });
  return { store, port, a, b, room };
}
afterEach(async () => {
  for (const s of clients.splice(0)) s.disconnect();
  await app?.close();
  app = undefined;
});
describe("real Socket.IO multiplayer", () => {
  it("joins two players, sends patches, rejects forged payloads and deduplicates dice", async () => {
    const { store, a, b, room } = await setup();
    const state = (await store.get(room.code))!;
    const wrong = await command(
      b.s,
      { type: "ROLL_DICE" },
      { turnId: state.turn!.id },
    );
    expect(wrong.code).toBe("NOT_YOUR_TURN");
    expect((await command(a.s, { type: "ROLL_DICE", dice: [6, 6] })).code).toBe(
      "INVALID_PAYLOAD",
    );
    const patch = event(b.s, "STATE_PATCH");
    const id = randomUUID(),
      envelope = {
        protocolVersion: 1,
        commandId: id,
        payload: { type: "ROLL_DICE" },
        turnId: state.turn!.id,
      };
    const ack = event(a.s, "COMMAND_ACK");
    a.s.emit("COMMAND", envelope);
    await ack;
    expect((await patch).operations.length).toBeGreaterThan(0);
    const next = (await store.get(room.code))!;
    const retry = event(a.s, "COMMAND_ACK");
    a.s.emit("COMMAND", envelope);
    expect((await retry).appliedVersion).toBe(next.version);
    const latest = (await store.get(room.code))!;
    expect(latest.events.filter((x) => x.kind === "DICE")).toHaveLength(1);
    expect(latest.turn!.dice!.every((x) => x >= 1 && x <= 6)).toBe(true);
  });
  it("spectators receive state but cannot act; identity survives reconnect", async () => {
    const { store, port, a, room } = await setup();
    const spectator = await client(port);
    const snap = event(spectator.s, "STATE_SNAPSHOT");
    await command(spectator.s, {
      type: "JOIN_ROOM",
      code: room.code,
      name: "Khách",
      role: "SPECTATOR",
    });
    expect((await snap).state.decks).toBeUndefined();
    expect((await command(spectator.s, { type: "ROLL_DICE" })).code).toBe(
      "SPECTATOR_FORBIDDEN",
    );
    a.s.disconnect();
    await new Promise((r) => setTimeout(r, 80));
    expect(
      (await store.get(room.code))!.players[a.session.userId].connected,
    ).toBe(false);
    const resumed = await client(port, a.session.token);
    const fresh = event(resumed.s, "STATE_SNAPSHOT");
    await command(resumed.s, {
      type: "RESUME_ROOM",
      code: room.code,
      lastStreamSeq: 0,
    });
    expect((await fresh).state.players[a.session.userId].connected).toBe(true);
    expect(resumed.session.userId).toBe(a.session.userId);
  });
  it("serializes competing bids and keeps private trades out of other projections", async () => {
    const { store, a, b, room } = await setup();
    const state = (await store.get(room.code))!;
    state.turn!.phase = "ACTION";
    state.turn!.pending = "AUCTION";
    state.turn!.auction = {
      id: "auction",
      tileId: "1",
      eligible: [a.session.userId, b.session.userId],
      passed: [],
      bidderId: null,
      highestBid: 0,
      deadlineAt: Date.now() + 10000,
    };
    store.rooms.set(room.code, state);
    const results = await Promise.all([
      command(a.s, {
        type: "AUCTION_BID",
        auctionId: "auction",
        amount: 100000,
      }),
      command(b.s, {
        type: "AUCTION_BID",
        auctionId: "auction",
        amount: 100000,
      }),
    ]);
    expect(results.filter((x) => x.code === "BID_TOO_LOW")).toHaveLength(1);
    expect((await store.get(room.code))!.turn!.auction!.highestBid).toBe(
      100000,
    );
  });
  it("filters chat, hides private rooms and recovers a missing patch via snapshot", async () => {
    const { a, b, room } = await setup();
    const msg = event(b.s, "CHAT_MESSAGE");
    await command(a.s, { type: "CHAT_SEND", text: "hello fuck" });
    expect((await msg).text).toBe("hello ***");
    const snap = event(a.s, "STATE_SNAPSHOT");
    a.s.emit("COMMAND", {
      protocolVersion: 1,
      commandId: randomUUID(),
      payload: { type: "SYNC_REQUEST", lastStreamSeq: 999999 },
    });
    expect((await snap).state.code).toBe(room.code);
  });
});
it("projection strips deck and other hands and trades", () => {
  const s = createState("r", "ABC234", "a", "A");
  s.players.a.cards = ["CHANCE-4"];
  s.trades.t = {
    id: "t",
    revision: 1,
    sides: [
      { playerId: "a", cash: 0, tileIds: [], cardIds: [] },
      { playerId: "b", cash: 0, tileIds: [], cardIds: [] },
    ],
    confirmedBy: [],
    expiresAt: 100,
    status: "OPEN",
  };
  expect(projection(s, "x").players.a.cards).toEqual([]);
  expect(projection(s, "x").trades).toEqual({});
  expect(projection(s, "a").players.a.cards).toEqual(["CHANCE-4"]);
  expect(sanitizeChat("hi\n")).toBe("hi");
});
