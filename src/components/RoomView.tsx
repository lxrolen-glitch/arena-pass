"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ActionBar } from "@/components/ActionBar";
import { Feed } from "@/components/Feed";
import { PokerTable } from "@/components/PokerTable";
import { createSocket, type PokerSocket } from "@/hooks/useSocket";
import { useNow } from "@/hooks/useNow";
import { clearSeat, readName, readSeat, writeName, writeSeat } from "@/lib/client/storage";
import { chips, useCopy } from "@/lib/client/ui";
import {
  getActionOptions,
  type PlayerAction,
  type TableSettings,
} from "@/lib/poker/game";
import type { JoinResult, RoomSnapshot, YouInfo } from "@/lib/protocol";

type Status = "connecting" | "needs-name" | "ready";

const BLIND_PRESETS = [
  { label: "10 / 20", smallBlind: 10, bigBlind: 20, startingChips: 1000 },
  { label: "25 / 50", smallBlind: 25, bigBlind: 50, startingChips: 2500 },
  { label: "50 / 100", smallBlind: 50, bigBlind: 100, startingChips: 5000 },
  { label: "100 / 200", smallBlind: 100, bigBlind: 200, startingChips: 10000 },
];

export function RoomView({ code }: { code: string }) {
  const router = useRouter();
  const now = useNow(250);

  const [snapshot, setSnapshot] = useState<RoomSnapshot | null>(null);
  const [you, setYou] = useState<YouInfo | null>(null);
  const [status, setStatus] = useState<Status>("connecting");
  const [connected, setConnected] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [nameDraft, setNameDraft] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const [showFeed, setShowFeed] = useState(false);

  const socketRef = useRef<PokerSocket | null>(null);
  const intentRef = useRef<"create" | "join">("join");
  const snapshotRef = useRef<RoomSnapshot | null>(null);
  snapshotRef.current = snapshot;
  // Anchor the countdown to the moment the state arrived locally, so a clock
  // difference between browser and server cannot skew the timer.
  const turnAnchor = useRef<{ server: number; local: number }>({ server: 0, local: 0 });
  const [copiedCode, copyCode] = useCopy();
  const [copiedLink, copyLink] = useCopy();

  useEffect(() => {
    setNameDraft(readName());
  }, []);

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(id);
  }, [toast]);

  const anchorIfNew = useCallback((next: RoomSnapshot) => {
    if (next.table.turnStartedAt !== turnAnchor.current.server) {
      turnAnchor.current = { server: next.table.turnStartedAt, local: Date.now() };
    }
  }, []);

  useEffect(() => {
    const socket = createSocket();
    socketRef.current = socket;
    let cancelled = false;

    const applyAck = (result: JoinResult) => {
      if (cancelled) return;
      if (!result.ok) {
        setToast(result.error ?? "Something went wrong");
        if (!snapshotRef.current) setStatus("needs-name");
        return;
      }
      if (result.playerId) {
        writeSeat(code, result.playerId);
        setStatus("ready");
      } else if (readSeat(code)) {
        clearSeat(code);
      }
      if (result.snapshot) {
        anchorIfNew(result.snapshot);
        setSnapshot(result.snapshot);
      }
      setYou(result.you ?? null);
    };

    const join = () => {
      const params = new URLSearchParams(window.location.search);
      if (params.get("new") === "1") {
        intentRef.current = "create";
        params.delete("new");
        const query = params.toString();
        window.history.replaceState(null, "", `${window.location.pathname}${query ? `?${query}` : ""}`);
      }
      const savedId = readSeat(code);

      if (intentRef.current === "create" && readName()) {
        socket.emit("room:create", { name: readName() }, applyAck);
        return;
      }
      if (intentRef.current === "join" && savedId) {
        socket.emit("room:subscribe", { code, playerId: savedId }, applyAck);
        return;
      }
      setStatus("needs-name");
    };

    socket.on("connect", () => {
      setConnected(true);
      join();
    });
    socket.on("disconnect", () => setConnected(false));
    socket.on("connect_error", () => setConnected(false));
    socket.on("room:state", (next) => {
      if (cancelled) return;
      anchorIfNew(next);
      setSnapshot(next);
    });
    socket.on("room:you", (next) => !cancelled && setYou(next));
    socket.on("chat:new", (message) => {
      if (cancelled) return;
      setSnapshot((prev) =>
        prev ? { ...prev, chat: [...prev.chat, message].slice(-60) } : prev,
      );
    });

    socket.connect();

    return () => {
      cancelled = true;
      // No "room:leave" here: the server keeps the seat for a few minutes so a
      // refresh (or React's dev-mode remount) can reclaim it.
      socket.removeAllListeners();
      socket.disconnect();
      socketRef.current = null;
    };
  }, [code, anchorIfNew]);

  const requireSocket = useCallback((): PokerSocket | null => {
    const socket = socketRef.current;
    if (!socket?.connected) {
      setToast("Reconnecting…");
      return null;
    }
    return socket;
  }, []);

  const sendSettings = useCallback(
    (settings: Partial<TableSettings>) => {
      const socket = requireSocket();
      if (!socket) return;
      socket.emit("game:settings", { settings }, (result) => {
        if (!result.ok && result.error) setToast(result.error);
      });
    },
    [requireSocket],
  );

  const startGame = useCallback(() => {
    const socket = requireSocket();
    if (!socket) return;
    socket.emit("game:start", (result) => {
      if (!result.ok && result.error) setToast(result.error);
    });
  }, [requireSocket]);

  const setPaused = useCallback(
    (paused: boolean) => {
      const socket = requireSocket();
      if (!socket) return;
      socket.emit("game:pause", { paused }, (result) => {
        if (!result.ok && result.error) setToast(result.error);
      });
    },
    [requireSocket],
  );

  const sendChat = useCallback(
    (text: string) => {
      const socket = requireSocket();
      if (!socket) return;
      socket.emit("chat:send", { text }, (result) => {
        if (!result.ok && result.error) setToast(result.error);
      });
    },
    [requireSocket],
  );

  const submitName = (event: React.FormEvent) => {
    event.preventDefault();
    const name = nameDraft.trim() || "Player";
    writeName(name);
    const socket = socketRef.current;
    if (!socket) return;
    setStatus("connecting");
    const apply = (result: JoinResult) => {
      if (!result.ok) {
        setToast(result.error ?? "Could not join the table");
        setStatus("needs-name");
        return;
      }
      if (result.playerId) writeSeat(code, result.playerId);
      if (result.snapshot) {
        anchorIfNew(result.snapshot);
        setSnapshot(result.snapshot);
      }
      setYou(result.you ?? null);
      setStatus("ready");
    };
    if (intentRef.current === "create") {
      socket.emit("room:create", { name }, apply);
    } else {
      socket.emit("room:join", { code, name }, apply);
    }
  };

  const takeSeat = (seat: number) => {
    const socket = socketRef.current;
    if (!socket?.connected) {
      setToast("Reconnecting…");
      return;
    }
    const name = readName();
    if (!name) {
      setStatus("needs-name");
      return;
    }
    socket.emit("room:join", { code, name, seat }, (result) => {
      if (!result.ok) {
        setToast(result.error ?? "Could not take that seat");
        return;
      }
      if (result.playerId) writeSeat(code, result.playerId);
      if (result.snapshot) {
        anchorIfNew(result.snapshot);
        setSnapshot(result.snapshot);
      }
      setYou(result.you ?? null);
    });
  };

  const act = (action: PlayerAction, amount?: number) => {
    const socket = socketRef.current;
    if (!socket?.connected) return;
    socket.emit("player:action", { action, amount }, (result) => {
      if (!result.ok && result.error) setToast(result.error);
    });
  };

  const secondsLeft = useCallback(
    (playerId: string) => {
      const table = snapshotRef.current?.table;
      if (!table || table.toActId !== playerId) return undefined;
      if (turnAnchor.current.server !== table.turnStartedAt) return undefined;
      const elapsed = (now - turnAnchor.current.local) / 1000;
      return Math.max(0, table.turnSeconds - elapsed);
    },
    [now],
  );

  const table = snapshot?.table ?? null;
  const options = useMemo(
    () => (table ? getActionOptions(table, you?.playerId ?? null) : null),
    [table, you],
  );

  const myPlayer = useMemo(
    () => table?.players.find((player) => player.id === you?.playerId) ?? null,
    [table, you],
  );

  const hint = useMemo(() => {
    if (!you || !table || !myPlayer || options?.canAct) return null;
    if (!table.handActive) {
      return table.handNumber === 0
        ? "Waiting for the host to start the game"
        : "Waiting for the next hand";
    }
    if (myPlayer.sittingOut) return "You are sitting out — press “I'm back” to be dealt in";
    if (!myPlayer.inHand) return "You will be dealt in on the next hand";
    if (myPlayer.folded) return "You folded — waiting for the hand to finish";
    if (myPlayer.allIn) return "You are all-in — waiting for the hand to finish";
    const acting = table.players.find((player) => player.id === table.toActId);
    return acting ? `Waiting for ${acting.name} to act…` : null;
  }, [you, table, myPlayer, options]);

  const rebuy = useCallback(() => {
    const socket = requireSocket();
    if (!socket) return;
    socket.emit("player:rebuy", (result) => {
      if (!result.ok && result.error) setToast(result.error);
    });
  }, [requireSocket]);

  const toggleSitOut = useCallback(
    (sittingOut: boolean) => {
      const socket = requireSocket();
      if (!socket) return;
      socket.emit("player:sitout", { sittingOut }, (result) => {
        if (!result.ok && result.error) setToast(result.error);
      });
    },
    [requireSocket],
  );

  const inviteUrl =
    typeof window === "undefined" ? "" : `${window.location.origin}/room/${code}`;
  const isHost = you !== null && snapshot?.hostId === you.playerId;
  const seated = table?.players.length ?? 0;
  const readyPlayers = table?.players.filter((player) => player.chips > 0).length ?? 0;

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-[1600px] flex-col gap-4 p-3 sm:p-5">
      {/* header */}
      <header className="panel flex flex-wrap items-center gap-3 px-4 py-3">
        <button
          type="button"
          onClick={() => router.push("/")}
          className="text-sm font-bold tracking-tight text-slate-300 transition hover:text-gold-400"
        >
          ♠ Arena Poker
        </button>

        <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-slate-950/60 px-3 py-1.5">
          <span className="text-[11px] uppercase tracking-widest text-slate-500">Room</span>
          <span className="font-mono text-base font-bold tracking-[0.2em] text-gold-400">{code}</span>
          <button
            type="button"
            onClick={() => copyCode(code)}
            className="rounded-md px-1.5 py-0.5 text-[11px] font-semibold text-slate-300 hover:bg-white/10"
          >
            {copiedCode ? "Copied!" : "Copy"}
          </button>
        </div>

        <button type="button" className="btn-ghost !px-3 !py-1.5 text-xs" onClick={() => copyLink(inviteUrl)}>
          {copiedLink ? "Link copied!" : "Invite link"}
        </button>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <span
            className={`chip-pill ${connected ? "text-emerald-300" : "text-rose-300"}`}
            title={connected ? "Connected" : "Reconnecting"}
          >
            <span
              className={`inline-block h-2 w-2 rounded-full ${connected ? "bg-emerald-400" : "bg-rose-400 animate-pulse"}`}
            />
            {connected ? "Live" : "Reconnecting"}
          </span>

          {table && (
            <>
              <span className="chip-pill">
                Blinds {chips(table.settings.smallBlind)}/{chips(table.settings.bigBlind)}
              </span>
              <span className="chip-pill">
                {seated}/{table.settings.maxPlayers} seated • {readyPlayers} ready
              </span>
              {snapshot && snapshot.spectators > 0 && (
                <span className="chip-pill">👁 {snapshot.spectators}</span>
              )}
            </>
          )}

          <button
            type="button"
            className="btn-ghost !px-3 !py-1.5 text-xs lg:hidden"
            onClick={() => setShowFeed((value) => !value)}
          >
            {showFeed ? "Hide feed" : "Feed"}
          </button>

          {isHost && table && !table.handActive && (
            <button
              type="button"
              className="btn-ghost !px-3 !py-1.5 text-xs"
              onClick={() => setShowSettings((value) => !value)}
            >
              ⚙ Settings
            </button>
          )}

          {you && myPlayer && (
            <button
              type="button"
              className="btn-ghost !px-3 !py-1.5 text-xs"
              title={
                myPlayer.sittingOut
                  ? "Resume playing — you are dealt in from the next hand"
                  : "Skip the next hands until you are back"
              }
              onClick={() => toggleSitOut(!myPlayer.sittingOut)}
            >
              {myPlayer.sittingOut ? "I'm back" : "Sit out"}
            </button>
          )}

          {you && (
            <button
              type="button"
              className="btn-ghost !px-3 !py-1.5 text-xs"
              onClick={() => {
                const socket = socketRef.current;
                socket?.emit("player:standup", (result) => {
                  if (result.ok) {
                    clearSeat(code);
                    setYou(null);
                    socket.emit("room:leave");
                  }
                });
              }}
            >
              Leave seat
            </button>
          )}
        </div>
      </header>

      {isHost && showSettings && table && (
        <div className="panel flex flex-wrap items-center gap-3 px-4 py-3">
          <span className="text-xs font-semibold uppercase tracking-widest text-slate-400">Blinds</span>
          {BLIND_PRESETS.map((preset) => (
            <button
              key={preset.label}
              type="button"
              className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition ${
                table.settings.smallBlind === preset.smallBlind
                  ? "border-gold-400/70 bg-gold-400/10 text-gold-400"
                  : "border-white/10 bg-white/5 text-slate-300 hover:bg-white/10"
              }`}
              onClick={() =>
                sendSettings({
                  smallBlind: preset.smallBlind,
                  bigBlind: preset.bigBlind,
                  startingChips: preset.startingChips,
                })
              }
            >
              {preset.label}
            </button>
          ))}
          <span className="text-xs font-semibold uppercase tracking-widest text-slate-400">
            Turn clock
          </span>
          {[15, 30, 45, 60].map((seconds) => (
            <button
              key={seconds}
              type="button"
              className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition ${
                table.settings.turnSeconds === seconds
                  ? "border-gold-400/70 bg-gold-400/10 text-gold-400"
                  : "border-white/10 bg-white/5 text-slate-300 hover:bg-white/10"
              }`}
              onClick={() => sendSettings({ turnSeconds: seconds })}
            >
              {seconds}s
            </button>
          ))}
          <span className="text-xs text-slate-500">
            Starting stack {chips(table.settings.startingChips)}
          </span>
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col gap-4 lg:flex-row">
        <div className="flex min-h-0 flex-1 flex-col gap-3">
          <div className="panel relative flex-1 overflow-hidden p-1">
            {snapshot ? (
              <PokerTable snapshot={snapshot} you={you} secondsLeft={secondsLeft} onSit={takeSeat} />
            ) : (
              <div className="flex h-72 items-center justify-center text-slate-400">
                {connected ? "Loading table…" : "Connecting…"}
              </div>
            )}

            {isHost && snapshot && table && !table.handActive && (
              <div className="pointer-events-none absolute inset-x-0 bottom-3 flex flex-wrap items-center justify-center gap-2 px-3">
                <button
                  type="button"
                  className="btn-primary pointer-events-auto animate-pop"
                  onClick={startGame}
                >
                  {snapshot.started || table.handNumber > 0 ? "▶ Deal next hand" : "▶ Start game"}
                </button>
                {snapshot.started ? (
                  <button
                    type="button"
                    className="btn-ghost pointer-events-auto"
                    title="Stop dealing new hands automatically"
                    onClick={() => setPaused(true)}
                  >
                    ⏸ Pause
                  </button>
                ) : (
                  table.handNumber > 0 && (
                    <button
                      type="button"
                      className="btn-ghost pointer-events-auto"
                      title="Deal every hand automatically again"
                      onClick={() => setPaused(false)}
                    >
                      ▶ Resume auto-deal
                    </button>
                  )
                )}
              </div>
            )}

            {snapshot && !snapshot.started && table && table.handNumber > 0 && !table.handActive && (
              <div className="pointer-events-none absolute inset-x-0 bottom-14 flex justify-center">
                <span className="rounded-full bg-black/60 px-3 py-1 text-xs text-slate-300">
                  Table paused — the host deals the next hand
                </span>
              </div>
            )}
          </div>

          {options && you ? (
            <ActionBar
              options={options}
              disabled={!connected}
              onAction={act}
              hint={hint}
              onRebuy={myPlayer && myPlayer.chips === 0 ? rebuy : undefined}
            />
          ) : (
            <div className="panel flex flex-wrap items-center justify-center gap-3 p-4 text-sm text-slate-400">
              {snapshot ? (
                <>
                  <span>You are watching this table.</span>
                  <button type="button" className="btn-primary !py-1.5 text-xs" onClick={() => takeSeat(-1)}>
                    Take a seat
                  </button>
                </>
              ) : (
                <span>Connecting to the table…</span>
              )}
            </div>
          )}
        </div>

        <aside
          className={`${showFeed ? "flex" : "hidden"} h-[24rem] shrink-0 flex-col lg:flex lg:h-auto lg:w-80`}
        >
          <Feed
            chat={snapshot?.chat ?? []}
            log={table?.log ?? []}
            canSend={Boolean(you)}
            onSend={sendChat}
          />
        </aside>
      </div>

      {/* join / name overlay */}
      {status === "needs-name" && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm">
          <form onSubmit={submitName} className="panel w-full max-w-sm space-y-4 p-6">
            <div>
              <h1 className="text-lg font-bold text-slate-100">
                {intentRef.current === "create" ? "Create your table" : `Join table ${code}`}
              </h1>
              <p className="mt-1 text-sm text-slate-400">
                Pick a display name. No account, no password — just play.
              </p>
            </div>
            <input
              className="field"
              autoFocus
              maxLength={22}
              placeholder="Your name"
              value={nameDraft}
              onChange={(event) => setNameDraft(event.target.value)}
            />
            <button type="submit" className="btn-primary w-full">
              {intentRef.current === "create" ? "Create table" : "Join table"}
            </button>
          </form>
        </div>
      )}

      {toast && (
        <div className="fixed inset-x-0 bottom-5 z-50 flex justify-center px-4">
          <div className="animate-pop rounded-xl border border-rose-400/40 bg-rose-950/90 px-4 py-2 text-sm font-semibold text-rose-100 shadow-xl">
            {toast}
          </div>
        </div>
      )}
    </div>
  );
}
