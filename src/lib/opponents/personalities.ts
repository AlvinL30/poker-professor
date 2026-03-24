import type { PersonalityType, GameState, PlayerAction, Card, Rank } from "../../types/poker.js";
import { evaluateHand } from "../engine/evaluator.js";

const RANK_VALUES: Record<Rank, number> = {
  "2": 2, "3": 3, "4": 4, "5": 5, "6": 6, "7": 7,
  "8": 8, "9": 9, "T": 10, "J": 11, "Q": 12, "K": 13, "A": 14,
};

interface OpponentDecision {
  action: PlayerAction;
  raiseAmount?: number;
}

/** Score a 2-card preflop hand (0-100 scale) */
function preflopStrength(cards: Card[]): number {
  if (cards.length < 2) return 0;
  const [a, b] = cards;
  const high = Math.max(RANK_VALUES[a.rank], RANK_VALUES[b.rank]);
  const low = Math.min(RANK_VALUES[a.rank], RANK_VALUES[b.rank]);
  const suited = a.suit === b.suit;
  const paired = a.rank === b.rank;

  if (paired) return 50 + (high - 2) * 3.5; // 22=50, AA=92
  let score = high * 3 + low * 1.5;
  if (suited) score += 8;
  if (high - low <= 2) score += 5; // connectors
  if (high - low <= 4) score += 2; // one-gappers
  if (high >= 12 && low >= 10) score += 12; // broadway
  if (high === 14) score += 5; // ace-high
  return Math.min(Math.max(score, 5), 90);
}

/** Proper post-flop hand strength using the evaluator */
function postflopStrength(holeCards: Card[], communityCards: Card[]): number {
  if (communityCards.length < 3) return preflopStrength(holeCards);

  const allCards = [...holeCards, ...communityCards];
  const eval_ = evaluateHand(allCards);

  // Map hand rank to a 0-100 strength scale
  const rankScores: Record<string, number> = {
    "high-card": 15,
    "pair": 35,
    "two-pair": 55,
    "three-of-a-kind": 70,
    "straight": 78,
    "flush": 82,
    "full-house": 90,
    "four-of-a-kind": 96,
    "straight-flush": 99,
    "royal-flush": 100,
  };

  let strength = rankScores[eval_.rank] ?? 15;

  // Adjust pair strength based on pair rank and whether it uses hole cards
  if (eval_.rank === "pair") {
    // Check if pair involves our hole cards (not just board pair)
    const holePairedWithBoard = holeCards.some((h) =>
      communityCards.some((c) => c.rank === h.rank)
    );
    const pocketPair = holeCards[0].rank === holeCards[1].rank;

    if (!holePairedWithBoard && !pocketPair) {
      strength = 12; // board pair, we have nothing
    } else {
      // Top pair vs middle/bottom pair
      const boardRanks = communityCards.map((c) => RANK_VALUES[c.rank]).sort((a, b) => b - a);
      const pairedRank = holeCards.find((h) => communityCards.some((c) => c.rank === h.rank));
      if (pairedRank && RANK_VALUES[pairedRank.rank] === boardRanks[0]) {
        strength = 50; // top pair
      } else if (pairedRank && RANK_VALUES[pairedRank.rank] >= boardRanks[1]) {
        strength = 38; // middle pair
      } else {
        strength = 28; // bottom pair
      }
      // Kicker matters
      const kicker = Math.max(...holeCards.map((h) => RANK_VALUES[h.rank]));
      if (kicker >= 12) strength += 5; // good kicker
    }
  }

  // Add draw potential
  const suitCounts = new Map<string, number>();
  for (const card of allCards) {
    suitCounts.set(card.suit, (suitCounts.get(card.suit) || 0) + 1);
  }
  for (const count of suitCounts.values()) {
    if (count === 4 && strength < 60) strength += 10; // flush draw
  }

  // Straight draw detection (simple: check for 4 in a row among all cards)
  const uniqueRanks = [...new Set(allCards.map((c) => RANK_VALUES[c.rank]))].sort((a, b) => a - b);
  for (let i = 0; i <= uniqueRanks.length - 4; i++) {
    if (uniqueRanks[i + 3] - uniqueRanks[i] === 4 || uniqueRanks[i + 3] - uniqueRanks[i] === 3) {
      if (strength < 60) strength += 8; // straight draw
      break;
    }
  }

  // Overcard bonus (both hole cards above all board cards)
  const highBoard = Math.max(...communityCards.map((c) => RANK_VALUES[c.rank]));
  const bothOver = holeCards.every((h) => RANK_VALUES[h.rank] > highBoard);
  if (bothOver && strength < 30) strength += 10;

  return Math.min(strength, 100);
}

