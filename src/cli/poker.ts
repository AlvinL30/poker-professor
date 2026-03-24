#!/usr/bin/env node
import { readFileSync, writeFileSync, existsSync } from "fs";
import { createInitialGameState, startNewHand, applyAction, getValidActions, isHumanTurn, getTableDisplay } from "../lib/engine/game.js";
import { getOpponentDecision } from "../lib/opponents/personalities.js";
import type { GameState, PlayerAction } from "../types/poker.js";

const STATE_FILE = ".poker-state.json";

function loadState(): GameState | null {
  if (!existsSync(STATE_FILE)) return null;
  try {
    return JSON.parse(readFileSync(STATE_FILE, "utf-8"));
  } catch {
    return null;
  }
}

function saveState(state: GameState): void {
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

function runAIActions(state: GameState): GameState {
  let current = state;
  let safety = 0;

  while (current.phase === "playing" && !isHumanTurn(current) && safety < 50) {
    const player = current.players[current.activePlayerIndex];
    if (!player || player.folded || player.allIn || player.isHuman) break;

    const decision = getOpponentDecision(player.personality!, player.id, current);
    current = applyAction(current, player.id, decision.action, decision.raiseAmount);
    safety++;
  }

  return current;
}

const [, , command, ...args] = process.argv;

switch (command) {
  case "new-game": {
    const state = createInitialGameState();
    saveState(state);
    console.log(JSON.stringify({
      status: "ok",
      message: "New game created. 6 players seated with $200 each.",
      players: state.players.map((p) => ({
        name: p.name,
        personality: p.personality ?? "human",
        chips: p.chips,
      })),
    }));
    break;
  }

  case "deal": {
    let state = loadState();
    if (!state) {
      state = createInitialGameState();
    }

    state = startNewHand(state);
    state = runAIActions(state);
    saveState(state);

    console.log(JSON.stringify({
      status: "ok",
      table: getTableDisplay(state),
      handLog: state.handLog,
      yourCards: state.players[0].holeCards,
      communityCards: state.communityCards,
      pot: state.pot,
      phase: state.phase,
      bettingRound: state.bettingRound,
      waitingForHuman: isHumanTurn(state),
      validActions: isHumanTurn(state) ? getValidActions(state) : [],
      currentBet: state.currentBet,
      yourBet: state.players[0].currentBet,
      yourChips: state.players[0].chips,
      winners: state.winners ?? null,
    }));
    break;
  }

  case "action": {
    let state = loadState();
    if (!state) {
      console.log(JSON.stringify({ status: "error", message: "No game in progress. Run 'new-game' then 'deal'." }));
      break;
    }

    if (!isHumanTurn(state)) {
      console.log(JSON.stringify({ status: "error", message: "Not your turn." }));
      break;
    }

    const actionStr = args[0]?.toLowerCase();
    let action: PlayerAction;
    let raiseAmount: number | undefined;

    if (actionStr === "fold") {
      action = "fold";
    } else if (actionStr === "check") {
      action = "check";
    } else if (actionStr === "call") {
      action = "call";
    } else if (actionStr?.startsWith("raise")) {
      action = "raise";
      raiseAmount = parseInt(args[1] ?? "0", 10);
      if (!raiseAmount || raiseAmount <= 0) {
        raiseAmount = state.currentBet * 2;
      }
    } else if (actionStr === "allin" || actionStr === "all-in") {
      action = "all-in";
    } else {
      console.log(JSON.stringify({
        status: "error",
        message: `Invalid action: "${actionStr}". Valid: fold, check, call, raise <amount>, allin`,
      }));
      break;
    }

    state = applyAction(state, 0, action, raiseAmount);
    state = runAIActions(state);
    saveState(state);

    console.log(JSON.stringify({
      status: "ok",
      table: getTableDisplay(state),
      handLog: state.handLog,
      communityCards: state.communityCards,
      pot: state.pot,
      phase: state.phase,
      bettingRound: state.bettingRound,
      waitingForHuman: isHumanTurn(state),
      validActions: isHumanTurn(state) ? getValidActions(state) : [],
      currentBet: state.currentBet,
      yourBet: state.players[0]?.currentBet ?? 0,
      yourChips: state.players[0]?.chips ?? 0,
      yourFolded: state.players[0]?.folded ?? false,
      winners: state.winners ?? null,
    }));
    break;
  }

  case "state": {
    const state = loadState();
    if (!state) {
      console.log(JSON.stringify({ status: "error", message: "No game in progress." }));
      break;
    }

    console.log(JSON.stringify({
      status: "ok",
      table: getTableDisplay(state),
      handLog: state.handLog,
      phase: state.phase,
      handNumber: state.handNumber,
      pot: state.pot,
      waitingForHuman: isHumanTurn(state),
      validActions: isHumanTurn(state) ? getValidActions(state) : [],
      players: state.players.map((p) => ({
        name: p.name,
        chips: p.chips,
        folded: p.folded,
        personality: p.personality ?? "human",
      })),
      winners: state.winners ?? null,
    }));
    break;
  }

  case "history": {
    const state = loadState();
    if (!state) {
      console.log(JSON.stringify({ status: "error", message: "No game in progress." }));
      break;
    }
    console.log(JSON.stringify({
      status: "ok",
      actionHistory: state.actionHistory,
      handLog: state.handLog,
    }));
    break;
  }

  default:
    console.log(JSON.stringify({
      status: "error",
      message: "Usage: poker <command>\n  new-game  — Start a new game\n  deal      — Deal a new hand\n  action <fold|check|call|raise N|allin>  — Take your action\n  state     — Show current game state\n  history   — Show action history",
    }));
}
