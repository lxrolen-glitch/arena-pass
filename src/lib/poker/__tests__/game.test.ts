import { beforeEach, describe, expect, it } from "vitest";

import { getActionOptions, PokerTable } from "../game";

/** Deterministic PRNG so shuffles are repeatable. */
function makeRandom(seed = 7): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

function makeTable(names: string[], overrides: Record<string, unknown> = {}) {
  const table = new PokerTable(
    {
      smallBlind: 10,
      bigBlind: 20,
      startingChips: 1000,
      maxPlayers: 6,
      turnSeconds: 30,
      ...overrides,
    },
    makeRandom(11),
  );
  const ids = names.map((name, index) => {
    const id = `p${index}`;
    const result = table.sitDown(id, name);
    if (!result.ok) throw new Error(`could not seat ${name}: ${result.error}`);
    return id;
  });
  return { table, ids };
}

/** Put the button on `seat` for the next hand. */
function setDealer(table: PokerTable, seat: number): void {
  table.dealerSeat = (seat - 1 + table.seats.length) % table.seats.length;
}

/** Act on behalf of whoever the engine says is next. */
function act(table: PokerTable, action: Parameters<PokerTable["act"]>[1], amount?: number): string {
  const id = table.toActId;
  if (!id) throw new Error("no player to act");
  const result = table.act(id, action, amount);
  if (!result.ok) throw new Error(`action ${action} rejected: ${result.error}`);
  return id;
}

function checkThrough(table: PokerTable, players: number): void {
  for (let i = 0; i < players; i++) act(table, "check");
}

describe("PokerTable hand setup", () => {
  it("refuses to start without two ready players", () => {
    const { table } = makeTable(["Solo"]);
    expect(table.startHand().ok).toBe(false);
    expect(table.handActive).toBe(false);
  });

  it("posts blinds and opens the action with the player left of the big blind", () => {
    const { table, ids } = makeTable(["A", "B", "C"]);
    setDealer(table, 0);
    expect(table.startHand().ok).toBe(true);

    expect(table.dealerSeat).toBe(0);
    expect(table.getPlayer(ids[0])!.bet).toBe(0);
    expect(table.getPlayer(ids[1])!.bet).toBe(10); // small blind
    expect(table.getPlayer(ids[2])!.bet).toBe(20); // big blind
    expect(table.currentBet).toBe(20);
    expect(table.toActId).toBe(ids[0]);
    expect(table.phase).toBe("preflop");
    expect(table.pot).toBe(30);
    for (const id of ids) expect(table.getPlayer(id)!.holeCards).toHaveLength(2);
    expect(table.deck).toHaveLength(46);
  });

  it("makes the button the small blind and first to act heads-up", () => {
    const { table, ids } = makeTable(["A", "B"]);
    setDealer(table, 0);
    table.startHand();

    expect(table.getPlayer(ids[0])!.bet).toBe(10);
    expect(table.getPlayer(ids[1])!.bet).toBe(20);
    expect(table.toActId).toBe(ids[0]);
  });

  it("deals unique cards", () => {
    const { table, ids } = makeTable(["A", "B", "C"]);
    table.startHand();
    const dealt = ids.flatMap((id) => table.getPlayer(id)!.holeCards);
    expect(new Set(dealt).size).toBe(dealt.length);
  });

  it("skips players who are sitting out or out of chips", () => {
    const { table, ids } = makeTable(["A", "B", "C"]);
    table.setSittingOut(ids[1], true);
    table.startHand();
    expect(table.getPlayer(ids[1])!.inHand).toBe(false);
    expect(table.getPlayer(ids[0])!.inHand).toBe(true);
    expect(table.getPlayer(ids[2])!.inHand).toBe(true);
  });
});

