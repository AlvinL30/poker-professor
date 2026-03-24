import type { PlayerAction, Card, Rank } from "../../types/poker.js";
import type { PlayerContext, VisibleGameState, OpponentRead } from "../../types/context.js";
import { evaluateHand } from "../engine/evaluator.js";

const RANK_VALUES: Record<Rank, number> = {
  "2": 2, "3": 3, "4": 4, "5": 5, "6": 6, "7": 7,
  "8": 8, "9": 9, "T": 10, "J": 11, "Q": 12, "K": 13, "A": 14,
};

interface Decision {
  action: PlayerAction;
  raiseAmount?: number;
}

// ─── Hand Strength (only uses own cards + board) ─────────────────

function preflopStrength(cards: Card[]): number {
  if (cards.length < 2) return 0;
  const [a, b] = cards;
  const high = Math.max(RANK_VALUES[a.rank], RANK_VALUES[b.rank]);
  const low = Math.min(RANK_VALUES[a.rank], RANK_VALUES[b.rank]);
  const suited = a.suit === b.suit;
  const paired = a.rank === b.rank;

  if (paired) return 50 + (high - 2) * 3.5;
  let score = high * 3 + low * 1.5;
  if (suited) score += 8;
  if (high - low <= 2) score += 5;
  if (high - low <= 4) score += 2;
  if (high >= 12 && low >= 10) score += 12;
  if (high === 14) score += 5;
  return Math.min(Math.max(score, 5), 90);
}

function postflopStrength(myCards: Card[], board: Card[]): number {
  if (board.length < 3) return preflopStrength(myCards);

  const allCards = [...myCards, ...board];
  const eval_ = evaluateHand(allCards);

  const rankScores: Record<string, number> = {
    "high-card": 15, "pair": 35, "two-pair": 55, "three-of-a-kind": 70,
    "straight": 78, "flush": 82, "full-house": 90, "four-of-a-kind": 96,
    "straight-flush": 99, "royal-flush": 100,
  };
  let strength = rankScores[eval_.rank] ?? 15;

  // Pair quality: top pair vs middle/bottom, uses hole cards or just board pair
  if (eval_.rank === "pair") {
    const holePaired = myCards.some((h) => board.some((c) => c.rank === h.rank));
    const pocketPair = myCards[0].rank === myCards[1].rank;
    if (!holePaired && !pocketPair) {
      strength = 12;
    } else {
      const boardRanks = board.map((c) => RANK_VALUES[c.rank]).sort((a, b) => b - a);
      const pairedCard = myCards.find((h) => board.some((c) => c.rank === h.rank));
      if (pairedCard && RANK_VALUES[pairedCard.rank] === boardRanks[0]) strength = 50;
      else if (pairedCard && RANK_VALUES[pairedCard.rank] >= boardRanks[1]) strength = 38;
      else strength = 28;
      const kicker = Math.max(...myCards.map((h) => RANK_VALUES[h.rank]));
      if (kicker >= 12) strength += 5;
    }
  }

  // Draw potential
  const suitCounts = new Map<string, number>();
  for (const card of allCards) suitCounts.set(card.suit, (suitCounts.get(card.suit) || 0) + 1);
  for (const count of suitCounts.values()) {
    if (count === 4 && strength < 60) strength += 10;
  }

  // Overcard bonus
  const highBoard = Math.max(...board.map((c) => RANK_VALUES[c.rank]));
  if (myCards.every((h) => RANK_VALUES[h.rank] > highBoard) && strength < 30) strength += 10;

  return Math.min(strength, 100);
}

// ─── Context-Aware Helpers ───────────────────────────────────────

/** Read how aggressive a specific opponent has been */
function getOpponentAggression(ctx: PlayerContext, opponentId: number): number {
  const read = ctx.reads.get(opponentId);
  if (!read || read.handsObserved < 2) return 0.5; // unknown, assume average
  return read.aggressionFreq;
}

/** Read how often a specific opponent enters pots */
function getOpponentVPIP(ctx: PlayerContext, opponentId: number): number {
  const read = ctx.reads.get(opponentId);
  if (!read || read.handsObserved < 2) return 0.5;
  return read.vpip;
}

/** How many players bet/raised this round? (from visible actions) */
function aggressorsThisRound(visible: VisibleGameState): number {
  return visible.actions.filter(
    (a) => a.round === visible.bettingRound && (a.action === "raise" || a.action === "all-in")
  ).length;
}

/** Who was the last raiser? */
function lastRaiser(visible: VisibleGameState): number | null {
  const raisers = visible.actions.filter(
    (a) => a.round === visible.bettingRound && (a.action === "raise" || a.action === "all-in")
  );
  return raisers.length > 0 ? raisers[raisers.length - 1].playerId : null;
}

/** My position: 0 = early, 1 = late */
function myPosition(visible: VisibleGameState): number {
  const pos = (visible.myIndex - visible.dealerIndex + visible.numPlayers) % visible.numPlayers;
  return pos / visible.numPlayers;
}

