import { createGameServer } from "./server";
import { MemoryStore, RedisStore } from "./store";
const memory = process.env.MEMORY_STORE === "1";
if (!memory && (!process.env.REDIS_URL || !process.env.DATABASE_URL))
  throw Error(
    "REDIS_URL and DATABASE_URL required; MEMORY_STORE=1 is only for explicit ephemeral development.",
  );
const app = createGameServer({
  store: memory ? new MemoryStore() : new RedisStore(process.env.REDIS_URL!),
  databaseUrl: memory ? undefined : process.env.DATABASE_URL,
  origin: process.env.WEB_ORIGIN,
});
const port = await app.listen(Number(process.env.PORT || 3001));
console.log(
  `Tỷ Phú Việt server :${port}${memory ? " (EPHEMERAL MEMORY MODE)" : ""}`,
);
let shutting = false;
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, async () => {
    if (shutting) return;
    shutting = true;
    await app.close();
    process.exit(0);
  });
