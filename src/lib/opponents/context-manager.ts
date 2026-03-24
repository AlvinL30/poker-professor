import type { GameState, ActionRecord, Card } from "../../types/poker.js";
import type { PlayerContext, VisibleGameState, OpponentRead } from "../../types/context.js";
import { createPlayerContext } from "../../types/context.js";

/** Extract what a specific player can see from the full game state */
export function getVisibleState(fullState: GameState, playerId: number): VisibleGameState {
  const me = fullState.players[playerId];
  return {
    myCards: me?.holeCards ?? [],
    communityCards: fullState.communityCards,
    pot: fullState.pot,
    currentBet: fullState.currentBet,
    myCurrentBet: me?.currentBet ?? 0,
    myChips: me?.chips ?? 0,
    bettingRound: fullState.bettingRound,
    actions: fullState.actionHistory.map((a) => ({
      playerId: a.playerId,
      playerName: a.playerName,
      action: a.action,
      amount: a.amount,
      round: a.round,
    })),
    activePlayers: fullState.players.map((p) => ({
      id: p.id,
      name: p.name,
      chips: p.chips,
      currentBet: p.currentBet,
      folded: p.folded,
      allIn: p.allIn,
    })),
    dealerIndex: fullState.dealerIndex,
    myIndex: playerId,
    numPlayers: fullState.players.length,
    handNumber: fullState.handNumber,
  };
}

/** Initialize contexts for all AI players at game start */
export function initializeContexts(state: GameState): Map<number, PlayerContext> {
  const contexts = new Map<number, PlayerContext>();
  const playerInfo = state.players.map((p) => ({ id: p.id, name: p.name }));

  for (const player of state.players) {
    if (!player.isHuman && player.personality) {
      contexts.set(
        player.id,
        createPlayerContext(player.id, player.name, player.personality, playerInfo)
      );
    }
  }

  return contexts;
}

/** Update all AI player contexts after a hand completes */
export function updateContextsAfterHand(
  contexts: Map<number, PlayerContext>,
  completedState: GameState
): void {
  const actions = completedState.actionHistory;
  const winners = completedState.winners ?? [];

  for (const [playerId, ctx] of contexts) {
    ctx.handsPlayed++;
    ctx.handsInCurrentGear++;

    // Update reads on each opponent based on their actions this hand
    for (const [opId, read] of ctx.reads) {
      const opponent = completedState.players[opId];
      if (!opponent) continue;

      read.handsObserved++;

      // Track VPIP: did this opponent voluntarily put money in preflop?
      const preflopActions = actions.filter(
        (a) => a.playerId === opId && a.round === "preflop"
      );
      const voluntaryPreflop = preflopActions.some(
        (a) => a.action === "call" || a.action === "raise" || a.action === "all-in"
      );
      if (voluntaryPreflop) read.vpipHands++;
      read.vpip = read.handsObserved > 0 ? read.vpipHands / read.handsObserved : 0;

      // Track aggression: postflop bets/raises vs checks/calls
      const postflopActions = actions.filter(
        (a) => a.playerId === opId && a.round !== "preflop"
      );
      for (const a of postflopActions) {
        if (a.action === "raise" || a.action === "all-in") {
          read.aggressionBets++;
        } else if (a.action === "check" || a.action === "call") {
          read.aggressionPassive++;
        }
      }
      const totalPostflop = read.aggressionBets + read.aggressionPassive;
      read.aggressionFreq = totalPostflop > 0 ? read.aggressionBets / totalPostflop : 0;

      // Track fold-to-bet
      const facedBet = actions.some(
        (a) =>
          a.playerId !== opId &&
          (a.action === "raise" || a.action === "all-in") &&
          actions.some((b) => b.playerId === opId && b.round === a.round)
      );
      if (facedBet) {
        read.foldToBetOpportunities++;
        if (opponent.folded) read.foldToBetCount++;
      }

      // Track showdowns — record what opponents showed
      if (completedState.phase === "hand-complete" && completedState.winners) {
        if (!opponent.folded && opponent.holeCards.length > 0) {
          const wasWinner = winners.some((w) => w.playerId === opId);
          // Determine if it was a "bluff" — won without a strong hand, or lost while betting
          const opponentBet = actions.some(
            (a) => a.playerId === opId && (a.action === "raise" || a.action === "all-in") && a.round !== "preflop"
          );
          const wasBluff = opponentBet && !wasWinner;

          read.showdowns.push({
            handNumber: completedState.handNumber,
            cards: [...opponent.holeCards],
            wasBluff,
          });

          // Keep last 10 showdowns
          if (read.showdowns.length > 10) {
            read.showdowns = read.showdowns.slice(-10);
          }
        }
      }
    }

    // Update own emotional state
    const me = completedState.players[playerId];
    const won = winners.some((w) => w.playerId === playerId);
    const invested = 200 - (me?.chips ?? 200); // rough P&L for this hand
    const pnl = won ? (winners.find((w) => w.playerId === playerId)?.amount ?? 0) - invested : -invested;

    ctx.recentResults.push(pnl);
    if (ctx.recentResults.length > 10) ctx.recentResults.shift();
    ctx.totalPnL += pnl;

    if (won) {
      ctx.handsWon++;
      ctx.consecutiveLosses = 0;
      ctx.confidence = Math.min(1, ctx.confidence + 0.05);
      ctx.tiltFactor = Math.max(0, ctx.tiltFactor - 0.1);
    } else if (pnl < -20) {
      ctx.consecutiveLosses++;
      ctx.confidence = Math.max(0, ctx.confidence - 0.08);
      if (ctx.consecutiveLosses >= 3) {
        ctx.tiltFactor = Math.min(1, ctx.tiltFactor + 0.15);
      }
      if (pnl < ctx.biggestLossThisSession) {
        ctx.biggestLossThisSession = pnl;
      }
    }

    // Gear shifting for tricky players
    if (ctx.personality === "tricky" && ctx.handsInCurrentGear >= 6 + Math.floor(Math.random() * 5)) {
      ctx.currentGear = ctx.currentGear === "passive" ? "aggressive" : "passive";
      ctx.handsInCurrentGear = 0;
    }
  }
}

/** Serialize contexts to JSON-safe format (Maps → objects) */
export function serializeContexts(contexts: Map<number, PlayerContext>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [id, ctx] of contexts) {
    const reads: Record<string, OpponentRead> = {};
    for (const [opId, read] of ctx.reads) {
      reads[String(opId)] = read;
    }
    result[String(id)] = { ...ctx, reads };
  }
  return result;
}

/** Deserialize contexts from JSON */
export function deserializeContexts(data: Record<string, unknown>): Map<number, PlayerContext> {
  const contexts = new Map<number, PlayerContext>();
  for (const [idStr, ctxData] of Object.entries(data)) {
    const ctx = ctxData as PlayerContext & { reads: Record<string, OpponentRead> };
    const reads = new Map<number, OpponentRead>();
    if (ctx.reads && typeof ctx.reads === "object") {
      for (const [opIdStr, read] of Object.entries(ctx.reads)) {
        reads.set(Number(opIdStr), read as OpponentRead);
      }
    }
    contexts.set(Number(idStr), { ...ctx, reads });
  }
  return contexts;
}
