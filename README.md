# Connect-N AI Showdown

A Connect-N game (any board size, any N) plus seven AI algorithms that play it,
a round-robin tournament between them, extra experiments, a written report and
a presentation.

## What's in this folder

| Path | What it is |
|---|---|
| `connectn/board.py` | The game engine (fast bitboard implementation, any rows x cols, any N) |
| `connectn/agents.py` | The seven algorithms: Random, Greedy, Minimax, Alpha-Beta, Monte Carlo, MCTS, Q-Learning |
| `play.py` | Play in the terminal: you vs an AI, two humans, or AI vs AI |
| `tournament.py` | Round-robin tournament (Connect 4 on 6x7, and Connect 5 on 8x9) |
| `experiments.py` | Pruning efficiency, Alpha-Beta depth scaling, MCTS budget scaling |
| `analyze.py` | Turns raw game logs into standings, Elo ratings, head-to-head tables and charts |
| `results/` | Raw game logs (CSV) and summaries (JSON). The trained Q-tables are not in git (one is over 100 MB); `tournament.py` retrains them in about a minute |
| `charts/` | All charts (PNG) |
| `REPORT.pdf` / `REPORT.md` / `REPORT.html` | The full write-up (same content, three formats) |
| `presentation/ConnectN_AI_Presentation.pptx` | Slide deck to present the project |
| `presentation/build_deck.js` | Script that generates the deck from the results (wording for the experiment slides lives in `narrative.json`) |

## Requirements

Python 3.10+ with `matplotlib` (only needed for charts). The deck builder needs Node.js with `pptxgenjs`.

## Play

```bash
python play.py                              # you vs Alpha-Beta, classic Connect 4
python play.py --opponent mcts              # you vs MCTS
python play.py --rows 8 --cols 9 --n 5      # Connect 5 on a bigger board
python play.py --p1 alphabeta --p2 mcts     # watch two AIs
```

Players: `human, random, greedy, minimax, alphabeta, montecarlo, mcts, qlearning`

## Reproduce the results

```bash
python tournament.py      # ~25 minutes on 6 cores
python experiments.py     # ~10 minutes
python analyze.py         # standings + charts
node presentation/build_deck.js
```
