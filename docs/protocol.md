# Protocol v1

Socket.IO, WebSocket only. Handshake `auth.token` optional for new guest; server returns `SESSION { userId, token? }`. Keep bearer credentials private.

## Client envelope

```ts
{
  protocolVersion: 1,
  commandId: string, // UUID; retry the same ID
  turnId?: string,   // required for current-turn actions
  expectedVersion?: number, // reserved; turn/entity guards govern concurrency
  payload: { type: string, ... }
}
```

Canonical Zod schemas are `packages/shared/src/protocol.ts`.

| Client command | Payload |
| --- | --- |
| CREATE_ROOM | name, visibility PUBLIC/PRIVATE, rules |
| LIST_ROOMS | none (up to 100 active public rooms) |
| JOIN_ROOM | code, name, role PLAYER/SPECTATOR |
| RESUME_ROOM | code, lastStreamSeq? |
| LEAVE_ROOM | none |
| UPDATE_ROOM_RULES | rules (host, lobby only) |
| SET_READY | ready |
| START_GAME, ROLL_DICE, END_TURN | none |
| BUY, DECLINE_BUY, BUILD, SELL_BUILDING, MORTGAGE, REDEEM | tileId |
| AUCTION_BID | auctionId, amount |
| AUCTION_PASS | auctionId |
| PAY_JAIL_FINE | none |
| USE_JAIL_CARD | cardId |
| SETTLE_DEBT, DECLARE_BANKRUPTCY | none |
| TRADE_OFFER | sides: [{playerId,cash,tileIds,cardIds}, {playerId,cash,tileIds,cardIds}] |
| TRADE_CONFIRM | tradeId, revision |
| TRADE_CANCEL, TRADE_REJECT | tradeId |
| CHAT_SEND | text (1–300 chars) |
| REACTION_SEND | emojiId in allowlist |
| SYNC_REQUEST | lastStreamSeq |
| TIME_SYNC | clientSentAt |

`JOIN`, `LEAVE`, `CONNECTED`, `DISCONNECTED`, `TICK` are internal engine commands, rejected by public Zod schema.

## Server messages

- `SESSION`: authentication bootstrap (token only for new guest).
- `ROOM_LIST`: room summaries.
- `ROOM_JOINED`: code, roomId, userId, role.
- `ROOM_LEFT`: clear local room state.
- `STATE_SNAPSHOT`: streamId, seq, state, serverTime.
- `STATE_PATCH`: streamId, baseSeq, seq, stateVersion, serverTime, operations (JSON Patch).
- `COMMAND_ACK`: commandId, appliedVersion?, code?.
- `COMMAND_REJECTED`: commandId, code, messageKey.
- `CHAT_MESSAGE`: id, userId, text, at.
- `REACTION`: id, userId, emojiId, at.
- `TIME_SYNC_RESULT`: clientSentAt, serverTime.
- `SERVER_STATUS`: RECOVERING.
- `SESSION_REPLACED`: this seat was opened on another connection.

Game events are an append-only, bounded event list **inside the state projection**, delivered through patches rather than a second GAME_EVENTS channel. This keeps animation/log and authoritative state on the same version. Private trade data is likewise projected per viewer.

Snapshot is normal on initial join and reconnect. Replay buffer belongs to current socket; an old stream is replaced, not reused across gateways. `expectedVersion` is reserved; state/turn ID/auction ID/trade revision are validated instead of rejecting unrelated changes such as another player's connectivity.

Failures never partially mutate game state: apply works on a clone, transaction commits only when it succeeds. HTTP `/health` provides process health. No HTTP endpoint mutates game state.