/** Count how many active players remain */
function activePlayers(state: GameState): number {
  return state.players.filter((p) => !p.folded).length;
}

/** Position relative to dealer (0 = earliest, higher = later = better) */
function positionScore(playerId: number, state: GameState): number {
  const count = state.players.length;
  const pos = ((playerId - state.dealerIndex + count) % count);
  return pos / count; // 0-1, higher is later position (better)
}

export function getOpponentDecision(
  personality: PersonalityType,
  playerId: number,
  state: GameState
): OpponentDecision {
  const player = state.players[playerId];
  if (!player) return { action: "fold" };

  const holeCards = player.holeCards;
  const strength =
    state.communityCards.length === 0
      ? preflopStrength(holeCards)
      : postflopStrength(holeCards, state.communityCards);

  const toCall = state.currentBet - player.currentBet;
  const potOdds = toCall > 0 ? toCall / (state.pot + toCall) : 0;
  const position = positionScore(playerId, state);
  const numActive = activePlayers(state);

  switch (personality) {
    case "tight-passive":
      return tightPassiveDecision(strength, toCall, potOdds, state, player.chips, position, numActive);
    case "loose-aggressive":
      return looseAggressiveDecision(strength, toCall, potOdds, state, player.chips, position, numActive);
    case "tricky":
      return trickyDecision(strength, toCall, potOdds, state, player.chips, position, numActive);
    default:
      return { action: "fold" };
  }
}

function makeBet(amount: number, chips: number, currentBet: number): OpponentDecision {
  const total = Math.min(Math.floor(amount), chips + currentBet);
  if (total <= 0) return { action: "check" };
  return { action: "raise", raiseAmount: total };
}

/**
 * Tight-Passive ("The Rock")
 * Plays few hands, rarely bets/raises, but when they DO bet — they have it.
 * Key coaching pattern: their bets are reliable tells.
 */
function tightPassiveDecision(
  strength: number, toCall: number, potOdds: number,
  state: GameState, chips: number, position: number, numActive: number
): OpponentDecision {
  const rand = Math.random();

  if (state.bettingRound === "preflop") {
    // Only play ~25% of hands, tighter in early position
    const threshold = position < 0.4 ? 55 : 42;
    if (strength < threshold) return { action: "fold" };

    // Very rarely raise — only with premium hands (top 5%)
    if (strength >= 80 && rand < 0.2) {
      return makeBet(state.currentBet * 3, chips, state.players[state.activePlayerIndex]?.currentBet ?? 0);
    }
    if (toCall === 0) return { action: "check" };
    if (toCall > chips * 0.15) return { action: "fold" }; // won't pay big without premium
    return { action: "call" };
  }

  // Postflop: passive but solid
  if (strength < 25) {
    if (toCall === 0) return { action: "check" };
    return { action: "fold" };
  }

  // Monster hand (70+) — this is the "tell" the coach should teach
  // They bet, which is rare, so when they do it means something
  if (strength >= 70) {
    if (toCall === 0 && rand < 0.35) {
      return makeBet(Math.floor(state.pot * 0.5), chips, 0);
    }
    if (toCall === 0) return { action: "check" };
    return { action: "call" };
  }

  // Medium hand: check/call small bets, fold to big ones
  if (toCall === 0) return { action: "check" };
  if (strength >= 40 && potOdds < 0.25) return { action: "call" };
  if (strength >= 30 && toCall <= 4) return { action: "call" };
  return { action: "fold" };
}

/**
 * Loose-Aggressive ("The Maniac")
 * Plays tons of hands, bets and raises constantly.
 * Bluffs frequently. Applies maximum pressure.
 * Key coaching pattern: their bets DON'T always mean strength.
 */
