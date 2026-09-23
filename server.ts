/* eslint-disable no-console */
import { createServer } from "node:http";
import next from "next";
import { Server as SocketIOServer } from "socket.io";

import type { ClientToServerEvents, ServerToClientEvents } from "./src/lib/protocol";
import { roomManager } from "./src/lib/server/rooms";

const dev = process.env.NODE_ENV !== "production";
const hostname = process.env.HOST ?? "0.0.0.0";
const port = Number.parseInt(process.env.PORT ?? "3000", 10);

const app = next({ dev, hostname, port, dir: process.cwd() });
const handleRequest = app.getRequestHandler();

void app.prepare().then(() => {
  const httpServer = createServer((req, res) => {
    // Socket.IO owns /socket.io/*; everything else belongs to Next.js.
    if (req.url?.startsWith("/socket.io")) return;
    void handleRequest(req, res);
  });

  const io = new SocketIOServer<ClientToServerEvents, ServerToClientEvents>(httpServer, {
    cors: { origin: true, credentials: true },
    pingInterval: 25000,
    pingTimeout: 20000,
    maxHttpBufferSize: 1e5,
  });

  roomManager.attach(io);

  httpServer.listen(port, hostname, () => {
    console.log(
      `> Poker server ready on http://${hostname === "0.0.0.0" ? "localhost" : hostname}:${port} (${dev ? "development" : "production"})`,
    );
  });

  const shutdown = () => {
    io.close();
    httpServer.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
});