describe("PokerTable betting", () => {
  let table: PokerTable;
  let ids: string[];

  beforeEach(() => {
    ({ table, ids } = makeTable(["A", "B", "C"]));
    setDealer(table, 0);
    table.startHand();
  });

  it("rejects an action from the wrong player", () => {
    expect(table.act(ids[1], "call").ok).toBe(false);
  });

  it("rejects a raise smaller than the minimum", () => {
    expect(table.act(ids[0], "raise", 30).ok).toBe(false);
    expect(table.act(ids[0], "raise", 40).ok).toBe(true);
    expect(table.currentBet).toBe(40);
    expect(table.minRaise).toBe(20);
  });

  it("rejects a check when facing a bet", () => {
    expect(table.act(ids[0], "check").ok).toBe(false);
  });

  it("reopens the action after a full raise", () => {
    act(table, "raise", 60); // A
    act(table, "raise", 150); // B re-raises
    expect(table.currentBet).toBe(150);
    expect(table.minRaise).toBe(90);
    expect(table.toActId).toBe(ids[2]); // C must still respond
    act(table, "call");
    expect(table.toActId).toBe(ids[0]); // A gets another chance
  });

  it("does not reopen betting after a short all-in", () => {
    const { table: t2, ids: other } = makeTable(["A", "B", "C"]);
    t2.getPlayer(other[2])!.chips = 30;
    setDealer(t2, 0);
    t2.startHand();

    act(t2, "call"); // A calls 20
    act(t2, "call"); // B calls 20
    // C shoves the remaining 10 on top of the big blind: a short raise.
    act(t2, "all-in");
    expect(t2.currentBet).toBe(30);
    expect(t2.getPlayer(other[2])!.allIn).toBe(true);

    expect(t2.toActId).toBe(other[0]);
    expect(t2.act(other[0], "raise", 60).ok).toBe(false);
    act(t2, "call");
    expect(t2.act(other[1], "raise", 60).ok).toBe(false);
    act(t2, "call");
    expect(t2.phase).toBe("flop");
  });

  it("folds on the clock and checks when there is nothing to call", () => {
    table.autoAct(ids[0]);
    expect(table.getPlayer(ids[0])!.folded).toBe(true);
    expect(table.toActId).toBe(ids[1]);

    table.autoAct(ids[1]); // small blind folds too
    expect(table.handActive).toBe(false);
    expect(table.lastOutcome?.winners[0].playerId).toBe(ids[2]);
  });
});

describe("PokerTable showdown", () => {
  it("awards the whole pot when everyone folds", () => {
    const { table, ids } = makeTable(["A", "B", "C"]);
    setDealer(table, 0);
    table.startHand();

    act(table, "fold");
    act(table, "fold");

    expect(table.handActive).toBe(false);
    expect(table.lastOutcome?.mucked).toBe(true);
    expect(table.lastOutcome?.winners).toEqual([
      { playerId: ids[2], amount: 30, hand: "wins unopposed" },
    ]);
    expect(table.getPlayer(ids[2])!.chips).toBe(1010);
  });

  it("plays all four streets and pays the best hand", () => {
    const { table, ids } = makeTable(["A", "B", "C"]);
    setDealer(table, 0);
    table.startHand();

    table.getPlayer(ids[0])!.holeCards = ["As", "Ah"];
    table.getPlayer(ids[1])!.holeCards = ["2c", "3d"];
    table.getPlayer(ids[2])!.holeCards = ["7h", "8s"];
    // The deck is dealt from the end, so list it river-first.
    table.deck = ["2s", "4h", "9s", "Kc", "Ad"];

    act(table, "call"); // A
    act(table, "call"); // B
    act(table, "check"); // C (big blind option)
    expect(table.phase).toBe("flop");
    expect(table.board).toEqual(["Ad", "Kc", "9s"]);

    checkThrough(table, 3);
    expect(table.phase).toBe("turn");
    checkThrough(table, 3);
    expect(table.phase).toBe("river");
    checkThrough(table, 3);

    expect(table.phase).toBe("showdown");
    expect(table.board).toEqual(["Ad", "Kc", "9s", "4h", "2s"]);
    expect(table.lastOutcome?.winners).toEqual([
      { playerId: ids[0], amount: 60, hand: "Three of a Kind, Aces" },
    ]);
    expect(table.getPlayer(ids[0])!.chips).toBe(1040);
    expect(table.getPlayer(ids[1])!.chips).toBe(980);
    expect(table.getPlayer(ids[2])!.chips).toBe(980);
  });

  it("splits the pot on an exact tie", () => {
    const { table, ids } = makeTable(["A", "B"]);
    setDealer(table, 0);
    table.startHand();

    table.getPlayer(ids[0])!.holeCards = ["Td", "2c"];
    table.getPlayer(ids[1])!.holeCards = ["Th", "3d"];
    table.deck = ["9s", "Jh", "Qc", "Kd", "As"]; // board plays: everyone has the broadway

    act(table, "call"); // button
    act(table, "check"); // big blind
    checkThrough(table, 2);
    checkThrough(table, 2);
    checkThrough(table, 2);

    expect(table.phase).toBe("showdown");
    expect(table.lastOutcome?.winners).toHaveLength(2);
    expect(table.lastOutcome?.winners.map((entry) => entry.amount)).toEqual([20, 20]);
    expect(table.getPlayer(ids[0])!.chips).toBe(1000);
    expect(table.getPlayer(ids[1])!.chips).toBe(1000);
  });

  it("pays the main pot to a short all-in and the side pot to the deep stack", () => {
    const { table, ids } = makeTable(["A", "B", "C"]);
    table.getPlayer(ids[0])!.chips = 100;
    setDealer(table, 0);
    table.startHand();

    table.getPlayer(ids[0])!.holeCards = ["As", "Ah"];
    table.getPlayer(ids[1])!.holeCards = ["Kd", "Ks"];
    table.getPlayer(ids[2])!.holeCards = ["7h", "8s"];
    table.deck = ["2s", "4h", "9s", "Kc", "Ad"];

    act(table, "raise", 100); // A shoves
    act(table, "call"); // B
    act(table, "raise", 300); // C
    act(table, "call"); // B
    expect(table.pot).toBe(700);
    expect(table.phase).toBe("flop");

    checkThrough(table, 2);
    checkThrough(table, 2);
    checkThrough(table, 2);

    expect(table.phase).toBe("showdown");
    expect(table.lastOutcome?.pots.map((pot) => pot.amount)).toEqual([300, 400]);
    expect(table.lastOutcome?.pots[0].winners).toEqual([ids[0]]);
    expect(table.lastOutcome?.pots[1].winners).toEqual([ids[1]]);
    expect(table.getPlayer(ids[0])!.chips).toBe(300);
    expect(table.getPlayer(ids[1])!.chips).toBe(1100);
    expect(table.getPlayer(ids[2])!.chips).toBe(700);
  });

  it("runs the board out when only one player can still act", () => {
    const { table, ids } = makeTable(["A", "B", "C"]);
    table.getPlayer(ids[1])!.chips = 50;
    table.getPlayer(ids[2])!.chips = 50;
    setDealer(table, 0);
    table.startHand();
    table.getPlayer(ids[0])!.holeCards = ["As", "Ah"];
    table.getPlayer(ids[1])!.holeCards = ["2c", "3d"];
    table.getPlayer(ids[2])!.holeCards = ["7h", "8s"];
    table.deck = ["2s", "4h", "9s", "Kc", "Ad"];

    act(table, "raise", 100); // A
    act(table, "all-in"); // B is all-in for 50
    act(table, "all-in"); // C is all-in for 50
    expect(table.phase).toBe("showdown");
    expect(table.board).toHaveLength(5);
    expect(table.toActId).toBeNull();
    expect(table.lastOutcome?.winners[0].playerId).toBe(ids[0]);
  });
});

