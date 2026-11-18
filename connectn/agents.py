"""
Seven Connect-N playing algorithms, from trivial to strong.

Every agent exposes:
    name           - short display name
    choose(board)  - returns the column to play (board is left unchanged)

All agents use random tie-breaking so that repeated games between two
deterministic searchers are not identical.
"""

from __future__ import annotations

import math
import os
import pickle
import random
import time
from array import array

from .board import Board

_TABLE_CACHE: dict = {}   # one loaded Q-table per process


def _pack_key(b0, b1):
    return (b0 << 128) | b1

WIN = 1_000_000


# --------------------------------------------------------------------------
# Shared heuristic evaluation
# --------------------------------------------------------------------------
def evaluate(board: Board, p: int) -> int:
    """
    Static score of the position from player p's point of view.

    For every possible n-length line ("window") on the board:
      * if it holds only p's pieces, add a weight that grows steeply with the
        number of pieces (1, 2 -> small, n-1 -> large: a real threat);
      * if it holds only the opponent's pieces, subtract the same weight;
      * mixed windows are dead and score 0.
    Pieces in the centre column(s) get a small bonus because they take part
    in the most windows.
    """
    me, opp = board.bb[p], board.bb[1 - p]
    n = board.n
    score = 0
    for w in board.windows():
        a = me & w
        b = opp & w
        if a and not b:
            k = a.bit_count()
            score += 1000 if k == n - 1 else 4 ** k
        elif b and not a:
            k = b.bit_count()
            score -= 1000 if k == n - 1 else 4 ** k
    # centre bonus
    H = board.H
    col_mask = (1 << board.rows) - 1
    for c in board._center_order[: 1 if board.cols % 2 else 2]:
        m = col_mask << (c * H)
        score += 3 * ((me & m).bit_count() - (opp & m).bit_count())
    return score


# --------------------------------------------------------------------------
# 1. Random
# --------------------------------------------------------------------------
class RandomAgent:
    """Baseline: picks a uniformly random legal column."""
    name = "Random"

    def __init__(self, seed=None):
        self.rng = random.Random(seed)

    def choose(self, board: Board) -> int:
        return self.rng.choice(board.legal_moves())


# --------------------------------------------------------------------------
# 2. Greedy (rule-based, 1-ply)
# --------------------------------------------------------------------------
class GreedyAgent:
    """
    Hand-written rules + one-move lookahead:
      1. take a winning move if there is one,
      2. otherwise block the opponent's immediate winning move,
      3. avoid moves that let the opponent win by playing on top,
      4. among what is left, play the move with the best heuristic score.
    """
    name = "Greedy"

    def __init__(self, seed=None):
        self.rng = random.Random(seed)

    def choose(self, board: Board) -> int:
        me = board.player
        opp = 1 - me
        moves = board.legal_moves()
        for c in moves:
            if board.winning_move(c, me):
                return c
        for c in moves:
            if board.winning_move(c, opp):
                return c
        safe = []
        for c in moves:
            board.play(c)
            gives_win = board.can_play(c) and board.winning_move(c, opp)
            board.undo()
            if not gives_win:
                safe.append(c)
        candidates = safe or moves
        best, best_moves = -math.inf, []
        for c in candidates:
            board.play(c)
            s = evaluate(board, me)
            board.undo()
            if s > best:
                best, best_moves = s, [c]
            elif s == best:
                best_moves.append(c)
        return self.rng.choice(best_moves)


# --------------------------------------------------------------------------
# 3. Plain Minimax (no pruning)
# --------------------------------------------------------------------------
class MinimaxAgent:
    """
    Classic depth-limited minimax (negamax form) with the heuristic at the
    leaves. Explores EVERY branch, so its cost grows as b^d (b ~ 7).
    """

    def __init__(self, depth=3, seed=None):
        self.depth = depth
        self.rng = random.Random(seed)
        self.name = f"Minimax (d={depth})"
        self.nodes = 0

    def _negamax(self, board: Board, depth: int) -> int:
        self.nodes += 1
        me = board.player
        moves = board.legal_moves()
        for c in moves:
            if board.winning_move(c, me):
                return WIN + depth          # win sooner = better
        if board.moves + 1 >= board.rows * board.cols and len(moves) == 1:
            return 0                        # last move, no win -> draw
        if depth == 0:
            return evaluate(board, me)
        best = -math.inf
        for c in moves:
            board.play(c)
            v = -self._negamax(board, depth - 1)
            board.undo()
            if v > best:
                best = v
        return best

    def choose(self, board: Board) -> int:
        me = board.player
        moves = board.legal_moves()
        for c in moves:
            if board.winning_move(c, me):
                return c
        best, best_moves = -math.inf, []
        for c in moves:
            board.play(c)
            v = 0 if board.is_full() else -self._negamax(board, self.depth - 1)
            board.undo()
            if v > best:
                best, best_moves = v, [c]
            elif v == best:
                best_moves.append(c)
        return self.rng.choice(best_moves)


