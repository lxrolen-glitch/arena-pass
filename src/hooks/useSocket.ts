"use client";

import { io, type Socket } from "socket.io-client";

import type { ClientToServerEvents, ServerToClientEvents } from "@/lib/protocol";

export type PokerSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

/** Connects to the Socket.IO server that shares this app's origin/port. */
export function createSocket(): PokerSocket {
  // socket.io-client's `io()` is not generic in 4.8, so narrow the returned
  // socket to our typed event map to keep emit/on call sites type safe.
  const socket = io({
    path: "/socket.io",
    // Long-polling first, then upgrade: the most reliable order behind proxies,
    // which may or may not allow the WebSocket upgrade.
    transports: ["polling", "websocket"],
    reconnection: true,
    reconnectionDelay: 700,
    reconnectionDelayMax: 4000,
    timeout: 15000,
  });
  return socket as unknown as PokerSocket;
}