function makeBet(amount: number, chips: number): Decision {
  const total = Math.min(Math.floor(amount), chips);
  if (total <= 0) return { action: "check" };
  return { action: "raise", raiseAmount: total };
}

// ─── Main Decision Entry Point ───────────────────────────────────

export function getContextualDecision(
  ctx: PlayerContext,
  visible: VisibleGameState
): Decision {
  const strength = visible.communityCards.length === 0
    ? preflopStrength(visible.myCards)
    : postflopStrength(visible.myCards, visible.communityCards);

  const toCall = visible.currentBet - visible.myCurrentBet;
  const potOdds = toCall > 0 ? toCall / (visible.pot + toCall) : 0;
  const position = myPosition(visible);
  const tilt = ctx.tiltFactor;
  const confidence = ctx.confidence;

  // Tilt adjustment: when tilted, play looser and more aggressive
  const tiltLoosen = tilt * 15; // up to 15 points more willing to play
  const tiltAggro = tilt * 0.2; // up to 20% more likely to raise

  switch (ctx.personality) {
    case "tight-passive":
      return tightPassiveDecision(ctx, visible, strength, toCall, potOdds, position, tiltLoosen, tiltAggro);
    case "loose-aggressive":
      return looseAggressiveDecision(ctx, visible, strength, toCall, potOdds, position, tiltLoosen, tiltAggro);
    case "tricky":
      return trickyDecision(ctx, visible, strength, toCall, potOdds, position, tiltLoosen, tiltAggro);
    default:
      return { action: "fold" };
  }
}

// ─── Tight-Passive ───────────────────────────────────────────────

function tightPassiveDecision(
  ctx: PlayerContext, visible: VisibleGameState,
  strength: number, toCall: number, potOdds: number, position: number,
  tiltLoosen: number, tiltAggro: number
): Decision {
  const rand = Math.random();
  const adjustedStrength = strength + tiltLoosen;

  if (visible.bettingRound === "preflop") {
    const threshold = position < 0.4 ? 55 - tiltLoosen : 42 - tiltLoosen;
    if (adjustedStrength < threshold) return { action: "fold" };

    // Only raise with premium — but check if the raiser is a known maniac
    const raiser = lastRaiser(visible);
    if (raiser !== null) {
      const rVPIP = getOpponentVPIP(ctx, raiser);
      // If the raiser plays 60%+ of hands, we can call wider
      if (rVPIP > 0.6 && adjustedStrength >= 40) return { action: "call" };
    }

    if (adjustedStrength >= 80 && rand < 0.2 + tiltAggro) {
      return makeBet(visible.currentBet * 3, visible.myChips);
    }
    if (toCall === 0) return { action: "check" };
    if (toCall > visible.myChips * 0.15 && adjustedStrength < 70) return { action: "fold" };
    return { action: "call" };
  }

  // Postflop
  if (adjustedStrength < 25) {
    if (toCall === 0) return { action: "check" };
    return { action: "fold" };
  }

  // Strong hand — their rare bets are reliable tells
  if (adjustedStrength >= 70) {
    if (toCall === 0 && rand < 0.3 + tiltAggro) {
      return makeBet(Math.floor(visible.pot * 0.5), visible.myChips);
    }
    if (toCall === 0) return { action: "check" };
    return { action: "call" };
  }

  // Medium — check/call small, fold to big
  if (toCall === 0) return { action: "check" };

  // Adjust calling range based on read on bettor
  const bettor = lastRaiser(visible);
  if (bettor !== null) {
    const bAggro = getOpponentAggression(ctx, bettor);
    // If bettor is very aggressive (likely bluffing), call wider
    if (bAggro > 0.6 && adjustedStrength >= 30) return { action: "call" };
    // If bettor is passive (likely has it), fold tighter
    if (bAggro < 0.3 && adjustedStrength < 50) return { action: "fold" };
  }

  if (adjustedStrength >= 40 && potOdds < 0.25) return { action: "call" };
  if (toCall <= 4) return { action: "call" };
  return { action: "fold" };
}

// ─── Loose-Aggressive ────────────────────────────────────────────

