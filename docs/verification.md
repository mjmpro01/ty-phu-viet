# Verification report — Tỷ Phú Việt

Final verification: 2026-09-11 (UTC).

| Check | Result |
| --- | --- |
| Vitest engine + real Socket.IO clients | 43 passed |
| Redis/PostgreSQL infrastructure tests | 2 skipped — services unavailable in delivery environment |
| Engine statement coverage | 99.88% |
| Engine line coverage | 99.88% |
| Engine branch coverage | 95.39% |
| Engine function coverage | 100% |
| TypeScript shared/server/test compilation | Passed |
| Next.js 15.5.25 production build | Passed |
| Prisma client generation | Passed |
| Prisma initial migration SQL generation | Passed |
| Docker Compose execution | Not executed — Docker unavailable |
| Browser visual / mobile device QA | Not executed |

Coverage thresholds are 80% for all four metrics over the complete engine directory. The JSON summary is included in this folder; regenerate HTML with `pnpm test:coverage`.

The Socket.IO tests use actual network clients with the explicit MemoryStore adapter. They verify server-side dice, duplicate-command receipts, wrong-player rejection, Zod rejection of forged dice, spectator permissions, reconnect identity, competing bids, chat filtering and resynchronization.

RedisStore, PostgreSQL/Prisma projection, migrations, Dockerfiles and Compose are implemented but the two infrastructure tests require separate real test services. Their results are not claimed as passed. See README for variables and test database setup.

The client UUID generator includes a getRandomValues fallback for HTTP LAN origins where randomUUID is unavailable. This generates only command IDs; game dice remain server-only crypto.randomInt.
