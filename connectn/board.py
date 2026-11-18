"""
Connect-N game engine (bitboard implementation).

The board is `rows` x `cols`; players drop pieces into columns and the first
player to line up `n` pieces horizontally, vertically or diagonally wins.

Bitboard layout (column-major, one spare "sentinel" bit on top of each column):

    col:   0   1   2  ...
         [ 6] [13] [20]   <- sentinel row (always empty, stops wrap-around)
         [ 5] [12] [19]
         ...
         [ 0] [ 7] [14]   <- bottom row

    bit index = col * (rows + 1) + row

Lines are detected with shifts: a run of n pieces in direction d exists iff
    b & (b >> d) & (b >> 2d) & ... & (b >> (n-1)d)  != 0
with d = 1 (vertical), H (horizontal), H+1 and H-1 (diagonals), H = rows + 1.
"""

from __future__ import annotations


class Board:
    __slots__ = ("rows", "cols", "n", "H", "bb", "heights", "moves",
                 "history", "_dirs", "_top", "_windows", "_center_order")

    def __init__(self, rows: int = 6, cols: int = 7, n: int = 4):
        if n > max(rows, cols):
            raise ValueError("n is larger than the board - nobody could ever win")
        self.rows, self.cols, self.n = rows, cols, n
        self.H = rows + 1
        self.bb = [0, 0]                 # one bitboard per player
        self.heights = [c * self.H for c in range(cols)]  # next free bit per column
        self.moves = 0
        self.history: list[int] = []
        self._dirs = (1, self.H, self.H + 1, self.H - 1)
        self._top = [c * self.H + rows for c in range(cols)]  # sentinel bit per column
        self._windows = None
        # Columns ordered centre-first (good move ordering for search).
        mid = (cols - 1) / 2
        self._center_order = sorted(range(cols), key=lambda c: (abs(c - mid), c))

    # ------------------------------------------------------------------ basics
    @property
    def player(self) -> int:
        """Index (0 or 1) of the player whose turn it is."""
        return self.moves & 1

    def copy(self) -> "Board":
        b = Board.__new__(Board)
        b.rows, b.cols, b.n, b.H = self.rows, self.cols, self.n, self.H
        b.bb = self.bb[:]
        b.heights = self.heights[:]
        b.moves = self.moves
        b.history = self.history[:]
        b._dirs, b._top = self._dirs, self._top
        b._windows = self._windows
        b._center_order = self._center_order
        return b

    def can_play(self, col: int) -> bool:
        return self.heights[col] != self._top[col]

    def legal_moves(self) -> list[int]:
        return [c for c in range(self.cols) if self.heights[c] != self._top[c]]

    def ordered_moves(self) -> list[int]:
        """Legal moves, centre columns first."""
        return [c for c in self._center_order if self.heights[c] != self._top[c]]

    def play(self, col: int) -> None:
        bit = self.heights[col]
        self.bb[self.moves & 1] |= 1 << bit
        self.heights[col] = bit + 1
        self.moves += 1
        self.history.append(col)

    def undo(self) -> None:
        col = self.history.pop()
        self.moves -= 1
        self.heights[col] -= 1
        self.bb[self.moves & 1] ^= 1 << self.heights[col]

    # ------------------------------------------------------------- win checks
    def has_won(self, p: int) -> bool:
        b = self.bb[p]
        n = self.n
        for d in self._dirs:
            x = b
            for i in range(1, n):
                x &= b >> (d * i)
                if not x:
                    break
            if x:
                return True
        return False

    def last_mover_won(self) -> bool:
        return self.moves > 0 and self.has_won((self.moves - 1) & 1)

    def is_full(self) -> bool:
        return self.moves == self.rows * self.cols

    def winning_move(self, col: int, p: int | None = None) -> bool:
        """Would playing `col` win immediately for player p (default: side to move)?"""
        if p is None:
            p = self.player
        bit = self.heights[col]
        b = self.bb[p] | (1 << bit)
        n = self.n
        for d in self._dirs:
            x = b
            for i in range(1, n):
                x &= b >> (d * i)
                if not x:
                    break
            if x:
                return True
        return False

    def result(self):
        """None while the game is running, else 0/1 (winner) or -1 (draw)."""
        if self.has_won(0):
            return 0
        if self.has_won(1):
            return 1
        if self.is_full():
            return -1
        return None

    # -------------------------------------------------------- evaluation help
    def windows(self) -> list[int]:
        """Every possible n-in-a-row line on this board, as a bitmask (cached)."""
        if self._windows is None:
            wins = []
            R, C, N, H = self.rows, self.cols, self.n, self.H
            for c in range(C):
                for r in range(R):
                    for dc, dr in ((0, 1), (1, 0), (1, 1), (1, -1)):
                        ec, er = c + dc * (N - 1), r + dr * (N - 1)
                        if 0 <= ec < C and 0 <= er < R:
                            m = 0
                            for i in range(N):
                                m |= 1 << ((c + dc * i) * H + (r + dr * i))
                            wins.append(m)
            self._windows = wins
        return self._windows

    def cell(self, r: int, c: int) -> int:
        """-1 empty, 0 player one, 1 player two (r = 0 is the bottom row)."""
        bit = 1 << (c * self.H + r)
        if self.bb[0] & bit:
            return 0
        if self.bb[1] & bit:
            return 1
        return -1

    def key(self):
        return (self.bb[0], self.bb[1])

    def __str__(self) -> str:
        sym = {-1: ".", 0: "X", 1: "O"}
        lines = []
        for r in range(self.rows - 1, -1, -1):
            lines.append(" ".join(sym[self.cell(r, c)] for c in range(self.cols)))
        lines.append(" ".join(str(c % 10) for c in range(self.cols)))
        return "\n".join(lines)