function looseAggressiveDecision(
  ctx: PlayerContext, visible: VisibleGameState,
  strength: number, toCall: number, potOdds: number, position: number,
  tiltLoosen: number, tiltAggro: number
): Decision {
  const rand = Math.random();
  const potBet = Math.max(Math.floor(visible.pot * (0.6 + Math.random() * 0.4)), 4);

  if (visible.bettingRound === "preflop") {
    if (strength < 15 - tiltLoosen) return { action: "fold" };

    // Raise often, but respect tight players' raises
    const raiser = lastRaiser(visible);
    if (raiser !== null) {
      const rVPIP = getOpponentVPIP(ctx, raiser);
      // Tight player raised — they have something. Only continue with strong hands
      if (rVPIP < 0.3 && strength < 60) {
        return rand < 0.3 ? { action: "call" } : { action: "fold" };
      }
    }

    if (rand < 0.45 + tiltAggro) {
      return makeBet(Math.floor(visible.currentBet * (2.5 + Math.random() * 2)), visible.myChips);
    }
    if (toCall === 0) {
      return rand < 0.6 ? makeBet(4, visible.myChips) : { action: "check" };
    }
    return { action: "call" };
  }

  // Postflop: bet strong hands and bluff, but adjust to opponents
  const numAggressors = aggressorsThisRound(visible);

  if (toCall === 0) {
    // More willing to bluff heads-up, less in multiway
    const activeCt = visible.activePlayers.filter((p) => !p.folded).length;
    const bluffChance = activeCt <= 2 ? 0.35 : activeCt <= 3 ? 0.2 : 0.1;
    if (strength >= 35 || rand < bluffChance + tiltAggro) {
      return makeBet(potBet, visible.myChips);
    }
    return { action: "check" };
  }

  // Facing a bet — use reads
  const bettor = lastRaiser(visible);
  if (bettor !== null) {
    const bAggro = getOpponentAggression(ctx, bettor);
    const bVPIP = getOpponentVPIP(ctx, bettor);

    // Passive player betting = they have it. Respect it.
    if (bAggro < 0.3 && bVPIP < 0.3 && strength < 60) {
      return { action: "fold" };
    }

    // Another aggro player betting = possible bluff, consider re-raising
    if (bAggro > 0.5 && strength >= 50 && rand < 0.35) {
      return makeBet(Math.floor(visible.currentBet * 2.5), visible.myChips);
    }
  }

  if (strength >= 65) {
    return rand < 0.4 ? makeBet(Math.floor(visible.currentBet * 2.5), visible.myChips) : { action: "call" };
  }
  if (strength >= 25 || rand < 0.2 + tiltAggro) return { action: "call" };
  return { action: "fold" };
}

// ─── Tricky ──────────────────────────────────────────────────────

function trickyDecision(
  ctx: PlayerContext, visible: VisibleGameState,
  strength: number, toCall: number, potOdds: number, position: number,
  tiltLoosen: number, tiltAggro: number
): Decision {
  const rand = Math.random();
  const inAggressiveGear = ctx.currentGear === "aggressive";

  if (visible.bettingRound === "preflop") {
    if (strength < 25 - tiltLoosen) return { action: "fold" };

    if (inAggressiveGear) {
      if (rand < 0.35 + tiltAggro) {
        return makeBet(Math.floor(visible.currentBet * (2 + Math.random() * 2.5)), visible.myChips);
      }
    } else {
      // Passive gear: limp/call with strong hands to trap
      if (strength >= 75 && toCall > 0) return { action: "call" };
    }
    if (toCall === 0) return { action: "check" };
    if (toCall <= 6) return { action: "call" };
    if (strength >= 50) return { action: "call" };
    return { action: "fold" };
  }

  // Postflop — the deception engine
  const potBet = Math.max(Math.floor(visible.pot * 0.65), 4);

  // MONSTER (70+): slow play on flop, spring trap on turn/river
  if (strength >= 70) {
    if (visible.bettingRound === "flop" && rand < 0.6) {
      if (toCall === 0) return { action: "check" };
      return { action: "call" };
    }
    // Turn/river: spring the trap
    if (toCall === 0) {
      return rand < 0.7 ? makeBet(potBet, visible.myChips) : { action: "check" };
    }
    // Check-raise opportunity
    if (rand < 0.4) {
      return makeBet(Math.floor(visible.currentBet * 2.5), visible.myChips);
    }
    return { action: "call" };
  }

  // BLUFF (weak hand): bet to represent — but adjust based on opponent reads
  if (strength < 25) {
    if (toCall === 0) {
      // More likely to bluff against tight opponents who fold often
      const activeCt = visible.activePlayers.filter((p) => !p.folded && p.id !== ctx.playerId);
      const avgFoldRate = activeCt.reduce((sum, p) => {
        const read = ctx.reads.get(p.id);
        if (!read || read.foldToBetOpportunities === 0) return sum + 0.4;
        return sum + read.foldToBetCount / read.foldToBetOpportunities;
      }, 0) / Math.max(activeCt.length, 1);

      if (avgFoldRate > 0.5 && rand < 0.4) {
        return makeBet(potBet, visible.myChips);
      }
      if (rand < 0.2) return makeBet(potBet, visible.myChips);
      return { action: "check" };
    }
    if (rand < 0.12) return { action: "call" }; // float
    return { action: "fold" };
  }

  // MEDIUM: use gear
  if (inAggressiveGear) {
    if (toCall === 0 && rand < 0.4) return makeBet(Math.floor(visible.pot * 0.5), visible.myChips);
    if (toCall === 0) return { action: "check" };
    if (strength >= 40) return { action: "call" };
    return { action: "fold" };
  } else {
    if (toCall === 0) return { action: "check" };
    if (strength >= 40 && potOdds < 0.35) return { action: "call" };
    return { action: "fold" };
  }
}
