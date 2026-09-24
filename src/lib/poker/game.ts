import { makeDeck, shuffle, type CardCode } from "./cards";
import { bestHand, compareScore, formatCards } from "./evaluator";
import { computePots } from "./pots";

export type PlayerAction = "fold" | "check" | "call" | "raise" | "all-in";

export type Phase = "idle" | "preflop" | "flop" | "turn" | "river" | "showdown";

export const BETTING_PHASES: Phase[] = ["preflop", "flop", "turn", "river"];

export interface TableSettings {
  smallBlind: number;
  bigBlind: number;
  startingChips: number;
  maxPlayers: number;
  turnSeconds: number;
}

export const DEFAULT_SETTINGS: TableSettings = {
  smallBlind: 10,
  bigBlind: 20,
  startingChips: 1000,
  maxPlayers: 9,
  turnSeconds: 30,
};

export interface TablePlayer {
  id: string;
  name: string;
  seat: number;
  chips: number;
  holeCards: CardCode[];
  /** Chips pushed in during the current betting round (shown in front of the player). */
  bet: number;
  /** Total chips committed this hand, used for side-pot maths. */
  committed: number;
  folded: boolean;
  allIn: boolean;
  inHand: boolean;
  sittingOut: boolean;
  connected: boolean;
  isHost: boolean;
  hasActed: boolean;
  canRaise: boolean;
  lastAction: string | null;
  lastActionAt: number;
  handsPlayed: number;
  totalWon: number;
  joinedAt: number;
}

export interface LogEntry {
  id: string;
  kind: "system" | "action" | "result" | "chat";
  playerId?: string;
  name?: string;
  text: string;
  at: number;
}

export interface PotBreakdown {
  label: string;
  amount: number;
  eligible: string[];
  winners: string[];
}

export interface WinnerEntry {
  playerId: string;
  amount: number;
  hand: string;
}

export interface HandOutcome {
  handNumber: number;
  board: CardCode[];
  /** True when the hand ended because everyone folded (no cards shown). */
  mucked: boolean;
  pots: PotBreakdown[];
  winners: WinnerEntry[];
  /** Hole cards revealed at showdown, keyed by player id. */
  shown: Record<string, CardCode[]>;
  handLabels: Record<string, string>;
  at: number;
}

export interface PublicPlayer {
  id: string;
  name: string;
  seat: number;
  chips: number;
  bet: number;
  committed: number;
  folded: boolean;
  allIn: boolean;
  inHand: boolean;
  sittingOut: boolean;
  connected: boolean;
  isHost: boolean;
  lastAction: string | null;
  hasActed: boolean;
  canRaise: boolean;
  handsPlayed: number;
  totalWon: number;
  /** Only populated when the cards are public (your own seat, or showdown). */
  holeCards: CardCode[] | null;
  handLabel: string | null;
}

export interface PublicTableState {
  phase: Phase;
  board: CardCode[];
  pot: number;
  currentBet: number;
  minRaise: number;
  dealerSeat: number;
  toActId: string | null;
  turnStartedAt: number;
  turnSeconds: number;
  handNumber: number;
  handActive: boolean;
  players: PublicPlayer[];
  lastOutcome: HandOutcome | null;
  settings: TableSettings;
  log: LogEntry[];
}

export interface ActionResult {
  ok: boolean;
  error?: string;
}

const NEXT_PHASE: Record<Exclude<Phase, "idle" | "showdown">, Phase> = {
  preflop: "flop",
  flop: "turn",
  turn: "river",
  river: "showdown",
};

const STREET_NAMES: Partial<Record<Phase, string>> = {
  flop: "Flop",
  turn: "Turn",
  river: "River",
};

let logCounter = 0;

/**
 * In-memory Texas Hold'em table. No side effects besides its own state: the room
 * layer reads `publicState()` and pushes it to clients.
 */
export class PokerTable {
  settings: TableSettings;
  seats: (TablePlayer | null)[];
  deck: CardCode[] = [];
  board: CardCode[] = [];
  phase: Phase = "idle";
  dealerSeat = -1;
  toActId: string | null = null;
  turnStartedAt = 0;
  currentBet = 0;
  minRaise: number;
  handNumber = 0;
  handActive = false;
  lastOutcome: HandOutcome | null = null;
  log: LogEntry[] = [];
  revealed: string[] = [];
  private pendingRemoval = new Set<string>();
  private random: () => number;