# --------------------------------------------------------------------------
# 4. Alpha-Beta pruning
# --------------------------------------------------------------------------
class AlphaBetaAgent:
    """
    Minimax + alpha-beta pruning + centre-first move ordering +
    a transposition table. Returns exactly the same value minimax would,
    but skips branches that provably cannot change the decision, so it can
    afford to look roughly twice as deep for the same cost.
    """

    def __init__(self, depth=6, seed=None):
        self.depth = depth
        self.rng = random.Random(seed)
        self.name = f"Alpha-Beta (d={depth})"
        self.nodes = 0

    def _negamax(self, board, depth, alpha, beta):
        self.nodes += 1
        me = board.player
        moves = board.ordered_moves()
        for c in moves:
            if board.winning_move(c, me):
                return WIN + depth
        if board.moves + 1 >= board.rows * board.cols and len(moves) == 1:
            return 0
        if depth == 0:
            return evaluate(board, me)

        key = (board.bb[0], board.bb[1])
        entry = self.tt.get(key)
        if entry is not None and entry[0] >= depth:
            _, flag, val = entry
            if flag == 0:
                return val
            if flag == 1 and val >= beta:
                return val
            if flag == -1 and val <= alpha:
                return val

        alpha0 = alpha
        best = -math.inf
        for c in moves:
            board.play(c)
            v = -self._negamax(board, depth - 1, -beta, -alpha)
            board.undo()
            if v > best:
                best = v
            if v > alpha:
                alpha = v
            if alpha >= beta:
                break                       # prune: opponent will avoid this line
        flag = 0 if alpha0 < best < beta else (1 if best >= beta else -1)
        self.tt[key] = (depth, flag, best)
        return best

    def choose(self, board: Board) -> int:
        self.tt = {}
        me = board.player
        moves = board.ordered_moves()
        for c in moves:
            if board.winning_move(c, me):
                return c
        best, best_moves = -math.inf, []
        for c in moves:
            board.play(c)
            if board.is_full():
                v = 0
            else:
                # window (best-1, inf) lets us detect exact ties for random tie-break
                lo = best - 1 if best != -math.inf else -math.inf
                v = -self._negamax(board, self.depth - 1, -math.inf, -lo)
            board.undo()
            if v > best:
                best, best_moves = v, [c]
            elif v == best:
                best_moves.append(c)
        return self.rng.choice(best_moves)


# --------------------------------------------------------------------------
# Random playout used by both Monte-Carlo methods
# --------------------------------------------------------------------------
def random_playout(board: Board, rng: random.Random) -> int:
    """Play random moves to the end. Returns winner (0/1) or -1 for a draw.
    The board is restored afterwards."""
    played = 0
    result = -1
    while True:
        moves = board.legal_moves()
        if not moves:
            break
        c = rng.choice(moves)
        p = board.player
        win = board.winning_move(c, p)
        board.play(c)
        played += 1
        if win:
            result = p
            break
    for _ in range(played):
        board.undo()
    return result


