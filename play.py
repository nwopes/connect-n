"""
Play Connect-N in the terminal - against a friend, against any AI, or watch
two AIs play each other.

Examples:
    python play.py                                   # you vs Alpha-Beta, classic Connect 4
    python play.py --opponent mcts                   # you vs MCTS
    python play.py --rows 8 --cols 9 --n 5           # Connect 5 on a bigger board
    python play.py --p1 human --p2 human             # two humans
    python play.py --p1 alphabeta --p2 mcts          # watch two AIs
    python play.py --p1 mcts --p2 human              # AI moves first

Players: human, random, greedy, minimax, alphabeta, montecarlo, mcts, qlearning
"""

from __future__ import annotations

import argparse
import os
import time

from connectn import (Board, RandomAgent, GreedyAgent, MinimaxAgent, AlphaBetaAgent,
                      MonteCarloAgent, MCTSAgent, QLearningAgent)

COLORS = os.environ.get("NO_COLOR") is None
RED, YEL, DIM, RST = ("\033[91m", "\033[93m", "\033[2m", "\033[0m") if COLORS else ("",) * 4


def make(kind, rows, cols, n):
    kind = kind.lower()
    if kind == "human":
        return None
    if kind == "random":
        return RandomAgent()
    if kind == "greedy":
        return GreedyAgent()
    if kind == "minimax":
        return MinimaxAgent(depth=3)
    if kind == "alphabeta":
        return AlphaBetaAgent(depth=6)
    if kind == "montecarlo":
        return MonteCarloAgent(playouts=2000)
    if kind == "mcts":
        return MCTSAgent(iterations=2000)
    if kind == "qlearning":
        print("Training Q-learning agent (20,000 self-play games)...")
        q = QLearningAgent(rows, cols, n, episodes=20_000)
        q.train(verbose=False)
        return q
    raise SystemExit(f"unknown player type: {kind}")


def show(board):
    sym = {-1: f"{DIM}.{RST}", 0: f"{RED}X{RST}", 1: f"{YEL}O{RST}"}
    print()
    for r in range(board.rows - 1, -1, -1):
        print("  " + " ".join(sym[board.cell(r, c)] for c in range(board.cols)))
    print("  " + " ".join(str(c % 10) for c in range(board.cols)))
    print()


def ask(board, label):
    while True:
        raw = input(f"{label} - choose a column (0-{board.cols - 1}, q to quit): ").strip()
        if raw.lower() == "q":
            raise SystemExit
        if raw.isdigit() and 0 <= int(raw) < board.cols and board.can_play(int(raw)):
            return int(raw)
        print("  That column is not playable.")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--rows", type=int, default=6)
    ap.add_argument("--cols", type=int, default=7)
    ap.add_argument("--n", type=int, default=4, help="pieces in a row needed to win")
    ap.add_argument("--p1", default="human")
    ap.add_argument("--p2", default=None)
    ap.add_argument("--opponent", default="alphabeta", help="shortcut for --p2")
    args = ap.parse_args()
    p2 = args.p2 or args.opponent

    board = Board(args.rows, args.cols, args.n)
    kinds = [args.p1, p2]
    players = [make(k, args.rows, args.cols, args.n) for k in kinds]
    labels = [f"{RED}X{RST} ({kinds[0]})", f"{YEL}O{RST} ({kinds[1]})"]
    print(f"Connect {args.n} on a {args.rows}x{args.cols} board: {labels[0]} vs {labels[1]}")

    while True:
        show(board)
        p = board.player
        agent = players[p]
        if agent is None:
            col = ask(board, labels[p])
        else:
            t = time.perf_counter()
            col = agent.choose(board)
            print(f"{labels[p]} plays column {col}  ({(time.perf_counter() - t) * 1000:.0f} ms)")
        board.play(col)
        if board.last_mover_won():
            show(board)
            print(f"{labels[p]} wins in {board.moves} moves!")
            break
        if board.is_full():
            show(board)
            print("Draw - the board is full.")
            break


if __name__ == "__main__":
    main()
