export type Suit = "h" | "d" | "c" | "s";
export type Rank = "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "T" | "J" | "Q" | "K" | "A";

export interface Card {
  rank: Rank;
  suit: Suit;
}

export type HandRank =
  | "high-card" | "pair" | "two-pair" | "three-of-a-kind"
  | "straight" | "flush" | "full-house" | "four-of-a-kind"
  | "straight-flush" | "royal-flush";

export interface HandEvaluation {
  rank: HandRank;
  value: number;
  description: string;
  bestCards: Card[];
}

export type BettingRound = "preflop" | "flop" | "turn" | "river";
export type PlayerAction = "fold" | "check" | "call" | "raise" | "all-in";

export interface ActionRecord {
  playerId: number;
  playerName: string;
  action: PlayerAction;
  amount: number;
  round: BettingRound;
}

export type PersonalityType = "tight-passive" | "loose-aggressive" | "tricky";

export interface Player {
  id: number;
  name: string;
  chips: number;
  holeCards: Card[];
  folded: boolean;
  allIn: boolean;
  currentBet: number;
  isHuman: boolean;
  personality?: PersonalityType;
}

export interface GameState {
  players: Player[];
  communityCards: Card[];
  pot: number;
  currentBet: number;
  activePlayerIndex: number;
  dealerIndex: number;
  bettingRound: BettingRound;
  deck: Card[];
  handNumber: number;
  actionHistory: ActionRecord[];
  phase: "waiting" | "playing" | "showdown" | "hand-complete";
  winners?: { playerId: number; playerName: string; amount: number; hand?: HandEvaluation }[];
  handLog: string[]; // Human-readable log of actions this hand
}
