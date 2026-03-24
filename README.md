# Poker Professor

A poker dojo that teaches pattern recognition through play — powered by Claude Code.

## What is this?

Poker Professor is a playable Texas Hold'em game where Claude Code acts as both the game master and your personal poker coach. Instead of teaching you GTO math, it teaches you to **read the table** — noticing opponent behavioral patterns, spotting style changes, and connecting what you observe to better decisions.

## How to play

1. Clone this repo
2. Install dependencies: `npm install`
3. Open Claude Code in this directory: `claude`
4. Say: "Let's play poker"

That's it. Claude reads the CLAUDE.md instructions, runs the game engine, displays the table, and coaches you as you play.

## Requirements

- [Claude Code](https://claude.ai/claude-code) installed and configured
- Node.js 18+

## How it works

- **Game engine:** TypeScript CLI that manages poker state (dealing, betting, hand evaluation)
- **AI opponents:** 3 personality archetypes (Tight-Passive, Loose-Aggressive, Tricky) with distinct behavioral models
- **Coach:** Claude itself — it tracks opponent patterns across hands and teaches you to read the table
- **State:** Persisted in `.poker-state.json` so you can resume across sessions

## Opponents

| Name | Style | Key Pattern |
|------|-------|-------------|
| Mike, Dave | Tight-Passive | Rarely bet — when they do, believe them |
| Sarah, Lisa | Loose-Aggressive | Bet everything — their bets don't always mean strength |
| Chen | Tricky | Slow-plays monsters, bluffs with air, changes gears |

## License

MIT