  constructor(settings: Partial<TableSettings> = {}, random: () => number = Math.random) {
    this.settings = { ...DEFAULT_SETTINGS, ...settings };
    this.seats = Array.from({ length: this.settings.maxPlayers }, () => null);
    this.minRaise = this.settings.bigBlind;
    this.random = random;
  }

  // ---------------------------------------------------------------- players

  getPlayer(id: string): TablePlayer | null {
    for (const seat of this.seats) {
      if (seat && seat.id === id) return seat;
    }
    return null;
  }

  get players(): TablePlayer[] {
    return this.seats.filter((seat): seat is TablePlayer => seat !== null);
  }

  freeSeat(preferred?: number): number {
    if (
      preferred !== undefined &&
      preferred >= 0 &&
      preferred < this.seats.length &&
      !this.seats[preferred]
    ) {
      return preferred;
    }
    const index = this.seats.findIndex((seat) => seat === null);
    return index;
  }

  sitDown(id: string, name: string, preferredSeat?: number): ActionResult {
    if (this.getPlayer(id)) return { ok: false, error: "Already seated" };
    const seat = this.freeSeat(preferredSeat);
    if (seat < 0) return { ok: false, error: "Table is full" };
    const player: TablePlayer = {
      id,
      name,
      seat,
      chips: this.settings.startingChips,
      holeCards: [],
      bet: 0,
      committed: 0,
      folded: false,
      allIn: false,
      inHand: false,
      sittingOut: false,
      connected: true,
      isHost: false,
      hasActed: false,
      canRaise: true,
      lastAction: null,
      lastActionAt: 0,
      handsPlayed: 0,
      totalWon: 0,
      joinedAt: Date.now(),
    };
    this.seats[seat] = player;
    this.pendingRemoval.delete(id);
    this.pushLog("system", `${name} sat down`);
    return { ok: true };
  }

  /** Leave the table. Players still in a hand fold first and are removed once it ends. */
  standUp(id: string): void {
    const player = this.getPlayer(id);
    if (!player) return;

    if (this.handActive && player.inHand) {
      this.pendingRemoval.add(id);
      if (!player.folded) {
        player.folded = true;
        player.lastAction = "fold";
        player.hasActed = true;
        player.lastActionAt = Date.now();
        this.pushLog("system", `${player.name} left the table`);
        this.afterAction(player);
      }
      return;
    }

    this.removePlayer(id);
    this.pushLog("system", `${player.name} left the table`);
  }

  removePlayer(id: string): void {
    const index = this.seats.findIndex((seat) => seat?.id === id);
    if (index >= 0) this.seats[index] = null;
    this.pendingRemoval.delete(id);
    if (this.toActId === id) this.toActId = null;
  }

  setConnected(id: string, connected: boolean): void {
    const player = this.getPlayer(id);
    if (!player) return;
    player.connected = connected;
    if (!connected) {
      player.sittingOut = true;
      this.pushLog("system", `${player.name} disconnected`);
    } else {
      this.pushLog("system", `${player.name} reconnected`);
    }
  }

  setSittingOut(id: string, sittingOut: boolean): void {
    const player = this.getPlayer(id);
    if (!player) return;
    player.sittingOut = sittingOut;
    this.pushLog("system", `${player.name} ${sittingOut ? "is sitting out" : "is back"}`);
  }

  setHost(id: string): void {
    for (const player of this.players) player.isHost = player.id === id;
  }

  /** Play money: anyone busted can top back up to the starting stack. */
  rebuy(id: string): ActionResult {
    const player = this.getPlayer(id);
    if (!player) return { ok: false, error: "Not seated" };
    if (player.chips > 0) return { ok: false, error: "You still have chips" };
    player.chips = this.settings.startingChips;
    player.sittingOut = false;
    this.pushLog("system", `${player.name} rebought for ${player.chips}`);
    return { ok: true };
  }

  // ------------------------------------------------------------- hand state

  private inHandPlayers(): TablePlayer[] {
    return this.players.filter((player) => player.inHand);
  }

  private contestants(): TablePlayer[] {
    return this.inHandPlayers().filter((player) => !player.folded);
  }

  private actionablePlayers(): TablePlayer[] {
    return this.contestants().filter((player) => !player.allIn);
  }

  private seatOf(id: string): number {
    return this.getPlayer(id)?.seat ?? -1;
  }

  /** Next seat clockwise that satisfies `predicate`, wrapping around the table. */
  private nextSeat(from: number, predicate: (player: TablePlayer) => boolean, inclusive = false): number {
    const total = this.seats.length;
    const start = inclusive ? from : from + 1;
    for (let step = 0; step < total; step++) {
      const index = (start + step) % total;
      const player = this.seats[index];
      if (player && predicate(player)) return index;
    }
    return -1;
  }