function looseAggressiveDecision(
  strength: number, toCall: number, potOdds: number,
  state: GameState, chips: number, position: number, numActive: number
): OpponentDecision {
  const rand = Math.random();
  const potBet = Math.max(Math.floor(state.pot * (0.6 + Math.random() * 0.4)), 4);

  if (state.bettingRound === "preflop") {
    if (strength < 15) return { action: "fold" }; // fold total garbage
    // Raise with ~50% of hands they play
    if (rand < 0.45) {
      const raiseSize = state.currentBet * (2.5 + Math.random() * 2);
      return makeBet(Math.floor(raiseSize), chips, 0);
    }
    // 3-bet with strong hands
    if (strength >= 65 && toCall > 0 && rand < 0.5) {
      return makeBet(Math.floor(state.currentBet * 3), chips, 0);
    }
    if (toCall === 0) {
      return rand < 0.6 ? makeBet(4, chips, 0) : { action: "check" };
    }
    return { action: "call" };
  }

  // Postflop: bet with strong hands AND bluff with weak ones
  if (toCall === 0) {
    // C-bet with everything decent, and bluff with ~30% of junk
    if (strength >= 35 || rand < 0.3) {
      return makeBet(potBet, chips, 0);
    }
    return { action: "check" };
  }

  // Facing a bet: raise strong, call medium, bluff-raise sometimes
  if (strength >= 65) {
    return rand < 0.4
      ? makeBet(Math.floor(state.currentBet * 2.5), chips, 0)
      : { action: "call" };
  }
  if (strength >= 30) return { action: "call" };
  // Bluff-raise with nothing sometimes
  if (rand < 0.15 && numActive <= 3) {
    return makeBet(Math.floor(state.currentBet * 2.5), chips, 0);
  }
  if (rand < 0.25) return { action: "call" }; // float
  return { action: "fold" };
}

/**
 * Tricky ("The Shapeshifter")
 * Mixes up play: slow-plays monsters, bluffs with air, changes gears.
 * Key coaching pattern: watch for style shifts, check-raise traps.
 */
function trickyDecision(
  strength: number, toCall: number, potOdds: number,
  state: GameState, chips: number, position: number, numActive: number
): OpponentDecision {
  const rand = Math.random();
  const handNumber = state.handNumber;
  const inAggressivePhase = Math.floor(handNumber / 8) % 2 === 0;

  if (state.bettingRound === "preflop") {
    if (strength < 25) return { action: "fold" };

    // In aggressive phase, raise more
    if (inAggressivePhase) {
      if (rand < 0.35) {
        return makeBet(Math.floor(state.currentBet * (2 + Math.random() * 2.5)), chips, 0);
      }
    } else {
      // Passive phase: limp in with lots of hands to trap
      if (strength >= 75 && toCall > 0) {
        // Just call with premium (trap!)
        return { action: "call" };
      }
    }
    if (toCall === 0) return { action: "check" };
    if (toCall <= 6) return { action: "call" };
    if (strength >= 50) return { action: "call" };
    return { action: "fold" };
  }

  // Postflop: the deception
  const potBet = Math.max(Math.floor(state.pot * 0.65), 4);

  // MONSTER (70+): slow play — check/call, then pounce later
  if (strength >= 70) {
    if (state.bettingRound === "flop" && rand < 0.6) {
      // Check the flop to trap
      if (toCall === 0) return { action: "check" };
      return { action: "call" }; // smooth call
    }
    // On turn/river, spring the trap
    if (toCall === 0) {
      return rand < 0.7 ? makeBet(potBet, chips, 0) : { action: "check" };
    }
    // Check-raise!
    if (rand < 0.4) {
      return makeBet(Math.floor(state.currentBet * 2.5), chips, 0);
    }
    return { action: "call" };
  }

  // BLUFF (weak hand): bet to represent strength
  if (strength < 25) {
    if (toCall === 0 && rand < 0.3) {
      return makeBet(potBet, chips, 0);
    }
    if (toCall === 0) return { action: "check" };
    if (rand < 0.12) return { action: "call" }; // float to bluff later
    return { action: "fold" };
  }

  // MEDIUM: straightforward
  if (toCall === 0) {
    return rand < 0.35 ? makeBet(Math.floor(state.pot * 0.4), chips, 0) : { action: "check" };
  }
  if (strength >= 40 && potOdds < 0.35) return { action: "call" };
  return { action: "fold" };
}