describe("PokerTable table management", () => {
  it("rebuys a busted player", () => {
    const { table, ids } = makeTable(["A", "B"]);
    table.getPlayer(ids[0])!.chips = 0;
    expect(table.rebuy(ids[0]).ok).toBe(true);
    expect(table.getPlayer(ids[0])!.chips).toBe(1000);
    expect(table.rebuy(ids[0]).ok).toBe(false);
  });

  it("seats a late joiner for the following hand only", () => {
    const { table, ids } = makeTable(["A", "B"]);
    setDealer(table, 0);
    table.startHand();

    table.sitDown("late", "Late");
    expect(table.getPlayer("late")!.inHand).toBe(false);
    expect(table.getPlayer("late")!.holeCards).toHaveLength(0);

    act(table, "fold"); // B folds, A takes it
    expect(table.startHand().ok).toBe(true);
    expect(table.getPlayer("late")!.inHand).toBe(true);
    expect(ids).toHaveLength(2);
  });

  it("folds a player who leaves mid-hand and frees the seat afterwards", () => {
    const { table, ids } = makeTable(["A", "B", "C"]);
    setDealer(table, 0);
    table.startHand();

    table.standUp(ids[0]);
    expect(table.getPlayer(ids[0])!.folded).toBe(true);
    expect(table.getPlayer(ids[0])).not.toBeNull(); // still in the pot math

    act(table, "fold"); // B folds as well
    expect(table.getPlayer(ids[0])).toBeNull();
    expect(table.lastOutcome?.winners[0].playerId).toBe(ids[2]);
  });
});

describe("getActionOptions", () => {
  it("describes what the acting player may do", () => {
    const { table, ids } = makeTable(["A", "B", "C"]);
    setDealer(table, 0);
    table.startHand();

    const mine = getActionOptions(table.publicState(), ids[0]);
    expect(mine.canAct).toBe(true);
    expect(mine.canCheck).toBe(false);
    expect(mine.canCall).toBe(true);
    expect(mine.callAmount).toBe(20);
    expect(mine.minRaiseTo).toBe(40);
    // ids[0] is the button in a 3-handed game, so nothing is in front of them yet.
    expect(mine.maxRaiseTo).toBe(1000);

    const theirs = getActionOptions(table.publicState(), ids[1]);
    expect(theirs.canAct).toBe(false);

    const spectator = getActionOptions(table.publicState(), "nobody");
    expect(spectator.canAct).toBe(false);
  });

  it("hides other players' hole cards before the showdown", () => {
    const { table, ids } = makeTable(["A", "B"]);
    setDealer(table, 0);
    table.startHand();

    const state = table.publicState();
    expect(state.players.every((player) => player.holeCards === null)).toBe(true);

    act(table, "fold");
    const after = table.publicState();
    expect(after.lastOutcome?.mucked).toBe(true);
    expect(after.players.every((player) => player.holeCards === null)).toBe(true);
    expect(ids).toHaveLength(2);
  });
});