  private firstToAct(fromSeat: number, inclusive = false): TablePlayer | null {
    const seat = this.nextSeat(
      fromSeat,
      (player) => player.inHand && !player.folded && !player.allIn,
      inclusive,
    );
    return seat >= 0 ? this.seats[seat] : null;
  }

  get pot(): number {
    return this.inHandPlayers().reduce((sum, player) => sum + player.committed, 0);
  }

  // ------------------------------------------------------------ dealing

  startHand(): ActionResult {
    if (this.handActive) return { ok: false, error: "A hand is already in progress" };

    for (const id of [...this.pendingRemoval]) this.removePlayer(id);
    this.pendingRemoval.clear();

    const eligible = this.players.filter(
      (player) => player.connected && !player.sittingOut && player.chips > 0,
    );
    if (eligible.length < 2) {
      return { ok: false, error: "Need at least 2 players with chips" };
    }

    this.handNumber += 1;
    this.handActive = true;
    this.board = [];
    this.lastOutcome = null;
    this.revealed = [];
    this.deck = shuffle(makeDeck(), this.random);

    for (const player of this.players) {
      player.holeCards = [];
      player.bet = 0;
      player.committed = 0;
      player.folded = false;
      player.allIn = false;
      player.inHand = false;
      player.hasActed = false;
      player.canRaise = true;
      player.lastAction = null;
    }
    for (const player of eligible) {
      player.inHand = true;
      player.handsPlayed += 1;
    }

    // Rotate the button to the next eligible seat.
    const isEligible = (player: TablePlayer) => player.inHand;
    this.dealerSeat =
      this.dealerSeat < 0
        ? eligible[Math.floor(this.random() * eligible.length)].seat
        : this.nextSeat(this.dealerSeat, isEligible);
    const dealer = this.seats[this.dealerSeat]!;

    let sbSeat: number;
    let bbSeat: number;
    const headsUp = eligible.length === 2;
    if (headsUp) {
      sbSeat = this.dealerSeat;
      bbSeat = this.nextSeat(this.dealerSeat, isEligible);
    } else {
      sbSeat = this.nextSeat(this.dealerSeat, isEligible);
      bbSeat = this.nextSeat(sbSeat, isEligible);
    }

    this.postBlind(this.seats[sbSeat]!, this.settings.smallBlind, "small blind");
    this.postBlind(this.seats[bbSeat]!, this.settings.bigBlind, "big blind");

    this.currentBet = Math.max(...eligible.map((player) => player.bet));
    this.minRaise = this.settings.bigBlind;
    this.phase = "preflop";

    this.pushLog(
      "system",
      `Hand #${this.handNumber} \u2014 ${dealer.name} is the dealer`,
    );

    for (const player of eligible) {
      player.holeCards = [this.deck.pop()!, this.deck.pop()!];
    }

    const first = this.firstToAct(headsUp ? this.dealerSeat : bbSeat, headsUp);
    if (first) {
      this.setToAct(first);
    } else {
      this.runOutBoard();
    }
    return { ok: true };
  }

  private postBlind(player: TablePlayer, amount: number, label: string): void {
    const paid = Math.min(amount, player.chips);
    player.chips -= paid;
    player.bet += paid;
    player.committed += paid;
    player.lastAction = label;
    player.lastActionAt = Date.now();
    if (player.chips === 0) player.allIn = true;
    this.pushLog("action", `posts ${label} ${paid}`, player.id);
  }

  private dealStreet(phase: Phase): void {
    const count = phase === "flop" ? 3 : 1;
    for (let i = 0; i < count; i++) this.board.push(this.deck.pop()!);
    this.pushLog("system", `${STREET_NAMES[phase]}: ${formatCards(this.board.slice(-count))}`);
  }

  private setToAct(player: TablePlayer | null): void {
    this.toActId = player?.id ?? null;
    this.turnStartedAt = player ? Date.now() : 0;
  }

  // ------------------------------------------------------------- actions

