"""
Round-robin tournament between all Connect-N agents.

Every pair of agents plays GAMES_PER_PAIR games, half with each agent moving
first (moving first is a big advantage in Connect-4). Games run in parallel
on all CPU cores. Results go to results/<config>_games.csv and are analysed
by analyze.py.

Usage:
    python tournament.py                 # main Connect-4 (6x7) + Connect-5 (8x9)
    python tournament.py --quick         # small smoke-test run
"""

from __future__ import annotations

import argparse
import csv
import itertools
import os
import random
import time
from concurrent.futures import ProcessPoolExecutor, as_completed

from connectn import (Board, RandomAgent, GreedyAgent, MinimaxAgent,
                      AlphaBetaAgent, MonteCarloAgent, MCTSAgent, QLearningAgent)

HERE = os.path.dirname(os.path.abspath(__file__))
RESULTS = os.path.join(HERE, "results")

# Fixed computational budgets (not wall-clock limits) so results are
# reproducible on any machine. Monte Carlo and MCTS get the SAME number of
# random playouts so the comparison between them is fair.
AGENT_SPECS = {
    "Random":     lambda cfg, s: RandomAgent(seed=s),
    "Greedy":     lambda cfg, s: GreedyAgent(seed=s),
    "Minimax":    lambda cfg, s: MinimaxAgent(depth=3, seed=s),
    "AlphaBeta":  lambda cfg, s: AlphaBetaAgent(depth=6, seed=s),
    "MonteCarlo": lambda cfg, s: MonteCarloAgent(playouts=2000, seed=s),
    "MCTS":       lambda cfg, s: MCTSAgent(iterations=2000, seed=s),
    "QLearning":  lambda cfg, s: QLearningAgent(cfg["rows"], cfg["cols"], cfg["n"],
                                                table_path=q_table_path(cfg), seed=s),
}

DISPLAY = {
    "Random": "Random", "Greedy": "Greedy (1-ply)", "Minimax": "Minimax (d=3)",
    "AlphaBeta": "Alpha-Beta (d=6)", "MonteCarlo": "Monte Carlo (2000)",
    "MCTS": "MCTS (2000)", "QLearning": "Q-Learning",
}

CONFIGS = {
    "connect4": dict(rows=6, cols=7, n=4, games_per_pair=40,
                     agents=list(AGENT_SPECS)),
    "connect5": dict(rows=8, cols=9, n=5, games_per_pair=20,
                     agents=["Random", "Greedy", "Minimax", "AlphaBeta",
                             "MonteCarlo", "MCTS", "QLearning"]),
}


def q_table_path(cfg):
    return os.path.join(RESULTS, f"qtable_{cfg['rows']}x{cfg['cols']}_n{cfg['n']}"
                                 f"_{cfg.get('q_episodes', 50_000)}.pkl")


def opening_book(cols, plies=2, seed=7):
    """All possible openings of `plies` random moves, in a fixed shuffled order.
    Every pairing uses the same openings, and plays each one twice with the
    sides swapped, so neither the opening nor the first-move advantage favours
    anyone. Without this, deterministic searchers replay the same game."""
    openings = [list(p) for p in itertools.product(range(cols), repeat=plies)]
    random.Random(seed).shuffle(openings)
    return openings


def play_game(cfg, first, second, seed, opening=()):
    """Play one game (after the forced opening moves). Returns a dict describing it."""
    rng = random.Random(seed)
    agents = [AGENT_SPECS[first](cfg, rng.randrange(1 << 30)),
              AGENT_SPECS[second](cfg, rng.randrange(1 << 30))]
    board = Board(cfg["rows"], cfg["cols"], cfg["n"])
    for col in opening:
        board.play(col)
    think = [0.0, 0.0]
    moves_made = [0, 0]
    winner = None
    while True:
        p = board.player
        t0 = time.perf_counter()
        col = agents[p].choose(board)
        think[p] += time.perf_counter() - t0
        moves_made[p] += 1
        if not board.can_play(col):
            winner = 1 - p          # illegal move forfeits (never happens, but be safe)
            break
        board.play(col)
        if board.last_mover_won():
            winner = p
            break
        if board.is_full():
            winner = -1
            break
    q_seen = q_unseen = 0
    for a in agents:
        if isinstance(a, QLearningAgent):
            q_seen += a.seen
            q_unseen += a.unseen
    return {
        "first": first, "second": second,
        "winner": {0: first, 1: second, -1: "draw"}[winner],
        "length": board.moves,
        "first_time": think[0], "first_moves": moves_made[0],
        "second_time": think[1], "second_moves": moves_made[1],
        "q_seen": q_seen, "q_unseen": q_unseen,
        "opening": " ".join(map(str, opening)),
        "moves": " ".join(map(str, board.history)),
    }


def run_config(name, cfg, workers):
    os.makedirs(RESULTS, exist_ok=True)
    # Train the Q-learning table once, before the tournament.
    if "QLearning" in cfg["agents"] and not os.path.exists(q_table_path(cfg)):
        print(f"[{name}] training Q-learning agent ({cfg['q_episodes']:,} self-play games)...")
        t0 = time.time()
        q = QLearningAgent(cfg["rows"], cfg["cols"], cfg["n"],
                           episodes=cfg["q_episodes"], table_path=q_table_path(cfg))
        q.train()
        print(f"[{name}] Q-table: {len(q.Q):,} states learned in {time.time() - t0:.0f}s")

    jobs = []
    seed = 2026
    book = opening_book(cfg["cols"])
    for a, b in itertools.combinations(cfg["agents"], 2):
        for g in range(cfg["games_per_pair"]):
            first, second = (a, b) if g % 2 == 0 else (b, a)
            seed += 1
            jobs.append((first, second, seed, book[(g // 2) % len(book)]))
    print(f"[{name}] {len(jobs)} games (random 2-move openings, sides swapped) on a {cfg['rows']}x{cfg['cols']} board, "
          f"connect {cfg['n']}, {workers} workers")

    out = os.path.join(RESULTS, f"{name}_games.csv")
    rows = []
    t0 = time.time()
    with ProcessPoolExecutor(max_workers=workers) as ex:
        futs = [ex.submit(play_game, cfg, f, s, sd, op) for f, s, sd, op in jobs]
        for i, fut in enumerate(as_completed(futs), 1):
            rows.append(fut.result())
            if i % 50 == 0 or i == len(futs):
                print(f"  {i}/{len(futs)} games done ({time.time() - t0:.0f}s)")
    rows.sort(key=lambda r: (r["first"], r["second"]))
    with open(out, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0]))
        w.writeheader()
        w.writerows(rows)
    print(f"[{name}] saved {out}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--quick", action="store_true")
    ap.add_argument("--only", choices=list(CONFIGS))
    ap.add_argument("--workers", type=int, default=6)
    args = ap.parse_args()
    for name, cfg in CONFIGS.items():
        if args.only and name != args.only:
            continue
        cfg = dict(cfg)
        cfg.setdefault("q_episodes", 50_000)
        if args.quick:
            cfg["games_per_pair"] = 2
            cfg["q_episodes"] = 2000
            name = name + "_quick"
        run_config(name, cfg, args.workers)


if __name__ == "__main__":
    main()
