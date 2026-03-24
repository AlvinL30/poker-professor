import type { GameState, Player, BettingRound, ActionRecord, PlayerAction, PersonalityType } from "../../types/poker.js";
import { createDeck, shuffleDeck, dealCards, cardsToString } from "./deck.js";
import { evaluateHand, compareHands } from "./evaluator.js";

const SMALL_BLIND = 1;
const BIG_BLIND = 2;
const STARTING_CHIPS = 200;

const AI_PLAYERS: { name: string; personality: PersonalityType }[] = [
  { name: "Mike", personality: "tight-passive" },
  { name: "Sarah", personality: "loose-aggressive" },
  { name: "Chen", personality: "tricky" },
  { name: "Dave", personality: "tight-passive" },
  { name: "Lisa", personality: "loose-aggressive" },
];

export function createInitialGameState(): GameState {
  const players: Player[] = [
    {
      id: 0, name: "You", chips: STARTING_CHIPS, holeCards: [],
      folded: false, allIn: false, currentBet: 0, isHuman: true,
    },
    ...AI_PLAYERS.map((ai, i) => ({
      id: i + 1, name: ai.name, chips: STARTING_CHIPS, holeCards: [],
      folded: false, allIn: false, currentBet: 0, isHuman: false,
      personality: ai.personality,
    })),
  ];

  return {
    players, communityCards: [], pot: 0, currentBet: 0,
    activePlayerIndex: 0, dealerIndex: 0, bettingRound: "preflop",
    deck: [], handNumber: 0, actionHistory: [], phase: "waiting",
    handLog: [],
  };
}

export function startNewHand(prevState: GameState): GameState {
  const state: GameState = { ...prevState };
  state.handNumber += 1;
  state.communityCards = [];
  state.pot = 0;
  state.currentBet = BIG_BLIND;
  state.actionHistory = [];
  state.bettingRound = "preflop";
  state.phase = "playing";
  state.winners = undefined;
  state.handLog = [`\n=== Hand #${state.handNumber} ===`];

  state.players = state.players.map((p) => ({
    ...p, holeCards: [], folded: p.chips <= 0, allIn: false, currentBet: 0,
  }));

  state.dealerIndex = nextActivePlayer(state, state.dealerIndex);
  let deck = shuffleDeck(createDeck());

  for (const player of state.players) {
    if (!player.folded) {
      const { dealt, remaining } = dealCards(deck, 2);
      player.holeCards = dealt;
      deck = remaining;
    }
  }
  state.deck = deck;

  const sbIndex = nextActivePlayer(state, state.dealerIndex);
  const bbIndex = nextActivePlayer(state, sbIndex);

  state.players = state.players.map((p, i) => {
    if (i === sbIndex) {
      const amt = Math.min(SMALL_BLIND, p.chips);
      return { ...p, currentBet: amt, chips: p.chips - amt, allIn: p.chips <= SMALL_BLIND };
    }
    if (i === bbIndex) {
      const amt = Math.min(BIG_BLIND, p.chips);
      return { ...p, currentBet: amt, chips: p.chips - amt, allIn: p.chips <= BIG_BLIND };
    }
    return p;
  });

  state.pot = state.players.reduce((sum, p) => sum + p.currentBet, 0);
  state.activePlayerIndex = nextActivePlayer(state, bbIndex);

  state.handLog.push(`Dealer: ${state.players[state.dealerIndex].name}`);
  state.handLog.push(`${state.players[sbIndex].name} posts SB $${SMALL_BLIND}`);
  state.handLog.push(`${state.players[bbIndex].name} posts BB $${BIG_BLIND}`);

  // Log hero's cards
  const hero = state.players[0];
  if (!hero.folded) {
    state.handLog.push(`Your cards: ${cardsToString(hero.holeCards)}`);
  }

  return state;
}

