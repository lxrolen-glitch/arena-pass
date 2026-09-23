"use client";

import { useMemo } from "react";

import { chips, seatPosition } from "@/lib/client/ui";
import type { CardCode } from "@/lib/poker/cards";
import type { PublicPlayer, PublicTableState } from "@/lib/poker/game";
import type { RoomSnapshot, YouInfo } from "@/lib/protocol";
import { PlayingCard } from "./PlayingCard";
import { Seat } from "./Seat";

const STREET_LABEL: Record<PublicTableState["phase"], string> = {
  idle: "Waiting",
  preflop: "Pre-flop",
  flop: "Flop",
  turn: "Turn",
  river: "River",
  showdown: "Showdown",
};

export function PokerTable({
  snapshot,
  you,
  secondsLeft,
  onSit,
}: {
  snapshot: RoomSnapshot;
  you: YouInfo | null;
  secondsLeft: (playerId: string) => number | undefined;
  onSit: (seat: number) => void;
}) {
  const table = snapshot.table;
  const seatCount = table.settings.maxPlayers;

  const viewerSeat = you?.seat ?? -1;
  const seatedBySeat = useMemo(() => {
    const map = new Map<number, PublicPlayer>();
    for (const player of table.players) map.set(player.seat, player);
    return map;
  }, [table.players]);

  const slots = useMemo(() => {
    const list: { slot: number; seat: number; player: PublicPlayer | null }[] = [];
    for (let slot = 0; slot < seatCount; slot++) {
      const seat = (viewerSeat + slot) % seatCount;
      list.push({ slot, seat, player: seatedBySeat.get(seat) ?? null });
    }
    return list;
  }, [seatCount, viewerSeat, seatedBySeat]);

  const winners = new Map<string, number>();
  if (table.phase === "showdown" && table.lastOutcome) {
    for (const entry of table.lastOutcome.winners) winners.set(entry.playerId, entry.amount);
  }

  const outcome = table.lastOutcome;
  const showOutcome = table.phase === "showdown" && outcome !== null;
  const outcomeTitle = outcome
    ? outcome.mucked
      ? `${outcome.winners.map((w) => w.hand).join(", ")}`
      : outcome.winners
          .map((winner) => {
            const name = table.players.find((p) => p.id === winner.playerId)?.name ?? "Player";
            return `${name} wins ${chips(winner.amount)} — ${winner.hand}`;
          })
          .join("  •  ")
    : "";

  return (
    <div className="relative w-full px-2 pb-4 pt-2 sm:px-10 sm:pb-14 sm:pt-8">
      <div className="felt relative mx-auto aspect-[4/5] w-full max-w-5xl rounded-[50%] sm:aspect-[16/10]">
        {/* centre of the table */}
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center">
          <div className="flex items-center gap-2">
            <span className="chip-pill !text-[11px] uppercase tracking-widest text-gold-400">
              {STREET_LABEL[table.phase]}
            </span>
            {table.handNumber > 0 && (
              <span className="chip-pill !text-[11px] text-slate-300">Hand #{table.handNumber}</span>
            )}
          </div>

          <div className="flex items-center gap-1.5">
            {[0, 1, 2, 3, 4].map((index) => {
              const code: CardCode | undefined = table.board[index];
              return code ? (
                <PlayingCard key={code} code={code} size="md" className="animate-deal" />
              ) : (
                <div
                  key={`empty-${index}`}
                  className="h-16 w-11 rounded-lg border border-white/10 bg-black/20"
                />
              );
            })}
          </div>

          <div className="rounded-full bg-black/45 px-4 py-1.5 text-sm font-bold text-gold-400 shadow-lg">
            Pot {chips(table.pot)}
            {table.currentBet > 0 && (
              <span className="ml-2 text-[11px] font-semibold text-slate-300">
                bet {chips(table.currentBet)}
              </span>
            )}
          </div>

          {!showOutcome && !table.handActive && !snapshot.started && (
            <p className="max-w-xs text-xs text-slate-200/80">
              Waiting for the host to deal the first hand.
            </p>
          )}

          {showOutcome && (
            <div className="animate-pop rounded-xl border border-emerald-400/40 bg-black/60 px-4 py-2">
              <p className="text-sm font-bold text-emerald-300">{outcomeTitle}</p>
              {outcome && !outcome.mucked && (
                <div className="mt-2 flex flex-wrap justify-center gap-2">
                  {Object.entries(outcome.shown).map(([playerId, cards]) => (
                    <div key={playerId} className="flex flex-col items-center gap-0.5">
                      <div className="flex gap-0.5">
                        {cards.map((code) => (
                          <PlayingCard key={code} code={code} size="sm" />
                        ))}
                      </div>
                      <span className="text-[10px] text-slate-300">
                        {table.players.find((p) => p.id === playerId)?.name}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* seats */}
        {slots.map(({ slot, seat, player }) => {
          const { left, top } = seatPosition(slot, seatCount);
          const isYou = you !== null && player?.id === you.playerId;
          const holeCards =
            player === null
              ? []
              : isYou
                ? you?.holeCards ?? []
                : player.holeCards ?? [];
          return (
            <div
              key={seat}
              className="absolute z-10 -translate-x-1/2 -translate-y-1/2"
              style={{ left: `${left}%`, top: `${top}%` }}
            >
              <Seat
                player={player}
                isYou={isYou}
                isDealer={table.dealerSeat === seat && table.handActive}
                isTurn={table.toActId !== null && player?.id === table.toActId}
                holeCards={holeCards}
                secondsLeft={player ? secondsLeft(player.id) : undefined}
                turnSeconds={table.turnSeconds}
                winnerAmount={player ? winners.get(player.id) ?? null : null}
                onSit={!you ? () => onSit(seat) : undefined}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