  act(playerId: string, action: PlayerAction, amount?: number): ActionResult {
    if (!this.handActive) return { ok: false, error: "No hand in progress" };
    const player = this.getPlayer(playerId);
    if (!player || !player.inHand) return { ok: false, error: "You are not in this hand" };
    if (this.toActId !== player.id) return { ok: false, error: "It is not your turn" };
    if (player.folded) return { ok: false, error: "You already folded" };
    if (player.allIn) return { ok: false, error: "You are all-in" };

    const toCall = Math.max(0, this.currentBet - player.bet);

    if (action === "fold") {
      player.folded = true;
      player.hasActed = true;
      player.lastAction = "fold";
      player.lastActionAt = Date.now();
      this.pushLog("action", "folds", player.id);
      this.afterAction(player);
      return { ok: true };
    }

    if (action === "check") {
      if (toCall > 0) return { ok: false, error: "There is a bet to call" };
      player.hasActed = true;
      player.lastAction = "check";
      player.lastActionAt = Date.now();
      this.pushLog("action", "checks", player.id);
      this.afterAction(player);
      return { ok: true };
    }

    if (action === "call") {
      const paid = Math.min(toCall, player.chips);
      player.chips -= paid;
      player.bet += paid;
      player.committed += paid;
      player.hasActed = true;
      player.allIn = player.chips === 0;
      player.lastAction = player.allIn ? "all-in" : paid === 0 ? "check" : `call ${paid}`;
      player.lastActionAt = Date.now();
      this.pushLog("action", player.lastAction, player.id);
      this.afterAction(player);
      return { ok: true };
    }

    // raise / all-in
    const maxTarget = player.bet + player.chips;
    const target =
      action === "all-in" ? maxTarget : Math.floor(amount ?? Number.NaN);
    if (!Number.isFinite(target)) return { ok: false, error: "Invalid raise amount" };
    if (target > maxTarget) return { ok: false, error: "You do not have that many chips" };
    if (target <= this.currentBet) {
      // Not actually a raise: treat it as a call.
      return this.act(playerId, "call");
    }
    const fullRaiseTo = this.currentBet + this.minRaise;
    if (target < fullRaiseTo && target < maxTarget) {
      return { ok: false, error: `Raise must be at least ${fullRaiseTo}` };
    }
    if (!player.canRaise && this.currentBet > 0) {
      return { ok: false, error: "Betting is not reopened for you, call or fold" };
    }
    return this.applyRaise(player, target);
  }

  private applyRaise(player: TablePlayer, target: number): ActionResult {
    const paid = target - player.bet;
    const increment = target - this.currentBet;
    player.chips -= paid;
    player.bet = target;
    player.committed += paid;
    player.hasActed = true;
    player.allIn = player.chips === 0;
    player.lastActionAt = Date.now();

    const isFullRaise = increment >= this.minRaise;
    if (isFullRaise) {
      this.minRaise = increment;
      this.currentBet = target;
      player.lastAction = `raise to ${target}`;
      // A full raise reopens the action for everyone who has already acted.
      for (const other of this.contestants()) {
        if (other.id === player.id || other.allIn) continue;
        other.hasActed = false;
        other.canRaise = true;
      }
    } else {
      // Short all-in: it may be called but does not reopen betting.
      this.currentBet = Math.max(this.currentBet, target);
      player.lastAction = `all-in ${target}`;
      for (const other of this.contestants()) {
        if (other.id === player.id || other.allIn) continue;
        if (other.bet < this.currentBet) {
          other.hasActed = false;
          other.canRaise = false;
        }
      }
    }

    this.pushLog("action", player.lastAction, player.id);
    this.afterAction(player);
    return { ok: true };
  }

  /** Called by the room when the action clock runs out. */
  autoAct(playerId: string): void {
    const player = this.getPlayer(playerId);
    if (!player || this.toActId !== playerId) return;
    const toCall = Math.max(0, this.currentBet - player.bet);
    if (toCall === 0) {
      this.act(playerId, "check");
    } else {
      this.pushLog("system", `${player.name} ran out of time`);
      this.act(playerId, "fold");
    }
  }

  private afterAction(player: TablePlayer): void {
    const contenders = this.contestants();
    if (contenders.length <= 1) {
      this.finishHand(true);
      return;
    }
    if (this.isRoundOver()) {
      this.nextStreet();
      return;
    }
    const next = this.firstToAct(player.seat);
    this.setToAct(next);
  }

  private isRoundOver(): boolean {
    const actionable = this.actionablePlayers();
    if (actionable.length === 0) return true;
    return actionable.every((player) => player.hasActed && player.bet === this.currentBet);
  }

  private nextStreet(): void {
    for (const player of this.inHandPlayers()) {
      player.bet = 0;
      player.hasActed = false;
      player.canRaise = true;
    }
    this.currentBet = 0;
    this.minRaise = this.settings.bigBlind;

    const phase = NEXT_PHASE[this.phase as keyof typeof NEXT_PHASE];
    if (phase === "showdown") {
      this.finishHand(false);
      return;
    }
    this.beginStreet(phase);
  }