export function applyAction(state: GameState, playerId: number, action: PlayerAction, raiseAmount?: number): GameState {
  const newState: GameState = {
    ...state,
    players: state.players.map((p) => ({ ...p })),
    actionHistory: [...state.actionHistory],
    handLog: [...state.handLog],
  };

  const player = newState.players[playerId];
  if (!player || player.folded || player.allIn) return state;

  const record: ActionRecord = {
    playerId, playerName: player.name, action, amount: 0, round: newState.bettingRound,
  };

  switch (action) {
    case "fold":
      player.folded = true;
      newState.handLog.push(`${player.name} folds`);
      break;

    case "check":
      newState.handLog.push(`${player.name} checks`);
      break;

    case "call": {
      const callAmt = Math.min(newState.currentBet - player.currentBet, player.chips);
      player.chips -= callAmt;
      player.currentBet += callAmt;
      newState.pot += callAmt;
      record.amount = callAmt;
      if (player.chips === 0) player.allIn = true;
      newState.handLog.push(`${player.name} calls $${callAmt}`);
      break;
    }

    case "raise": {
      const totalBet = raiseAmount ?? newState.currentBet * 2;
      const addAmt = Math.min(totalBet - player.currentBet, player.chips);
      player.chips -= addAmt;
      player.currentBet += addAmt;
      newState.pot += addAmt;
      newState.currentBet = player.currentBet;
      record.amount = addAmt;
      if (player.chips === 0) player.allIn = true;
      newState.handLog.push(`${player.name} raises to $${player.currentBet}`);
      break;
    }

    case "all-in": {
      const allInAmt = player.chips;
      player.currentBet += allInAmt;
      newState.pot += allInAmt;
      player.chips = 0;
      player.allIn = true;
      if (player.currentBet > newState.currentBet) newState.currentBet = player.currentBet;
      record.amount = allInAmt;
      newState.handLog.push(`${player.name} goes ALL IN for $${allInAmt}`);
      break;
    }
  }

  newState.actionHistory.push(record);

  const activePlayers = newState.players.filter((p) => !p.folded);
  if (activePlayers.length === 1) {
    return resolveHand(newState);
  }

  if (isBettingRoundComplete(newState)) {
    return advanceBettingRound(newState);
  }

  newState.activePlayerIndex = nextActivePlayer(newState, playerId);
  return newState;
}

function isBettingRoundComplete(state: GameState): boolean {
  const active = state.players.filter((p) => !p.folded && !p.allIn);
  if (active.length === 0) return true;
  const allMatched = active.every((p) => p.currentBet === state.currentBet);
  if (!allMatched) return false;
  const roundActions = state.actionHistory.filter((a) => a.round === state.bettingRound);
  const actedPlayers = new Set(roundActions.map((a) => a.playerId));
  return active.every((p) => actedPlayers.has(p.id));
}

function advanceBettingRound(state: GameState): GameState {
  const newState: GameState = {
    ...state,
    players: state.players.map((p) => ({ ...p, currentBet: 0 })),
    handLog: [...state.handLog],
  };
  newState.currentBet = 0;

  const nextRounds: Record<BettingRound, BettingRound | "showdown"> = {
    preflop: "flop", flop: "turn", turn: "river", river: "showdown",
  };
  const next = nextRounds[newState.bettingRound];

  if (next === "showdown") return resolveHand(newState);

  newState.bettingRound = next;
  let deck = [...newState.deck];

  if (next === "flop") {
    const { dealt, remaining } = dealCards(deck, 3);
    newState.communityCards = dealt;
    deck = remaining;
    newState.handLog.push(`\n--- Flop: ${cardsToString(dealt)} ---`);
  } else {
    const { dealt, remaining } = dealCards(deck, 1);
    newState.communityCards = [...newState.communityCards, ...dealt];
    deck = remaining;
    const label = next === "turn" ? "Turn" : "River";
    newState.handLog.push(`\n--- ${label}: ${cardsToString(dealt)} ---`);
    newState.handLog.push(`Board: ${cardsToString(newState.communityCards)}`);
  }
  newState.deck = deck;
  newState.activePlayerIndex = nextActivePlayer(newState, newState.dealerIndex);

  return newState;
}

