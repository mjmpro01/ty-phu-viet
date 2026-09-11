import { BOARD, CARDS, DEFAULT_RULES, tile } from "../config";
import type { State, Player, Input, Context, Rules, TradeSide } from "../types";
import {
  requireRule,
  rent,
  assets,
  liquidValue,
  liquidate,
  bankrupt,
  buildings,
  mortgage,
} from "./economy";
import { bid, closeAuction, offer, confirm } from "./exchanges";
export function createState(
  roomId: string,
  code: string,
  hostId: string,
  name: string,
  rules: Partial<Rules> = {},
  visibility: "PUBLIC" | "PRIVATE" = "PUBLIC",
): State {
  const s: State = {
    schemaVersion: 1,
    version: 0,
    roomId,
    code,
    visibility,
    hostPlayerId: hostId,
    status: "LOBBY",
    rules: { ...DEFAULT_RULES, ...rules },
    configHash: "",
    players: {},
    order: [],
    properties: {},
    turn: null,
    trades: {},
    decks: { CHANCE: [], FORTUNE: [] },
    discard: { CHANCE: [], FORTUNE: [] },
    events: [],
    matchEndsAt: null,
    result: null,
    startedAt: null,
  };
  for (const t of BOARD)
    if (t.price)
      s.properties[t.id] = { ownerId: null, level: 0, mortgaged: false };
  addPlayer(s, hostId, name);
  return s;
}
export function addPlayer(s: State, id: string, name: string) {
  requireRule(
    s.status === "LOBBY" && s.order.length < 6 && !s.players[id],
    "ROOM_UNAVAILABLE",
  );
  s.players[id] = {
    id,
    name,
    cash: s.rules.startingMoney,
    position: 0,
    ready: false,
    status: "ACTIVE",
    connected: true,
    controller: "HUMAN",
    reconnectDeadlineAt: null,
    jail: null,
    cards: [],
  };
  s.order.push(id);
}
function log(
  s: State,
  ctx: Context,
  kind: string,
  data: Record<string, unknown> = {},
  playerId?: string,
) {
  s.events.push({
    id: `${s.version + 1}:${s.events.length}:${ctx.now}`,
    at: ctx.now,
    kind,
    data,
    ...(playerId ? { playerId } : {}),
  });
  if (s.events.length > 120) s.events.shift();
}
function beginTurn(s: State, id: string, now: number, doubles = 0) {
  s.turn = {
    id: `${s.version + 1}-${now}-${id}`,
    playerId: id,
    phase: "WAITING",
    deadlineAt: now + s.rules.turnDurationMs,
    completesAt: now,
    dice: null,
    doubles,
    extraRoll: false,
    path: [],
    pending: "MANAGE",
    auction: null,
    debt: null,
  };
}
function finish(s: State) {
  const scores = s.order
    .map((id) => ({ playerId: id, assets: assets(s, id), rank: 0 }))
    .sort(
      (a, b) =>
        Number(s.players[b.playerId].status === "ACTIVE") -
          Number(s.players[a.playerId].status === "ACTIVE") ||
        b.assets - a.assets,
    );
  scores.forEach(
    (x, i) =>
      (x.rank =
        i &&
        x.assets === scores[i - 1].assets &&
        s.players[x.playerId].status ===
          s.players[scores[i - 1].playerId].status
          ? scores[i - 1].rank
          : i + 1),
  );
  s.result = scores;
  s.status = "FINISHED";
  for (const t of Object.values(s.trades))
    if (t.status === "OPEN") t.status = "CANCELLED";
}
function checkFinish(s: State, ctx: Context) {
  if (
    s.order.filter((id) => s.players[id].status === "ACTIVE").length <= 1 ||
    (s.matchEndsAt !== null && ctx.now >= s.matchEndsAt)
  ) {
    finish(s);
    return true;
  }
  return false;
}
function end(s: State, ctx: Context) {
  s.turn!.phase = "END_TURN";
  s.turn!.completesAt = ctx.now + 100;
  for (const t of Object.values(s.trades))
    if (t.status === "OPEN") t.status = "CANCELLED";
}
function jail(s: State, p: Player) {
  p.position = 10;
  p.jail = 0;
  s.turn!.extraRoll = false;
  s.turn!.phase = "ACTION";
  s.turn!.pending = "MANAGE";
  s.turn!.path = [];
}
function move(s: State, steps: number, ctx: Context) {
  const t = s.turn!,
    p = s.players[t.playerId];
  t.path = Array.from({ length: steps }, (_, i) => (p.position + i + 1) % 40);
  t.phase = "MOVING";
  t.completesAt = ctx.now + Math.max(1, steps * s.rules.stepMs);
}
function manage(s: State) {
  s.turn!.phase = "ACTION";
  s.turn!.pending = "MANAGE";
}
function charge(
  s: State,
  amount: number,
  creditorId: string | null,
  reason: string,
  ctx: Context,
  after: "MANAGE" | "MOVE" = "MANAGE",
  steps?: number,
) {
  const t = s.turn!,
    p = s.players[t.playerId];
  if (p.cash >= amount) {
    p.cash -= amount;
    if (creditorId) s.players[creditorId].cash += amount;
    log(s, ctx, "PAYMENT", { amount, creditorId, reason }, p.id);
    if (after === "MOVE") move(s, steps!, ctx);
    else manage(s);
  } else {
    t.phase = "ACTION";
    t.pending = "DEBT";
    t.debt = { debtorId: p.id, creditorId, amount, reason, after, steps };
  }
}
function resolveTile(s: State, ctx: Context) {
  const t = s.turn!,
    p = s.players[t.playerId],
    boardTile = BOARD[p.position],
    prop = s.properties[boardTile.id];
  if (prop) {
    if (!prop.ownerId) {
      t.phase = "ACTION";
      t.pending = "PURCHASE";
    } else if (prop.ownerId !== p.id)
      charge(
        s,
        rent(s, boardTile.id, t.dice![0] + t.dice![1]),
        prop.ownerId,
        "RENT",
        ctx,
      );
    else manage(s);
    return;
  }
  if (boardTile.kind === "TAX") {
    charge(s, boardTile.amount!, null, "TAX", ctx);
    return;
  }
  if (boardTile.kind === "GO_TO_JAIL") {
    jail(s, p);
    log(s, ctx, "JAIL", {}, p.id);
    return;
  }
  if (boardTile.kind === "CHANCE" || boardTile.kind === "FORTUNE") {
    const deck = boardTile.kind;
    if (!s.decks[deck].length) {
      s.decks[deck] = ctx.shuffle
        ? ctx.shuffle(s.discard[deck])
        : [...s.discard[deck]];
      s.discard[deck] = [];
    }
    const id = s.decks[deck].shift();
    requireRule(id, "EMPTY_DECK");
    const card = CARDS.find((x) => x.id === id)!;
    log(s, ctx, "CARD", { cardId: id, text: card.text }, p.id);
    if (card.kind === "GET_OUT") {
      p.cards.push(id);
      manage(s);
      return;
    }
    s.discard[deck].push(id);
    if (card.kind === "CASH") {
      if (card.value < 0) charge(s, -card.value, null, "CARD", ctx);
      else {
        p.cash += card.value;
        manage(s);
      }
    } else if (card.kind === "JAIL") jail(s, p);
    else move(s, (card.value - p.position + 40) % 40, ctx);
    return;
  }
  manage(s);
}
function afterRoll(s: State, ctx: Context) {
  const t = s.turn!,
    p = s.players[t.playerId],
    d = t.dice!,
    pair = d[0] === d[1],
    steps = d[0] + d[1];
  if (p.jail !== null) {
    t.extraRoll = false;
    if (pair) {
      p.jail = null;
      move(s, steps, ctx);
    } else if (p.jail < 2) {
      p.jail++;
      end(s, ctx);
    } else {
      p.jail = null;
      charge(s, s.rules.jailFine, null, "JAIL", ctx, "MOVE", steps);
    }
    return;
  }
  t.doubles = pair ? t.doubles + 1 : 0;
  t.extraRoll = pair;
  if (t.doubles === 3) {
    jail(s, p);
    return;
  }
  move(s, steps, ctx);
}
function roll(s: State, ctx: Context) {
  const d = ctx.dice;
  requireRule(
    d && d.every((x) => Number.isInteger(x) && x >= 1 && x <= 6),
    "RNG_REQUIRED",
  );
  s.turn!.dice = d;
  s.turn!.phase = "ROLLING";
  s.turn!.completesAt = ctx.now + s.rules.rollingMs;
  log(s, ctx, "DICE", { dice: d, turnId: s.turn!.id }, s.turn!.playerId);
}
function decline(s: State, ctx: Context) {
  const t = s.turn!;
  if (!s.rules.auctionsEnabled) {
    manage(s);
    return;
  }
  t.pending = "AUCTION";
  t.auction = {
    id: `a-${s.version + 1}`,
    tileId: String(s.players[t.playerId].position),
    eligible: s.order.filter(
      (id) =>
        s.players[id].status === "ACTIVE" &&
        s.players[id].controller === "HUMAN",
    ),
    passed: [],
    highestBid: 0,
    bidderId: null,
    deadlineAt: ctx.now + s.rules.auctionDurationMs,
  };
}
function settle(s: State, ctx: Context, forced = false) {
  const d = s.turn!.debt!;
  if (forced) liquidate(s, d.debtorId, d.amount);
  if (s.players[d.debtorId].cash < d.amount) {
    requireRule(forced, "INSUFFICIENT_CASH");
    bankrupt(s, d.debtorId, d.creditorId);
    s.turn!.debt = null;
    log(s, ctx, "BANKRUPTCY", { creditorId: d.creditorId }, d.debtorId);
    end(s, ctx);
    return;
  }
  s.turn!.debt = null;
  charge(s, d.amount, d.creditorId, d.reason, ctx, d.after, d.steps);
}
function timedAction(s: State, ctx: Context) {
  const t = s.turn!;
  if (t.phase === "WAITING") roll(s, ctx);
  else if (t.phase === "ACTION") {
    if (t.pending === "PURCHASE") decline(s, ctx);
    else if (t.pending === "DEBT") settle(s, ctx, true);
    else if (t.pending === "MANAGE") end(s, ctx);
  }
}
function tick(s: State, ctx: Context) {
  for (const p of Object.values(s.players))
    if (
      !p.connected &&
      p.reconnectDeadlineAt !== null &&
      ctx.now >= p.reconnectDeadlineAt
    ) {
      p.controller = "BOT";
      p.reconnectDeadlineAt = null;
      log(s, ctx, "BOT_TAKEOVER", {}, p.id);
    }
  for (const t of Object.values(s.trades))
    if (t.status === "OPEN" && ctx.now >= t.expiresAt) t.status = "EXPIRED";
  if (s.status !== "PLAYING") return;
  const t = s.turn!;
  if (t.phase === "ROLLING" && ctx.now >= t.completesAt) afterRoll(s, ctx);
  else if (t.phase === "MOVING" && ctx.now >= t.completesAt) {
    const p = s.players[t.playerId];
    for (const pos of t.path) if (pos === 0) p.cash += s.rules.passGoMoney;
    if (t.path.length) p.position = t.path[t.path.length - 1];
    t.phase = "RESOLVING_TILE";
    log(s, ctx, "MOVED", { position: p.position, path: t.path }, p.id);
  } else if (t.phase === "RESOLVING_TILE") resolveTile(s, ctx);
  else if (t.phase === "END_TURN" && ctx.now >= t.completesAt) {
    if (checkFinish(s, ctx)) return;
    const current = s.players[t.playerId];
    if (t.extraRoll && current.status === "ACTIVE" && current.jail === null)
      beginTurn(s, current.id, ctx.now, t.doubles);
    else {
      let i = s.order.indexOf(t.playerId);
      do {
        i = (i + 1) % s.order.length;
      } while (s.players[s.order[i]].status !== "ACTIVE");
      const p = s.players[s.order[i]];
      if (p.connected) p.controller = "HUMAN";
      beginTurn(s, p.id, ctx.now);
    }
  } else if (t.phase === "ACTION" && t.pending === "AUCTION") {
    const a = t.auction!;
    if (
      ctx.now >= a.deadlineAt ||
      a.eligible.every((id) => a.passed.includes(id) || id === a.bidderId)
    ) {
      log(s, ctx, "AUCTION_END", { ...a });
      closeAuction(s);
    }
  } else if (
    ctx.now >= t.deadlineAt ||
    s.players[t.playerId].controller === "BOT" ||
    (s.matchEndsAt !== null && ctx.now >= s.matchEndsAt)
  )
    timedAction(s, ctx);
}
export function apply(
  state: State,
  actor: string,
  input: Input,
  ctx: Context,
): State {
  const s = structuredClone(state);
  const p = s.players[actor];
  const type = input.type;
  if (type === "TICK") {
    requireRule(actor === "@server", "FORBIDDEN");
    tick(s, ctx);
  } else if (type === "LEAVE") {
    requireRule(actor === "@server", "FORBIDDEN");
    const id = String(input.playerId);
    requireRule(s.players[id], "INVALID_PLAYER");
    if (s.status === "LOBBY") {
      delete s.players[id];
      s.order = s.order.filter((x) => x !== id);
      if (s.hostPlayerId === id) s.hostPlayerId = s.order[0] || "";
      for (const p of Object.values(s.players)) p.ready = false;
      if (!s.order.length) {
        s.status = "FINISHED";
        s.result = [];
      }
    } else {
      s.players[id].connected = false;
      s.players[id].reconnectDeadlineAt = ctx.now + s.rules.reconnectGraceMs;
    }
  } else if (type === "CONNECTED" || type === "DISCONNECTED") {
    requireRule(actor === "@server", "FORBIDDEN");
    const x = s.players[String(input.playerId)];
    requireRule(x, "INVALID_PLAYER");
    x.connected = type === "CONNECTED";
    x.reconnectDeadlineAt = x.connected
      ? null
      : ctx.now + s.rules.reconnectGraceMs;
  } else if (type === "JOIN") {
    requireRule(actor === "@server", "FORBIDDEN");
    addPlayer(s, String(input.playerId), String(input.name));
  } else {
    requireRule(p, "NOT_PLAYER");
    requireRule(p.connected && p.controller === "HUMAN", "BOT_CONTROL");
    if (type === "SET_READY") {
      requireRule(s.status === "LOBBY", "INVALID_STATE");
      p.ready = Boolean(input.ready);
    } else if (type === "UPDATE_ROOM_RULES") {
      requireRule(
        s.status === "LOBBY" && actor === s.hostPlayerId,
        "FORBIDDEN",
      );
      s.rules = { ...s.rules, ...(input.rules as Partial<Rules>) };
      for (const x of Object.values(s.players)) {
        x.cash = s.rules.startingMoney;
        x.ready = false;
      }
    } else if (type === "START_GAME") {
      requireRule(
        s.status === "LOBBY" && actor === s.hostPlayerId,
        "FORBIDDEN",
      );
      requireRule(
        s.order.length >= 2 &&
          s.order.every((id) => s.players[id].ready && s.players[id].connected),
        "NOT_READY",
      );
      s.status = "PLAYING";
      s.startedAt = ctx.now;
      s.matchEndsAt =
        s.rules.mode === "TIMED" ? ctx.now + s.rules.durationMs : null;
      for (const deck of ["CHANCE", "FORTUNE"]) {
        const ids = CARDS.filter((x) => x.deck === deck).map((x) => x.id);
        s.decks[deck] = ctx.shuffle ? ctx.shuffle(ids) : ids;
      }
      beginTurn(s, s.order[0], ctx.now);
      log(s, ctx, "START");
    } else {
      requireRule(
        s.status === "PLAYING" && p.status === "ACTIVE",
        "INVALID_STATE",
      );
      const t = s.turn!;
      requireRule(
        !(s.matchEndsAt !== null && ctx.now >= s.matchEndsAt),
        "MATCH_EXPIRED",
      );
      if (type === "AUCTION_BID" || type === "AUCTION_PASS") {
        requireRule(
          t.phase === "ACTION" && t.pending === "AUCTION",
          "INVALID_STATE",
        );
        const a = t.auction!;
        if (type === "AUCTION_BID")
          bid(s, actor, String(input.auctionId), Number(input.amount), ctx.now);
        else {
          requireRule(
            a.id === input.auctionId &&
              ctx.now < a.deadlineAt &&
              a.eligible.includes(actor) &&
              a.bidderId !== actor,
            "INVALID_PASS",
          );
          if (!a.passed.includes(actor)) a.passed.push(actor);
        }
      } else if (type === "TRADE_CONFIRM")
        confirm(
          s,
          actor,
          String(input.tradeId),
          Number(input.revision),
          ctx.now,
        );
      else if (type === "TRADE_CANCEL" || type === "TRADE_REJECT") {
        const trade = s.trades[String(input.tradeId)];
        requireRule(
          trade &&
            trade.status === "OPEN" &&
            trade.sides.some((x) => x.playerId === actor),
          "INVALID_TRADE",
        );
        trade.status = "CANCELLED";
      } else {
        requireRule(t.playerId === actor, "NOT_YOUR_TURN");
        requireRule(ctx.now < t.deadlineAt, "TURN_EXPIRED");
        if (type === "ROLL_DICE") {
          requireRule(t.phase === "WAITING", "INVALID_STATE");
          roll(s, ctx);
        } else if (type === "PAY_JAIL_FINE" || type === "USE_JAIL_CARD") {
          requireRule(
            t.phase === "WAITING" && p.jail !== null,
            "INVALID_STATE",
          );
          if (type === "PAY_JAIL_FINE") {
            requireRule(p.cash >= s.rules.jailFine, "INSUFFICIENT_CASH");
            p.cash -= s.rules.jailFine;
          } else {
            const id = String(input.cardId);
            requireRule(p.cards.includes(id), "NOT_CARD_OWNER");
            p.cards = p.cards.filter((x) => x !== id);
            s.discard[id.startsWith("CHANCE") ? "CHANCE" : "FORTUNE"].push(id);
          }
          p.jail = null;
        } else {
          requireRule(t.phase === "ACTION", "INVALID_STATE");
          if (type === "BUY" || type === "DECLINE_BUY") {
            requireRule(
              t.pending === "PURCHASE" && String(p.position) === input.tileId,
              "INVALID_STATE",
            );
            if (type === "DECLINE_BUY") decline(s, ctx);
            else {
              const key = String(p.position),
                price = tile(key).price!;
              requireRule(
                p.cash >= price && !s.properties[key].ownerId,
                "INSUFFICIENT_CASH",
              );
              p.cash -= price;
              s.properties[key].ownerId = actor;
              manage(s);
              log(s, ctx, "BUY", { tileId: key, price }, actor);
            }
          } else if (type === "SETTLE_DEBT" || type === "DECLARE_BANKRUPTCY") {
            requireRule(t.pending === "DEBT", "INVALID_STATE");
            if (type === "DECLARE_BANKRUPTCY") {
              requireRule(
                liquidValue(s, actor) < t.debt!.amount,
                "CAN_PAY_DEBT",
              );
              settle(s, ctx, true);
            } else settle(s, ctx);
          } else {
            requireRule(
              t.pending === "MANAGE" || t.pending === "DEBT",
              "INVALID_STATE",
            );
            if (type === "BUILD" || type === "SELL_BUILDING") {
              requireRule(
                type !== "BUILD" || t.pending === "MANAGE",
                "DEBT_PENDING",
              );
              buildings(
                s,
                String(input.tileId),
                type === "BUILD" ? 1 : -1,
                actor,
              );
            } else if (type === "MORTGAGE" || type === "REDEEM") {
              requireRule(
                type !== "REDEEM" || t.pending === "MANAGE",
                "DEBT_PENDING",
              );
              mortgage(s, String(input.tileId), actor, type === "REDEEM");
            } else if (type === "TRADE_OFFER") {
              requireRule(t.pending === "MANAGE", "DEBT_PENDING");
              offer(
                s,
                actor,
                `trade-${s.version + 1}`,
                input.sides as [TradeSide, TradeSide],
                ctx.now,
              );
            } else if (type === "END_TURN") {
              requireRule(t.pending === "MANAGE", "DEBT_PENDING");
              end(s, ctx);
            } else throw Error("UNKNOWN_COMMAND");
          }
        }
      }
    }
  }
  // Do not publish a new version for idle clock ticks.
  if (JSON.stringify(s) === JSON.stringify(state)) return state;
  s.version = state.version + 1;
  return s;
}
