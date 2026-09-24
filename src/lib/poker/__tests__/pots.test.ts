import { describe, expect, it } from "vitest";

import { computePots } from "../pots";

describe("computePots", () => {
  it("builds a single main pot when everyone matches", () => {
    const pots = computePots([
      { playerId: "a", amount: 100, eligible: true },
      { playerId: "b", amount: 100, eligible: true },
      { playerId: "c", amount: 100, eligible: true },
    ]);
    expect(pots).toHaveLength(1);
    expect(pots[0].label).toBe("Main Pot");
    expect(pots[0].amount).toBe(300);
    expect(pots[0].eligible.sort()).toEqual(["a", "b", "c"]);
  });

  it("keeps a folded player's chips in the pot but out of the eligibility list", () => {
    const pots = computePots([
      { playerId: "a", amount: 50, eligible: false },
      { playerId: "b", amount: 100, eligible: true },
      { playerId: "c", amount: 100, eligible: true },
    ]);
    expect(pots).toHaveLength(1);
    expect(pots[0].amount).toBe(250);
    expect(pots[0].eligible.sort()).toEqual(["b", "c"]);
  });

  it("splits a main and side pot around an all-in", () => {
    const pots = computePots([
      { playerId: "short", amount: 100, eligible: true },
      { playerId: "deep1", amount: 300, eligible: true },
      { playerId: "deep2", amount: 300, eligible: true },
    ]);
    expect(pots.map((pot) => pot.amount)).toEqual([300, 400]);
    expect(pots[0].label).toBe("Main Pot");
    expect(pots[0].eligible.sort()).toEqual(["deep1", "deep2", "short"]);
    expect(pots[1].label).toBe("Side Pot 1");
    expect(pots[1].eligible.sort()).toEqual(["deep1", "deep2"]);
  });

  it("builds three pots with two all-ins of different sizes", () => {
    const pots = computePots([
      { playerId: "a", amount: 50, eligible: true },
      { playerId: "b", amount: 150, eligible: true },
      { playerId: "c", amount: 400, eligible: true },
      { playerId: "d", amount: 400, eligible: true },
    ]);
    // 4x50 main, then 3x100 and 2x250 for the two side pots.
    expect(pots.map((pot) => pot.amount)).toEqual([200, 300, 500]);
    expect(pots[0].eligible.sort()).toEqual(["a", "b", "c", "d"]);
    expect(pots[1].eligible.sort()).toEqual(["b", "c", "d"]);
    expect(pots[2].eligible.sort()).toEqual(["c", "d"]);
    const total = pots.reduce((sum, pot) => sum + pot.amount, 0);
    expect(total).toBe(1000);
  });

  it("ignores players who never put chips in", () => {
    const pots = computePots([
      { playerId: "a", amount: 0, eligible: true },
      { playerId: "b", amount: 20, eligible: true },
      { playerId: "c", amount: 20, eligible: true },
    ]);
    expect(pots).toHaveLength(1);
    expect(pots[0].amount).toBe(40);
    expect(pots[0].eligible.sort()).toEqual(["b", "c"]);
  });
});