function resolveHand(state: GameState): GameState {
  const newState: GameState = { ...state, phase: "showdown", handLog: [...state.handLog] };
  const active = newState.players.filter((p) => !p.folded);

  if (active.length === 1) {
    newState.winners = [{ playerId: active[0].id, playerName: active[0].name, amount: newState.pot }];
    newState.players = newState.players.map((p) =>
      p.id === active[0].id ? { ...p, chips: p.chips + newState.pot } : p
    );
    newState.handLog.push(`\n🏆 ${active[0].name} wins $${newState.pot} (everyone else folded)`);
    newState.phase = "hand-complete";
    return newState;
  }

  // Deal remaining community cards
  let deck = [...newState.deck];
  while (newState.communityCards.length < 5) {
    const { dealt, remaining } = dealCards(deck, 1);
    newState.communityCards = [...newState.communityCards, ...dealt];
    deck = remaining;
  }
  newState.deck = deck;

  newState.handLog.push(`\n--- Showdown ---`);
  newState.handLog.push(`Board: ${cardsToString(newState.communityCards)}`);

  const evals = active.map((p) => ({
    playerId: p.id,
    playerName: p.name,
    cards: p.holeCards,
    hand: evaluateHand([...p.holeCards, ...newState.communityCards]),
  }));

  // Show everyone's cards
  for (const e of evals) {
    newState.handLog.push(`${e.playerName}: ${cardsToString(e.cards)} → ${e.hand.description}`);
  }

  evals.sort((a, b) => compareHands(b.hand, a.hand));
  const bestVal = evals[0].hand.value;
  const winners = evals.filter((e) => e.hand.value === bestVal);
  const winAmt = Math.floor(newState.pot / winners.length);

  newState.winners = winners.map((w) => ({
    playerId: w.playerId, playerName: w.playerName, amount: winAmt, hand: w.hand,
  }));

  newState.players = newState.players.map((p) => {
    const win = newState.winners?.find((w) => w.playerId === p.id);
    return win ? { ...p, chips: p.chips + win.amount } : p;
  });

  for (const w of winners) {
    newState.handLog.push(`🏆 ${w.playerName} wins $${winAmt} with ${w.hand.description}`);
  }

  newState.phase = "hand-complete";
  return newState;
}

function nextActivePlayer(state: GameState, fromIndex: number): number {
  const count = state.players.length;
  let idx = (fromIndex + 1) % count;
  let attempts = 0;
  while (attempts < count) {
    const player = state.players[idx];
    if (!player.folded && !player.allIn && player.chips > 0) return idx;
    idx = (idx + 1) % count;
    attempts++;
  }
  return fromIndex;
}

export function getValidActions(state: GameState): string[] {
  const player = state.players[state.activePlayerIndex];
  if (!player || player.folded || player.allIn) return [];

  const actions: string[] = ["fold"];
  const toCall = state.currentBet - player.currentBet;

  if (toCall === 0) {
    actions.push("check");
  } else {
    actions.push(`call ($${Math.min(toCall, player.chips)})`);
  }

  if (player.chips + player.currentBet > state.currentBet) {
    actions.push(`raise (min $${Math.min(state.currentBet + BIG_BLIND, player.chips + player.currentBet)}, max $${player.chips + player.currentBet})`);
  }

  return actions;
}

export function isHumanTurn(state: GameState): boolean {
  if (state.phase !== "playing") return false;
  return state.players[state.activePlayerIndex]?.isHuman ?? false;
}

export function getTableDisplay(state: GameState): string {
  const lines: string[] = [];
  const hero = state.players[0];

  lines.push(`\n${"═".repeat(50)}`);
  lines.push(`  POKER PROFESSOR — Hand #${state.handNumber}  |  Pot: $${state.pot}`);
  lines.push(`${"═".repeat(50)}`);

  // Community cards
  if (state.communityCards.length > 0) {
    lines.push(`  Board: ${cardsToString(state.communityCards)}`);
  } else {
    lines.push(`  Board: [not yet dealt]`);
  }
  lines.push("");

  // Players
  for (const p of state.players) {
    const isActive = state.activePlayerIndex === p.id && state.phase === "playing";
    const marker = isActive ? "→ " : "  ";
    const dealerMark = state.dealerIndex === p.id ? " (D)" : "";
    const status = p.folded ? " [FOLDED]" : p.allIn ? " [ALL IN]" : "";

    let cards = "";
    if (p.isHuman && !p.folded) {
      cards = ` | ${cardsToString(p.holeCards)}`;
    } else if (state.phase === "hand-complete" && state.winners && !p.folded) {
      cards = ` | ${cardsToString(p.holeCards)}`;
    } else if (!p.folded) {
      cards = " | [??] [??]";
    }

    const personality = p.personality ? ` (${p.personality})` : "";
    const bet = p.currentBet > 0 ? ` | Bet: $${p.currentBet}` : "";

    lines.push(`${marker}${p.name}${dealerMark}${personality}: $${p.chips}${cards}${bet}${status}`);
  }

  lines.push(`${"─".repeat(50)}`);

  return lines.join("\n");
}