  private beginStreet(phase: Phase): void {
    this.phase = phase;
    this.dealStreet(phase);

    const actionable = this.actionablePlayers();
    if (actionable.length > 1) {
      this.setToAct(this.firstToAct(this.dealerSeat));
      return;
    }
    // Everyone but (at most) one player is all-in: run the board out.
    this.runOutBoard();
  }

  private runOutBoard(): void {
    this.setToAct(null);
    while (this.phase !== "showdown" && this.handActive) {
      const phase = NEXT_PHASE[this.phase as keyof typeof NEXT_PHASE];
      this.phase = phase;
      if (phase === "showdown") {
        this.finishHand(false);
        return;
      }
      this.dealStreet(phase);
    }
  }

  // ----------------------------------------------------------- settlement

  finishHand(mucked: boolean): void {
    const inHand = this.inHandPlayers();
    const contenders = inHand.filter((player) => !player.folded);

    const pots = computePots(
      inHand.map((player) => ({
        playerId: player.id,
        amount: player.committed,
        eligible: !player.folded,
      })),
    );

    const winners: WinnerEntry[] = [];
    const potBreakdowns: PotBreakdown[] = [];
    const handLabels: Record<string, string> = {};
    const shown: Record<string, CardCode[]> = {};

    if (!mucked) {
      for (const player of contenders) {
        if (player.holeCards.length === 2) {
          shown[player.id] = player.holeCards;
          handLabels[player.id] = bestHand([...player.holeCards, ...this.board]).label;
        }
      }
      this.revealed = Object.keys(shown);
    }

    const eligibleIds = new Set(contenders.map((player) => player.id));

    for (const pot of pots) {
      const potEligible = pot.eligible.filter((id) => eligibleIds.has(id));
      const eligiblePlayers = potEligible
        .map((id) => this.getPlayer(id))
        .filter((player): player is TablePlayer => player !== null);

      let takeAll: TablePlayer[] = [];
      if (mucked) {
        takeAll = contenders;
      } else if (eligiblePlayers.length > 0) {
        const scores = new Map(
          eligiblePlayers.map((player) => [
            player.id,
            bestHand([...player.holeCards, ...this.board]),
          ]),
        );
        let bestScore = null as ReturnType<typeof bestHand> | null;
        for (const score of scores.values()) {
          if (!bestScore || compareScore(score, bestScore) > 0) bestScore = score;
        }
        takeAll = eligiblePlayers.filter((player) => {
          const score = scores.get(player.id);
          return score !== undefined && bestScore !== null && compareScore(score, bestScore) === 0;
        });
      }

      if (takeAll.length === 0) {
        // Nobody eligible (edge case): hand the chips to the first contender.
        takeAll = contenders;
      }

      const share = Math.floor(pot.amount / takeAll.length);
      let remainder = pot.amount - share * takeAll.length;

      // Odd chips go clockwise from the button.
      const ordered = [...takeAll].sort((a, b) => {
        const distanceA = (a.seat - this.dealerSeat + this.seats.length) % this.seats.length;
        const distanceB = (b.seat - this.dealerSeat + this.seats.length) % this.seats.length;
        return distanceA - distanceB;
      });

      for (const player of ordered) {
        const won = share + (remainder > 0 ? 1 : 0);
        if (remainder > 0) remainder -= 1;
        player.chips += won;
        player.totalWon += won;
        const existing = winners.find((entry) => entry.playerId === player.id);
        if (existing) {
          existing.amount += won;
        } else {
          winners.push({
            playerId: player.id,
            amount: won,
            hand: mucked ? "wins unopposed" : handLabels[player.id] ?? "best hand",
          });
        }
      }

      potBreakdowns.push({
        label: pot.label,
        amount: pot.amount,
        eligible: potEligible.length > 0 ? potEligible : pot.eligible,
        winners: ordered.map((player) => player.id),
      });
    }

    for (const player of inHand) {
      player.inHand = false;
      player.hasActed = false;
      player.canRaise = true;
    }

    this.lastOutcome = {
      handNumber: this.handNumber,
      board: [...this.board],
      mucked,
      pots: potBreakdowns,
      winners,
      shown,
      handLabels,
      at: Date.now(),
    };

    for (const entry of winners) {
      const player = this.getPlayer(entry.playerId);
      this.pushLog(
        "result",
        `${player?.name ?? entry.playerId} wins ${entry.amount} (${entry.hand})`,
        entry.playerId,
      );
    }
    if (winners.length === 0) {
      this.pushLog("result", "Hand over \u2014 nobody collected the pot");
    }

    this.handActive = false;
    this.phase = "showdown";
    this.setToAct(null);

    for (const id of [...this.pendingRemoval]) this.removePlayer(id);
    this.pendingRemoval.clear();

    // Anyone who is busted or away does not get dealt into the next hand.
    for (const player of this.players) {
      if (player.chips === 0) player.sittingOut = true;
    }
  }

