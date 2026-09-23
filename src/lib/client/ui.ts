"use client";

import { useEffect, useState } from "react";

/** Seat coordinates around the felt. Index 0 is the viewer's own seat (bottom centre). */
export function seatPosition(index: number, total: number): { left: number; top: number } {
  const angle = (2 * Math.PI * index) / total;
  return {
    left: 50 + 47 * Math.sin(angle),
    top: 50 + 45 * Math.cos(angle),
  };
}

export function useCopy(): [boolean, (value: string) => void] {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const id = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(id);
  }, [copied]);

  const copy = (value: string) => {
    void navigator.clipboard?.writeText(value).then(
      () => setCopied(true),
      () => setCopied(false),
    );
  };

  return [copied, copy];
}

export function chips(value: number): string {
  return value.toLocaleString("en-US");
}
