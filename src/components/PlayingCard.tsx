"use client";

import type { CSSProperties } from "react";

import { isRed, rankLabel, rankOf, SUIT_GLYPH, suitOf, type CardCode } from "@/lib/poker/cards";

const SIZES = {
  xs: "h-9 w-6 text-[9px] rounded-[3px]",
  sm: "h-12 w-9 text-[11px] rounded-md",
  md: "h-16 w-11 text-sm rounded-lg",
  lg: "h-24 w-16 text-xl rounded-xl",
} as const;

const GLYPH_SIZES = {
  xs: "text-[10px]",
  sm: "text-sm",
  md: "text-xl",
  lg: "text-3xl",
} as const;

export type CardSize = keyof typeof SIZES;

export function PlayingCard({
  code,
  size = "md",
  faceDown = false,
  className = "",
  style,
}: {
  code?: CardCode;
  size?: CardSize;
  faceDown?: boolean;
  className?: string;
  style?: CSSProperties;
}) {
  if (faceDown || !code) {
    return (
      <div
        style={{
          backgroundImage:
            "repeating-linear-gradient(45deg, rgba(255,255,255,0.09) 0 3px, transparent 3px 6px)",
          ...style,
        }}
        className={`${SIZES[size]} border border-white/20 bg-gradient-to-br from-slate-700 via-slate-800 to-slate-900 shadow-card ${className}`}
        aria-hidden
      />
    );
  }

  const red = isRed(code);
  return (
    <div
      style={style}
      className={`${SIZES[size]} relative flex flex-col items-center justify-center border border-slate-300 bg-white font-bold shadow-card ${className} ${
        red ? "text-rose-600" : "text-slate-900"
      }`}
      aria-label={`${rankLabel(rankOf(code))} of ${suitOf(code)}`}
    >
      <span className="absolute left-1 top-0.5 leading-none">{rankLabel(rankOf(code))}</span>
      <span className={`${GLYPH_SIZES[size]} leading-none`}>{SUIT_GLYPH[suitOf(code)]}</span>
    </div>
  );
}

export function CardRow({
  codes,
  size = "md",
  faceDown = false,
  className = "",
}: {
  codes: CardCode[];
  size?: CardSize;
  faceDown?: boolean;
  className?: string;
}) {
  const list = codes.length > 0 ? codes : [undefined, undefined];
  return (
    <div className={`flex gap-1 ${className}`}>
      {list.map((code, index) => (
        <PlayingCard
          key={`${code ?? "back"}-${index}`}
          code={code}
          size={size}
          faceDown={faceDown || !code}
          className="animate-deal"
          style={{ animationDelay: `${index * 90}ms` }}
        />
      ))}
    </div>
  );
}
