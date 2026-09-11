import Redis from "ioredis";
import { randomUUID } from "node:crypto";
import type { State } from "@tpv/shared";
export interface Receipt {
  version: number;
  data?: unknown;
}
export interface Journal {
  state: State;
  commandId: string;
  actorId: string;
  input: unknown;
  at: number;
}
export interface Transaction {
  state: State;
  receipt?: Receipt;
  commit: (s: State, receipt: Receipt, j: Journal) => Promise<void>;
}
export interface Store {
  create(s: State): Promise<boolean>;
  get(code: string): Promise<State | null>;
  list(): Promise<State[]>;
  transact(
    code: string,
    key: string,
    fn: (tx: Transaction) => Promise<Receipt>,
  ): Promise<Receipt>;
  onChange(fn: (code: string) => void): void;
  session(tokenHash: string): Promise<{ id: string; name: string } | null>;
  saveSession(tokenHash: string, id: string, name: string): Promise<void>;
  drain(fn: (j: Journal) => Promise<void>): Promise<void>;
  close(): Promise<void>;
}
export class MemoryStore implements Store {
  rooms = new Map<string, State>();
  receipts = new Map<string, Receipt>();
  sessions = new Map<string, { id: string; name: string }>();
  journal: Journal[] = [];
  listeners: ((c: string) => void)[] = [];
  queues = new Map<string, Promise<unknown>>();
  async create(s: State) {
    if (this.rooms.has(s.code)) return false;
    this.rooms.set(s.code, structuredClone(s));
    return true;
  }
  async get(c: string) {
    return structuredClone(this.rooms.get(c) || null);
  }
  async list() {
    return [...this.rooms.values()].map((s) => structuredClone(s));
  }
  onChange(fn: (c: string) => void) {
    this.listeners.push(fn);
  }
  async transact(
    code: string,
    key: string,
    fn: (tx: Transaction) => Promise<Receipt>,
  ): Promise<Receipt> {
    const previous = this.queues.get(code) || Promise.resolve();
    const task = previous
      .catch(() => {})
      .then(async () => {
        const s = await this.get(code);
        if (!s) throw Error("ROOM_NOT_FOUND");
        const receipt = this.receipts.get(`${code}:${key}`);
        if (receipt) return receipt;
        return fn({
          state: s,
          commit: async (next, r, j) => {
            this.rooms.set(code, structuredClone(next));
            this.receipts.set(`${code}:${key}`, r);
            this.journal.push(j);
            for (const f of this.listeners) f(code);
          },
        });
      });
    this.queues.set(code, task);
    try {
      return await task;
    } finally {
      if (this.queues.get(code) === task) this.queues.delete(code);
    }
  }
  async session(h: string) {
    return this.sessions.get(h) || null;
  }
  async saveSession(h: string, id: string, name: string) {
    this.sessions.set(h, { id, name });
  }
  async drain(fn: (j: Journal) => Promise<void>) {
    while (this.journal.length) {
      await fn(this.journal[0]);
      this.journal.shift();
    }
  }
  async close() {}
}
const LOCK_MS = 10000;
export class RedisStore implements Store {
  redis: Redis;
  subscriber: Redis;
  listeners: ((c: string) => void)[] = [];
  constructor(url: string) {
    this.redis = new Redis(url, { maxRetriesPerRequest: 2 });
    this.subscriber = this.redis.duplicate();
    this.subscriber.subscribe("tpv:changed").catch(console.error);
    this.subscriber.on("message", (_, code) => {
      for (const fn of this.listeners) fn(code);
    });
  }
  onChange(fn: (c: string) => void) {
    this.listeners.push(fn);
  }
  async create(s: State) {
    const ok = await this.redis.set(
      `tpv:room:${s.code}`,
      JSON.stringify(s),
      "NX",
    );
    if (ok) await this.redis.sadd("tpv:rooms", s.code);
    return !!ok;
  }
  async get(code: string) {
    const raw = await this.redis.get(`tpv:room:${code}`);
    return raw ? (JSON.parse(raw) as State) : null;
  }
  async list() {
    const codes = await this.redis.smembers("tpv:rooms");
    if (!codes.length) return [];
    const rows = await this.redis.mget(...codes.map((c) => `tpv:room:${c}`));
    return rows.filter(Boolean).map((x) => JSON.parse(x!) as State);
  }
  async transact(
    code: string,
    key: string,
    fn: (tx: Transaction) => Promise<Receipt>,
  ): Promise<Receipt> {
    const lock = `tpv:lock:${code}`,
      token = randomUUID(),
      stateKey = `tpv:room:${code}`,
      dedup = `tpv:dedup:${code}:${key}`;
    let acquired = false;
    for (let i = 0; i < 80; i++) {
      if (await this.redis.set(lock, token, "PX", LOCK_MS, "NX")) {
        acquired = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 15));
    }
    if (!acquired) throw Error("ROOM_BUSY");
    try {
      const raw = await this.redis.get(dedup);
      if (raw) return JSON.parse(raw);
      const state = await this.get(code);
      if (!state) throw Error("ROOM_NOT_FOUND");
      const baseVersion = state.version;
      return await fn({
        state,
        commit: async (next, receipt, journal) => {
          // The unique lease token fences expired writers. CAS also catches stale state.
          const result = await this.redis.eval(
            `
    if redis.call('GET',KEYS[1])~=ARGV[1] then return -1 end
    local old=cjson.decode(redis.call('GET',KEYS[2]))
    if old.version~=tonumber(ARGV[2]) then return -2 end
    redis.call('SET',KEYS[2],ARGV[3])
    redis.call('SET',KEYS[3],ARGV[4],'EX',86400)
    redis.call('RPUSH',KEYS[4],ARGV[5])
    redis.call('PUBLISH','tpv:changed',ARGV[6])
    return 1`,
            4,
            lock,
            stateKey,
            dedup,
            "tpv:outbox",
            token,
            baseVersion,
            JSON.stringify(next),
            JSON.stringify(receipt),
            JSON.stringify(journal),
            code,
          );
          if (result !== 1) throw Error("STALE_WRITER");
        },
      });
    } finally {
      await this.redis.eval(
        "if redis.call('GET',KEYS[1])==ARGV[1] then return redis.call('DEL',KEYS[1]) else return 0 end",
        1,
        lock,
        token,
      );
    }
  }
  async session(h: string) {
    const x = await this.redis.get(`tpv:session:${h}`);
    return x ? JSON.parse(x) : null;
  }
  async saveSession(h: string, id: string, name: string) {
    await this.redis.set(
      `tpv:session:${h}`,
      JSON.stringify({ id, name }),
      "EX",
      60 * 60 * 24 * 30,
    );
  }
  async drain(fn: (j: Journal) => Promise<void>) {
    const token = randomUUID();
    if (!(await this.redis.set("tpv:outbox-lock", token, "PX", 30000, "NX")))
      return;
    try {
      for (let i = 0; i < 100; i++) {
        const raw = await this.redis.lindex("tpv:outbox", 0);
        if (!raw) break;
        await fn(JSON.parse(raw));
        const popped = await this.redis.eval(
          "if redis.call('GET',KEYS[1])~=ARGV[1] then return 0 end if redis.call('LINDEX',KEYS[2],0)==ARGV[2] then redis.call('LPOP',KEYS[2]);return 1 end return 0",
          2,
          "tpv:outbox-lock",
          "tpv:outbox",
          token,
          raw,
        );
        if (popped !== 1) break;
      }
    } finally {
      await this.redis.eval(
        "if redis.call('GET',KEYS[1])==ARGV[1] then return redis.call('DEL',KEYS[1]) end",
        1,
        "tpv:outbox-lock",
        token,
      );
    }
  }
  async close() {
    await this.subscriber.quit();
    await this.redis.quit();
  }
}
