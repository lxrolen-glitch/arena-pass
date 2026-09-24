const NAME_KEY = "poker:name";

export function seatKey(code: string): string {
  return `poker:seat:${code}`;
}

export function readName(): string {
  if (typeof window === "undefined") return "";
  try {
    return window.localStorage.getItem(NAME_KEY) ?? "";
  } catch {
    return "";
  }
}

export function writeName(name: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(NAME_KEY, name);
  } catch {
    /* storage disabled */
  }
}

export function readSeat(code: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(seatKey(code));
  } catch {
    return null;
  }
}

export function writeSeat(code: string, playerId: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(seatKey(code), playerId);
  } catch {
    /* storage disabled */
  }
}

export function clearSeat(code: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(seatKey(code));
  } catch {
    /* storage disabled */
  }
}
