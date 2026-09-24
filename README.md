# ♠ Arena Poker

Realtime multiplayer **No-Limit Texas Hold'em** built with **Next.js (App Router) + TypeScript +
Tailwind CSS + Socket.IO**.

Create a table, get a unique room code, share it, and play with friends in the browser.
**No accounts, no sign-in, no email** — just a display name and a room code.

---

## Quick start

```bash
npm install
npm run dev          # http://localhost:3000
```

Open the app in two or more browser windows (or send the invite link to a friend), create a
table in one of them, and join it from the others with the 6-character room code.

Production:

```bash
npm run build
npm start            # serves the built app + realtime server on one port
```

Environment variables (all optional): `PORT` (default `3000`), `HOST` (default `0.0.0.0`).

## Scripts

| Script                | What it does                                        |
| --------------------- | --------------------------------------------------- |
| `npm run dev`         | Dev server (Next.js + Socket.IO on the same port)   |
| `npm run build`       | Production build of the Next.js app                 |
| `npm start`           | Run the production build                            |
| `npm test`            | Unit + end-to-end socket tests (Vitest)             |
| `npm run typecheck`   | `tsc --noEmit`                                      |

## How a game works

1. **Create a table** on the home page → the server generates a unique code (e.g. `MVQCMV`)
   from an alphabet that excludes the easily-confused characters `0/O/1/I`.
2. **Share the code** (or the invite link `/room/<CODE>`). Anyone who opens it types a name and
   takes a free seat — up to 9 seats per table. Everyone else can watch as a spectator.
3. **The host presses Start.** Blinds are posted, hole cards are dealt, and the action clock
   (30s by default) starts for the first player.
4. Hands continue automatically; the button moves clockwise and busted players can rebuy.
   The host can also **⏸ Pause** the automatic dealer and deal each hand by hand
   (**▶ Deal next hand**), or pick from four blind levels and four clocks in **⚙ Settings**.
   Any player can **Sit out** (skipping the hands without giving up the seat) and come back
   with **I'm back**.
5. Refreshing the page, or losing the connection, keeps your seat for a few minutes — the seat
   id lives in `localStorage` and is silently reclaimed on reconnect.

### Game rules implemented

- No-Limit Texas Hold'em: pre-flop, flop, turn, river, showdown.
- Blinds with rotation, **heads-up button rules** (dealer = small blind and acts first pre-flop).
- `fold`, `check`, `call`, `raise`, `all-in` with proper minimum-raise enforcement.
- **Short all-in does not reopen betting** for players who have already acted.
- **Side pots** when stacks differ, split pots, and odd chips awarded clockwise from the button.
- 7-card hand evaluation (best 5 of 7) with full tiebreakers, including the wheel straight.
- Action clock with auto-check/auto-fold, and players who leave mid-hand fold and keep their
  committed chips in the pot.
- Live table feed (game events + chat), spectators, sitting out / coming back, rebuys and
  top-ups, host controls (start, pause the auto-dealer, blinds, action clock).

## Architecture

```
server.ts                     custom Node server: Next.js request handler + Socket.IO, one port
src/lib/poker/
  cards.ts                    deck, shuffling, card parsing
  evaluator.ts                5/7-card hand ranking and comparison
  pots.ts                     main/side pot computation
  game.ts                     PokerTable state machine (dealing, betting rounds, settlement)
src/lib/protocol.ts           the shared socket event contract + payload sanitising
src/lib/server/rooms.ts       RoomManager: rooms, seats, seats-on-disconnect, timers, chat
src/components/               table, seats, cards, action bar, feed, lobby, room client
src/app/                      Next.js routes:  /  and  /room/[code]
```

**One port, no CORS.** `server.ts` creates a single HTTP server, hands every non-`/socket.io`
request to Next.js and lets Socket.IO own `/socket.io/*`. Game state lives only in that Node
process, so there is exactly one source of truth and no module-instance duplication.

**Hole cards never leak.** The broadcast snapshot contains `holeCards: null` for everybody;
each socket additionally receives a private `room:you` message with only its own cards. Cards
become public in the snapshot at showdown.

**Clock skew proof.** The turn countdown is anchored to the moment a state update arrives in
the browser rather than to the server's absolute timestamp.

Rooms are kept in memory: an empty room is garbage-collected five minutes after the last socket
leaves, and a disconnected player's seat is released after three minutes.

## Tests

```bash
npm test
```

- `evaluator.test.ts` — hand ranking, kickers, the wheel, splits.
- `pots.test.ts` — side-pot maths (amounts always sum to the total committed).
- `game.test.ts` — blinds, first-to-act, min-raise rules, short all-in, timeouts, showdowns,
  split pots, side pots with an all-in short stack, seating and leaving mid-hand.
- `rooms.integration.test.ts` — spins up a real Socket.IO server and drives it with real
  clients: room creation, joining, dealing a full hand, hole-card privacy, chat, spectating,
  reconnecting to the same seat, standing up, sitting out and coming back, rebuys, dealing on
  demand vs. pausing the auto-dealer, and partial settings updates.

> Note: a custom server (required to host Socket.IO on the same port) is not supported on
> Vercel's serverless platform. Deploy on a long-running Node host (VPS, Fly.io, Render,
> Railway, a container, …). Rooms are in-memory, so run a single instance per room namespace.
