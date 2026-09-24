"use client";

import { useEffect, useState } from "react";

import { chips } from "@/lib/client/ui";
import type { ActionOptions, PlayerAction } from "@/lib/poker/game";

export function ActionBar({
  options,
  disabled,
  onAction,
  hint,
  onRebuy,
}: {
  options: ActionOptions;
  disabled: boolean;
  onAction: (action: PlayerAction, amount?: number) => void;
  hint?: string | null;
  onRebuy?: () => void;
}) {
  const [raiseTo, setRaiseTo] = useState(options.minRaiseTo);

  useEffect(() => {
    setRaiseTo((current) =>
      Math.min(options.maxRaiseTo, Math.max(options.minRaiseTo, current || options.minRaiseTo)),
    );
  }, [options.minRaiseTo, options.maxRaiseTo]);

  const clamp = (value: number) =>
    Math.min(options.maxRaiseTo, Math.max(options.minRaiseTo, Math.round(value)));

  const quickTargets = [
    { label: "Min", value: options.minRaiseTo },
    { label: "½ pot", value: options.currentBet + (options.pot + options.toCall) / 2 },
    { label: "¾ pot", value: options.currentBet + ((options.pot + options.toCall) * 3) / 4 },
    { label: "Pot", value: options.currentBet + options.pot + options.toCall },
    { label: "All-in", value: options.maxRaiseTo },
  ];

  const active = options.canAct && !disabled;

  return (
    <div className="panel flex flex-col gap-3 p-3 sm:p-4">
      {onRebuy && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-400/30 bg-amber-500/10 px-3 py-2">
          <span className="text-sm text-amber-200">You are out of chips.</span>
          <button type="button" className="btn-primary !py-1.5 text-xs" onClick={onRebuy}>
            Rebuy
          </button>
        </div>
      )}

      {hint && !options.canAct && (
        <p className="text-center text-xs font-medium text-slate-400">{hint}</p>
      )}

      {options.canRaise && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Raise to</span>
            <span className="font-bold text-gold-400">{chips(raiseTo)}</span>
          </div>
          <input
            type="range"
            min={options.minRaiseTo}
            max={options.maxRaiseTo}
            step={Math.max(1, Math.floor(options.maxRaiseTo / 200))}
            value={Math.min(Math.max(raiseTo, options.minRaiseTo), options.maxRaiseTo)}
            disabled={!active}
            onChange={(event) => setRaiseTo(Number(event.target.value))}
            className="w-full disabled:opacity-40"
          />
          <div className="flex flex-wrap gap-1.5">
            {quickTargets.map((quick) => (
              <button
                key={quick.label}
                type="button"
                disabled={!active}
                onClick={() => setRaiseTo(clamp(quick.value))}
                className="rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-[11px] font-semibold text-slate-300 transition hover:bg-white/10 disabled:opacity-40"
              >
                {quick.label}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-3 gap-2">
        <button
          type="button"
          className="btn-danger"
          disabled={!options.canAct || disabled}
          onClick={() => onAction("fold")}
        >
          Fold
        </button>

        {options.toCall > 0 ? (
          <button
            type="button"
            className="btn-primary"
            disabled={!options.canCall || disabled}
            onClick={() => onAction("call")}
          >
            Call {chips(options.callAmount)}
          </button>
        ) : (
          <button
            type="button"
            className="btn-primary"
            disabled={!options.canCheck || disabled}
            onClick={() => onAction("check")}
          >
            Check
          </button>
        )}

        <button
          type="button"
          className="btn-success"
          disabled={!options.canRaise || disabled}
          onClick={() =>
            onAction(
              raiseTo >= options.maxRaiseTo ? "all-in" : "raise",
              Math.max(raiseTo, options.minRaiseTo),
            )
          }
        >
          {raiseTo >= options.maxRaiseTo ? "All-in" : "Raise"} {chips(raiseTo)}
        </button>
      </div>
    </div>
  );
}
