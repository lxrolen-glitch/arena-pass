"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { createSocket, type PokerSocket } from "@/hooks/useSocket";
import { readName, writeName, writeSeat } from "@/lib/client/storage";
import { PlayingCard } from "@/components/PlayingCard";

const HOW_IT_WORKS = [
  {
    title: "Create a table",
    body: "Pick a name and you get a unique 6-character room code. No account, no email.",
  },
  {
    title: "Share the code",
    body: "Send the invite link or just the code. Friends join from any device, instantly.",
  },
  {
    title: "Play Hold'em",
    body: "No-Limit Texas Hold'em with blinds, side pots, an action clock and live chat.",
  },
];

export function Lobby() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [online, setOnline] = useState(false);
  const socketRef = useRef<PokerSocket | null>(null);

  useEffect(() => {
    setName(readName());
    const socket = createSocket();
    socketRef.current = socket;
    socket.on("connect", () => {
      setOnline(true);
      setError(null);
    });
    socket.on("disconnect", () => setOnline(false));
    socket.connect();
    return () => {
      // Deliberately no "room:leave" here: a seat created on this page is kept
      // alive on the server so the room page can reclaim it after navigation.
      socket.removeAllListeners();
      socket.disconnect();
      socketRef.current = null;
    };
  }, []);

  const createTable = (event: React.FormEvent) => {
    event.preventDefault();
    const socket = socketRef.current;
    const displayName = name.trim() || "Host";
    if (!socket?.connected) {
      setError("Still connecting, give it a second…");
      return;
    }
    setBusy(true);
    setError(null);
    writeName(displayName);
    socket.emit("room:create", { name: displayName }, (result) => {
      setBusy(false);
      if (!result.ok || !result.code) {
        setError(result.error ?? "Could not create the table");
        return;
      }
      if (result.playerId) writeSeat(result.code, result.playerId);
      router.push(`/room/${result.code}`);
    });
  };

  const joinTable = (event: React.FormEvent) => {
    event.preventDefault();
    const clean = code.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (clean.length < 4) {
      setError("Enter the room code your friend shared");
      return;
    }
    writeName(name.trim() || "Player");
    router.push(`/room/${clean}`);
  };

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-5xl flex-col justify-center gap-10 px-4 py-12">
      <section className="text-center">
        <div className="mb-6 flex justify-center gap-1.5">
          <PlayingCard code="As" size="lg" className="-rotate-6" />
          <PlayingCard code="Ks" size="lg" className="z-10 -translate-y-1" />
          <PlayingCard code="Qh" size="lg" className="rotate-6" />
        </div>
        <h1 className="text-4xl font-black tracking-tight text-slate-50 sm:text-6xl">
          Arena <span className="text-gold-400">Poker</span>
        </h1>
        <p className="mx-auto mt-4 max-w-xl text-slate-400">
          Realtime No-Limit Texas Hold&apos;em with friends. Create a table, share the room code,
          start playing — no sign-up, no download.
        </p>
        <span
          className={`chip-pill mt-5 ${online ? "text-emerald-300" : "text-slate-400"}`}
          title={online ? "Realtime server connected" : "Connecting to the realtime server"}
        >
          <span
            className={`inline-block h-2 w-2 rounded-full ${online ? "bg-emerald-400" : "bg-slate-500 animate-pulse"}`}
          />
          {online ? "Server online" : "Connecting…"}
        </span>
      </section>

      <section className="grid gap-4 sm:grid-cols-2">
        <form onSubmit={createTable} className="panel space-y-3 p-5">
          <h2 className="text-lg font-bold text-slate-100">Create a table</h2>
          <p className="text-sm text-slate-400">You get a unique room code to share.</p>
          <label className="block text-xs font-semibold uppercase tracking-widest text-slate-500">
            Display name
          </label>
          <input
            className="field"
            value={name}
            maxLength={22}
            placeholder="e.g. Alice"
            onChange={(event) => setName(event.target.value)}
          />
          <button type="submit" className="btn-primary w-full" disabled={busy}>
            {busy ? "Creating…" : "Create table"}
          </button>
        </form>

        <form onSubmit={joinTable} className="panel space-y-3 p-5">
          <h2 className="text-lg font-bold text-slate-100">Join a table</h2>
          <p className="text-sm text-slate-400">Enter the code your friend sent you.</p>
          <label className="block text-xs font-semibold uppercase tracking-widest text-slate-500">
            Room code
          </label>
          <input
            className="field font-mono text-center text-xl tracking-[0.35em] uppercase"
            value={code}
            maxLength={8}
            placeholder="ABC123"
            onChange={(event) => setCode(event.target.value.toUpperCase())}
          />
          <button type="submit" className="btn-ghost w-full">
            Join table
          </button>
        </form>
      </section>

      {error && (
        <p className="rounded-xl border border-rose-400/40 bg-rose-950/60 px-4 py-2 text-center text-sm text-rose-200">
          {error}
        </p>
      )}

      <section className="grid gap-4 sm:grid-cols-3">
        {HOW_IT_WORKS.map((step, index) => (
          <div key={step.title} className="panel p-5">
            <span className="text-xs font-black text-gold-400">0{index + 1}</span>
            <h3 className="mt-1 font-bold text-slate-100">{step.title}</h3>
            <p className="mt-1 text-sm text-slate-400">{step.body}</p>
          </div>
        ))}
      </section>

      <footer className="pb-6 text-center text-xs text-slate-600">
        Play money only — chips have no real-world value. Rooms stay open while someone is
        connected and are cleared a few minutes after everybody leaves.
      </footer>
    </main>
  );
}
