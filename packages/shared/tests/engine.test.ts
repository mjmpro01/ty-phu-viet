import { describe, it, expect } from "vitest";
import {
  createState,
  addPlayer,
  apply,
  BOARD,
  CARDS,
  DEFAULT_RULES,
  rent,
  buildings,
  mortgage,
  mortgageValue,
  redeemValue,
  liquidValue,
  liquidate,
  assets,
  bankrupt,
  bid,
  closeAuction,
  offer,
  confirm,
  validSide,
  group,
} from "../src";
import type { State, Input, TradeSide } from "../src";
const ctx = {
  now: 1000,
  dice: [1, 2] as [number, number],
  shuffle: (x: string[]) => x,
};
function game() {
  let s = createState("room", "ABC234", "a", "An");
  addPlayer(s, "b", "Bình");
  for (const id of s.order)
    s = apply(s, id, { type: "SET_READY", ready: true }, ctx);
  return apply(s, "a", { type: "START_GAME" }, ctx);
}
function action() {
  const s = game();
  s.turn!.phase = "ACTION";
  s.turn!.pending = "MANAGE";
  return s;
}
function run(
  s: State,
  type: string,
  extra: Record<string, unknown> = {},
  actor = "a",
  now = 1100,
) {
  return apply(s, actor, { type, ...extra }, { ...ctx, now });
}
function tick(s: State, now = 2000, dice: [number, number] = [1, 2]) {
  return apply(s, "@server", { type: "TICK" }, { ...ctx, now, dice });
}
function landGroup(s: State) {
  const ids = BOARD.filter((t) => t.group === "north").map((t) => t.id);
  for (const id of ids) s.properties[id].ownerId = "a";
  return ids;
}
function purchase(s: State, pos = 1) {
  s.players.a.position = pos;
  s.turn!.phase = "ACTION";
  s.turn!.pending = "PURCHASE";
  return s;
}
function debt(s: State, amount: number, creditorId: string | null = "b") {
  s.turn!.phase = "ACTION";
  s.turn!.pending = "DEBT";
  s.turn!.debt = {
    debtorId: "a",
    creditorId,
    amount,
    reason: "RENT",
    after: "MANAGE",
  };
  return s;
}
const sides = (cash = 100): [TradeSide, TradeSide] => [
  { playerId: "a", cash, tileIds: [], cardIds: [] },
  { playerId: "b", cash: 0, tileIds: [], cardIds: [] },
];
describe("board and lobby", () => {
  it("has 40 unique positions and eight equal groups", () => {
    expect(BOARD).toHaveLength(40);
    expect(new Set(BOARD.map((x) => x.position)).size).toBe(40);
    expect(BOARD.filter((x) => x.kind === "LAND")).toHaveLength(24);
    expect(CARDS.length).toBe(12);
  });
  it("validates start and resets readiness after rule changes", () => {
    let s = createState("r", "ABC234", "a", "An");
    expect(() => run(s, "START_GAME")).toThrow("NOT_READY");
    expect(() => run(s, "ROLL_DICE", {}, "x")).toThrow("NOT_PLAYER");
    s = run(s, "JOIN", { playerId: "b", name: "B" }, "@server");
    s = run(s, "UPDATE_ROOM_RULES", { rules: { startingMoney: 20000000 } });
    expect(s.players.b.cash).toBe(20000000);
    expect(() => run(s, "UPDATE_ROOM_RULES", { rules: {} }, "b")).toThrow(
      "FORBIDDEN",
    );
    s = run(s, "SET_READY", { ready: true });
    s = run(s, "SET_READY", { ready: true }, "b");
    s = run(s, "START_GAME");
    expect(s.status).toBe("PLAYING");
    expect(() => addPlayer(s, "c", "C")).toThrow();
  });
  it("caps players at six and rejects duplicate IDs", () => {
    const s = createState("r", "ABC234", "a", "A");
    expect(() => addPlayer(s, "a", "A")).toThrow();
    for (const id of ["b", "c", "d", "e", "f"]) addPlayer(s, id, id);
    expect(() => addPlayer(s, "g", "G")).toThrow();
  });
  it("stores timed deadline and deterministic decks", () => {
    let s = createState("r", "ABC234", "a", "A", {
      mode: "TIMED",
      durationMs: 300000,
    });
    addPlayer(s, "b", "B");
    s.players.a.ready = s.players.b.ready = true;
    s = apply(s, "a", { type: "START_GAME" }, { now: 1000 });
    expect(s.matchEndsAt).toBe(301000);
    expect(s.decks.CHANCE).toHaveLength(6);
  });
});
describe("rent", () => {
  it("handles unowned, own group, developed and mortgaged property", () => {
    const s = action(),
      ids = landGroup(s),
      id = ids[0],
      t = BOARD[Number(id)];
    expect(rent(s, "5", 7)).toBe(0);
    expect(rent(s, id, 7)).toBe(t.rents![0] * 2);
    s.properties[ids[1]].ownerId = "b";
    expect(rent(s, id, 7)).toBe(t.rents![0]);
    s.properties[id].level = 3;
    expect(rent(s, id, 7)).toBe(t.rents![3]);
    s.properties[id].mortgaged = true;
    expect(rent(s, id, 7)).toBe(0);
  });
  it("scales airport and utility rent", () => {
    const s = action();
    s.properties["5"].ownerId = "a";
    expect(rent(s, "5", 4)).toBe(250000);
    s.properties["15"].ownerId = "a";
    expect(rent(s, "5", 4)).toBe(500000);
    s.properties["12"].ownerId = "a";
    expect(rent(s, "12", 8)).toBe(320000);
    s.properties["28"].ownerId = "a";
    expect(rent(s, "12", 8)).toBe(800000);
  });
});
describe("building and mortgage", () => {
  it("builds and sells evenly through hotel and returns correct money", () => {
    const s = action(),
      ids = landGroup(s);
    s.players.a.cash = 100000000;
    for (let level = 0; level < 5; level++)
      for (const id of ids) buildings(s, id, 1, "a");
    expect(s.properties[ids[0]].level).toBe(5);
    expect(() => buildings(s, ids[0], 1, "a")).toThrow();
    buildings(s, ids[0], -1, "a");
    expect(s.properties[ids[0]].level).toBe(4);
    expect(() => buildings(s, ids[0], -1, "a")).toThrow("SELL_EVENLY");
  });
  it("rejects wrong owner, incomplete group, uneven builds, shortage and insufficient funds", () => {
    const s = action(),
      ids = landGroup(s);
    expect(() => buildings(s, "5", 1, "a")).toThrow();
    s.properties[ids[1]].mortgaged = true;
    expect(() => buildings(s, ids[0], 1, "a")).toThrow("GROUP_REQUIRED");
    s.properties[ids[1]].mortgaged = false;
    buildings(s, ids[0], 1, "a");
    expect(() => buildings(s, ids[0], 1, "a")).toThrow("BUILD_EVENLY");
    s.rules.houseSupply = 1;
    expect(() => buildings(s, ids[1], 1, "a")).toThrow("BANK_SUPPLY");
    s.players.a.cash = 0;
    expect(() => buildings(s, ids[1], 1, "a")).toThrow("INSUFFICIENT_CASH");
  });
  it("checks hotel and replacement-house supply", () => {
    const s = action(),
      ids = landGroup(s);
    s.players.a.cash = 100000000;
    ids.forEach((id) => (s.properties[id].level = 4));
    s.rules.hotelSupply = 0;
    expect(() => buildings(s, ids[0], 1, "a")).toThrow("BANK_SUPPLY");
    s.properties[ids[0]].level = 5;
    s.rules.houseSupply = 8;
    expect(() => buildings(s, ids[0], -1, "a")).toThrow("BANK_SUPPLY");
  });
  it("mortgages at 50% and redeems at 110% of loan", () => {
    const s = action();
    landGroup(s);
    const initial = s.players.a.cash;
    mortgage(s, "1", "a");
    expect(mortgageValue(s, "1")).toBe(300000);
    expect(redeemValue(s, "1")).toBe(330000);
    expect(s.players.a.cash).toBe(initial + 300000);
    expect(() => mortgage(s, "1", "a")).toThrow();
    mortgage(s, "1", "a", true);
    expect(s.players.a.cash).toBe(initial - 30000);
    expect(() => mortgage(s, "1", "a", true)).toThrow();
    expect(() => mortgage(s, "5", "a")).toThrow();
    s.properties["1"].level = 1;
    expect(() => mortgage(s, "1", "a")).toThrow();
  });
  it("requires money to redeem and handles ungrouped property", () => {
    const s = action();
    s.properties["5"].ownerId = "a";
    mortgage(s, "5", "a");
    s.players.a.cash = 0;
    expect(() => mortgage(s, "5", "a", true)).toThrow();
    expect(group(s, "5")).toEqual([]);
  });
  it("values assets and force-liquidates developed groups without supply deadlock", () => {
    const s = action(),
      ids = landGroup(s);
    s.players.a.cash = 0;
    ids.forEach((id) => (s.properties[id].level = 5));
    const total = liquidValue(s, "a");
    expect(total).toBeGreaterThan(0);
    liquidate(s, "a", 100);
    expect(s.players.a.cash).toBe(3750000);
    expect(ids.every((id) => s.properties[id].level === 0)).toBe(true);
    liquidate(s, "a", total);
    expect(s.players.a.cash).toBe(total);
    expect(assets(s, "a")).toBeGreaterThan(0);
    expect(liquidValue(s, "a")).toBe(total);
  });
});
describe("auctions", () => {
  it("decline starts auction and highest bidder pays once", () => {
    let s = run(purchase(game()), "DECLINE_BUY", { tileId: "1" });
    const id = s.turn!.auction!.id;
    s = run(s, "AUCTION_BID", { auctionId: id, amount: 100000 }, "b");
    expect(() =>
      run(s, "AUCTION_BID", { auctionId: id, amount: 100000 }),
    ).toThrow("BID_TOO_LOW");
    s = run(s, "AUCTION_BID", { auctionId: id, amount: 200000 });
    const initial = s.players.a.cash;
    s = tick(s, 20000);
    expect(s.properties["1"].ownerId).toBe("a");
    expect(s.players.a.cash).toBe(initial - 200000);
    expect(s.turn!.auction).toBeNull();
  });
  it("validates cash, eligibility, expiry and pass", () => {
    let s = run(purchase(game()), "DECLINE_BUY", { tileId: "1" });
    const id = s.turn!.auction!.id;
    expect(() => bid(s, "a", id, 20000000, 1200)).toThrow("INSUFFICIENT_CASH");
    expect(() => bid(s, "x", id, 100000, 1200)).toThrow("NOT_ELIGIBLE");
    expect(() => bid(s, "a", id, 100000, 20000)).toThrow("AUCTION_CLOSED");
    s = run(s, "AUCTION_PASS", { auctionId: id });
    expect(() => bid(s, "a", id, 100000, 1200)).toThrow();
    s = run(s, "AUCTION_PASS", { auctionId: id }, "b");
    s = tick(s);
    expect(s.properties["1"].ownerId).toBeNull();
  });
  it("disabling auctions immediately returns to manage", () => {
    const s = purchase(game());
    s.rules.auctionsEnabled = false;
    expect(run(s, "DECLINE_BUY", { tileId: "1" }).turn!.pending).toBe("MANAGE");
  });
  it("prevents high bidder passing and ignores duplicate pass", () => {
    let s = run(purchase(game()), "DECLINE_BUY", { tileId: "1" });
    const id = s.turn!.auction!.id;
    s = run(s, "AUCTION_BID", { auctionId: id, amount: 100000 });
    expect(() => run(s, "AUCTION_PASS", { auctionId: id })).toThrow();
    s = run(s, "AUCTION_PASS", { auctionId: id }, "b");
    s = run(s, "AUCTION_PASS", { auctionId: id }, "b");
    expect(s.turn!.auction!.passed).toEqual(["b"]);
    closeAuction(s);
    expect(s.turn!.pending).toBe("MANAGE");
  });
});
describe("trades", () => {
  it("needs two confirmations and atomically exchanges all asset types", () => {
    const s = action(),
      x = sides(1000);
    s.properties["1"].ownerId = "a";
    s.players.a.cards = ["CHANCE-4"];
    x[0].tileIds = ["1"];
    x[0].cardIds = ["CHANCE-4"];
    x[1].cash = 2000;
    offer(s, "a", "t", x, 1000);
    confirm(s, "a", "t", 1, 1100);
    confirm(s, "a", "t", 1, 1101);
    expect(s.trades.t.status).toBe("OPEN");
    confirm(s, "b", "t", 1, 1200);
    expect(s.trades.t.status).toBe("COMPLETED");
    expect(s.players.a.cash).toBe(15001000);
    expect(s.properties["1"].ownerId).toBe("b");
    expect(s.players.b.cards).toContain("CHANCE-4");
  });
  it("rejects stale, expired, outsider and changed ownership", () => {
    let s = action();
    offer(s, "a", "t", sides(), 1000);
    expect(() => confirm(s, "b", "t", 2, 1100)).toThrow();
    expect(() => confirm(s, "x", "t", 1, 1100)).toThrow();
    expect(() => confirm(s, "b", "t", 1, 62000)).toThrow();
    expect(() => offer(s, "a", "t2", sides(), 1100)).toThrow();
    s = tick(s, 62000);
    expect(s.trades.t.status).toBe("EXPIRED");
    s = action();
    const x = sides();
    x[0].tileIds = ["1"];
    s.properties["1"].ownerId = "a";
    offer(s, "a", "t", x, 1000);
    confirm(s, "a", "t", 1, 1100);
    s.properties["1"].ownerId = "b";
    expect(() => confirm(s, "b", "t", 1, 1200)).toThrow("NOT_OWNER");
  });
  it("validates sides and developed group restrictions", () => {
    const s = action(),
      x = sides()[0];
    expect(() => validSide(s, { ...x, playerId: "x" })).toThrow();
    expect(() => validSide(s, { ...x, cash: -1 })).toThrow();
    expect(() => validSide(s, { ...x, tileIds: ["1", "1"] })).toThrow();
    expect(() => validSide(s, { ...x, cardIds: ["missing"] })).toThrow();
    landGroup(s);
    s.properties["1"].level = 1;
    expect(() => validSide(s, { ...x, tileIds: ["2"] })).toThrow(
      "SELL_BUILDINGS_FIRST",
    );
    expect(() => offer(s, "b", "t", sides(), 1000)).toThrow();
  });
  it("routes offer, confirm, rejection and cancellation", () => {
    let s = run(action(), "TRADE_OFFER", { sides: sides() });
    let id = Object.keys(s.trades)[0];
    s = run(s, "TRADE_CONFIRM", { tradeId: id, revision: 1 });
    s = run(s, "TRADE_REJECT", { tradeId: id }, "b");
    expect(s.trades[id].status).toBe("CANCELLED");
    s = run(s, "TRADE_OFFER", { sides: sides() });
    id = Object.keys(s.trades).at(-1)!;
    s = run(s, "TRADE_CANCEL", { tradeId: id });
    expect(s.trades[id].status).toBe("CANCELLED");
  });
});
describe("bankruptcy and debt", () => {
  it("transfers property, mortgage and card to creditor", () => {
    const s = action();
    landGroup(s);
    s.properties["1"].level = 2;
    s.properties["2"].mortgaged = true;
    s.players.a.cash = 100;
    s.players.a.cards = ["CHANCE-4"];
    offer(s, "a", "t", sides(0), 1000);
    bankrupt(s, "a", "b");
    expect(s.players.a.status).toBe("BANKRUPT");
    expect(s.players.b.cash).toBe(15500100);
    expect(s.properties["2"]).toMatchObject({
      ownerId: "b",
      mortgaged: true,
      level: 0,
    });
    expect(s.players.b.cards).toEqual(["CHANCE-4"]);
    expect(s.trades.t.status).toBe("CANCELLED");
  });
  it("returns clean assets and cards to bank", () => {
    const s = action();
    s.properties["5"] = { ownerId: "a", level: 0, mortgaged: true };
    s.players.a.cards = ["FORTUNE-4"];
    bankrupt(s, "a", null);
    expect(s.properties["5"]).toEqual({
      ownerId: null,
      level: 0,
      mortgaged: false,
    });
    expect(s.discard.FORTUNE).toContain("FORTUNE-4");
    expect(() => bankrupt(s, "b", "b")).toThrow();
  });
  it("cannot evade debt by ending turn or voluntary bankruptcy when solvent", () => {
    const s = debt(action(), 1000000);
    expect(() => run(s, "END_TURN")).toThrow("DEBT_PENDING");
    expect(() => run(s, "BUILD", { tileId: "1" })).toThrow("DEBT_PENDING");
    expect(() => run(s, "REDEEM", { tileId: "1" })).toThrow("DEBT_PENDING");
    expect(() => run(s, "DECLARE_BANKRUPTCY")).toThrow("CAN_PAY_DEBT");
    const paid = run(s, "SETTLE_DEBT");
    expect(paid.players.b.cash).toBe(16000000);
    expect(paid.turn!.debt).toBeNull();
  });
  it("forced timeout liquidates and bankrupts before next turn", () => {
    let s = debt(action(), 90000000);
    landGroup(s);
    s = tick(s, 50000);
    expect(s.players.a.status).toBe("BANKRUPT");
    s = tick(s, 51000);
    expect(s.status).toBe("FINISHED");
    expect(s.result![0].playerId).toBe("b");
  });
  it("voluntary insolvency and insufficient cash reject path", () => {
    let s = debt(action(), 90000000, null);
    expect(() => run(s, "SETTLE_DEBT")).toThrow("INSUFFICIENT_CASH");
    s = run(s, "DECLARE_BANKRUPTCY");
    expect(s.players.a.status).toBe("BANKRUPT");
  });
});
describe("turn machine", () => {
  it("rejects out of turn, wrong phase and unknown commands without mutating state", () => {
    const s = game(),
      before = JSON.stringify(s);
    expect(() => run(s, "ROLL_DICE", {}, "b")).toThrow("NOT_YOUR_TURN");
    expect(() => run(s, "BUY", { tileId: "1" })).toThrow("INVALID_STATE");
    expect(() => apply(s, "a", { type: "ROLL_DICE" }, { now: 1100 })).toThrow(
      "RNG_REQUIRED",
    );
    expect(() => run(action(), "NOPE")).toThrow("UNKNOWN_COMMAND");
    expect(JSON.stringify(s)).toBe(before);
  });
  it("runs roll, move, resolve and purchase", () => {
    let s = run(game(), "ROLL_DICE");
    expect(s.turn!.phase).toBe("ROLLING");
    s = tick(s);
    expect(s.turn!.phase).toBe("MOVING");
    s = tick(s, 3000);
    expect(s.players.a.position).toBe(3);
    expect(s.turn!.phase).toBe("RESOLVING_TILE");
    s = tick(s, 3100);
    expect(s.players.a.cash).toBe(16000000);
    let p = run(purchase(game()), "BUY", { tileId: "1" });
    expect(p.properties["1"].ownerId).toBe("a");
    expect(p.players.a.cash).toBe(14400000);
    p = run(p, "END_TURN");
    p = tick(p);
    expect(p.turn!.playerId).toBe("b");
  });
  it("handles pass GO and owner rent", () => {
    let s = game();
    s.players.a.position = 39;
    s = run(s, "ROLL_DICE");
    s = tick(s);
    s = tick(s, 3000);
    expect(s.players.a.cash).toBe(17000000);
    s.properties["2"].ownerId = "b";
    s = tick(s, 3100);
    expect(s.players.a.cash).toBe(16930000);
    expect(s.players.b.cash).toBe(15070000);
  });
  it("resolves tax, parking, own tile, go to jail and debt", () => {
    for (const pos of [0, 8, 10, 20, 30, 38, 1]) {
      let s = game();
      s.players.a.position = pos;
      s.turn!.phase = "RESOLVING_TILE";
      s.turn!.dice = [1, 2];
      if (pos === 1) s.properties["1"].ownerId = "a";
      s = tick(s);
      expect(s.turn!.phase).toBe("ACTION");
      if (pos === 30) expect(s.players.a.jail).toBe(0);
    }
    let s = game();
    s.players.a.position = 8;
    s.players.a.cash = 0;
    s.turn!.phase = "RESOLVING_TILE";
    s = tick(s);
    expect(s.turn!.pending).toBe("DEBT");
  });
  it("handles all card effects and deck recycling", () => {
    for (const card of CARDS) {
      let s = game();
      s.players.a.position = card.deck === "CHANCE" ? 3 : 17;
      s.turn!.phase = "RESOLVING_TILE";
      s.turn!.dice = [1, 2];
      s.decks[card.deck] = [card.id];
      s = tick(s);
      if (card.kind === "GET_OUT") expect(s.players.a.cards).toContain(card.id);
      else expect(s.discard[card.deck]).toContain(card.id);
    }
    let s = game();
    s.players.a.position = 3;
    s.turn!.phase = "RESOLVING_TILE";
    s.decks.CHANCE = [];
    s.discard.CHANCE = ["CHANCE-0"];
    s = apply(s, "@server", { type: "TICK" }, { now: 2000 });
    expect(s.players.a.cash).toBe(16000000);
  });
  it("grants a double extra roll and third doubles jail", () => {
    let s = apply(
      game(),
      "a",
      { type: "ROLL_DICE" },
      { now: 1100, dice: [2, 2] },
    );
    s = tick(s);
    s = tick(s, 3000);
    s = tick(s, 3100);
    s = run(s, "DECLINE_BUY", { tileId: "4" }, "a", 3200);
    s = tick(s, 20000);
    s = run(s, "END_TURN", {}, "a", 21000);
    s = tick(s, 22000);
    expect(s.turn!.playerId).toBe("a");
    expect(s.turn!.doubles).toBe(1);
    s.turn!.doubles = 2;
    s = apply(s, "a", { type: "ROLL_DICE" }, { now: 23000, dice: [3, 3] });
    s = tick(s, 24000);
    expect(s.players.a.jail).toBe(0);
    expect(s.turn!.extraRoll).toBe(false);
  });
  it("supports all jail exits and failed attempts", () => {
    for (const pair of [true, false]) {
      let s = game();
      s.players.a.jail = 0;
      s.players.a.position = 10;
      s = apply(
        s,
        "a",
        { type: "ROLL_DICE" },
        { now: 1100, dice: pair ? [2, 2] : [1, 2] },
      );
      s = tick(s);
      expect(s.players.a.jail).toBe(pair ? null : 1);
      expect(s.turn!.extraRoll).toBe(false);
    }
    let s = game();
    s.players.a.jail = 2;
    s.players.a.position = 10;
    s = run(s, "ROLL_DICE");
    s = tick(s);
    expect(s.players.a.cash).toBe(14500000);
    expect(s.turn!.phase).toBe("MOVING");
    s = game();
    s.players.a.jail = 0;
    s = run(s, "PAY_JAIL_FINE");
    expect(s.players.a.jail).toBeNull();
    s.players.a.jail = 0;
    s.players.a.cards = ["CHANCE-4"];
    s = run(s, "USE_JAIL_CARD", { cardId: "CHANCE-4" });
    expect(s.discard.CHANCE).toContain("CHANCE-4");
  });
  it("continues movement after debt from third jail attempt", () => {
    let s = game();
    s.players.a.jail = 2;
    s.players.a.position = 10;
    s.players.a.cash = 0;
    s.properties["5"].ownerId = "a";
    s = run(s, "ROLL_DICE");
    s = tick(s);
    expect(s.turn!.pending).toBe("DEBT");
    s = run(s, "MORTGAGE", { tileId: "5" }, "a", 2100);
    s = run(s, "SETTLE_DEBT", {}, "a", 2200);
    expect(s.turn!.phase).toBe("MOVING");
    expect(s.turn!.path).toEqual([11, 12, 13]);
  });
  it("supports asset commands in management and no free purchases", () => {
    let s = action();
    landGroup(s);
    s = run(s, "BUILD", { tileId: "1" });
    s = run(s, "SELL_BUILDING", { tileId: "1" });
    s = run(s, "MORTGAGE", { tileId: "1" });
    s = run(s, "REDEEM", { tileId: "1" });
    expect(s.properties["1"].mortgaged).toBe(false);
    const poor = purchase(game());
    poor.players.a.cash = 0;
    expect(() => run(poor, "BUY", { tileId: "1" })).toThrow();
  });
  it("expires turns without bypassing purchase and auction", () => {
    let s = game();
    expect(() => run(s, "ROLL_DICE", {}, "a", 50000)).toThrow("TURN_EXPIRED");
    s = tick(s, 50000);
    expect(s.turn!.phase).toBe("ROLLING");
    s = purchase(game());
    s = tick(s, 50000);
    expect(s.turn!.pending).toBe("AUCTION");
    s = tick(s, 70000);
    s = tick(s, 71000);
    expect(s.turn!.phase).toBe("END_TURN");
  });
  it("reconnect grace and bot control, no-op tick, server-only intents", () => {
    let s = game();
    expect(tick(s, 1100)).toBe(s);
    expect(() => run(s, "TICK")).toThrow("FORBIDDEN");
    s = run(s, "DISCONNECTED", { playerId: "a" }, "@server");
    expect(s.players.a.reconnectDeadlineAt).toBe(91100);
    s = run(s, "CONNECTED", { playerId: "a" }, "@server", 1200);
    expect(s.players.a.reconnectDeadlineAt).toBeNull();
    s = run(s, "DISCONNECTED", { playerId: "a" }, "@server");
    s = tick(s, 92000);
    expect(s.players.a.controller).toBe("BOT");
    expect(() => run(s, "ROLL_DICE")).toThrow("BOT_CONTROL");
    s = run(s, "CONNECTED", { playerId: "a" }, "@server", 93000);
    expect(s.players.a.connected).toBe(true);
  });
  it("ends timed game after settlement and supports tied results", () => {
    let s = action();
    s.matchEndsAt = 1500;
    expect(() => run(s, "END_TURN", {}, "a", 1600)).toThrow("MATCH_EXPIRED");
    s = tick(s, 1600);
    s = tick(s, 1800);
    expect(s.status).toBe("FINISHED");
    expect(s.result!.map((x) => x.rank)).toEqual([1, 1]);
  });
});
it("explicit lobby leave removes seat and transfers host; in-game leave keeps seat", () => {
  let s = createState("r", "ABC234", "a", "A");
  addPlayer(s, "b", "B");
  s = run(s, "LEAVE", { playerId: "a" }, "@server");
  expect(s.hostPlayerId).toBe("b");
  expect(s.order).toEqual(["b"]);
  s = run(s, "LEAVE", { playerId: "b" }, "@server");
  expect(s.status).toBe("FINISHED");
  s = run(game(), "LEAVE", { playerId: "a" }, "@server");
  expect(s.players.a.connected).toBe(false);
  expect(s.order).toHaveLength(2);
});
