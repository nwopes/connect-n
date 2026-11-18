"""
Extra experiments on classic Connect 4 (6x7):

  A. Pruning efficiency - nodes searched by plain Minimax vs Alpha-Beta at the
     same depth (both return identical moves; only the work differs).
  B. Depth scaling - Alpha-Beta at depth 1..7 vs a fixed reference opponent
     (Minimax depth 3), to see how look-ahead buys strength - and the
     odd/even depth ("horizon parity") effect.
  C. Budget scaling - MCTS with 250..8000 iterations vs the same reference.

Writes results/experiments.json and charts/exp_*.png

Usage:  python experiments.py
"""

from __future__ import annotations

import json
import math
import os
import random
import time
from concurrent.futures import ProcessPoolExecutor

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

from connectn import Board, MinimaxAgent, AlphaBetaAgent, MCTSAgent
from tournament import opening_book

HERE = os.path.dirname(os.path.abspath(__file__))
RESULTS = os.path.join(HERE, "results")
CHARTS = os.path.join(HERE, "charts")
NAVY, GOLD, RED, INK, MUTED, GRID = "#1B2A4A", "#C98A00", "#C8102E", "#1F2328", "#6B7280", "#E5E7EB"

GAMES = 60  # per setting: 30 random openings, each played with both colours


def build(spec, seed):
    kind, x = spec
    if kind == "ab":
        return AlphaBetaAgent(depth=x, seed=seed)
    if kind == "mm":
        return MinimaxAgent(depth=x, seed=seed)
    if kind == "mcts":
        return MCTSAgent(iterations=x, seed=seed)
    raise ValueError(kind)


def game(args):
    spec, ref, test_first, seed, opening = args
    rng = random.Random(seed)
    test, other = build(spec, rng.randrange(1 << 30)), build(ref, rng.randrange(1 << 30))
    players = [test, other] if test_first else [other, test]
    b = Board()
    for col in opening:
        b.play(col)
    t_test = 0.0
    n_test = 0
    while True:
        p = b.player
        t0 = time.perf_counter()
        c = players[p].choose(b)
        if players[p] is test:
            t_test += time.perf_counter() - t0
            n_test += 1
        b.play(c)
        if b.last_mover_won():
            win = players[p] is test
            return spec, (1.0 if win else 0.0), t_test / max(1, n_test)
        if b.is_full():
            return spec, 0.5, t_test / max(1, n_test)


def pruning_experiment():
    rng = random.Random(99)
    positions = []
    while len(positions) < 25:
        b = Board()
        for _ in range(rng.randrange(4, 14)):
            if b.result() is not None:
                break
            b.play(rng.choice(b.legal_moves()))
        if b.result() is None:
            positions.append(b)
    out = []
    for d in range(1, 6):
        mm, ab = MinimaxAgent(depth=d, seed=1), AlphaBetaAgent(depth=d, seed=1)
        mm_nodes = ab_nodes = 0
        mm_t = ab_t = 0.0
        for b in positions:
            mm.nodes = ab.nodes = 0
            t = time.perf_counter(); mm.choose(b.copy()); mm_t += time.perf_counter() - t
            t = time.perf_counter(); ab.choose(b.copy()); ab_t += time.perf_counter() - t
            mm_nodes += mm.nodes
            ab_nodes += ab.nodes
        k = len(positions)
        out.append(dict(depth=d, minimax_nodes=round(mm_nodes / k), alphabeta_nodes=round(ab_nodes / k),
                        minimax_ms=round(1000 * mm_t / k, 2), alphabeta_ms=round(1000 * ab_t / k, 2)))
        print(f"  depth {d}: minimax {mm_nodes / k:,.0f} nodes, alpha-beta {ab_nodes / k:,.0f} nodes")
    return out


