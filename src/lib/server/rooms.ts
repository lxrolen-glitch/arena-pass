import { randomUUID } from "node:crypto";
import type { Server, Socket } from "socket.io";

import { PokerTable, type PlayerAction, type TableSettings } from "../poker/game";
import {
  cleanName,
  cleanText,
  type ChatMessage,
  type ClientToServerEvents,
  type JoinResult,
  type RoomSnapshot,
  type ServerToClientEvents,
  type YouInfo,
} from "../protocol";

export type TypedSocket = Socket<ClientToServerEvents, ServerToClientEvents>;
export type TypedServer = Server<ClientToServerEvents, ServerToClientEvents>;

interface SocketMeta {
  playerId: string | null;
  name: string;
  lastChatAt: number;
}

export class Room {
  readonly code: string;
  readonly table: PokerTable;
  hostId: string;
  started = false;
  chat: ChatMessage[] = [];
  sockets = new Map<string, SocketMeta>();
  createdAt = Date.now();
  emptySince: number | null = null;
  disconnectedAt = new Map<string, number>();
  waitingAnnounced = false;
  turnTimer: ReturnType<typeof setTimeout> | null = null;
  nextHandTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(code: string, hostId: string, settings?: Partial<TableSettings>) {
    this.code = code;
    this.hostId = hostId;
    this.table = new PokerTable(settings);
  }
}

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 6;
const NEXT_HAND_DELAY_MS = 7000;
const EMPTY_ROOM_TTL_MS = 5 * 60 * 1000;
const DISCONNECTED_TTL_MS = 3 * 60 * 1000;
const SWEEP_INTERVAL_MS = 15 * 1000;
const CHAT_HISTORY = 60;
const CHAT_MIN_INTERVAL_MS = 350;
const MAX_ROOMS = 500;

