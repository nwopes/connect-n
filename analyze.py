"""
Analyse tournament results: standings, head-to-head matrix, Elo ratings,
thinking time and first-move advantage. Writes:

    results/<config>_summary.json   - all numbers (used by the report & deck)
    charts/<config>_*.png           - charts for the report

Usage:  python analyze.py
"""

from __future__ import annotations

import csv
import json
import math
import os
from collections import defaultdict

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.colors import LinearSegmentedColormap

from tournament import CONFIGS, DISPLAY

HERE = os.path.dirname(os.path.abspath(__file__))
RESULTS = os.path.join(HERE, "results")
CHARTS = os.path.join(HERE, "charts")

NAVY = "#1B2A4A"
GOLD = "#C98A00"
RED = "#C8102E"
INK = "#1F2328"
MUTED = "#6B7280"
GRID = "#E5E7EB"


def bradley_terry_elo(agents, games, iters=2000):
    """Fit Bradley-Terry strengths (draws = half a win each way, plus a tiny
    prior of one draw against every opponent so unbeaten agents stay finite),
    then convert to the Elo scale with the field average at 1500."""
    wins = defaultdict(float)
    n_ij = defaultdict(float)
    for a in agents:
        for b in agents:
            if a < b:
                wins[(a, b)] += 0.5
                wins[(b, a)] += 0.5
                n_ij[(a, b)] += 1
                n_ij[(b, a)] += 1
    for g in games:
        a, b, w = g["first"], g["second"], g["winner"]
        n_ij[(a, b)] += 1
        n_ij[(b, a)] += 1
        if w == a:
            wins[(a, b)] += 1
        elif w == b:
            wins[(b, a)] += 1
        else:
            wins[(a, b)] += 0.5
            wins[(b, a)] += 0.5
    p = {a: 1.0 for a in agents}
    for _ in range(iters):
        new = {}
        for i in agents:
            W = sum(wins[(i, j)] for j in agents if j != i)
            denom = sum(n_ij[(i, j)] / (p[i] + p[j]) for j in agents if j != i)
            new[i] = W / denom if denom else p[i]
        g = math.exp(sum(math.log(v) for v in new.values()) / len(new))
        p = {k: v / g for k, v in new.items()}
    return {a: 1500 + 400 * math.log10(p[a]) for a in agents}


def analyse(name):
    path = os.path.join(RESULTS, f"{name}_games.csv")
    if not os.path.exists(path):
        print(f"skip {name}: no results")
        return None
    cfg = CONFIGS[name]
    games = list(csv.DictReader(open(path)))
    agents = cfg["agents"]

    stats = {a: dict(w=0, d=0, l=0, time=0.0, moves=0, w_first=0, g_first=0,
                     w_second=0, g_second=0, length_sum=0, games=0) for a in agents}
    h2h = {a: {b: [0, 0, 0] for b in agents} for a in agents}  # w,d,l
    first_wins = second_wins = draws = 0
    q_seen = q_unseen = 0
    for g in games:
        a, b, w = g["first"], g["second"], g["winner"]
        L = int(g["length"])
        sa, sb = stats[a], stats[b]
        sa["time"] += float(g["first_time"]); sa["moves"] += int(g["first_moves"])
        sb["time"] += float(g["second_time"]); sb["moves"] += int(g["second_moves"])
        sa["g_first"] += 1; sb["g_second"] += 1
        for s in (sa, sb):
            s["length_sum"] += L
            s["games"] += 1
        q_seen += int(g["q_seen"]); q_unseen += int(g["q_unseen"])
        if w == a:
            sa["w"] += 1; sb["l"] += 1; sa["w_first"] += 1
            h2h[a][b][0] += 1; h2h[b][a][2] += 1
            first_wins += 1
        elif w == b:
            sb["w"] += 1; sa["l"] += 1; sb["w_second"] += 1
            h2h[b][a][0] += 1; h2h[a][b][2] += 1
            second_wins += 1
        else:
            sa["d"] += 1; sb["d"] += 1
            h2h[a][b][1] += 1; h2h[b][a][1] += 1
            draws += 1

    elo = bradley_terry_elo(agents, games)
    table = []
    for a in agents:
        s = stats[a]
        n = s["w"] + s["d"] + s["l"]
        table.append(dict(
            key=a, name=DISPLAY[a], games=n, wins=s["w"], draws=s["d"], losses=s["l"],
            score_pct=round(100 * (s["w"] + 0.5 * s["d"]) / n, 1),
            win_pct=round(100 * s["w"] / n, 1),
            elo=round(elo[a]),
            ms_per_move=round(1000 * s["time"] / max(1, s["moves"]), 2),
            win_pct_first=round(100 * s["w_first"] / max(1, s["g_first"]), 1),
            win_pct_second=round(100 * s["w_second"] / max(1, s["g_second"]), 1),
            avg_game_length=round(s["length_sum"] / max(1, s["games"]), 1),
        ))
    table.sort(key=lambda r: -r["elo"])
    matrix = {a: {b: (round(100 * (h2h[a][b][0] + 0.5 * h2h[a][b][1]) / sum(h2h[a][b]), 1)
                      if sum(h2h[a][b]) else None) for b in agents} for a in agents}
    h2h_raw = {a: {b: h2h[a][b] for b in agents} for a in agents}
    summary = dict(
        config=name, rows=cfg["rows"], cols=cfg["cols"], n=cfg["n"],
        games=len(games), games_per_pair=cfg["games_per_pair"],
        first_player_win_pct=round(100 * first_wins / len(games), 1),
        second_player_win_pct=round(100 * second_wins / len(games), 1),
        draw_pct=round(100 * draws / len(games), 1),
        q_known_state_pct=round(100 * q_seen / max(1, q_seen + q_unseen), 1),
        q_decisions=q_seen + q_unseen,
        standings=table, h2h_score_pct=matrix, h2h_wdl=h2h_raw,
        order=[r["key"] for r in table],
    )
    with open(os.path.join(RESULTS, f"{name}_summary.json"), "w") as f:
        json.dump(summary, f, indent=2)
    make_charts(name, summary)
    print_summary(summary)
    return summary


