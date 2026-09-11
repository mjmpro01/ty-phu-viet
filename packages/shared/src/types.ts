export type Money = number;
export type Phase =
  "WAITING" | "ROLLING" | "MOVING" | "RESOLVING_TILE" | "ACTION" | "END_TURN";
export interface Tile {
  id: string;
  position: number;
  kind: string;
  name: string;
  color: string;
  group?: string;
  price?: number;
  buildCost?: number;
  rents?: number[];
  amount?: number;
}
export interface Card {
  id: string;
  deck: string;
  kind: string;
  value: number;
  text: string;
}
export interface Rules {
  startingMoney: number;
  passGoMoney: number;
  jailFine: number;
  auctionsEnabled: boolean;
  turnDurationMs: number;
  auctionDurationMs: number;
  tradeTimeoutMs: number;
  reconnectGraceMs: number;
  mode: "LAST_STANDING" | "TIMED";
  durationMs: number;
  minBid: number;
  mortgageRatio: number;
  redeemRatio: number;
  sellBuildingRatio: number;
  houseSupply: number;
  hotelSupply: number;
  rollingMs: number;
  stepMs: number;
}
export interface Player {
  id: string;
  name: string;
  cash: number;
  position: number;
  ready: boolean;
  status: "ACTIVE" | "BANKRUPT";
  connected: boolean;
  controller: "HUMAN" | "BOT";
  reconnectDeadlineAt: number | null;
  jail: number | null;
  cards: string[];
}
export interface Property {
  ownerId: string | null;
  level: number;
  mortgaged: boolean;
}
export interface Auction {
  id: string;
  tileId: string;
  eligible: string[];
  passed: string[];
  highestBid: number;
  bidderId: string | null;
  deadlineAt: number;
}
export interface Debt {
  debtorId: string;
  creditorId: string | null;
  amount: number;
  reason: string;
  after: "MANAGE" | "MOVE";
  steps?: number;
}
export interface Turn {
  id: string;
  playerId: string;
  phase: Phase;
  deadlineAt: number;
  completesAt: number;
  dice: [number, number] | null;
  doubles: number;
  extraRoll: boolean;
  path: number[];
  pending: "MANAGE" | "PURCHASE" | "AUCTION" | "DEBT";
  auction: Auction | null;
  debt: Debt | null;
}
export interface TradeSide {
  playerId: string;
  cash: number;
  tileIds: string[];
  cardIds: string[];
}
export interface Trade {
  id: string;
  revision: number;
  sides: [TradeSide, TradeSide];
  confirmedBy: string[];
  expiresAt: number;
  status: "OPEN" | "COMPLETED" | "CANCELLED" | "EXPIRED";
}
export interface GameEvent {
  id: string;
  at: number;
  kind: string;
  playerId?: string;
  data: Record<string, unknown>;
}
export interface State {
  schemaVersion: 1;
  version: number;
  roomId: string;
  code: string;
  visibility: "PUBLIC" | "PRIVATE";
  hostPlayerId: string;
  status: "LOBBY" | "PLAYING" | "PAUSED" | "FINISHED";
  rules: Rules;
  configHash: string;
  players: Record<string, Player>;
  order: string[];
  properties: Record<string, Property>;
  turn: Turn | null;
  trades: Record<string, Trade>;
  decks: Record<string, string[]>;
  discard: Record<string, string[]>;
  events: GameEvent[];
  matchEndsAt: number | null;
  result: { playerId: string; assets: number; rank: number }[] | null;
  startedAt: number | null;
}
export interface Input {
  type: string;
  [key: string]: unknown;
}
export interface Context {
  now: number;
  dice?: [number, number];
  shuffle?: (ids: string[]) => string[];
}
export type PublicState = Omit<State, "decks" | "discard">;
