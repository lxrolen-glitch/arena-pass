export type Suit = "s" | "h" | "d" | "c";

/** Card codes are two characters: rank + suit, e.g. "As", "Td", "2c". */
export type CardCode = string;

export const SUITS: Suit[] = ["s", "h", "d", "c"];

export const SUIT_GLYPH: Record<Suit, string> = {
  s: "\u2660",
  h: "\u2665",
  d: "\u2666",
  c: "\u2663",
};

export const SUIT_NAME: Record<Suit, string> = {
  s: "Spades",
  h: "Hearts",
  d: "Diamonds",
  c: "Clubs",
};

const RANK_CHARS: Record<number, string> = {
  2: "2",
  3: "3",
  4: "4",
  5: "5",
  6: "6",
  7: "7",
  8: "8",
  9: "9",
  10: "T",
  11: "J",
  12: "Q",
  13: "K",
  14: "A",
};

const RANK_NAMES: Record<number, string> = {
  2: "Two",
  3: "Three",
  4: "Four",
  5: "Five",
  6: "Six",
  7: "Seven",
  8: "Eight",
  9: "Nine",
  10: "Ten",
  11: "Jack",
  12: "Queen",
  13: "King",
  14: "Ace",
};

/** Rank of a card code, 2..14 (ace high). */
export function rankOf(code: CardCode): number {
  const char = code[0]?.toUpperCase();
  switch (char) {
    case "T":
      return 10;
    case "J":
      return 11;
    case "Q":
      return 12;
    case "K":
      return 13;
    case "A":
      return 14;
    default: {
      const parsed = Number.parseInt(char ?? "", 10);
      if (Number.isNaN(parsed) || parsed < 2 || parsed > 9) {
        throw new Error(`Invalid card code: ${code}`);
      }
      return parsed;
    }
  }
}

export function suitOf(code: CardCode): Suit {
  const suit = code[1]?.toLowerCase() as Suit;
  if (!SUITS.includes(suit)) {
    throw new Error(`Invalid card code: ${code}`);
  }
  return suit;
}

export function cardCode(rank: number, suit: Suit): CardCode {
  return `${RANK_CHARS[rank]}${suit}`;
}

export function rankLabel(rank: number): string {
  return RANK_CHARS[rank] ?? String(rank);
}

export function rankName(rank: number): string {
  return RANK_NAMES[rank] ?? String(rank);
}

export function isRed(code: CardCode): boolean {
  const suit = suitOf(code);
  return suit === "h" || suit === "d";
}

/** Full 52 card deck in canonical order. */
export function makeDeck(): CardCode[] {
  const deck: CardCode[] = [];
  for (const suit of SUITS) {
    for (let rank = 2; rank <= 14; rank++) {
      deck.push(cardCode(rank, suit));
    }
  }
  return deck;
}

/** In-place Fisher-Yates shuffle. Pass `random` for deterministic tests. */
export function shuffle<T>(items: T[], random: () => number = Math.random): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

/** All `size`-card combinations of `cards`. */
export function combinations<T>(cards: T[], size: number): T[][] {
  const out: T[][] = [];
  const combo: T[] = [];
  const walk = (start: number) => {
    if (combo.length === size) {
      out.push([...combo]);
      return;
    }
    for (let i = start; i < cards.length; i++) {
      combo.push(cards[i]);
      walk(i + 1);
      combo.pop();
    }
  };
  walk(0);
  return out;
}
