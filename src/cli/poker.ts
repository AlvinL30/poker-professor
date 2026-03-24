#!/usr/bin/env node
import { readFileSync, writeFileSync, existsSync } from "fs";
import { createInitialGameState, startNewHand, applyAction, getValidActions, isHumanTurn, getTableDisplay } from "../lib/engine/game.js";
import { getContextualDecision } from "../lib/opponents/personalities.js";
import { initializeContexts, getVisibleState, updateContextsAfterHand, serializeContexts, deserializeContexts } from "../lib/opponents/context-manager.js";
import type { GameState, PlayerAction } from "../types/poker.js";
import type { PlayerContext } from "../types/context.js";

const STATE_FILE = ".poker-state.json";
const CONTEXT_FILE = ".poker-contexts.json";

function loadState(): GameState | null {
  if (!existsSync(STATE_FILE)) return null;
  try { return JSON.parse(readFileSync(STATE_FILE, "utf-8")); } catch { return null; }
}

function saveState(state: GameState): void {
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

function loadContexts(): Map<number, PlayerContext> | null {
  if (!existsSync(CONTEXT_FILE)) return null;
  try {
    const data = JSON.parse(readFileSync(CONTEXT_FILE, "utf-8"));
    return deserializeContexts(data);
  } catch { return null; }
}

function saveContexts(contexts: Map<number, PlayerContext>): void {
  writeFileSync(CONTEXT_FILE, JSON.stringify(serializeContexts(contexts), null, 2));
}

function runAIActions(state: GameState, contexts: Map<number, PlayerContext>): GameState {
  let current = state;
  let safety = 0;

  while (current.phase === "playing" && !isHumanTurn(current) && safety < 50) {
    const player = current.players[current.activePlayerIndex];
    if (!player || player.folded || player.allIn || player.isHuman) break;

    const ctx = contexts.get(player.id);
    if (!ctx) break;

    const visible = getVisibleState(current, player.id);
    const decision = getContextualDecision(ctx, visible);
    current = applyAction(current, player.id, decision.action, decision.raiseAmount);
    safety++;
  }

  // If hand just completed, update all contexts
  if (current.phase === "hand-complete") {
    updateContextsAfterHand(contexts, current);
  }

  return current;
}

function outputJSON(data: Record<string, unknown>): void {
  console.log(JSON.stringify(data));
}

const [, , command, ...args] = process.argv;

switch (command) {
  case "new-game": {
    const state = createInitialGameState();
    const contexts = initializeContexts(state);
    saveState(state);
    saveContexts(contexts);
    outputJSON({
      status: "ok",
      message: "New game created. 6 players seated with $200 each.",
      players: state.players.map((p) => ({
        name: p.name,
        personality: p.personality ?? "human",
        chips: p.chips,
      })),
    });
    break;
  }

  case "deal": {
    let state = loadState();
    let contexts = loadContexts();
    if (!state) {
      state = createInitialGameState();
      contexts = initializeContexts(state);
    }
    if (!contexts) contexts = initializeContexts(state);

    state = startNewHand(state);
    state = runAIActions(state, contexts);
    saveState(state);
    saveContexts(contexts);

    outputJSON({
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
    });
    break;
  }

  case "action": {
    let state = loadState();
    let contexts = loadContexts();
    if (!state) {
      outputJSON({ status: "error", message: "No game in progress. Run 'new-game' then 'deal'." });
      break;
    }
    if (!contexts) contexts = initializeContexts(state);

    if (!isHumanTurn(state)) {
      outputJSON({ status: "error", message: "Not your turn." });
      break;
    }

    const actionStr = args[0]?.toLowerCase();
    let action: PlayerAction;
    let raiseAmount: number | undefined;

    if (actionStr === "fold") action = "fold";
    else if (actionStr === "check") action = "check";
    else if (actionStr === "call") action = "call";
    else if (actionStr?.startsWith("raise")) {
      action = "raise";
      raiseAmount = parseInt(args[1] ?? "0", 10);
      if (!raiseAmount || raiseAmount <= 0) raiseAmount = state.currentBet * 2;
    } else if (actionStr === "allin" || actionStr === "all-in") {
      action = "all-in";
    } else {
      outputJSON({ status: "error", message: `Invalid action: "${actionStr}". Valid: fold, check, call, raise <amount>, allin` });
      break;
    }

    state = applyAction(state, 0, action, raiseAmount);
    state = runAIActions(state, contexts);
    saveState(state);
    saveContexts(contexts);

    outputJSON({
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
    });
    break;
  }

  case "state": {
    const state = loadState();
    if (!state) { outputJSON({ status: "error", message: "No game in progress." }); break; }
    outputJSON({
      status: "ok",
      table: getTableDisplay(state),
      handLog: state.handLog,
      phase: state.phase,
      handNumber: state.handNumber,
      pot: state.pot,
      waitingForHuman: isHumanTurn(state),
      validActions: isHumanTurn(state) ? getValidActions(state) : [],
      players: state.players.map((p) => ({
        name: p.name, chips: p.chips, folded: p.folded, personality: p.personality ?? "human",
      })),
      winners: state.winners ?? null,
    });
    break;
  }

  case "history": {
    const state = loadState();
    if (!state) { outputJSON({ status: "error", message: "No game in progress." }); break; }
    outputJSON({ status: "ok", actionHistory: state.actionHistory, handLog: state.handLog });
    break;
  }

  default:
    outputJSON({
      status: "error",
      message: "Usage: poker <command>\n  new-game  — Start a new game\n  deal      — Deal a new hand\n  action <fold|check|call|raise N|allin>  — Take your action\n  state     — Show current game state\n  history   — Show action history",
    });
}
