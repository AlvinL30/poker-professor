import type { Card, PlayerAction, BettingRound, PersonalityType } from "./poker.js";

/** What a player knows about a specific opponent from observation */
export interface OpponentRead {
  playerId: number;
  playerName: string;
  handsObserved: number;
  /** How often they voluntarily put money in preflop (0-1) */
  vpip: number;
  vpipHands: number; // numerator
  /** How often they bet/raise vs check/call postflop (0-1) */
  aggressionFreq: number;
  aggressionBets: number;  // bets + raises
  aggressionPassive: number; // checks + calls
  /** Hands they revealed at showdown */
  showdowns: { handNumber: number; cards: Card[]; wasBluff: boolean }[];
  /** How many times they folded to a bet */
  foldToBetCount: number;
  foldToBetOpportunities: number;
  /** Last notable action */
  lastNotableAction?: string;
}

/** A player's internal state — what they know, feel, and remember */
export interface PlayerContext {
  playerId: number;
  playerName: string;
  personality: PersonalityType;

  /** Reads on each other player, built from observation */
  reads: Map<number, OpponentRead>;

  /** Emotional / psychological state */
  recentResults: number[]; // last 10 hand P&L values
  confidence: number;      // 0-1, starts at 0.5
  tiltFactor: number;      // 0-1, 0 = calm, 1 = full tilt
  consecutiveLosses: number;
  biggestLossThisSession: number;

  /** Session memory */
  handsPlayed: number;
  handsWon: number;
  totalPnL: number;

  /** Gear shifting (for tricky players) */
  currentGear: "passive" | "aggressive";
  handsInCurrentGear: number;
}

/** What a player can actually see at the table */
export interface VisibleGameState {
  myCards: Card[];
  communityCards: Card[];
  pot: number;
  currentBet: number;
  myCurrentBet: number;
  myChips: number;
  bettingRound: BettingRound;
  /** Actions taken this hand (all players — this is public info) */
  actions: { playerId: number; playerName: string; action: PlayerAction; amount: number; round: BettingRound }[];
  /** Which players are still in (not folded) */
  activePlayers: { id: number; name: string; chips: number; currentBet: number; folded: boolean; allIn: boolean }[];
  /** Position info */
  dealerIndex: number;
  myIndex: number;
  numPlayers: number;
  handNumber: number;
}

export function createOpponentRead(playerId: number, playerName: string): OpponentRead {
  return {
    playerId,
    playerName,
    handsObserved: 0,
    vpip: 0,
    vpipHands: 0,
    aggressionFreq: 0,
    aggressionBets: 0,
    aggressionPassive: 0,
    showdowns: [],
    foldToBetCount: 0,
    foldToBetOpportunities: 0,
  };
}

export function createPlayerContext(
  playerId: number,
  playerName: string,
  personality: PersonalityType,
  allPlayerIds: { id: number; name: string }[]
): PlayerContext {
  const reads = new Map<number, OpponentRead>();
  for (const p of allPlayerIds) {
    if (p.id !== playerId) {
      reads.set(p.id, createOpponentRead(p.id, p.name));
    }
  }

  return {
    playerId,
    playerName,
    personality,
    reads,
    recentResults: [],
    confidence: 0.5,
    tiltFactor: 0,
    consecutiveLosses: 0,
    biggestLossThisSession: 0,
    handsPlayed: 0,
    handsWon: 0,
    totalPnL: 0,
    currentGear: personality === "tricky" ? "passive" : "aggressive",
    handsInCurrentGear: 0,
  };
}
