import { describe, expect, it } from "vitest";

import { bestHand, compareScore, HAND_CATEGORY, score5 } from "../evaluator";

describe("score5", () => {
  it("detects a straight flush and a royal flush", () => {
    const royal = score5(["As", "Ks", "Qs", "Js", "Ts"]);
    expect(royal.category).toBe(HAND_CATEGORY.STRAIGHT_FLUSH);
    expect(royal.label).toBe("Royal Flush");

    const wheelFlush = score5(["5h", "4h", "3h", "2h", "Ah"]);
    expect(wheelFlush.category).toBe(HAND_CATEGORY.STRAIGHT_FLUSH);
    expect(wheelFlush.tiebreak).toEqual([5]);
  });

  it("ranks a wheel below a six-high straight", () => {
    const wheel = score5(["As", "2h", "3d", "4c", "5s"]);
    const six = score5(["6s", "2h", "3d", "4c", "5s"]);
    expect(wheel.category).toBe(HAND_CATEGORY.STRAIGHT);
    expect(compareScore(six, wheel)).toBeGreaterThan(0);
  });

  it("orders categories correctly", () => {
    const quads = score5(["9s", "9h", "9d", "9c", "2s"]);
    const boat = score5(["9s", "9h", "9d", "2c", "2s"]);
    const flush = score5(["As", "Js", "8s", "5s", "2s"]);
    const straight = score5(["9s", "8h", "7d", "6c", "5s"]);
    const trips = score5(["9s", "9h", "9d", "Kc", "2s"]);
    const twoPair = score5(["9s", "9h", "Kd", "Kc", "2s"]);
    const pair = score5(["9s", "9h", "Kd", "Qc", "2s"]);
    const high = score5(["As", "Jh", "9d", "6c", "3s"]);

    const ordered = [quads, boat, flush, straight, trips, twoPair, pair, high];
    for (let i = 1; i < ordered.length; i++) {
      expect(compareScore(ordered[i - 1], ordered[i])).toBeGreaterThan(0);
    }
  });

  it("breaks ties with kickers", () => {
    const pairKingsAceKicker = score5(["Ks", "Kh", "Ad", "7c", "3s"]);
    const pairKingsQueenKicker = score5(["Kd", "Kc", "Qd", "7c", "3s"]);
    expect(compareScore(pairKingsAceKicker, pairKingsQueenKicker)).toBeGreaterThan(0);

    const twoPairSevensSix = score5(["7s", "7h", "6d", "6c", "As"]);
    const twoPairSevensFive = score5(["7d", "7c", "5d", "5c", "As"]);
    expect(compareScore(twoPairSevensSix, twoPairSevensFive)).toBeGreaterThan(0);
  });

  it("calls an exact tie", () => {
    const a = score5(["As", "Ks", "9d", "6c", "3h"]);
    const b = score5(["Ah", "Kh", "9c", "6d", "3s"]);
    expect(compareScore(a, b)).toBe(0);
  });

  it("produces a readable label", () => {
    expect(score5(["Qs", "Qh", "9d", "9c", "2s"]).label).toBe("Two Pair, Queens & 9s");
    expect(score5(["Jh", "Jd", "Jc", "4s", "2h"]).label).toBe("Three of a Kind, Jacks");
    expect(score5(["Ah", "Ad", "Ac", "As", "Kh"]).label).toBe("Four of a Kind, Aces");
  });
});

describe("bestHand", () => {
  it("picks the best five of seven", () => {
    const hand = bestHand(["As", "Ah", "Ad", "Kc", "Kd", "2s", "3h"]);
    expect(hand.category).toBe(HAND_CATEGORY.FULL_HOUSE);
    expect(hand.label).toBe("Aces full of Kings");
  });

  it("finds a flush hidden among seven cards", () => {
    const hand = bestHand(["2h", "5h", "9h", "Jh", "Kh", "As", "Td"]);
    expect(hand.category).toBe(HAND_CATEGORY.FLUSH);
    expect(hand.tiebreak[0]).toBe(13);
  });

  it("splits identical hands exactly", () => {
    const board = ["As", "Kd", "Qc", "Jh", "9s"];
    const first = bestHand(["Td", "2c", ...board]);
    const second = bestHand(["Th", "3d", ...board]);
    expect(first.category).toBe(HAND_CATEGORY.STRAIGHT);
    expect(compareScore(first, second)).toBe(0);
  });

  it("rejects fewer than five cards", () => {
    expect(() => bestHand(["As", "Ah", "Ad"])).toThrow();
  });
});
