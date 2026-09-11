import { PrismaClient, Prisma } from "@prisma/client";
import type { Journal } from "./store";
export function persistence(databaseUrl?: string) {
  const db = databaseUrl
    ? new PrismaClient({ datasourceUrl: databaseUrl })
    : null;
  return {
    db,
    async write(j: Journal) {
      if (!db) return;
      const s = j.state;
      await db.$transaction(async (tx) => {
        for (const p of Object.values(s.players))
          await tx.user.upsert({
            where: { id: p.id },
            create: { id: p.id, name: p.name },
            update: { name: p.name },
          });
        await tx.match.upsert({
          where: { id: s.roomId },
          create: {
            id: s.roomId,
            code: s.code,
            rules: s.rules as unknown as Prisma.InputJsonValue,
            configHash: s.configHash,
            status: s.status,
          },
          update: {},
        });
        // Serialize duplicate outbox consumers and prevent an older checkpoint overwriting a newer one.
        await tx.$queryRaw`SELECT id FROM "Match" WHERE id=${s.roomId} FOR UPDATE`;
        const checkpoint = await tx.matchCheckpoint.findUnique({
          where: { matchId: s.roomId },
        });
        await tx.matchEvent.upsert({
          where: {
            matchId_sequence: { matchId: s.roomId, sequence: s.version },
          },
          create: {
            matchId: s.roomId,
            sequence: s.version,
            commandId: j.commandId,
            actorId: j.actorId,
            payload: {
              input: j.input,
              events: s.events.filter((e) => e.id.startsWith(`${s.version}:`)),
            } as unknown as Prisma.InputJsonValue,
          },
          update: {},
        });
        for (const e of s.events.filter(
          (e) => e.kind === "DICE" && e.id.startsWith(`${s.version}:`),
        )) {
          const dice = e.data.dice as number[];
          await tx.diceAudit.upsert({
            where: { id: `${s.roomId}:${e.id}` },
            create: {
              id: `${s.roomId}:${e.id}`,
              matchId: s.roomId,
              turnId: String(e.data.turnId),
              die1: dice[0],
              die2: dice[1],
              createdAt: new Date(e.at),
            },
            update: {},
          });
        }
        if (checkpoint && checkpoint.version >= s.version) return;
        await tx.match.update({
          where: { id: s.roomId },
          data: {
            status: s.status,
            rules: s.rules as unknown as Prisma.InputJsonValue,
            startedAt: s.startedAt ? new Date(s.startedAt) : null,
            endedAt: s.status === "FINISHED" ? new Date(j.at) : null,
            result: s.result
              ? (s.result as unknown as Prisma.InputJsonValue)
              : Prisma.DbNull,
          },
        });
        for (const [seat, id] of s.order.entries()) {
          const result = s.result?.find((x) => x.playerId === id);
          const data = {
            seat,
            rank: result?.rank,
            assets: result ? BigInt(result.assets) : undefined,
          };
          await tx.matchParticipant.upsert({
            where: { matchId_userId: { matchId: s.roomId, userId: id } },
            create: { matchId: s.roomId, userId: id, ...data },
            update: data,
          });
        }
        await tx.matchCheckpoint.upsert({
          where: { matchId: s.roomId },
          create: {
            matchId: s.roomId,
            version: s.version,
            state: s as unknown as Prisma.InputJsonValue,
          },
          update: {
            version: s.version,
            state: s as unknown as Prisma.InputJsonValue,
          },
        });
      });
    },
    async close() {
      await db?.$disconnect();
    },
  };
}