  // -------------------------------------------------------------- output

  publicState(): PublicTableState {
    const outcome = this.lastOutcome;
    const showAll = outcome !== null && !outcome.mucked;
    const revealedSet = new Set(this.revealed);

    return {
      phase: this.phase,
      board: [...this.board],
      pot: this.pot,
      currentBet: this.currentBet,
      minRaise: this.minRaise,
      dealerSeat: this.dealerSeat,
      toActId: this.toActId,
      turnStartedAt: this.turnStartedAt,
      turnSeconds: this.settings.turnSeconds,
      handNumber: this.handNumber,
      handActive: this.handActive,
      settings: { ...this.settings },
      log: [...this.log].slice(-80),
      lastOutcome: outcome,
      players: this.players.map((player) => {
        const visible = player.holeCards.length > 0 && showAll && revealedSet.has(player.id);
        return {
          id: player.id,
          name: player.name,
          seat: player.seat,
          chips: player.chips,
          bet: player.bet,
          committed: player.committed,
          folded: player.folded,
          allIn: player.allIn,
          inHand: player.inHand,
          sittingOut: player.sittingOut,
          connected: player.connected,
          isHost: player.isHost,
          lastAction: player.lastAction,
          hasActed: player.hasActed,
          canRaise: player.canRaise,
          handsPlayed: player.handsPlayed,
          totalWon: player.totalWon,
          holeCards: visible ? [...player.holeCards] : null,
          handLabel: visible ? this.lastOutcome?.handLabels[player.id] ?? null : null,
        };
      }),
    };
  }

  pushLog(kind: LogEntry["kind"], text: string, playerId?: string): void {
    const player = playerId ? this.getPlayer(playerId) : null;
    logCounter += 1;
    this.log.push({
      id: `log-${Date.now()}-${logCounter}`,
      kind,
      playerId,
      name: player?.name,
      text,
      at: Date.now(),
    });
    if (this.log.length > 120) this.log.splice(0, this.log.length - 120);
  }
}

/** What the acting player is allowed to do, shared by the server and the UI. */
export interface ActionOptions {
  canAct: boolean;
  canFold: boolean;
  canCheck: boolean;
  canCall: boolean;
  canRaise: boolean;
  toCall: number;
  callAmount: number;
  currentBet: number;
  minRaiseTo: number;
  maxRaiseTo: number;
  pot: number;
}

export function getActionOptions(state: PublicTableState, playerId: string | null): ActionOptions {
  const empty: ActionOptions = {
    canAct: false,
    canFold: false,
    canCheck: false,
    canCall: false,
    canRaise: false,
    toCall: 0,
    callAmount: 0,
    currentBet: state.currentBet,
    minRaiseTo: 0,
    maxRaiseTo: 0,
    pot: state.pot,
  };
  if (!playerId) return empty;
  const player = state.players.find((entry) => entry.id === playerId);
  if (!player) return empty;

  const canAct =
    state.handActive &&
    state.toActId === playerId &&
    player.inHand &&
    !player.folded &&
    !player.allIn;

  const toCall = Math.max(0, state.currentBet - player.bet);
  const callAmount = Math.min(toCall, player.chips);
  const maxRaiseTo = player.bet + player.chips;
  const fullRaiseTo = state.currentBet + state.minRaise;
  const minRaiseTo = Math.min(fullRaiseTo, maxRaiseTo);
  const canRaise =
    canAct && player.canRaise && maxRaiseTo > state.currentBet && maxRaiseTo > minRaiseTo - 1;

  return {
    canAct,
    canFold: canAct && toCall > 0,
    canCheck: canAct && toCall === 0,
    canCall: canAct && toCall > 0 && player.chips > 0,
    canRaise,
    toCall,
    callAmount,
    currentBet: state.currentBet,
    minRaiseTo,
    maxRaiseTo,
    pot: state.pot,
  };
}
