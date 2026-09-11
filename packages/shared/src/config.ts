import board from "./config/board.vi.json";
import cards from "./config/cards.vi.json";
import rules from "./config/rules.defaults.json";
import type { Tile, Card, Rules } from "./types";
export const BOARD: Tile[] = board;
export const CARDS: Card[] = cards;
export const DEFAULT_RULES: Rules = rules as Rules;
export const tile = (id: string): Tile => {
  const t = BOARD.find((t) => t.id === id);
  if (!t) throw Error("INVALID_TILE");
  return t;
};