export function normaliseCode(raw: unknown): string {
  return (typeof raw === "string" ? raw : "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12);
}

export class RoomManager {
  private io: TypedServer | null = null;
  private rooms = new Map<string, Room>();
  private sweeper: ReturnType<typeof setInterval> | null = null;

  attach(io: TypedServer): void {
    this.io = io;
    io.on("connection", (socket) => this.onConnection(socket));
    if (!this.sweeper) {
      this.sweeper = setInterval(() => this.sweep(), SWEEP_INTERVAL_MS);
      this.sweeper.unref?.();
    }
  }

  get roomCount(): number {
    return this.rooms.size;
  }

  get playerCount(): number {
    let count = 0;
    for (const room of this.rooms.values()) count += room.sockets.size;
    return count;
  }

  private onConnection(socket: TypedSocket): void {
    socket.data.playerId = null;
    socket.data.name = cleanName(socket.handshake.query.name, "Player");

    socket.on("room:create", (payload, ack) => ack(this.createRoom(socket, payload?.name, payload?.settings)));
    socket.on("room:join", (payload, ack) =>
      ack(this.joinRoom(socket, payload?.code, payload?.name, payload?.seat)),
    );
    socket.on("room:subscribe", (payload, ack) =>
      ack(this.subscribe(socket, payload?.code, payload?.playerId)),
    );
    socket.on("room:leave", () => this.leave(socket));
    socket.on("game:start", (ack) => ack(this.startGame(socket)));
    socket.on("game:settings", (payload, ack) => ack(this.updateSettings(socket, payload?.settings)));
    socket.on("player:action", (payload, ack) => ack(this.act(socket, payload?.action, payload?.amount)));
    socket.on("player:rebuy", (ack) => ack(this.rebuy(socket)));
    socket.on("player:sitout", (payload, ack) => ack(this.sitOut(socket, payload?.sittingOut)));
    socket.on("player:standup", (ack) => ack(this.standUp(socket)));
    socket.on("chat:send", (payload, ack) => ack(this.chat(socket, payload?.text)));
    socket.on("disconnect", () => this.onDisconnect(socket));
  }

  // ------------------------------------------------------------- lifecycle

  private createRoom(socket: TypedSocket, rawName: unknown, rawSettings?: Partial<TableSettings>): JoinResult {
    if (this.rooms.size >= MAX_ROOMS) return { ok: false, error: "Server is full, try again shortly" };
    const name = cleanName(rawName, socket.data.name);
    const code = this.generateCode();
    const room = new Room(code, "", rawSettings);
    this.rooms.set(code, room);

    const playerId = randomUUID();
    const seated = room.table.sitDown(playerId, name);
    if (!seated.ok) {
      this.rooms.delete(code);
      return { ok: false, error: seated.error };
    }
    room.hostId = playerId;
    room.table.setHost(playerId);
    room.table.pushLog("system", `${name} created the table`);

    socket.data.name = name;
    socket.data.playerId = playerId;
    this.enterRoom(socket, room);
    this.pushChat(room, `${name} created the table`, null, true);
    this.afterStateChange(room);
    return this.ackFor(socket, room);
  }

  private joinRoom(
    socket: TypedSocket,
    rawCode: unknown,
    rawName: unknown,
    seat?: number,
  ): JoinResult {
    const code = normaliseCode(rawCode);
    const room = this.rooms.get(code);
    if (!room) return { ok: false, error: `No table found with code ${code || "—"}` };

    const name = cleanName(rawName, socket.data.name);

    const playerId = randomUUID();
    const seated = room.table.sitDown(playerId, name, typeof seat === "number" ? seat : undefined);
    if (!seated.ok) return { ok: false, error: seated.error };

    socket.data.name = name;
    socket.data.playerId = playerId;
    this.enterRoom(socket, room);
    this.pushChat(room, `${name} joined the table`, null, true);
    this.afterStateChange(room);
    return this.ackFor(socket, room);
  }

  /** Reconnect: take over a seat that this browser created earlier. */
  private subscribe(socket: TypedSocket, rawCode: unknown, playerId?: string | null): JoinResult {
    const code = normaliseCode(rawCode);
    const room = this.rooms.get(code);
    if (!room) return { ok: false, error: `No table found with code ${code || "—"}` };

    if (playerId && room.table.getPlayer(playerId)) {
      return this.rebind(socket, room, playerId);
    }
    // Spectate.
    socket.data.playerId = null;
    this.enterRoom(socket, room);
    return this.ackFor(socket, room);
  }

  private rebind(socket: TypedSocket, room: Room, playerId: string): JoinResult {
    const player = room.table.getPlayer(playerId);
    if (!player) return { ok: false, error: "That seat no longer exists" };
    // Drop any other socket still bound to this seat.
    for (const [socketId, meta] of room.sockets) {
      if (meta.playerId === playerId && socketId !== socket.id) {
        this.io?.sockets.sockets.get(socketId)?.emit("room:you", null);
        meta.playerId = null;
      }
    }
    socket.data.playerId = playerId;
    socket.data.name = player.name;
    room.disconnectedAt.delete(playerId);
    room.table.setConnected(playerId, true);
    if (!room.table.handActive) player.sittingOut = false;
    this.enterRoom(socket, room);
    return this.ackFor(socket, room);
  }

  private enterRoom(socket: TypedSocket, room: Room): void {
    const previous = socket.data.code as string | undefined;
    if (previous && previous !== room.code) {
      this.leave(socket);
    }
    socket.data.code = room.code;
    room.sockets.set(socket.id, {
      playerId: socket.data.playerId ?? null,
      name: socket.data.name,
      lastChatAt: 0,
    });
    room.emptySince = null;
    void socket.join(room.code);
    this.broadcast(room);
  }

  private leave(socket: TypedSocket): void {
    const code = socket.data.code as string | undefined;
    const room = code ? this.rooms.get(code) : undefined;
    socket.data.code = undefined;
    if (!room) return;

    const meta = room.sockets.get(socket.id);
    room.sockets.delete(socket.id);
    void socket.leave(room.code);
    socket.emit("room:you", null);

    if (meta?.playerId) this.dropPlayer(room, meta.playerId, true);
    if (room.sockets.size === 0) room.emptySince = Date.now();
    this.broadcast(room);
    this.afterStateChange(room);
  }

  private onDisconnect(socket: TypedSocket): void {
    const code = socket.data.code as string | undefined;
    const room = code ? this.rooms.get(code) : undefined;
    if (!room) return;

    const meta = room.sockets.get(socket.id);
    room.sockets.delete(socket.id);
    if (meta?.playerId) {
      // Keep the seat so a refresh can reclaim it.
      room.table.setConnected(meta.playerId, false);
      room.disconnectedAt.set(meta.playerId, Date.now());
      if (room.table.toActId === meta.playerId) room.table.autoAct(meta.playerId);
    }
    if (room.sockets.size === 0) room.emptySince = Date.now();
    this.reassignHost(room);
    this.broadcast(room);
    this.afterStateChange(room);
  }

  private dropPlayer(room: Room, playerId: string, immediate: boolean): void {
    const player = room.table.getPlayer(playerId);
    if (!player) return;
    if (!immediate) {
      // Keep the seat for a while so a refresh can reclaim it.
      room.table.setConnected(playerId, false);
      room.disconnectedAt.set(playerId, Date.now());
    } else if (room.table.handActive && player.inHand && !player.folded) {
      // Mid-hand: fold now, the seat is released when the hand ends so the
      // chips already committed stay in the pot.
      room.table.standUp(playerId);
      room.disconnectedAt.delete(playerId);
    } else {
      room.table.standUp(playerId);
      room.table.removePlayer(playerId);
      room.disconnectedAt.delete(playerId);
    }
    if (room.hostId === playerId) this.reassignHost(room);
  }

  private reassignHost(room: Room): void {
    if (room.table.getPlayer(room.hostId)?.connected) return;
    const next = room.table.players.find((player) => player.connected);
    if (next) {
      room.hostId = next.id;
      room.table.setHost(next.id);
    }
  }

  // -------------------------------------------------------------- commands

  private startGame(socket: TypedSocket): JoinResult {
    const room = this.roomFor(socket);
    if (!room) return { ok: false, error: "Not in a table" };
    const playerId = socket.data.playerId as string | null;
    if (!playerId) return { ok: false, error: "Only seated players can start the game" };
    if (room.hostId !== playerId) return { ok: false, error: "Only the host can start the game" };

    // Pressing it again while idle pauses the table.
    if (room.started && !room.table.handActive) {
      room.started = false;
      room.waitingAnnounced = false;
      if (room.nextHandTimer) {
        clearTimeout(room.nextHandTimer);
        room.nextHandTimer = null;
      }
      this.pushChat(room, `${socket.data.name} paused the table`, null, true);
      this.broadcast(room);
      return this.ackFor(socket, room);
    }

    const result = room.table.startHand();
    if (!result.ok) return { ok: false, error: result.error };
    room.started = true;
    room.waitingAnnounced = false;
    this.broadcast(room);
    this.afterStateChange(room);
    return this.ackFor(socket, room);
  }

  private updateSettings(socket: TypedSocket, raw: Partial<TableSettings> = {}): JoinResult {
    const room = this.roomFor(socket);
    if (!room) return { ok: false, error: "Not in a table" };
    if (room.hostId !== socket.data.playerId) return { ok: false, error: "Only the host can change settings" };
    if (room.table.handActive) return { ok: false, error: "Wait for the current hand to finish" };

    const settings = room.table.settings;
    const clamp = (value: unknown, min: number, max: number, fallback: number) => {
      const parsed = typeof value === "number" ? Math.floor(value) : Number.parseInt(String(value ?? ""), 10);
      if (!Number.isFinite(parsed)) return fallback;
      return Math.min(max, Math.max(min, parsed));
    };

    settings.smallBlind = clamp(raw.smallBlind, 1, 5000, settings.smallBlind);
    settings.bigBlind = clamp(raw.bigBlind, settings.smallBlind * 2, settings.smallBlind * 10, settings.smallBlind * 2);
    settings.startingChips = clamp(raw.startingChips, settings.bigBlind * 10, settings.bigBlind * 500, settings.startingChips);
    settings.turnSeconds = clamp(raw.turnSeconds, 10, 120, settings.turnSeconds);

    for (const player of room.table.players) {
      if (player.chips === 0) player.chips = settings.startingChips;
    }
    room.table.pushLog("system", `Blinds set to ${settings.smallBlind}/${settings.bigBlind}`);
    this.broadcast(room);
    return this.ackFor(socket, room);
  }

  private act(socket: TypedSocket, action?: PlayerAction, amount?: number): JoinResult {
    const room = this.roomFor(socket);
    if (!room) return { ok: false, error: "Not in a table" };
    const playerId = socket.data.playerId as string | null;
    if (!playerId) return { ok: false, error: "You are not seated" };

    const allowed: PlayerAction[] = ["fold", "check", "call", "raise", "all-in"];
    if (!action || !allowed.includes(action)) return { ok: false, error: "Unknown action" };

    const result = room.table.act(playerId, action, amount);
    if (!result.ok) return { ok: false, error: result.error };

    this.broadcast(room);
    this.afterStateChange(room);
    return this.ackFor(socket, room);
  }

  private rebuy(socket: TypedSocket): JoinResult {
    const room = this.roomFor(socket);
    const playerId = socket.data.playerId as string | null;
    if (!room || !playerId) return { ok: false, error: "You are not seated" };
    const result = room.table.rebuy(playerId);
    if (!result.ok) return { ok: false, error: result.error };
    this.broadcast(room);
    this.afterStateChange(room);
    return this.ackFor(socket, room);
  }

  private sitOut(socket: TypedSocket, sittingOut?: boolean): JoinResult {
    const room = this.roomFor(socket);
    const playerId = socket.data.playerId as string | null;
    if (!room || !playerId) return { ok: false, error: "You are not seated" };
    room.table.setSittingOut(playerId, Boolean(sittingOut));
    this.broadcast(room);
    return this.ackFor(socket, room);
  }

  private standUp(socket: TypedSocket): JoinResult {
    const room = this.roomFor(socket);
    const playerId = socket.data.playerId as string | null;
    if (!room || !playerId) return { ok: false, error: "You are not seated" };
    room.table.standUp(playerId);
    socket.data.playerId = null;
    const meta = room.sockets.get(socket.id);
    if (meta) meta.playerId = null;
    socket.emit("room:you", null);
    if (room.hostId === playerId) this.reassignHost(room);
    this.broadcast(room);
    this.afterStateChange(room);
    return this.ackFor(socket, room);
  }

  private chat(socket: TypedSocket, rawText?: string): JoinResult {
    const room = this.roomFor(socket);
    if (!room) return { ok: false, error: "Not in a table" };
    const text = cleanText(rawText);
    if (!text) return { ok: false, error: "Empty message" };

    const meta = room.sockets.get(socket.id);
    const now = Date.now();
    if (meta && now - meta.lastChatAt < CHAT_MIN_INTERVAL_MS) {
      return { ok: false, error: "Slow down a little" };
    }
    if (meta) meta.lastChatAt = now;

    const playerId = (socket.data.playerId as string | null) ?? null;
    const name = playerId ? room.table.getPlayer(playerId)?.name ?? "Guest" : "Spectator";
    this.pushChat(room, text, playerId, false, name);
    return this.ackFor(socket, room);
  }

  // ----------------------------------------------------------------- glue

  private roomFor(socket: TypedSocket): Room | null {
    const code = socket.data.code as string | undefined;
    return code ? this.rooms.get(code) ?? null : null;
  }

  private generateCode(): string {
    for (let attempt = 0; attempt < 50; attempt++) {
      let code = "";
      for (let i = 0; i < CODE_LENGTH; i++) {
        code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
      }
      if (!this.rooms.has(code)) return code;
    }
    return `${Date.now().toString(36).toUpperCase()}`.slice(-CODE_LENGTH);
  }

  private snapshot(room: Room): RoomSnapshot {
    return {
      code: room.code,
      hostId: room.hostId,
      table: room.table.publicState(),
      chat: [...room.chat].slice(-CHAT_HISTORY),
      spectators: [...room.sockets.values()].filter((meta) => !meta.playerId).length,
      started: room.started,
    };
  }

  private youFor(room: Room, playerId: string | null): YouInfo | null {
    if (!playerId) return null;
    const player = room.table.getPlayer(playerId);
    if (!player) return null;
    return {
      playerId: player.id,
      name: player.name,
      seat: player.seat,
      holeCards: [...player.holeCards],
      isHost: room.hostId === player.id,
    };
  }

  private broadcast(room: Room): void {
    if (!this.io) return;
    this.io.to(room.code).emit("room:state", this.snapshot(room));
    for (const [socketId, meta] of room.sockets) {
      const target = this.io.sockets.sockets.get(socketId);
      if (!target) continue;
      target.emit("room:you", this.youFor(room, meta.playerId));
    }
  }

  private ackFor(socket: TypedSocket, room: Room): JoinResult {
    const playerId = (socket.data.playerId as string | null) ?? null;
    return {
      ok: true,
      code: room.code,
      playerId,
      snapshot: this.snapshot(room),
      you: this.youFor(room, playerId),
    };
  }

  private pushChat(
    room: Room,
    text: string,
    playerId: string | null,
    system = false,
    name?: string,
  ): void {
    room.chat.push({
      id: randomUUID(),
      playerId,
      name: name ?? room.table.getPlayer(playerId ?? "")?.name ?? "Table",
      text,
      at: Date.now(),
      system,
    });
    if (room.chat.length > CHAT_HISTORY) room.chat.splice(0, room.chat.length - CHAT_HISTORY);
    this.io?.to(room.code).emit("chat:new", room.chat[room.chat.length - 1]);
  }

  /** Re-arm the action clock and queue the next hand when one is not running. */
  private afterStateChange(room: Room): void {
    if (room.turnTimer) {
      clearTimeout(room.turnTimer);
      room.turnTimer = null;
    }
    if (room.table.toActId) {
      if (room.nextHandTimer) {
        clearTimeout(room.nextHandTimer);
        room.nextHandTimer = null;
      }
      const playerId = room.table.toActId;
      room.turnTimer = setTimeout(() => {
        room.turnTimer = null;
        room.table.autoAct(playerId);
        this.broadcast(room);
        this.afterStateChange(room);
      }, room.table.settings.turnSeconds * 1000);
      return;
    }

    if (room.table.handActive || !room.started) return;
    if (room.nextHandTimer) return;

    const ready = room.table.players.filter(
      (player) => player.connected && !player.sittingOut && player.chips > 0,
    );
    if (ready.length < 2) {
      if (!room.waitingAnnounced) {
        room.waitingAnnounced = true;
        this.pushChat(
          room,
          "Waiting for at least 2 players with chips to deal the next hand",
          null,
          true,
        );
      }
      return;
    }
    room.waitingAnnounced = false;

    room.nextHandTimer = setTimeout(() => {
      room.nextHandTimer = null;
      const result = room.table.startHand();
      if (!result.ok) {
        this.pushChat(room, result.error ?? "Could not deal the next hand", null, true);
      }
      this.broadcast(room);
      this.afterStateChange(room);
    }, NEXT_HAND_DELAY_MS);
  }

  private sweep(): void {
    const now = Date.now();
    for (const [code, room] of this.rooms) {
      let changed = false;

      for (const [playerId, since] of room.disconnectedAt) {
        if (now - since > DISCONNECTED_TTL_MS) {
          room.table.standUp(playerId);
          room.table.removePlayer(playerId);
          room.disconnectedAt.delete(playerId);
          if (room.hostId === playerId) this.reassignHost(room);
          changed = true;
        }
      }

      if (room.sockets.size === 0) {
        room.emptySince ??= now;
        if (now - room.emptySince > EMPTY_ROOM_TTL_MS) {
          if (room.turnTimer) clearTimeout(room.turnTimer);
          if (room.nextHandTimer) clearTimeout(room.nextHandTimer);
          this.rooms.delete(code);
          continue;
        }
      } else {
        room.emptySince = null;
      }

      if (changed) this.broadcast(room);
    }
  }

  /** Used by tests and diagnostics. */
  getRoom(code: string): Room | undefined {
    return this.rooms.get(normaliseCode(code));
  }
}

export const roomManager = new RoomManager();