def _style(ax):
    for s in ("top", "right"):
        ax.spines[s].set_visible(False)
    for s in ("left", "bottom"):
        ax.spines[s].set_color(GRID)
    ax.tick_params(colors=MUTED, labelsize=10)
    ax.grid(axis="x", color=GRID, linewidth=0.8)
    ax.set_axisbelow(True)


def make_charts(name, s):
    os.makedirs(CHARTS, exist_ok=True)
    plt.rcParams["font.family"] = "DejaVu Sans"
    title_cfg = f"Connect-{s['n']} on a {s['rows']}x{s['cols']} board"
    rows = s["standings"]

    # 1. Elo leaderboard
    fig, ax = plt.subplots(figsize=(8, 4.2), dpi=150)
    names = [r["name"] for r in rows][::-1]
    vals = [r["elo"] for r in rows][::-1]
    colors = [NAVY] * len(vals)
    colors[-1] = GOLD
    base = min(vals) - 100
    bars = ax.barh(names, [v - base for v in vals], left=base, color=colors, height=0.6)
    for b, v in zip(bars, vals):
        ax.text(b.get_x() + b.get_width() + 8, b.get_y() + b.get_height() / 2, f"{v}",
                va="center", fontsize=10, color=INK)
    _style(ax)
    ax.set_xlabel("Elo rating (field average = 1500)", color=MUTED)
    ax.set_title(f"Elo ratings - {title_cfg}", loc="left", color=INK, fontsize=13, fontweight="bold")
    fig.tight_layout()
    fig.savefig(os.path.join(CHARTS, f"{name}_elo.png"))
    plt.close(fig)

    # 2. Win / draw / loss stacked
    fig, ax = plt.subplots(figsize=(8, 4.2), dpi=150)
    names = [r["name"] for r in rows][::-1]
    W = [100 * r["wins"] / r["games"] for r in rows][::-1]
    D = [100 * r["draws"] / r["games"] for r in rows][::-1]
    Lo = [100 * r["losses"] / r["games"] for r in rows][::-1]
    ax.barh(names, W, color=NAVY, height=0.6, label="Win", edgecolor="white", linewidth=1.5)
    ax.barh(names, D, left=W, color="#9CA3AF", height=0.6, label="Draw", edgecolor="white", linewidth=1.5)
    ax.barh(names, Lo, left=[w + d for w, d in zip(W, D)], color=RED, height=0.6,
            label="Loss", edgecolor="white", linewidth=1.5)
    for i, w in enumerate(W):
        if w > 8:
            ax.text(w / 2, i, f"{w:.0f}%", ha="center", va="center", color="white", fontsize=9)
    _style(ax)
    ax.set_xlim(0, 100)
    ax.set_xlabel("% of games", color=MUTED)
    ax.legend(ncol=3, loc="lower center", bbox_to_anchor=(0.5, 1.0), frameon=False, fontsize=9)
    ax.set_title(f"Win / draw / loss - {title_cfg}", loc="left", color=INK, fontsize=13,
                 fontweight="bold", pad=24)
    fig.tight_layout()
    fig.savefig(os.path.join(CHARTS, f"{name}_wdl.png"))
    plt.close(fig)

    # 3. Head-to-head heatmap
    order = s["order"]
    labels = [DISPLAY[k] for k in order]
    M = [[s["h2h_score_pct"][a][b] if a != b else float("nan") for b in order] for a in order]
    cmap = LinearSegmentedColormap.from_list("div", [RED, "#F3F4F6", NAVY])
    fig, ax = plt.subplots(figsize=(8, 6.4), dpi=150)
    im = ax.imshow(M, cmap=cmap, vmin=0, vmax=100)
    ax.set_xticks(range(len(order)), labels, rotation=35, ha="right", fontsize=9, color=INK)
    ax.set_yticks(range(len(order)), labels, fontsize=9, color=INK)
    for i in range(len(order)):
        for j in range(len(order)):
            if i != j:
                v = M[i][j]
                ax.text(j, i, f"{v:.0f}", ha="center", va="center", fontsize=9,
                        color="white" if (v > 75 or v < 25) else INK)
    for sp in ax.spines.values():
        sp.set_visible(False)
    cb = fig.colorbar(im, ax=ax, fraction=0.04, pad=0.02)
    cb.set_label("Row agent's score % vs column agent", color=MUTED)
    ax.set_title(f"Head-to-head score % - {title_cfg}", loc="left", color=INK, fontsize=13,
                 fontweight="bold")
    fig.tight_layout()
    fig.savefig(os.path.join(CHARTS, f"{name}_h2h.png"))
    plt.close(fig)

    # 4. Strength vs thinking time
    fig, ax = plt.subplots(figsize=(8, 4.6), dpi=150)
    for r in rows:
        t = max(r["ms_per_move"], 0.01)
        ax.scatter(t, r["elo"], s=70, color=GOLD if r is rows[0] else NAVY,
                   edgecolor="white", linewidth=2, zorder=3)
        off = (8, -14) if r["key"] in ("QLearning", "MCTS") else (8, 4)
        ax.annotate(r["name"], (t, r["elo"]), textcoords="offset points", xytext=off,
                    ha="left",
                    fontsize=9, color=INK)
    ax.set_xscale("log")
    ax.margins(x=0.08, y=0.12)
    _style(ax)
    ax.grid(axis="y", color=GRID, linewidth=0.8)
    ax.set_xlabel("Average thinking time per move (ms, log scale)", color=MUTED)
    ax.set_ylabel("Elo", color=MUTED)
    ax.set_title(f"Strength vs. thinking time - {title_cfg}", loc="left", color=INK,
                 fontsize=13, fontweight="bold")
    fig.tight_layout()
    fig.savefig(os.path.join(CHARTS, f"{name}_time.png"))
    plt.close(fig)


def print_summary(s):
    print(f"\n=== {s['config']}: Connect-{s['n']} {s['rows']}x{s['cols']}, {s['games']} games ===")
    print(f"first player wins {s['first_player_win_pct']}%, second {s['second_player_win_pct']}%, "
          f"draws {s['draw_pct']}%;  Q-learning knew {s['q_known_state_pct']}% of positions")
    print(f"{'Agent':22} {'Elo':>5} {'Score%':>7} {'W':>4} {'D':>4} {'L':>4} {'ms/move':>9}")
    for r in s["standings"]:
        print(f"{r['name']:22} {r['elo']:>5} {r['score_pct']:>7} {r['wins']:>4} {r['draws']:>4} "
              f"{r['losses']:>4} {r['ms_per_move']:>9}")


if __name__ == "__main__":
    for name in CONFIGS:
        analyse(name)
