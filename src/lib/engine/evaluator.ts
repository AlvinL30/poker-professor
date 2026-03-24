import type { Card, HandEvaluation, HandRank, Rank } from "../../types/poker.js";

const RANK_VALUES: Record<Rank, number> = {
  "2": 2, "3": 3, "4": 4, "5": 5, "6": 6, "7": 7,
  "8": 8, "9": 9, "T": 10, "J": 11, "Q": 12, "K": 13, "A": 14,
};

const RANK_NAMES: Record<Rank, string> = {
  "2": "Two", "3": "Three", "4": "Four", "5": "Five", "6": "Six",
  "7": "Seven", "8": "Eight", "9": "Nine", "T": "Ten",
  "J": "Jack", "Q": "Queen", "K": "King", "A": "Ace",
};

const HAND_RANK_VALUES: Record<HandRank, number> = {
  "high-card": 1,
  "pair": 2,
  "two-pair": 3,
  "three-of-a-kind": 4,
  "straight": 5,
  "flush": 6,
  "full-house": 7,
  "four-of-a-kind": 8,
  "straight-flush": 9,
  "royal-flush": 10,
};

/** Evaluate the best 5-card hand from up to 7 cards */
export function evaluateHand(cards: Card[]): HandEvaluation {
  if (cards.length < 5) {
    throw new Error(`Need at least 5 cards, got ${cards.length}`);
  }

  const combos = getCombinations(cards, 5);
  let best: HandEvaluation | null = null;

  for (const combo of combos) {
    const evaluation = evaluate5Cards(combo);
    if (!best || evaluation.value > best.value) {
      best = evaluation;
    }
  }

  return best!;
}

function evaluate5Cards(cards: Card[]): HandEvaluation {
  const sorted = [...cards].sort((a, b) => RANK_VALUES[b.rank] - RANK_VALUES[a.rank]);
  const ranks = sorted.map((c) => RANK_VALUES[c.rank]);
  const suits = sorted.map((c) => c.suit);

  const isFlush = suits.every((s) => s === suits[0]);
  const isStraight = checkStraight(ranks);
  const isAceLowStraight = checkAceLowStraight(ranks);

  const groups = getGroups(sorted);

  // Royal flush
  if (isFlush && isStraight && ranks[0] === 14) {
    return { rank: "royal-flush", value: score("royal-flush", ranks), description: "Royal Flush", bestCards: sorted };
  }

  // Straight flush
  if (isFlush && (isStraight || isAceLowStraight)) {
    const effectiveRanks = isAceLowStraight ? [5, 4, 3, 2, 1] : ranks;
    return { rank: "straight-flush", value: score("straight-flush", effectiveRanks), description: `Straight Flush, ${RANK_NAMES[sorted[isAceLowStraight ? 1 : 0].rank]} high`, bestCards: sorted };
  }

  // Four of a kind
  if (groups[0].count === 4) {
    return { rank: "four-of-a-kind", value: score("four-of-a-kind", [groups[0].value, groups[1].value]), description: `Four ${RANK_NAMES[groups[0].rank]}s`, bestCards: sorted };
  }

  // Full house
  if (groups[0].count === 3 && groups[1].count === 2) {
    return { rank: "full-house", value: score("full-house", [groups[0].value, groups[1].value]), description: `Full House, ${RANK_NAMES[groups[0].rank]}s full of ${RANK_NAMES[groups[1].rank]}s`, bestCards: sorted };
  }

  // Flush
  if (isFlush) {
    return { rank: "flush", value: score("flush", ranks), description: `Flush, ${RANK_NAMES[sorted[0].rank]} high`, bestCards: sorted };
  }

  // Straight
  if (isStraight || isAceLowStraight) {
    const effectiveRanks = isAceLowStraight ? [5, 4, 3, 2, 1] : ranks;
    return { rank: "straight", value: score("straight", effectiveRanks), description: `Straight, ${isAceLowStraight ? "Five" : RANK_NAMES[sorted[0].rank]} high`, bestCards: sorted };
  }

  // Three of a kind
  if (groups[0].count === 3) {
    return { rank: "three-of-a-kind", value: score("three-of-a-kind", [groups[0].value, groups[1].value, groups[2].value]), description: `Three ${RANK_NAMES[groups[0].rank]}s`, bestCards: sorted };
  }

  // Two pair
  if (groups[0].count === 2 && groups[1].count === 2) {
    return { rank: "two-pair", value: score("two-pair", [groups[0].value, groups[1].value, groups[2].value]), description: `Two Pair, ${RANK_NAMES[groups[0].rank]}s and ${RANK_NAMES[groups[1].rank]}s`, bestCards: sorted };
  }

  // Pair
  if (groups[0].count === 2) {
    return { rank: "pair", value: score("pair", [groups[0].value, groups[1].value, groups[2].value, groups[3].value]), description: `Pair of ${RANK_NAMES[groups[0].rank]}s`, bestCards: sorted };
  }

  // High card
  return { rank: "high-card", value: score("high-card", ranks), description: `${RANK_NAMES[sorted[0].rank]} high`, bestCards: sorted };
}

function checkStraight(ranks: number[]): boolean {
  for (let i = 0; i < ranks.length - 1; i++) {
    if (ranks[i] - ranks[i + 1] !== 1) return false;
  }
  return true;
}

function checkAceLowStraight(ranks: number[]): boolean {
  // A-2-3-4-5
  const sorted = [...ranks].sort((a, b) => a - b);
  return sorted[0] === 2 && sorted[1] === 3 && sorted[2] === 4 && sorted[3] === 5 && sorted[4] === 14;
}

interface RankGroup {
  rank: Rank;
  value: number;
  count: number;
}

function getGroups(sorted: Card[]): RankGroup[] {
  const counts = new Map<Rank, number>();
  for (const card of sorted) {
    counts.set(card.rank, (counts.get(card.rank) || 0) + 1);
  }

  const groups: RankGroup[] = [];
  for (const [rank, count] of counts) {
    groups.push({ rank, value: RANK_VALUES[rank], count });
  }

  // Sort by count desc, then value desc
  groups.sort((a, b) => b.count - a.count || b.value - a.value);
  return groups;
}

function score(handRank: HandRank, kickers: number[]): number {
  // Base score from hand rank (shifted left), then kickers for tiebreaking
  let value = HAND_RANK_VALUES[handRank] * 1_000_000_000;
  for (let i = 0; i < kickers.length && i < 5; i++) {
    value += kickers[i] * Math.pow(15, 4 - i);
  }
  return value;
}

function getCombinations<T>(arr: T[], k: number): T[][] {
  if (k === 0) return [[]];
  if (arr.length < k) return [];

  const result: T[][] = [];
  const [first, ...rest] = arr;

  // Include first element
  for (const combo of getCombinations(rest, k - 1)) {
    result.push([first, ...combo]);
  }
  // Exclude first element
  for (const combo of getCombinations(rest, k)) {
    result.push(combo);
  }

  return result;
}

/** Compare two hands. Returns positive if a wins, negative if b wins, 0 for tie */
export function compareHands(a: HandEvaluation, b: HandEvaluation): number {
  return a.value - b.value;
}