def run_matches(specs, ref, workers):
    jobs, seed = [], 777
    book = opening_book(7)
    for s in specs:
        for g in range(GAMES):
            seed += 1
            jobs.append((s, ref, g % 2 == 0, seed, book[g // 2]))
    agg = {s: [0.0, 0, 0.0] for s in specs}
    with ProcessPoolExecutor(max_workers=workers) as ex:
        for spec, score, t in ex.map(game, jobs, chunksize=1):
            a = agg[spec]
            a[0] += score; a[1] += 1; a[2] += t
    return [dict(setting=s[1], score_pct=round(100 * agg[s][0] / agg[s][1], 1),
                 ms_per_move=round(1000 * agg[s][2] / agg[s][1], 1)) for s in specs]


def charts(res):
    os.makedirs(CHARTS, exist_ok=True)

    def style(ax):
        for s in ("top", "right"):
            ax.spines[s].set_visible(False)
        for s in ("left", "bottom"):
            ax.spines[s].set_color(GRID)
        ax.tick_params(colors=MUTED)
        ax.grid(axis="y", color=GRID)
        ax.set_axisbelow(True)

    p = res["pruning"]
    fig, ax = plt.subplots(figsize=(8, 4.2), dpi=150)
    d = [r["depth"] for r in p]
    ax.plot(d, [r["minimax_nodes"] for r in p], "-o", color=RED, lw=2, ms=8, label="Minimax (no pruning)")
    ax.plot(d, [r["alphabeta_nodes"] for r in p], "-o", color=NAVY, lw=2, ms=8, label="Alpha-Beta")
    ax.set_yscale("log")
    style(ax)
    ax.set_xticks(d)
    ax.set_xlabel("Search depth (moves ahead)", color=MUTED)
    ax.set_ylabel("Positions examined per move (log)", color=MUTED)
    ax.legend(frameon=False)
    ax.set_title("Pruning: same answer, far less work", loc="left", fontweight="bold", color=INK)
    fig.tight_layout(); fig.savefig(os.path.join(CHARTS, "exp_pruning.png")); plt.close(fig)

    for key, xlabel, title, fname, logx in (
        ("depth", "Alpha-Beta search depth", "Alpha-Beta depth vs. Minimax (d=3)", "exp_depth.png", False),
        ("mcts", "MCTS iterations per move", "MCTS budget vs. Minimax (d=3)", "exp_mcts.png", True)):
        r = res[key]
        fig, ax = plt.subplots(figsize=(8, 4.2), dpi=150)
        x = [v["setting"] for v in r]
        y = [v["score_pct"] for v in r]
        ax.plot(x, y, "-o", color=NAVY, lw=2, ms=8)
        for xi, yi in zip(x, y):
            ax.annotate(f"{yi:.0f}%", (xi, yi), textcoords="offset points", xytext=(0, 9),
                        ha="center", fontsize=9, color=INK)
        ax.axhline(50, color=MUTED, lw=1, ls="--")
        if logx:
            ax.set_xscale("log", base=2)
            ax.set_xticks(x, [str(v) for v in x])
        else:
            ax.set_xticks(x)
        style(ax)
        ax.set_ylim(0, 105)
        ax.set_xlabel(xlabel, color=MUTED)
        ax.set_ylabel("Score % vs. Minimax (d=3)", color=MUTED)
        ax.set_title(title, loc="left", fontweight="bold", color=INK)
        fig.tight_layout(); fig.savefig(os.path.join(CHARTS, fname)); plt.close(fig)


def main():
    os.makedirs(RESULTS, exist_ok=True)
    workers = 6
    ref = ("mm", 3)
    print("A. pruning efficiency")
    res = {"pruning": pruning_experiment()}
    print("B. alpha-beta depth scaling")
    res["depth"] = run_matches([("ab", d) for d in range(1, 8)], ref, workers)
    print(res["depth"])
    print("C. MCTS budget scaling")
    res["mcts"] = run_matches([("mcts", n) for n in (250, 500, 1000, 2000, 4000, 8000)], ref, workers)
    print(res["mcts"])
    res["games_per_setting"] = GAMES
    with open(os.path.join(RESULTS, "experiments.json"), "w") as f:
        json.dump(res, f, indent=2)
    charts(res)


if __name__ == "__main__":
    main()
