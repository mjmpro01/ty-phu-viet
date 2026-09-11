import { tile } from "../config";
import type { State, TradeSide } from "../types";
import { requireRule, availableCash, group } from "./economy";
export function bid(
  s: State,
  id: string,
  auctionId: string,
  amount: number,
  now: number,
) {
  const a = s.turn!.auction;
  requireRule(a && a.id === auctionId && now < a.deadlineAt, "AUCTION_CLOSED");
  requireRule(
    a.eligible.includes(id) && !a.passed.includes(id),
    "NOT_ELIGIBLE",
  );
  requireRule(
    Number.isSafeInteger(amount) && amount >= a.highestBid + s.rules.minBid,
    "BID_TOO_LOW",
  );
  requireRule(amount <= s.players[id].cash, "INSUFFICIENT_CASH");
  a.highestBid = amount;
  a.bidderId = id;
}
export function closeAuction(s: State) {
  const a = s.turn!.auction!;
  if (a.bidderId) {
    s.players[a.bidderId].cash -= a.highestBid;
    s.properties[a.tileId].ownerId = a.bidderId;
  }
  s.turn!.auction = null;
  s.turn!.pending = "MANAGE";
}
export function validSide(s: State, side: TradeSide) {
  requireRule(s.players[side.playerId]?.status === "ACTIVE", "INVALID_PLAYER");
  requireRule(
    Number.isSafeInteger(side.cash) &&
      side.cash >= 0 &&
      availableCash(s, side.playerId) >= side.cash,
    "INSUFFICIENT_CASH",
  );
  requireRule(
    new Set(side.tileIds).size === side.tileIds.length &&
      new Set(side.cardIds).size === side.cardIds.length,
    "DUPLICATE_ASSET",
  );
  for (const id of side.tileIds) {
    requireRule(s.properties[id]?.ownerId === side.playerId, "NOT_OWNER");
    requireRule(
      group(s, id).every(([, p]) => p.level === 0),
      "SELL_BUILDINGS_FIRST",
    );
    tile(id);
  }
  for (const id of side.cardIds)
    requireRule(s.players[side.playerId].cards.includes(id), "NOT_CARD_OWNER");
}
export function offer(
  s: State,
  id: string,
  tradeId: string,
  sides: [TradeSide, TradeSide],
  now: number,
) {
  requireRule(
    sides[0].playerId === id && sides[1].playerId !== id,
    "INVALID_TRADE",
  );
  requireRule(
    !Object.values(s.trades).some((x) => x.status === "OPEN"),
    "TRADE_ALREADY_OPEN",
  );
  sides.forEach((x) => validSide(s, x));
  s.trades[tradeId] = {
    id: tradeId,
    revision: 1,
    sides,
    confirmedBy: [],
    expiresAt: now + s.rules.tradeTimeoutMs,
    status: "OPEN",
  };
}
export function confirm(
  s: State,
  id: string,
  tradeId: string,
  revision: number,
  now: number,
) {
  const t = s.trades[tradeId];
  requireRule(t && t.status === "OPEN" && now < t.expiresAt, "TRADE_CLOSED");
  requireRule(
    t.revision === revision && t.sides.some((x) => x.playerId === id),
    "INVALID_TRADE",
  );
  requireRule(
    s.turn?.pending === "MANAGE" && s.turn.phase === "ACTION",
    "INVALID_STATE",
  );
  if (!t.confirmedBy.includes(id)) t.confirmedBy.push(id);
  if (t.confirmedBy.length < 2) return;
  t.sides.forEach((x) => validSide(s, x));
  for (let i = 0; i < 2; i++) {
    const from = t.sides[i],
      to = t.sides[1 - i];
    s.players[from.playerId].cash -= from.cash;
    s.players[to.playerId].cash += from.cash;
    for (const key of from.tileIds) s.properties[key].ownerId = to.playerId;
    for (const key of from.cardIds) {
      s.players[from.playerId].cards = s.players[from.playerId].cards.filter(
        (x) => x !== key,
      );
      s.players[to.playerId].cards.push(key);
    }
  }
  t.status = "COMPLETED";
}
