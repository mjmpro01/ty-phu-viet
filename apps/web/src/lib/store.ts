"use client";
import { create } from "zustand";
import { newCommandId } from "./command-id";
import { io, Socket } from "socket.io-client";
import jsonPatch from "fast-json-patch";
import type { PublicState } from "@tpv/shared";
type Chat = {
  id: string;
  userId: string;
  text?: string;
  emojiId?: string;
  at: number;
};
type RoomSummary = {
  code: string;
  status: string;
  players: number;
  host: string;
};
interface Store {
  state: PublicState | null;
  userId: string;
  role: string;
  connected: boolean;
  error: string;
  busy: boolean;
  seq: number;
  streamId: string;
  offset: number;
  rooms: RoomSummary[];
  chat: Chat[];
  connect: () => void;
  send: (payload: Record<string, unknown>) => void;
  clearError: () => void;
}
let socket: Socket | undefined;
const pending = new Map<
  string,
  { envelope: unknown; timer: ReturnType<typeof setTimeout>; attempts: number }
>();
function finish(id: string) {
  const p = pending.get(id);
  if (p) clearTimeout(p.timer);
  pending.delete(id);
  useGame.setState({ busy: pending.size > 0 });
}
export const useGame = create<Store>((set, get) => ({
  state: null,
  userId: "",
  role: "",
  connected: false,
  error: "",
  busy: false,
  seq: 0,
  streamId: "",
  offset: 0,
  rooms: [],
  chat: [],
  clearError: () => set({ error: "" }),
  connect() {
    if (socket) return;
    socket = io(process.env.NEXT_PUBLIC_SERVER_URL || "http://localhost:3001", {
      transports: ["websocket"],
      autoConnect: false,
      auth: { token: sessionStorage.getItem("tpv-session") || undefined },
    });
    socket.on("connect", () => {
      set({ connected: true, error: "" });
    });
    socket.on("SESSION", (x) => {
      if (x.token) {
        sessionStorage.setItem("tpv-session", x.token);
        socket!.auth = { token: x.token };
      }
      set({ userId: x.userId });
      const code = sessionStorage.getItem("tpv-room");
      if (code) {
        const role = sessionStorage.getItem("tpv-role");
        get().send(
          role === "SPECTATOR"
            ? { type: "JOIN_ROOM", code, name: "Khán giả", role: "SPECTATOR" }
            : { type: "RESUME_ROOM", code, lastStreamSeq: get().seq },
        );
      } else get().send({ type: "LIST_ROOMS" });
    });
    socket.on("disconnect", () => set({ connected: false }));
    socket.on("SESSION_REPLACED", () => {
      socket?.disconnect();
      set({ error: "Phiên chơi đã được mở ở nơi khác.", connected: false });
    });
    socket.on("connect_error", (e) => {
      set({ error: e.message, connected: false });
      if (e.message === "INVALID_SESSION") {
        sessionStorage.removeItem("tpv-session");
        sessionStorage.removeItem("tpv-room");
        socket!.auth = {};
        setTimeout(() => socket?.connect(), 500);
      }
    });
    socket.on("ROOM_JOINED", (x) => {
      sessionStorage.setItem("tpv-room", x.code);
      sessionStorage.setItem("tpv-role", x.role);
      set({ userId: x.userId, role: x.role, chat: [] });
    });
    socket.on("ROOM_LEFT", () => {
      sessionStorage.removeItem("tpv-room");
      sessionStorage.removeItem("tpv-role");
      set({ state: null, seq: 0, streamId: "", role: "", chat: [] });
      for (const id of pending.keys()) finish(id);
      get().send({ type: "LIST_ROOMS" });
    });
    socket.on("STATE_SNAPSHOT", (x) =>
      set({
        state: x.state,
        seq: x.seq,
        streamId: x.streamId,
        offset: x.serverTime - Date.now(),
      }),
    );
    socket.on("STATE_PATCH", (x) => {
      const current = get();
      if (x.streamId === current.streamId && x.seq <= current.seq) return;
      if (
        x.streamId !== current.streamId ||
        x.baseSeq !== current.seq ||
        !current.state
      ) {
        get().send({ type: "SYNC_REQUEST", lastStreamSeq: current.seq });
        return;
      }
      try {
        const state = jsonPatch.applyPatch(
          structuredClone(current.state),
          x.operations,
          true,
          true,
        ).newDocument;
        set({ state, seq: x.seq, offset: x.serverTime - Date.now() });
      } catch {
        get().send({ type: "SYNC_REQUEST", lastStreamSeq: current.seq });
      }
    });
    socket.on("COMMAND_ACK", (x) => finish(x.commandId));
    socket.on("COMMAND_REJECTED", (x) => {
      finish(x.commandId);
      set({ error: x.code });
      if (["ROOM_NOT_FOUND", "SEAT_NOT_FOUND"].includes(x.code)) {
        sessionStorage.removeItem("tpv-room");
        set({ state: null });
      }
    });
    socket.on("ROOM_LIST", (rooms) => {
      set({ rooms });
      for (const [id, p] of pending)
        if (
          (p.envelope as { payload: { type: string } }).payload.type ===
          "LIST_ROOMS"
        )
          finish(id);
    });
    for (const event of ["CHAT_MESSAGE", "REACTION"])
      socket.on(event, (x) =>
        set((s) => ({ chat: [...s.chat, x].slice(-100) })),
      );
    socket.on("SERVER_STATUS", () => set({ error: "RECOVERING" }));
    socket.on("TIME_SYNC_RESULT", (x) =>
      set({ offset: x.serverTime - (x.clientSentAt + Date.now()) / 2 }),
    );
    socket.connect();
  },
  send(payload) {
    if (!socket?.connected) {
      set({ error: "DISCONNECTED" });
      return;
    }
    const id = newCommandId(),
      envelope = {
        protocolVersion: 1,
        commandId: id,
        turnId: get().state?.turn?.id,
        payload,
      };
    socket.emit("COMMAND", envelope);
    if (
      ["SYNC_REQUEST", "TIME_SYNC", "LEAVE_ROOM"].includes(String(payload.type))
    )
      return;
    const retry = () => {
      const p = pending.get(id);
      if (!p) return;
      if (
        p.attempts++ >= 3 ||
        [
          "CREATE_ROOM",
          "JOIN_ROOM",
          "RESUME_ROOM",
          "CHAT_SEND",
          "REACTION_SEND",
          "LIST_ROOMS",
        ].includes(String(payload.type))
      ) {
        finish(id);
        set({ error: "REQUEST_TIMEOUT" });
        return;
      }
      socket?.emit("COMMAND", p.envelope);
      p.timer = setTimeout(retry, 3000);
    };
    pending.set(id, { envelope, attempts: 1, timer: setTimeout(retry, 3000) });
    set({ busy: true, error: "" });
  },
}));
export const money = (n: number) =>
  new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 0 }).format(n) + "đ";
