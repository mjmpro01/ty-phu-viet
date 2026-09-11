import { BOARD, tile } from "../config";
import type { State, Property } from "../types";
export function requireRule(ok: unknown, code: string): asserts ok {
  if (!ok) throw Error(code);
}
export const owned = (s: State, id: string) =>
  Object.entries(s.properties).filter(([, p]) => p.ownerId === id);
export function group(s: State, id: string): [string, Property][] {
  const t = tile(id);
  return BOARD.filter((x) => x.group && x.group === t.group).map((x) => [
    x.id,
    s.properties[x.id],
  ]);
}
export function completeGroup(s: State, id: string, owner: string) {
  const g = group(s, id);
  return (
    g.length > 0 && g.every(([, p]) => p.ownerId === owner && !p.mortgaged)
  );
}
export function rent(s: State, id: string, diceTotal: number): number {
  const t = tile(id),
    p = s.properties[id];
  if (!p || !p.ownerId || p.mortgaged) return 0;
  if (t.kind === "LAND")
    return (
      t.rents![p.level] *
      (p.level === 0 && completeGroup(s, id, p.ownerId) ? 2 : 1)
    );
  const count = owned(s, p.ownerId).filter(
    ([key]) => tile(key).kind === t.kind,
  ).length;
  return t.kind === "AIRPORT"
    ? t.rents![count - 1]
    : t.rents![count - 1] * diceTotal;
}
export const mortgageValue = (s: State, id: string) =>
  Math.floor(tile(id).price! * s.rules.mortgageRatio);
export const redeemValue = (s: State, id: string) =>
  Math.round(mortgageValue(s, id) * s.rules.redeemRatio);
export function assets(s: State, id: string) {
  return (
    s.players[id].cash +
    owned(s, id).reduce(
      (sum, [key, p]) =>
        sum +
        tile(key).price! +
        p.level * (tile(key).buildCost || 0) -
        (p.mortgaged ? redeemValue(s, key) : 0),
      0,
    ) -
    (s.turn?.debt?.debtorId === id ? s.turn.debt.amount : 0)
  );
}
export function liquidValue(s: State, id: string) {
  return (
    s.players[id].cash +
    owned(s, id).reduce(
      (v, [key, p]) =>
        v +
        (p.mortgaged ? 0 : mortgageValue(s, key)) +
        p.level * (tile(key).buildCost || 0) * s.rules.sellBuildingRatio,
      0,
    )
  );
}
export function availableCash(s: State, id: string) {
  const a = s.turn?.auction;
  return s.players[id].cash - (a?.bidderId === id ? a.highestBid : 0);
}
export function buildings(s: State, id: string, delta: 1 | -1, owner: string) {
  const t = tile(id),
    p = s.properties[id];
  requireRule(p && p.ownerId === owner && t.kind === "LAND", "NOT_OWNER");
  const g = group(s, id);
  const levels = g.map(([, v]) => v.level);
  if (delta === 1) {
    requireRule(completeGroup(s, id, owner), "GROUP_REQUIRED");
    requireRule(p.level < 5 && p.level === Math.min(...levels), "BUILD_EVENLY");
    requireRule(availableCash(s, owner) >= t.buildCost!, "INSUFFICIENT_CASH");
    const usedH = Object.values(s.properties).reduce(
        (n, x) => n + (x.level === 5 ? 0 : x.level),
        0,
      ),
      usedK = Object.values(s.properties).filter((x) => x.level === 5).length;
    requireRule(
      p.level === 4 ? usedK < s.rules.hotelSupply : usedH < s.rules.houseSupply,
      "BANK_SUPPLY",
    );
    s.players[owner].cash -= t.buildCost!;
  } else {
    requireRule(p.level > 0 && p.level === Math.max(...levels), "SELL_EVENLY");
    if (p.level === 5) {
      const houses = Object.values(s.properties).reduce(
        (n, x) => n + (x.level === 5 ? 0 : x.level),
        0,
      );
      requireRule(s.rules.houseSupply - houses >= 4, "BANK_SUPPLY");
    }
    s.players[owner].cash += Math.floor(
      t.buildCost! * s.rules.sellBuildingRatio,
    );
  }
  p.level += delta;
}
export function mortgage(s: State, id: string, owner: string, redeem = false) {
  const p = s.properties[id];
  requireRule(p && p.ownerId === owner, "NOT_OWNER");
  if (redeem) {
    requireRule(p.mortgaged, "NOT_MORTGAGED");
    const cost = redeemValue(s, id);
    requireRule(availableCash(s, owner) >= cost, "INSUFFICIENT_CASH");
    s.players[owner].cash -= cost;
    p.mortgaged = false;
  } else {
    requireRule(
      !p.mortgaged && group(s, id).every(([, x]) => x.level === 0),
      "MORTGAGE_BLOCKED",
    );
    s.players[owner].cash += mortgageValue(s, id);
    p.mortgaged = true;
  }
}
/** Forced liquidation may sell a whole developed group, avoiding hotel/house supply deadlocks. */
export function liquidate(s: State, id: string, amount: number) {
  const props = owned(s, id).sort(([a], [b]) => Number(a) - Number(b));
  for (const [key, p] of props) {
    if (s.players[id].cash >= amount) break;
    if (p.level) {
      const g = group(s, key);
      for (const [k, x] of g) {
        s.players[id].cash +=
          x.level * tile(k).buildCost! * s.rules.sellBuildingRatio;
        x.level = 0;
      }
    }
  }
  for (const [key, p] of props) {
    if (s.players[id].cash >= amount) break;
    if (!p.mortgaged) mortgage(s, key, id);
  }
}
export function bankrupt(s: State, id: string, creditorId: string | null) {
  requireRule(creditorId !== id, "INVALID_CREDITOR");
  const player = s.players[id];
  for (const [key, p] of owned(s, id)) {
    player.cash +=
      p.level * (tile(key).buildCost || 0) * s.rules.sellBuildingRatio;
    p.level = 0;
    p.ownerId = creditorId;
    if (!creditorId) p.mortgaged = false;
  }
  if (creditorId) {
    s.players[creditorId].cash += player.cash;
    s.players[creditorId].cards.push(...player.cards);
  } else
    for (const card of player.cards) {
      const deck = card.startsWith("CHANCE") ? "CHANCE" : "FORTUNE";
      s.discard[deck].push(card);
    }
  player.cash = 0;
  player.cards = [];
  player.status = "BANKRUPT";
  for (const t of Object.values(s.trades))
    if (t.status === "OPEN" && t.sides.some((x) => x.playerId === id))
      t.status = "CANCELLED";
}
