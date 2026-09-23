import { combinations, rankLabel, rankOf, SUIT_GLYPH, suitOf, type CardCode } from "./cards";

/** Hand categories, ordered worst -> best. */
export const HAND_CATEGORY = {
  HIGH_CARD: 0,
  PAIR: 1,
  TWO_PAIR: 2,
  THREE_OF_A_KIND: 3,
  STRAIGHT: 4,
  FLUSH: 5,
  FULL_HOUSE: 6,
  FOUR_OF_A_KIND: 7,
  STRAIGHT_FLUSH: 8,
} as const;

export const HAND_NAMES: Record<number, string> = {
  0: "High Card",
  1: "Pair",
  2: "Two Pair",
  3: "Three of a Kind",
  4: "Straight",
  5: "Flush",
  6: "Full House",
  7: "Four of a Kind",
  8: "Straight Flush",
};

export interface HandScore {
  /** Category, see HAND_CATEGORY. */
  category: number;
  /** Descending tiebreakers used to split identical categories. */
  tiebreak: number[];
  /** The five cards that make up the hand. */
  cards: CardCode[];
  name: string;
  /** Short human readable form, e.g. "Two Pair, Kings & Sevens". */
  label: string;
}

const PAIR_WORD: Record<number, string> = {
  11: "Jacks",
  12: "Queens",
  13: "Kings",
  14: "Aces",
};

function plural(rank: number): string {
  return PAIR_WORD[rank] ?? `${rankLabel(rank)}s`;
}

/** Score exactly five cards. */
export function score5(cards: CardCode[]): HandScore {
  if (cards.length !== 5) {
    throw new Error(`score5 expects 5 cards, received ${cards.length}`);
  }

  const ranks = cards.map(rankOf).sort((a, b) => b - a);
  const isFlush = cards.every((c) => suitOf(c) === suitOf(cards[0]));

  const uniqueRanks = [...new Set(ranks)].sort((a, b) => b - a);
  let straightHigh = 0;
  if (uniqueRanks.length === 5) {
    if (uniqueRanks[0] - uniqueRanks[4] === 4) {
      straightHigh = uniqueRanks[0];
    } else if (
      uniqueRanks[0] === 14 &&
      uniqueRanks[1] === 5 &&
      uniqueRanks[2] === 4 &&
      uniqueRanks[3] === 3 &&
      uniqueRanks[4] === 2
    ) {
      // The wheel: A-2-3-4-5 counts as a five-high straight.
      straightHigh = 5;
    }
  }

  const counts = new Map<number, number>();
  for (const rank of ranks) {
    counts.set(rank, (counts.get(rank) ?? 0) + 1);
  }
  // Groups ordered by count desc then rank desc.
  const groups = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);

  const finish = (category: number, tiebreak: number[]): HandScore => ({
    category,
    tiebreak,
    cards,
    name: HAND_NAMES[category],
    label: labelFor(category, tiebreak),
  });

  if (straightHigh > 0 && isFlush) return finish(HAND_CATEGORY.STRAIGHT_FLUSH, [straightHigh]);
  if (groups[0][1] === 4) {
    return finish(HAND_CATEGORY.FOUR_OF_A_KIND, [groups[0][0], groups[1][0]]);
  }
  if (groups[0][1] === 3 && groups[1][1] === 2) {
    return finish(HAND_CATEGORY.FULL_HOUSE, [groups[0][0], groups[1][0]]);
  }
  if (isFlush) return finish(HAND_CATEGORY.FLUSH, ranks);
  if (straightHigh > 0) return finish(HAND_CATEGORY.STRAIGHT, [straightHigh]);
  if (groups[0][1] === 3) {
    const kickers = groups.filter((g) => g[1] === 1).map((g) => g[0]);
    return finish(HAND_CATEGORY.THREE_OF_A_KIND, [groups[0][0], ...kickers]);
  }
  if (groups[0][1] === 2 && groups[1][1] === 2) {
    const [hi, lo] = [groups[0][0], groups[1][0]].sort((a, b) => b - a);
    return finish(HAND_CATEGORY.TWO_PAIR, [hi, lo, groups[2][0]]);
  }
  if (groups[0][1] === 2) {
    const kickers = groups.filter((g) => g[1] === 1).map((g) => g[0]);
    return finish(HAND_CATEGORY.PAIR, [groups[0][0], ...kickers]);
  }
  return finish(HAND_CATEGORY.HIGH_CARD, ranks);
}

function labelFor(category: number, tiebreak: number[]): string {
  switch (category) {
    case HAND_CATEGORY.STRAIGHT_FLUSH:
      return tiebreak[0] === 14 ? "Royal Flush" : `Straight Flush, ${rankLabel(tiebreak[0])} high`;
    case HAND_CATEGORY.FOUR_OF_A_KIND:
      return `Four of a Kind, ${plural(tiebreak[0])}`;
    case HAND_CATEGORY.FULL_HOUSE:
      return `${plural(tiebreak[0])} full of ${plural(tiebreak[1])}`;
    case HAND_CATEGORY.FLUSH:
      return `Flush, ${rankLabel(tiebreak[0])} high`;
    case HAND_CATEGORY.STRAIGHT:
      return `Straight, ${rankLabel(tiebreak[0])} high`;
    case HAND_CATEGORY.THREE_OF_A_KIND:
      return `Three of a Kind, ${plural(tiebreak[0])}`;
    case HAND_CATEGORY.TWO_PAIR:
      return `Two Pair, ${plural(tiebreak[0])} & ${plural(tiebreak[1])}`;
    case HAND_CATEGORY.PAIR:
      return `Pair of ${plural(tiebreak[0])}`;
    default:
      return `${rankLabel(tiebreak[0])} high`;
  }
}

/** Best five-card hand from any 5, 6 or 7 cards. */
export function bestHand(cards: CardCode[]): HandScore {
  if (cards.length < 5) {
    throw new Error(`bestHand needs at least 5 cards, received ${cards.length}`);
  }
  if (cards.length === 5) return score5(cards);
  let best: HandScore | null = null;
  for (const combo of combinations(cards, 5)) {
    const score = score5(combo);
    if (!best || compareScore(score, best) > 0) best = score;
  }
  return best!;
}

/** Positive when `a` beats `b`, negative when it loses, 0 for an exact tie. */
export function compareScore(a: HandScore, b: HandScore): number {
  if (a.category !== b.category) return a.category - b.category;
  const length = Math.max(a.tiebreak.length, b.tiebreak.length);
  for (let i = 0; i < length; i++) {
    const left = a.tiebreak[i] ?? 0;
    const right = b.tiebreak[i] ?? 0;
    if (left !== right) return left - right;
  }
  return 0;
}

/** Pretty print cards, e.g. ["As","Kh"] -> "A\u2660 K\u2665". */
export function formatCards(cards: CardCode[]): string {
  return cards.map((c) => `${rankLabel(rankOf(c))}${SUIT_GLYPH[suitOf(c)]}`).join(" ");
}
