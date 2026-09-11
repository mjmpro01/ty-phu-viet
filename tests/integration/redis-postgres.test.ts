import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { RedisStore } from "../../apps/server/src/store";
import { persistence } from "../../apps/server/src/persistence";
import { createState } from "../../packages/shared/src";
const redisUrl = process.env.TEST_REDIS_URL,
  databaseUrl = process.env.TEST_DATABASE_URL;
describe.skipIf(!redisUrl)("real Redis persistence", () => {
  it("serializes competing writers, deduplicates retries, restores after reopening", async () => {
    const a = new RedisStore(redisUrl!),
      b = new RedisStore(redisUrl!);
    const code = randomUUID().slice(0, 6),
      s = createState(randomUUID(), code, "a", "An");
    await a.create(s);
    const mutate = (store: RedisStore, key: string) =>
      store.transact(code, key, async (tx) => {
        tx.state.players.a.cash += 100;
        tx.state.version++;
        const r = { version: tx.state.version };
        await tx.commit(tx.state, r, {
          state: tx.state,
          commandId: key,
          actorId: "a",
          input: { type: "TEST" },
          at: Date.now(),
        });
        return r;
      });
    try {
      const out = await Promise.all([mutate(a, "one"), mutate(b, "two")]);
      expect(out.map((x) => x.version).sort()).toEqual([1, 2]);
      await mutate(a, "one");
      expect((await b.get(code))!.players.a.cash).toBe(15000200);
    } finally {
      await a.redis.del(
        `tpv:room:${code}`,
        `tpv:dedup:${code}:one`,
        `tpv:dedup:${code}:two`,
      );
      await a.redis.srem("tpv:rooms", code);
      await a.close();
      await b.close();
    }
  });
});
describe.skipIf(!databaseUrl)("real PostgreSQL outbox projection", () => {
  it("persists audit, users and checkpoint idempotently", async () => {
    const repo = persistence(databaseUrl),
      s = createState(randomUUID(), "TESTPG", randomUUID(), "An");
    s.version = 1;
    const j = {
      state: s,
      commandId: randomUUID(),
      actorId: s.hostPlayerId,
      input: { type: "TEST" },
      at: Date.now(),
    };
    try {
      await repo.write(j);
      await repo.write(j);
      expect(
        await repo.db!.matchEvent.count({ where: { matchId: s.roomId } }),
      ).toBe(1);
      expect(
        (await repo.db!.matchCheckpoint.findUnique({
          where: { matchId: s.roomId },
        }))!.version,
      ).toBe(1);
    } finally {
      const db = repo.db!;
      await db.matchCheckpoint.deleteMany({ where: { matchId: s.roomId } });
      await db.matchEvent.deleteMany({ where: { matchId: s.roomId } });
      await db.matchParticipant.deleteMany({ where: { matchId: s.roomId } });
      await db.match.deleteMany({ where: { id: s.roomId } });
      await db.user.deleteMany({ where: { id: s.hostPlayerId } });
      await repo.close();
    }
  });
});
