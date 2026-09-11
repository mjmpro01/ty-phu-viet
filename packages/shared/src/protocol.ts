import { z } from "zod";
const id = z.string().min(1).max(80),
  money = z.number().int().min(0).max(1_000_000_000);
export const rulesSchema = z
  .object({
    startingMoney: z.number().int().min(1_000_000).max(100_000_000),
    auctionsEnabled: z.boolean(),
    turnDurationMs: z.number().int().min(15_000).max(180_000),
    mode: z.enum(["LAST_STANDING", "TIMED"]),
    durationMs: z.number().int().min(300_000).max(14_400_000),
  })
  .partial()
  .strict();
const bare = <T extends string>(type: T) =>
  z.object({ type: z.literal(type) }).strict();
const tileCommand = <T extends string>(type: T) =>
  z.object({ type: z.literal(type), tileId: id }).strict();
const tradeSide = z
  .object({
    playerId: id,
    cash: money,
    tileIds: z.array(id).max(30),
    cardIds: z.array(id).max(12),
  })
  .strict();
export const commandSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("CREATE_ROOM"),
      name: z.string().trim().min(1).max(24),
      visibility: z.enum(["PUBLIC", "PRIVATE"]),
      rules: rulesSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("JOIN_ROOM"),
      code: z.string().regex(/^[A-HJ-NP-Z2-9]{6}$/),
      name: z.string().trim().min(1).max(24),
      role: z.enum(["PLAYER", "SPECTATOR"]),
    })
    .strict(),
  z
    .object({
      type: z.literal("RESUME_ROOM"),
      code: z.string().length(6),
      lastStreamSeq: z.number().int().min(0).optional(),
    })
    .strict(),
  bare("LIST_ROOMS"),
  bare("LEAVE_ROOM"),
  bare("START_GAME"),
  bare("ROLL_DICE"),
  bare("PAY_JAIL_FINE"),
  bare("SETTLE_DEBT"),
  bare("DECLARE_BANKRUPTCY"),
  bare("END_TURN"),
  z.object({ type: z.literal("SET_READY"), ready: z.boolean() }).strict(),
  z
    .object({ type: z.literal("UPDATE_ROOM_RULES"), rules: rulesSchema })
    .strict(),
  ...(
    [
      "BUY",
      "DECLINE_BUY",
      "BUILD",
      "SELL_BUILDING",
      "MORTGAGE",
      "REDEEM",
    ] as const
  ).map(tileCommand),
  z
    .object({ type: z.literal("AUCTION_BID"), auctionId: id, amount: money })
    .strict(),
  z.object({ type: z.literal("AUCTION_PASS"), auctionId: id }).strict(),
  z.object({ type: z.literal("USE_JAIL_CARD"), cardId: id }).strict(),
  z
    .object({
      type: z.literal("TRADE_OFFER"),
      sides: z.tuple([tradeSide, tradeSide]),
    })
    .strict(),
  z
    .object({
      type: z.literal("TRADE_CONFIRM"),
      tradeId: id,
      revision: z.number().int().positive(),
    })
    .strict(),
  z.object({ type: z.literal("TRADE_CANCEL"), tradeId: id }).strict(),
  z.object({ type: z.literal("TRADE_REJECT"), tradeId: id }).strict(),
  z
    .object({
      type: z.literal("CHAT_SEND"),
      text: z.string().trim().min(1).max(300),
    })
    .strict(),
  z
    .object({
      type: z.literal("REACTION_SEND"),
      emojiId: z.enum(["👏", "😂", "😮", "❤️", "🎉", "🤝"]),
    })
    .strict(),
  z
    .object({
      type: z.literal("SYNC_REQUEST"),
      lastStreamSeq: z.number().int().min(0),
    })
    .strict(),
  z
    .object({ type: z.literal("TIME_SYNC"), clientSentAt: z.number().finite() })
    .strict(),
]);
export const envelopeSchema = z
  .object({
    protocolVersion: z.literal(1),
    commandId: z.string().uuid(),
    turnId: id.optional(),
    expectedVersion: z.number().int().nonnegative().optional(),
    payload: commandSchema,
  })
  .strict();
export type Command = z.infer<typeof commandSchema>;