# --------------------------------------------------------------------------
# 5. Flat (pure) Monte-Carlo
# --------------------------------------------------------------------------
class MonteCarloAgent:
    """
    For each legal move, play many completely random games to the end and
    pick the move with the best average result. No tree, no heuristic.
    The playout budget is split evenly between moves.
    """

    def __init__(self, playouts=1000, seed=None):
        self.playouts = playouts
        self.rng = random.Random(seed)
        self.name = f"Monte Carlo ({playouts})"

    def choose(self, board: Board) -> int:
        me = board.player
        moves = board.legal_moves()
        for c in moves:
            if board.winning_move(c, me):
                return c
        per_move = max(1, self.playouts // len(moves))
        best, best_moves = -math.inf, []
        for c in moves:
            board.play(c)
            score = 0.0
            for _ in range(per_move):
                r = random_playout(board, self.rng)
                score += 1.0 if r == me else (0.5 if r == -1 else 0.0)
            board.undo()
            score /= per_move
            if score > best:
                best, best_moves = score, [c]
            elif score == best:
                best_moves.append(c)
        return self.rng.choice(best_moves)


# --------------------------------------------------------------------------
# 6. Monte-Carlo Tree Search (UCT)
# --------------------------------------------------------------------------
class _Node:
    __slots__ = ("move", "parent", "children", "untried", "visits", "wins", "player")

    def __init__(self, move, parent, untried, player):
        self.move = move            # move that led here
        self.parent = parent
        self.children = []
        self.untried = untried      # moves not yet expanded
        self.visits = 0
        self.wins = 0.0             # from the view of `player` (who made `move`)
        self.player = player


class MCTSAgent:
    """
    Monte-Carlo Tree Search with the UCT selection rule:
        select child maximising  wins/visits + c * sqrt(ln(parent visits) / visits)
    Four phases per iteration: Selection -> Expansion -> Simulation -> Backprop.
    Unlike flat Monte-Carlo it grows a search tree and spends more playouts on
    promising lines, so its estimates sharpen where it matters.
    """

    def __init__(self, iterations=1000, c=1.41, seed=None):
        self.iterations = iterations
        self.c = c
        self.rng = random.Random(seed)
        self.name = f"MCTS ({iterations})"

    def choose(self, board: Board) -> int:
        me = board.player
        moves = board.legal_moves()
        for c in moves:
            if board.winning_move(c, me):
                return c
        rng = self.rng
        root = _Node(None, None, moves[:], 1 - me)
        log = math.log
        sqrt = math.sqrt
        for _ in range(self.iterations):
            node = root
            depth = 0
            terminal_winner = None
            # 1. Selection
            while not node.untried and node.children:
                lnN = log(node.visits)
                cc = self.c
                node = max(node.children,
                           key=lambda ch: ch.wins / ch.visits + cc * sqrt(lnN / ch.visits))
                board.play(node.move)
                depth += 1
            # 2. Expansion
            if node.untried and board.result() is None:
                m = node.untried.pop(rng.randrange(len(node.untried)))
                mover = board.player
                won = board.winning_move(m, mover)
                board.play(m)
                depth += 1
                child = _Node(m, node, [] if won else board.legal_moves(), mover)
                node.children.append(child)
                node = child
                if won:
                    terminal_winner = mover
            # 3. Simulation
            if terminal_winner is not None:
                winner = terminal_winner
            else:
                res = board.result()
                winner = res if res is not None else random_playout(board, rng)
            # 4. Backpropagation
            while node is not None:
                node.visits += 1
                if winner == -1:
                    node.wins += 0.5
                elif winner == node.player:
                    node.wins += 1.0
                node = node.parent
            for _ in range(depth):
                board.undo()
        most = max(ch.visits for ch in root.children)
        return rng.choice([ch.move for ch in root.children if ch.visits == most])


# --------------------------------------------------------------------------
# 7. Tabular Q-Learning (reinforcement learning)
# --------------------------------------------------------------------------
class QLearningAgent:
    """
    Learns a table Q[state][move] by playing against itself (self-play) and
    updating with the Q-learning rule, negamax style (the opponent's best
    value is our worst):
        target = reward                          if the move ends the game
        target = -max_a' Q[next_state][a']       otherwise
        Q[s][a] += alpha * (target - Q[s][a])
    At play time it picks argmax Q; for a state it has never seen it has no
    knowledge at all and falls back to a random move.
    """

    def __init__(self, rows=6, cols=7, n=4, episodes=100_000, alpha=0.3,
                 epsilon=0.2, table_path=None, seed=None):
        self.rows, self.cols, self.n = rows, cols, n
        self.episodes = episodes
        self.alpha = alpha
        self.epsilon = epsilon
        self.rng = random.Random(seed)
        self.name = "Q-Learning"
        self.Q: dict = {}
        self.seen = 0
        self.unseen = 0
        self.table_path = table_path
        self.packed = None        # compact table used at play time
        if table_path and os.path.exists(table_path):
            if table_path not in _TABLE_CACHE:
                with open(table_path, "rb") as f:
                    _TABLE_CACHE[table_path] = pickle.load(f)
            self.packed = _TABLE_CACHE[table_path]

    def _q(self, key, ncols):
        q = self.Q.get(key)
        if q is None:
            q = [0.0] * ncols
            self.Q[key] = q
        return q

    def train(self, verbose=True):
        rng = random.Random(12345)
        start = time.time()
        for ep in range(self.episodes):
            board = Board(self.rows, self.cols, self.n)
            eps = max(0.05, self.epsilon * (1 - ep / self.episodes))
            while True:
                key = board.key()
                q = self._q(key, board.cols)
                moves = board.legal_moves()
                if rng.random() < eps:
                    a = rng.choice(moves)
                else:
                    bv = max(q[m] for m in moves)
                    a = rng.choice([m for m in moves if q[m] == bv])
                won = board.winning_move(a)
                board.play(a)
                if won:
                    target = 1.0
                elif board.is_full():
                    target = 0.0
                else:
                    nq = self.Q.get(board.key())
                    nm = board.legal_moves()
                    target = -max(nq[m] for m in nm) if nq else 0.0
                q[a] += self.alpha * (target - q[a])
                if won or board.is_full():
                    break
            if verbose and (ep + 1) % 20000 == 0:
                print(f"  Q-learning: {ep + 1}/{self.episodes} episodes, "
                      f"{len(self.Q):,} states, {time.time() - start:.0f}s")
        # Compact form: int key -> 4-byte floats, to keep memory low.
        self.packed = {_pack_key(*k): array("f", v).tobytes() for k, v in self.Q.items()}
        if self.table_path:
            with open(self.table_path, "wb") as f:
                pickle.dump(self.packed, f, protocol=pickle.HIGHEST_PROTOCOL)
        self.Q = {}

    def choose(self, board: Board) -> int:
        moves = board.legal_moves()
        raw = self.packed.get(_pack_key(board.bb[0], board.bb[1])) if self.packed else None
        q = array("f", raw) if raw is not None else None
        if q is None:
            self.unseen += 1
            return self.rng.choice(moves)
        self.seen += 1
        bv = max(q[m] for m in moves)
        return self.rng.choice([m for m in moves if q[m] == bv])
