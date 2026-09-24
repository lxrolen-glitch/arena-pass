"use client";

import type { CardCode } from "@/lib/poker/cards";
import type { PublicPlayer } from "@/lib/poker/game";
import { chips } from "@/lib/client/ui";
import { PlayingCard } from "./PlayingCard";

function TimerRing({ fraction }: { fraction: number }) {
  const radius = 21;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.max(0, Math.min(1, fraction));
  return (
    <svg viewBox="0 0 48 48" className="absolute -inset-1 h-[calc(100%+8px)] w-[calc(100%+8px)]">
      <circle cx="24" cy="24" r={radius} fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="3" />
      <circle
        cx="24"
        cy="24"
        r={radius}
        fill="none"
        stroke={clamped > 0.3 ? "#f2c14e" : "#fb7185"}
        strokeWidth="3"
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={circumference * (1 - clamped)}
        transform="rotate(-90 24 24)"
        style={{ transition: "stroke-dashoffset 250ms linear" }}
      />
    </svg>
  );
}

export function Seat({
  player,
  isYou,
  isDealer,
  isTurn,
  holeCards,
  secondsLeft,
  turnSeconds,
  winnerAmount,
  onSit,
  compact = false,
}: {
  player: PublicPlayer | null;
  isYou: boolean;
  isDealer: boolean;
  isTurn: boolean;
  holeCards: CardCode[];
  secondsLeft?: number;
  turnSeconds: number;
  winnerAmount?: number | null;
  onSit?: () => void;
  compact?: boolean;
}) {
  if (!player) {
    return (
      <div className="flex w-36 flex-col items-center gap-2 sm:w-44">
        <div className="h-16 w-24" />
        <button
          type="button"
          onClick={onSit}
          disabled={!onSit}
          className="w-full rounded-xl border border-dashed border-white/20 bg-white/5 px-3 py-2.5 text-xs font-semibold text-slate-400 transition hover:border-gold-400/50 hover:bg-white/10 hover:text-slate-100 disabled:cursor-default disabled:hover:border-white/20 disabled:hover:bg-white/5"
        >
          Open seat
        </button>
      </div>
    );
  }

  const initial = player.name.trim().charAt(0).toUpperCase() || "?";
  const dim = player.folded || (!player.connected && !player.inHand);

  return (
    <div
      className={`flex w-36 flex-col items-center gap-1.5 sm:w-44 ${dim ? "opacity-50" : ""}`}
    >
      <div className="flex h-16 items-end">
        {holeCards.length > 0 ? (
          <div className="flex gap-1">
            {holeCards.map((code, index) => (
              <PlayingCard
                key={code + index}
                code={code}
                size={compact ? "sm" : "md"}
                className="animate-deal"
                style={{ animationDelay: `${index * 80}ms` }}
              />
            ))}
          </div>
        ) : (
          <div className="h-16" />
        )}
      </div>

      <div
        className={`relative w-full rounded-xl border px-2 py-1.5 text-center transition ${
          isTurn
            ? "border-gold-400/70 bg-slate-900/90 shadow-lg shadow-gold-600/10"
            : winnerAmount
              ? "border-emerald-400/70 bg-emerald-950/60"
              : "border-white/10 bg-slate-900/70"
        }`}
      >
        <div className="flex items-center justify-center gap-2">
          <div className="relative h-11 w-11 shrink-0">
            {isTurn && (
              <TimerRing fraction={turnSeconds > 0 ? (secondsLeft ?? 0) / turnSeconds : 0} />
            )}
            <div
              className={`flex h-11 w-11 items-center justify-center rounded-full text-base font-bold ${
                isYou
                  ? "bg-gradient-to-br from-gold-400 to-gold-600 text-slate-900"
                  : "bg-gradient-to-br from-slate-600 to-slate-800 text-slate-100"
              }`}
            >
              {initial}
            </div>
            {isDealer && (
              <span className="absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full border border-slate-300 bg-white text-[10px] font-black text-slate-900">
                D
              </span>
            )}
          </div>

          <div className="min-w-0 flex-1 text-left">
            <div className="flex items-center gap-1 truncate text-[13px] font-semibold text-slate-100">
              {player.name}
              {player.isHost && <span title="Table host">👑</span>}
              {isYou && <span className="text-[10px] font-bold text-gold-400">YOU</span>}
            </div>
            <div className="truncate text-xs font-semibold text-gold-400">{chips(player.chips)}</div>
          </div>
        </div>

        <div className="mt-1 flex flex-wrap items-center justify-center gap-1 text-[10px] font-bold uppercase tracking-wide">
          {player.allIn && <span className="rounded bg-rose-500/90 px-1.5 py-0.5 text-white">All-in</span>}
          {player.folded && <span className="rounded bg-slate-600/80 px-1.5 py-0.5 text-slate-200">Folded</span>}
          {!player.connected && <span className="rounded bg-amber-500/90 px-1.5 py-0.5 text-slate-900">Away</span>}
          {player.sittingOut && player.connected && !player.folded && (
            <span className="rounded bg-slate-600/80 px-1.5 py-0.5 text-slate-200">Sitting out</span>
          )}
          {winnerAmount ? (
            <span className="rounded bg-emerald-500/90 px-1.5 py-0.5 text-white">
              +{chips(winnerAmount)}
            </span>
          ) : (
            player.lastAction &&
            player.inHand &&
            !player.folded && (
              <span className="rounded bg-white/10 px-1.5 py-0.5 text-slate-200">{player.lastAction}</span>
            )
          )}
        </div>
      </div>

      {player.bet > 0 && (
        <div className="chip-pill animate-pop !py-0.5 text-[11px] text-gold-400">
          <span className="inline-block h-2.5 w-2.5 rounded-full bg-gradient-to-br from-gold-400 to-gold-600" />
          {chips(player.bet)}
        </div>
      )}
    </div>
  );
}
