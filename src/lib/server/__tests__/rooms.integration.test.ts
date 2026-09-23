import { createServer, type Server as HttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import { io as ioClient, type Socket } from "socket.io-client";
import { Server as IOServer } from "socket.io";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import type { PlayerAction } from "../../poker/game";
import type {
  ClientToServerEvents,
  JoinResult,
  RoomSnapshot,
  ServerToClientEvents,
  YouInfo,
} from "../../protocol";
import { RoomManager } from "../rooms";

type ClientSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

let httpServer: HttpServer;
let io: IOServer<ClientToServerEvents, ServerToClientEvents>;
let url = "";

const clients: ClientSocket[] = [];
const latest = new Map<ClientSocket, RoomSnapshot>();
const privateCards = new Map<ClientSocket, YouInfo | null>();

beforeAll(async () => {
  const manager = new RoomManager();
  httpServer = createServer();
  io = new IOServer<ClientToServerEvents, ServerToClientEvents>(httpServer);
  manager.attach(io);
  await new Promise<void>((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
  const address = httpServer.address() as AddressInfo;
  url = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  for (const client of clients) client.disconnect();
  io.close();
  await new Promise<void>((resolve) => httpServer.close(() => resolve()));
});

afterEach(() => {
  while (clients.length) clients.pop()?.disconnect();
  latest.clear();
  privateCards.clear();
});

function connect(): Promise<ClientSocket> {
  const socket = ioClient(url, {
    transports: ["websocket"],
    forceNew: true,
    reconnection: false,
    timeout: 5000,
  }) as unknown as ClientSocket;
  clients.push(socket);
  socket.on("room:state", (snapshot) => latest.set(socket, snapshot));
  socket.on("room:you", (you) => privateCards.set(socket, you));
  return new Promise((resolve, reject) => {
    socket.once("connect", () => resolve(socket));
    socket.once("connect_error", (error) => reject(error));
  });
}

function callAck(run: (done: (result: JoinResult) => void) => void): Promise<JoinResult> {
  return new Promise<JoinResult>((resolve) => run(resolve));
}

const createRoom = (socket: ClientSocket, name: string) =>
  callAck((done) => socket.emit("room:create", { name }, done));
const joinRoom = (socket: ClientSocket, code: string, name: string, seat?: number) =>
  callAck((done) => socket.emit("room:join", { code, name, seat }, done));
const subscribeRoom = (socket: ClientSocket, code: string, playerId?: string | null) =>
  callAck((done) => socket.emit("room:subscribe", { code, playerId }, done));
const startGame = (socket: ClientSocket) => callAck((done) => socket.emit("game:start", done));
const sendAction = (socket: ClientSocket, action: PlayerAction, amount?: number) =>
  callAck((done) => socket.emit("player:action", { action, amount }, done));
const sendChat = (socket: ClientSocket, text: string) =>
  callAck((done) => socket.emit("chat:send", { text }, done));
const standUp = (socket: ClientSocket) => callAck((done) => socket.emit("player:standup", done));

async function poll<T>(read: () => T | undefined, predicate: (value: T) => boolean, label: string) {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    const value = read();
    if (value !== undefined && predicate(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`timed out waiting for ${label}`);
}

const waitFor = (socket: ClientSocket, predicate: (snapshot: RoomSnapshot) => boolean, label: string) =>
  poll(() => latest.get(socket), predicate, label);

/** Anything that must move between two consecutive actions. */
function fingerprint(snapshot: RoomSnapshot): string {
  const { table } = snapshot;
  return [
    table.handNumber,
    table.phase,
    table.board.length,
    table.currentBet,
    table.toActId,
    table.pot,
  ].join("|");
}

/** Play a whole hand by calling or checking for whoever is next. */
async function playHand(
  players: { socket: ClientSocket; id: string }[],
  observer: ClientSocket,
): Promise<RoomSnapshot> {
  let snapshot = await waitFor(observer, (state) => state !== undefined, "the first snapshot");
  const deadline = Date.now() + 10000;

  while (Date.now() < deadline) {
    if (!snapshot.table.handActive) return snapshot;

    const toAct = snapshot.table.toActId;
    const before = fingerprint(snapshot);
    const actor = players.find((player) => player.id === toAct);
    if (!actor) throw new Error(`nobody at the table owns the turn (${String(toAct)})`);

    const me = snapshot.table.players.find((player) => player.id === actor.id)!;
    const toCall = snapshot.table.currentBet - me.bet;
    const result =
      toCall > 0 ? await sendAction(actor.socket, "call") : await sendAction(actor.socket, "check");
    if (!result.ok) throw new Error(`action rejected: ${result.error}`);

    snapshot = await waitFor(
      observer,
      (state) => !state.table.handActive || fingerprint(state) !== before,
      "the next turn",
    );
  }
  throw new Error("hand did not finish in time");
}

describe("room lifecycle over a real socket connection", () => {
  it("creates a room with a unique code and lets a friend join it", async () => {
    const host = await connect();
    const guest = await connect();

    const created = await createRoom(host, "Alice");
    expect(created.ok).toBe(true);
    expect(created.code).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
    expect(created.playerId).toBeTruthy();
    expect(created.you?.name).toBe("Alice");

    const joined = await joinRoom(guest, created.code!, "Bob");
    expect(joined.ok).toBe(true);
    expect(joined.code).toBe(created.code);
    expect(joined.snapshot?.table.players).toHaveLength(2);
    expect(joined.snapshot?.table.players.map((player) => player.name)).toEqual(["Alice", "Bob"]);

    const wrongCode = await joinRoom(guest, "ZZZZZZ", "Mallory");
    expect(wrongCode.ok).toBe(false);
    expect(wrongCode.error).toMatch(/No table found/);
  });

  it("deals a full hand, keeps hole cards private and pays the winner", async () => {
    const host = await connect();
    const guest = await connect();

    const created = await createRoom(host, "Alice");
    const code = created.code!;
    const joined = await joinRoom(guest, code, "Bob");

    const started = await startGame(host);
    expect(started.ok).toBe(true);

    const live = await waitFor(host, (snapshot) => snapshot.table.handActive, "a live hand");
    expect(live.table.phase).toBe("preflop");
    // The broadcast never carries hole cards before the showdown.
    expect(live.table.players.every((player) => player.holeCards === null)).toBe(true);

    // Each player learns their own cards privately.
    const hostYou = await poll(() => privateCards.get(host), (you) => (you?.holeCards.length ?? 0) === 2, "host cards");
    const guestYou = await poll(() => privateCards.get(guest), (you) => (you?.holeCards.length ?? 0) === 2, "guest cards");
    expect(hostYou!.holeCards).toHaveLength(2);
    expect(guestYou!.holeCards).toHaveLength(2);
    expect(guestYou!.playerId).toBe(joined.playerId);

    const players = [
      { socket: host, id: created.playerId! },
      { socket: guest, id: joined.playerId! },
    ];
    const finished = await playHand(players, host);

    expect(finished.table.lastOutcome).not.toBeNull();
    const totalChips = finished.table.players.reduce((sum, player) => sum + player.chips, 0);
    expect(totalChips).toBe(2000);
    const awarded = finished.table.lastOutcome!.winners.reduce((sum, entry) => sum + entry.amount, 0);
    expect(awarded).toBeGreaterThan(0);
  });

  it("keeps the seat when a player reconnects with their stored id", async () => {
    const host = await connect();
    const guest = await connect();
    const created = await createRoom(host, "Alice");
    const code = created.code!;
    const joined = await joinRoom(guest, code, "Bob");
    const playerId = joined.playerId!;

    guest.disconnect();
    const returning = await connect();
    const resubscribed = await subscribeRoom(returning, code, playerId);

    expect(resubscribed.ok).toBe(true);
    expect(resubscribed.playerId).toBe(playerId);
    expect(resubscribed.you?.name).toBe("Bob");

    const state = await waitFor(
      host,
      (snapshot) => snapshot.table.players.every((player) => player.connected),
      "both players connected",
    );
    expect(state.table.players.map((player) => player.name)).toEqual(["Alice", "Bob"]);
  });

  it("lets a visitor watch without taking a seat", async () => {
    const host = await connect();
    const watcher = await connect();
    const created = await createRoom(host, "Alice");

    const spectating = await subscribeRoom(watcher, created.code!);
    expect(spectating.ok).toBe(true);
    expect(spectating.you).toBeNull();
    expect(spectating.snapshot?.spectators).toBe(1);
    expect(spectating.snapshot?.table.players).toHaveLength(1);
  });

  it("relays chat to everybody at the table", async () => {
    const host = await connect();
    const guest = await connect();
    const created = await createRoom(host, "Alice");
    await joinRoom(guest, created.code!, "Bob");

    const received = new Promise<string>((resolve) =>
      guest.once("chat:new", (message) => resolve(message.text)),
    );
    const sent = await sendChat(host, "gl hf");
    expect(sent.ok).toBe(true);
    await expect(received).resolves.toBe("gl hf");
  });

  it("releases a seat when a player stands up", async () => {
    const host = await connect();
    const guest = await connect();
    const created = await createRoom(host, "Alice");
    await joinRoom(guest, created.code!, "Bob");

    const left = await standUp(guest);
    expect(left.ok).toBe(true);
    expect(left.snapshot?.table.players.map((player) => player.name)).toEqual(["Alice"]);
    expect(left.you).toBeNull();
  });

  it("refuses an action from a player who is not seated", async () => {
    const host = await connect();
    const watcher = await connect();
    const created = await createRoom(host, "Alice");
    await subscribeRoom(watcher, created.code!);
    await startGame(host);

    const result = await sendAction(watcher, "call");
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/not seated/i);
  });
});
