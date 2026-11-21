/*
 * Connect-N engine + the seven bots, ported from connectn/board.py and
 * connectn/agents.py so the game runs entirely in the browser.
 *
 * Same algorithms and the same budgets as the tournament:
 *   Random, Greedy (1-ply rules), Minimax (depth 3), Alpha-Beta (depth 6,
 *   move ordering + transposition table), Monte Carlo (2,000 playouts),
 *   MCTS/UCT (2,000 iterations), Q-Learning (50,000 self-play games).
 *
 * Works in a page, a Web Worker and Node (for tests).
 */
(function (root) {
  "use strict";

  const WIN = 1000000;

  // ------------------------------------------------------------------ board
  class Board {
    constructor(rows = 6, cols = 7, n = 4) {
      if (n > Math.max(rows, cols)) throw new Error("N is larger than the board");
      this.rows = rows; this.cols = cols; this.n = n;
      this.grid = new Int8Array(rows * cols).fill(-1); // index r*cols + c, r = 0 is the bottom row
      this.heights = new Int8Array(cols);
      this.moves = 0;
      this.history = [];
      const mid = (cols - 1) / 2;
      this.centerOrder = [...Array(cols).keys()].sort((a, b) => Math.abs(a - mid) - Math.abs(b - mid) || a - b);
      this._windows = null;
      this.hash = 0; this.hash2 = 0;
      this._zob = Board.zobrist(rows, cols);
    }
    static zobrist(rows, cols) {
      const key = rows + "x" + cols;
      Board._z = Board._z || {};
      if (!Board._z[key]) {
        let s = 0x9e3779b9 ^ (rows * 131 + cols);
        const rnd = () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return s >>> 0; };
        const t = [];
        for (let i = 0; i < rows * cols * 2; i++) t.push([rnd(), rnd() & 0x1fffff]);
        Board._z[key] = t;
      }
      return Board._z[key];
    }
    get player() { return this.moves & 1; }
    clone() {
      const b = new Board(this.rows, this.cols, this.n);
      b.grid.set(this.grid); b.heights.set(this.heights);
      b.moves = this.moves; b.history = this.history.slice();
      b.hash = this.hash; b.hash2 = this.hash2; b._windows = this._windows;
      return b;
    }
    canPlay(c) { return this.heights[c] < this.rows; }
    legalMoves() { const m = []; for (let c = 0; c < this.cols; c++) if (this.heights[c] < this.rows) m.push(c); return m; }
    orderedMoves() { return this.centerOrder.filter((c) => this.heights[c] < this.rows); }
    play(c) {
      const r = this.heights[c], i = r * this.cols + c, p = this.moves & 1;
      this.grid[i] = p; this.heights[c] = r + 1; this.moves++; this.history.push(c);
      const z = this._zob[i * 2 + p]; this.hash ^= z[0]; this.hash2 ^= z[1];
    }
    undo() {
      const c = this.history.pop(); this.moves--;
      const r = --this.heights[c], i = r * this.cols + c, p = this.grid[i];
      this.grid[i] = -1;
      const z = this._zob[i * 2 + p]; this.hash ^= z[0]; this.hash2 ^= z[1];
    }
    key() { return this.hash2 * 4294967296 + this.hash; }
    isFull() { return this.moves === this.rows * this.cols; }
    // Would dropping in column c give player p (default: side to move) N in a row?
    winningMove(c, p = this.player) {
      const r = this.heights[c];
      if (r >= this.rows) return false;
      return this._lineThrough(r, c, p, true) !== null;
    }
    // Cells of the N-in-a-row through (r, c) for player p, or null.
    _lineThrough(r, c, p, hypothetical) {
      const { rows, cols, n, grid } = this;
      const at = (rr, cc) => (hypothetical && rr === r && cc === c) ? p : grid[rr * cols + cc];
      for (const [dr, dc] of [[0, 1], [1, 0], [1, 1], [1, -1]]) {
        const cells = [[r, c]];
        for (const s of [1, -1]) {
          let rr = r + dr * s, cc = c + dc * s;
          while (rr >= 0 && rr < rows && cc >= 0 && cc < cols && at(rr, cc) === p) {
            cells.push([rr, cc]); rr += dr * s; cc += dc * s;
          }
        }
        if (cells.length >= n) return cells;
      }
      return null;
    }
    lastMoverWon() {
      if (!this.moves) return false;
      const c = this.history[this.history.length - 1], r = this.heights[c] - 1;
      return this._lineThrough(r, c, this.grid[r * this.cols + c], false) !== null;
    }
    winningLine() {
      if (!this.moves) return null;
      const c = this.history[this.history.length - 1], r = this.heights[c] - 1;
      return this._lineThrough(r, c, this.grid[r * this.cols + c], false);
    }
    windows() {
      if (!this._windows) {
        const w = [], { rows, cols, n } = this;
        for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++)
          for (const [dr, dc] of [[1, 0], [0, 1], [1, 1], [-1, 1]]) {
            const er = r + dr * (n - 1), ec = c + dc * (n - 1);
            if (er >= 0 && er < rows && ec >= 0 && ec < cols) {
              const cells = new Int16Array(n);
              for (let k = 0; k < n; k++) cells[k] = (r + dr * k) * cols + (c + dc * k);
              w.push(cells);
            }
          }
        this._windows = w;
      }
      return this._windows;
    }
  }

  // ------------------------------------------------------- shared heuristic
  // Count every N-length line: lines holding only my pieces score 4^k
  // (1000 for N-1), only the opponent's score the negative; mixed lines are dead.
  // Small bonus for centre-column pieces.
  function evaluate(b, p) {
    const n = b.n, g = b.grid;
    let score = 0;
    for (const w of b.windows()) {
      let a = 0, o = 0;
      for (let k = 0; k < n; k++) { const v = g[w[k]]; if (v === p) a++; else if (v === 1 - p) o++; }
      if (a && !o) score += a === n - 1 ? 1000 : 4 ** a;
      else if (o && !a) score -= o === n - 1 ? 1000 : 4 ** o;
    }
    const centres = b.cols % 2 ? [b.centerOrder[0]] : b.centerOrder.slice(0, 2);
    for (const c of centres) for (let r = 0; r < b.heights[c]; r++) {
      const v = g[r * b.cols + c]; score += v === p ? 3 : -3;
    }
    return score;
  }

  function makeRng(seed) {
    let s = (seed >>> 0) || 0x2545f491;
    return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) / 4294967296; };
  }
  const pick = (rng, arr) => arr[Math.floor(rng() * arr.length)];

  // Every bot returns { col, scores: per-column numbers or null, label, stats, note }
  // ---------------------------------------------------------------- Random
  function randomBot(b, rng) {
    return { col: pick(rng, b.legalMoves()), scores: null, note: "Picks any legal column at random." };
  }

  // ---------------------------------------------------------------- Greedy
  function greedyBot(b, rng) {
    const me = b.player, opp = 1 - me, moves = b.legalMoves();
    for (const c of moves) if (b.winningMove(c, me)) return { col: c, scores: null, note: "Found a winning move." };
    for (const c of moves) if (b.winningMove(c, opp)) return { col: c, scores: null, note: "Blocking the opponent's immediate win." };
    const safe = moves.filter((c) => { b.play(c); const bad = b.canPlay(c) && b.winningMove(c, opp); b.undo(); return !bad; });
    const cand = safe.length ? safe : moves;
    const scores = new Array(b.cols).fill(null);
    let best = -Infinity, bestMoves = [];
    for (const c of cand) {
      b.play(c); const s = evaluate(b, me); b.undo();
      scores[c] = s;
      if (s > best) { best = s; bestMoves = [c]; } else if (s === best) bestMoves.push(c);
    }
    const skipped = moves.length - cand.length;
    return { col: pick(rng, bestMoves), scores, label: "Heuristic score after the move",
      note: skipped ? `Skipped ${skipped} column(s) that would hand the opponent a win.` : "No immediate threats: playing the best-looking move." };
  }

  // ------------------------------------------------------ Minimax / Alpha-Beta
  function searchBot(b, rng, depth, prune) {
    const me = b.player, stats = { nodes: 0 };
    const tt = new Map();
    const full = b.rows * b.cols;
    function negamax(d, alpha, beta) {
      stats.nodes++;
      const p = b.player, moves = prune ? b.orderedMoves() : b.legalMoves();
      for (const c of moves) if (b.winningMove(c, p)) return WIN + d;
      if (b.moves + 1 >= full && moves.length === 1) return 0;
      if (d === 0) return evaluate(b, p);
      let key, a0 = alpha;
      if (prune) {
        key = b.key();
        const e = tt.get(key);
        if (e && e.d >= d) {
          if (e.f === 0) return e.v;
          if (e.f === 1 && e.v >= beta) return e.v;
          if (e.f === -1 && e.v <= alpha) return e.v;
        }
      }
      let best = -Infinity;
      for (const c of moves) {
        b.play(c); const v = -negamax(d - 1, -beta, -alpha); b.undo();
        if (v > best) best = v;
        if (prune) { if (v > alpha) alpha = v; if (alpha >= beta) break; }
      }
      if (prune) tt.set(key, { d, f: a0 < best && best < beta ? 0 : best >= beta ? 1 : -1, v: best });
      return best;
    }
    const moves = prune ? b.orderedMoves() : b.legalMoves();
    for (const c of moves) if (b.winningMove(c, me)) return { col: c, scores: null, stats, note: "Found a winning move." };
    const scores = new Array(b.cols).fill(null);
    let best = -Infinity, bestMoves = [];
    for (const c of moves) {
      b.play(c);
      const v = b.isFull() ? 0 : -negamax(depth - 1, -Infinity, Infinity); // full window: exact score for every column
      b.undo();
      scores[c] = v;
      if (v > best) { best = v; bestMoves = [c]; } else if (v === best) bestMoves.push(c);
    }
    const col = pick(rng, bestMoves);
    let note = `Looked ${depth} moves ahead and examined ${stats.nodes.toLocaleString()} positions.`;
    if (best >= WIN - 100) note += ` It can force a win in ${depth - (best - WIN)} moves or fewer.`;
    else if (best <= -WIN + 100) note += " Every move loses against perfect play - it picks the one that loses slowest.";
    return { col, scores, stats, label: "Minimax score (higher is better for the bot)", note };
  }

  // ---------------------------------------------------- random playout
  function playout(b, rng) {
    let played = 0, result = -1;
    for (;;) {
      const moves = b.legalMoves();
      if (!moves.length) break;
      const c = pick(rng, moves), p = b.player, w = b.winningMove(c, p);
      b.play(c); played++;
      if (w) { result = p; break; }
    }
    for (let i = 0; i < played; i++) b.undo();
    return result;
  }

  // ------------------------------------------------------- flat Monte Carlo
  function monteCarloBot(b, rng, playouts = 2000) {
    const me = b.player, moves = b.legalMoves();
    for (const c of moves) if (b.winningMove(c, me)) return { col: c, scores: null, note: "Found a winning move." };
    const per = Math.max(1, Math.floor(playouts / moves.length));
    const scores = new Array(b.cols).fill(null);
    let best = -Infinity, bestMoves = [];
    for (const c of moves) {
      b.play(c);
      let s = 0;
      for (let i = 0; i < per; i++) { const r = playout(b, rng); s += r === me ? 1 : r === -1 ? 0.5 : 0; }
      b.undo();
      s /= per; scores[c] = Math.round(s * 1000) / 10;
      if (s > best) { best = s; bestMoves = [c]; } else if (s === best) bestMoves.push(c);
    }
    return { col: pick(rng, bestMoves), scores, stats: { playouts: per * moves.length },
      label: "Win rate in random games (%)", note: `Played ${per} random games from each column.` };
  }

  // ------------------------------------------------------------- MCTS (UCT)
  function mctsBot(b, rng, iterations = 2000, C = 1.41) {
    const me = b.player, moves = b.legalMoves();
    for (const c of moves) if (b.winningMove(c, me)) return { col: c, scores: null, note: "Found a winning move." };
    const node = (move, parent, untried, player) => ({ move, parent, children: [], untried, visits: 0, wins: 0, player });
    const rootN = node(null, null, moves.slice(), 1 - me);
    for (let it = 0; it < iterations; it++) {
      let nd = rootN, depth = 0, terminal = null;
      while (!nd.untried.length && nd.children.length) { // 1. selection
        const lnN = Math.log(nd.visits);
        let bestV = -Infinity, bestC = null;
        for (const ch of nd.children) {
          const v = ch.wins / ch.visits + C * Math.sqrt(lnN / ch.visits);
          if (v > bestV) { bestV = v; bestC = ch; }
        }
        nd = bestC; b.play(nd.move); depth++;
      }
      if (nd.untried.length && !b.lastMoverWon() && !b.isFull()) { // 2. expansion
        const m = nd.untried.splice(Math.floor(rng() * nd.untried.length), 1)[0];
        const mover = b.player, won = b.winningMove(m, mover);
        b.play(m); depth++;
        const ch = node(m, nd, won ? [] : b.legalMoves(), mover);
        nd.children.push(ch); nd = ch;
        if (won) terminal = mover;
      }
      let winner; // 3. simulation
      if (terminal !== null) winner = terminal;
      else if (b.lastMoverWon()) winner = (b.moves - 1) & 1;
      else if (b.isFull()) winner = -1;
      else winner = playout(b, rng);
      for (; nd; nd = nd.parent) { // 4. backpropagation
        nd.visits++;
        if (winner === -1) nd.wins += 0.5; else if (winner === nd.player) nd.wins += 1;
      }
      for (let i = 0; i < depth; i++) b.undo();
    }
    const scores = new Array(b.cols).fill(null), visits = new Array(b.cols).fill(null);
    let most = -1;
    for (const ch of rootN.children) { visits[ch.move] = ch.visits; scores[ch.move] = Math.round(1000 * ch.wins / ch.visits) / 10; most = Math.max(most, ch.visits); }
    const top = rootN.children.filter((ch) => ch.visits === most).map((ch) => ch.move);
    return { col: pick(rng, top), scores, visits, stats: { simulations: iterations },
      label: "Estimated win rate (%) - bar width = simulations spent", note: `Ran ${iterations.toLocaleString()} simulations, focusing on the most promising columns.` };
  }

  // ------------------------------------------------------- Tabular Q-learning
  const qTables = {};
  function trainQ(rows, cols, n, episodes = 50000, onProgress) {
    const Q = new Map(), rng = makeRng(12345), alpha = 0.3;
    const b0 = new Board(rows, cols, n);
    for (let ep = 0; ep < episodes; ep++) {
      const b = new Board(rows, cols, n);
      b._windows = b0._windows;
      const eps = Math.max(0.05, 0.2 * (1 - ep / episodes));
      for (;;) {
        const k = b.key();
        let q = Q.get(k);
        if (!q) { q = new Float32Array(cols); Q.set(k, q); }
        const moves = b.legalMoves();
        let a;
        if (rng() < eps) a = pick(rng, moves);
        else { let bv = -Infinity, bm = []; for (const m of moves) { if (q[m] > bv) { bv = q[m]; bm = [m]; } else if (q[m] === bv) bm.push(m); } a = pick(rng, bm); }
        const won = b.winningMove(a);
        b.play(a);
        let target;
        if (won) target = 1; else if (b.isFull()) target = 0;
        else { const nq = Q.get(b.key()); if (nq) { let mx = -Infinity; for (const m of b.legalMoves()) mx = Math.max(mx, nq[m]); target = -mx; } else target = 0; }
        q[a] += alpha * (target - q[a]);
        if (won || b.isFull()) break;
      }
      if (onProgress && (ep + 1) % 5000 === 0) onProgress((ep + 1) / episodes, Q.size);
    }
    return Q;
  }
  function qBot(b, rng) {
    const key = `${b.rows}x${b.cols}x${b.n}`;
    const Q = qTables[key];
    const moves = b.legalMoves();
    const q = Q && Q.get(b.key());
    if (!q) return { col: pick(rng, moves), scores: null, known: false, tableSize: Q ? Q.size : 0,
      note: "Never saw this position in training, so it has no idea - it moves at random." };
    const scores = new Array(b.cols).fill(null);
    let bv = -Infinity, bm = [];
    for (const m of moves) { scores[m] = Math.round(q[m] * 100) / 100; if (q[m] > bv) { bv = q[m]; bm = [m]; } else if (q[m] === bv) bm.push(m); }
    return { col: pick(rng, bm), scores, known: true, tableSize: Q.size, label: "Learned value Q (−1 to +1)",
      note: "Recognises this position from training and plays its highest-valued column." };
  }

  const BOTS = {
    random: { name: "Random", family: "Baseline", run: (b, rng) => randomBot(b, rng),
      about: "Picks any legal column. The floor every other bot should beat." },
    greedy: { name: "Greedy", family: "Baseline", run: (b, rng) => greedyBot(b, rng),
      about: "Wins if it can, blocks if it must, otherwise plays the best-looking move. No look-ahead." },
    minimax: { name: "Minimax (depth 3)", family: "Search", run: (b, rng) => searchBot(b, rng, 3, false),
      about: "Tries every sequence of 3 moves and assumes you always find your best reply." },
    alphabeta: { name: "Alpha-Beta (depth 6)", family: "Search", run: (b, rng) => searchBot(b, rng, 6, true),
      about: "Minimax that skips branches proven to be worse, so it can look 6 moves ahead. Tournament winner." },
    montecarlo: { name: "Monte Carlo (2,000)", family: "Sampling", run: (b, rng) => monteCarloBot(b, rng, 2000),
      about: "Plays 2,000 random games from the position, split across the columns, and picks the best win rate." },
    mcts: { name: "MCTS (2,000)", family: "Sampling", run: (b, rng) => mctsBot(b, rng, 2000),
      about: "Grows a search tree and spends its 2,000 random games on the most promising lines." },
    qlearning: { name: "Q-Learning", family: "Learning", run: (b, rng) => qBot(b, rng),
      about: "Learned a table of move values from 50,000 games against itself. Moves at random in positions it never saw." },
  };

  function think(cfg) {
    const b = new Board(cfg.rows, cfg.cols, cfg.n);
    for (const c of cfg.history) b.play(c);
    const rng = makeRng(cfg.seed || (Date.now() ^ (Math.random() * 4294967296)));
    const t0 = (typeof performance !== "undefined" ? performance : Date).now();
    const res = BOTS[cfg.bot].run(b, rng);
    res.ms = (typeof performance !== "undefined" ? performance : Date).now() - t0;
    return res;
  }
  function ensureQ(rows, cols, n, onProgress) {
    const key = `${rows}x${cols}x${n}`;
    if (!qTables[key]) qTables[key] = trainQ(rows, cols, n, 50000, onProgress);
    return qTables[key].size;
  }

  const api = { Board, evaluate, BOTS, think, ensureQ, trainQ, makeRng, WIN };
  root.ConnectN = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;

  // Web Worker protocol
  if (typeof WorkerGlobalScope !== "undefined" && root instanceof WorkerGlobalScope) {
    root.onmessage = (e) => {
      const m = e.data;
      try {
        if (m.bot === "qlearning") {
          ensureQ(m.rows, m.cols, m.n, (pct, size) => root.postMessage({ id: m.id, type: "progress", pct, size }));
        }
        root.postMessage({ id: m.id, type: "move", result: think(m) });
      } catch (err) {
        root.postMessage({ id: m.id, type: "error", message: String(err && err.message || err) });
      }
    };
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
