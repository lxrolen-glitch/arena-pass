export interface PotInput {
  playerId: string;
  /** Total chips this player has committed during the current hand. */
  amount: number;
  /** Players who folded are not eligible to win the chips they put in. */
  eligible: boolean;
}

export interface Pot {
  amount: number;
  /** Player ids that may win this pot. */
  eligible: string[];
  /** "Main Pot" / "Side Pot 1" ... */
  label: string;
}

/**
 * Split total contributions into a main pot plus one side pot per distinct
 * all-in level. Folded players' chips stay in the pots but they cannot win them.
 */
export function computePots(inputs: PotInput[]): Pot[] {
  const contributions = inputs
    .filter((input) => input.amount > 0)
    .map((input) => ({ ...input }))
    .sort((a, b) => a.amount - b.amount);

  const pots: Pot[] = [];
  let previousLevel = 0;

  const levels = [...new Set(contributions.map((c) => c.amount))].sort((a, b) => a - b);

  for (const level of levels) {
    const slice = level - previousLevel;
    if (slice <= 0) continue;

    let amount = 0;
    const eligible: string[] = [];
    for (const contribution of contributions) {
      if (contribution.amount >= level) {
        amount += slice;
        if (contribution.eligible) eligible.push(contribution.playerId);
      } else if (contribution.amount > previousLevel) {
        // This player has chips inside this band but not enough to be eligible.
        amount += contribution.amount - previousLevel;
      }
    }

    if (amount > 0) {
      const existing = pots[pots.length - 1];
      const sameEligibility =
        existing &&
        existing.eligible.length === eligible.length &&
        existing.eligible.every((id, index) => id === eligible[index]);
      if (sameEligibility && existing) {
        existing.amount += amount;
      } else {
        pots.push({ amount, eligible, label: "" });
      }
    }
    previousLevel = level;
  }

  pots.forEach((pot, index) => {
    pot.label = index === 0 ? "Main Pot" : `Side Pot ${index}`;
  });

  return pots;
}
