// Builds presentation/ConnectN_AI_Presentation.pptx from the results in ../results.
//   cd presentation && node build_deck.js
//
// Visual world: the Connect-4 board itself. Navy board, red and gold pieces, and
// discs as the one recurring device (bullets, step markers, data marks). No card
// grids, no stat tiles: every slide's visual carries real content.
const path = require("path");
const fs = require("fs");
const pptxgen = require("pptxgenjs");

const ROOT = path.join(__dirname, "..");
const RES = process.env.RESULTS_DIR || path.join(ROOT, "results");
const c4 = JSON.parse(fs.readFileSync(path.join(RES, "connect4_summary.json")));
const c5 = JSON.parse(fs.readFileSync(path.join(RES, "connect5_summary.json")));
const exp = JSON.parse(fs.readFileSync(path.join(RES, "experiments.json")));
const OUT = process.env.OUT || path.join(__dirname, "ConnectN_AI_Presentation.pptx");
const N = JSON.parse(fs.readFileSync(path.join(__dirname, "narrative.json"))); // result-dependent wording

let applyTheme = null;
for (const p of [path.join(__dirname, "apply_theme.js"), process.env.APPLY_THEME || ""]) {
  if (p && fs.existsSync(p)) { applyTheme = require(p).applyTheme; break; }
}

// ---------------------------------------------------------------- theme
const HEX = {
  ink: "1F2328", white: "FFFFFF", navy: "1B2A4A", tint: "EEF1F6",
  red: "C8102E", gold: "E0A100", blue: "3A5A8C", gray: "6B7280", grid: "E5E7EB", green: "2E7D5B",
};
const THEME = {
  name: "Connect-N",
  headFontFace: "Bahnschrift SemiBold", // ships with Windows 10/11 and Office for Windows
  bodyFontFace: "Calibri",
  colors: {
    dk1: HEX.ink, lt1: HEX.white, dk2: HEX.navy, lt2: HEX.tint,
    accent1: HEX.navy, accent2: HEX.red, accent3: HEX.gold, accent4: HEX.blue,
    accent5: HEX.gray, accent6: HEX.green, hlink: "1B4F9C", folHlink: HEX.gray,
  },
};
const HEAD = THEME.headFontFace;

const pres = new pptxgen();
pres.layout = "LAYOUT_WIDE"; // 13.333 x 7.5
pres.title = "Which AI Plays Connect-N Best?";
pres.author = "Connect-N AI Showdown";
pres.theme = { headFontFace: THEME.headFontFace, bodyFontFace: THEME.bodyFontFace };
const C = pres.SchemeColor;

// ---------------------------------------------------------------- layouts
pres.defineSlideMaster({
  title: "TITLE_DARK",
  background: { color: C.text2 },
  objects: [
    { placeholder: { options: { name: "title", type: "title", x: 0.7, y: 1.7, w: 6.7, h: 2.4,
        fontSize: 50, color: C.background1, valign: "bottom", align: "left", margin: 0 }, text: "" } },
    { placeholder: { options: { name: "body", type: "body", x: 0.7, y: 4.4, w: 6.4, h: 1.3,
        fontSize: 20, color: C.background2, valign: "top", align: "left", margin: 0 }, text: "" } },
  ],
});
pres.defineSlideMaster({
  title: "CONTENT",
  background: { color: C.background1 },
  margin: [0.5, 0.6, 0.6, 0.6],
  objects: [
    { placeholder: { options: { name: "title", type: "title", x: 0.6, y: 0.4, w: 12.1, h: 0.85,
        fontSize: 32, color: C.text2, valign: "middle", align: "left", margin: 0 }, text: "" } },
    { text: { text: "Connect-N AI Showdown", options: { x: 0.6, y: 7.0, w: 5, h: 0.3,
        fontSize: 10, color: C.accent5, margin: 0 } } },
  ],
  slideNumber: { x: 12.2, y: 7.0, w: 0.5, h: 0.3, fontSize: 10, color: C.accent5, align: "right" },
});
pres.defineSlideMaster({
  title: "CONTENT_DARK",
  background: { color: C.text2 },
  margin: [0.5, 0.6, 0.6, 0.6],
  objects: [
    { placeholder: { options: { name: "title", type: "title", x: 0.6, y: 0.4, w: 12.1, h: 0.85,
        fontSize: 32, color: C.background1, valign: "middle", align: "left", margin: 0 }, text: "" } },
    { text: { text: "Connect-N AI Showdown", options: { x: 0.6, y: 7.0, w: 5, h: 0.3,
        fontSize: 10, color: C.background2, margin: 0 } } },
  ],
  slideNumber: { x: 12.2, y: 7.0, w: 0.5, h: 0.3, fontSize: 10, color: C.background2, align: "right" },
});

// ---------------------------------------------------------------- helpers
const NAME = {
  Random: "Random", Greedy: "Greedy", Minimax: "Minimax", AlphaBeta: "Alpha-Beta",
  MonteCarlo: "Monte Carlo", MCTS: "MCTS", QLearning: "Q-Learning",
};
const row = (s, k) => s.standings.find((r) => r.key === k);
const fmt = (n) => n.toLocaleString("en-US");

function disc(slide, x, y, d, color, name, line) {
  slide.addShape(pres.shapes.OVAL, { x, y, w: d, h: d, fill: { color },
    line: line || { color, width: 0 }, objectName: name });
}
function text(slide, t, o) {
  slide.addText(t, { margin: 0, isTextBox: true, valign: "top", color: C.text1, fontSize: 15, ...o });
}
// Straight line from (x1,y1) to (x2,y2).
function seg(slide, x1, y1, x2, y2, line, name = "Line") {
  slide.addShape(pres.shapes.LINE, { x: Math.min(x1, x2), y: Math.min(y1, y2),
    w: Math.max(Math.abs(x2 - x1), 0.001), h: Math.max(Math.abs(y2 - y1), 0.001),
    flipH: (x2 < x1) !== (y2 < y1), line, objectName: name });
}
// Disc-bulleted list (the deck's one recurring device).
function discList(slide, items, x, y, w, opts = {}) {
  const gap = opts.gap || 0.95, d = opts.d || 0.2, size = opts.fontSize || 15;
  items.forEach((it, i) => {
    const yy = y + i * gap;
    disc(slide, x, yy + 0.06, d, it.color || C.accent3, "Bullet disc");
    const runs = [];
    if (it.head) runs.push({ text: it.head + (it.body ? "  " : ""), options: { bold: true, color: opts.headColor || C.text2 } });
    if (it.body) runs.push({ text: it.body, options: { color: opts.color || C.text1 } });
    text(slide, runs, { x: x + d + 0.22, y: yy, w: w - d - 0.22, h: gap - 0.05, fontSize: size });
  });
}
// A Connect-N board drawn from shapes. pieces: {"r,c": "red"|"gold"}, win: ["r,c", ...]
function board(slide, x, y, w, rows, cols, pieces, win = [], opts = {}) {
  const pad = w * 0.04;
  const cell = (w - 2 * pad) / cols;
  const h = rows * cell + 2 * pad;
  slide.addShape(pres.shapes.ROUNDED_RECTANGLE, { x, y, w, h, rectRadius: 0.12,
    fill: { color: opts.boardColor || C.accent4 }, line: { color: opts.boardColor || C.accent4, width: 0 },
    objectName: "Board" });
  const d = cell * 0.78;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const key = `${r},${c}`;
      const p = pieces[key];
      const color = p === "red" ? C.accent2 : p === "gold" ? C.accent3 : (opts.holeColor || C.background1);
      const cx = x + pad + c * cell + (cell - d) / 2;
      const cy = y + pad + (rows - 1 - r) * cell + (cell - d) / 2;
      disc(slide, cx, cy, d, color, `Cell ${r}-${c}`);
      if (win.includes(key)) disc(slide, cx + d * 0.3, cy + d * 0.3, d * 0.4, C.background1, `Win ${r}-${c}`);
    }
  }
  return h;
}
const chartText = { catAxisLabelFontFace: "+mn-lt", valAxisLabelFontFace: "+mn-lt",
  dataLabelFontFace: "+mn-lt", titleFontFace: "+mn-lt", legendFontFace: "+mn-lt",
  catAxisLabelColor: HEX.gray, valAxisLabelColor: HEX.gray, dataLabelColor: HEX.ink,
  catAxisLabelFontSize: 12, valAxisLabelFontSize: 11, dataLabelFontSize: 12 };

const ab4 = row(c4, "AlphaBeta"), mm4 = row(c4, "Minimax"), mc4 = row(c4, "MCTS"), mcf4 = row(c4, "MonteCarlo");
const ab5 = row(c5, "AlphaBeta"), mm5 = row(c5, "Minimax");
const q4 = row(c4, "QLearning"), q5 = row(c5, "QLearning"), r4 = row(c4, "Random"), r5 = row(c5, "Random");
const totalGames = c4.games + c5.games;
const prune5 = exp.pruning[exp.pruning.length - 1];
const pruneX = Math.round(prune5.minimax_nodes / prune5.alphabeta_nodes);

// ================================================================ 1. Title
pres.addSection({ title: "Introduction" });
let s = pres.addSlide({ masterName: "TITLE_DARK", sectionTitle: "Introduction" });
s.addText("Which AI Plays Connect-N Best?", { placeholder: "title" });
s.addText(`Seven algorithms, ${fmt(totalGames)} tournament games, one winner`, { placeholder: "body" });
{
  const P = {};
  [["0,1", "red"], ["0,2", "gold"], ["0,3", "red"], ["0,4", "gold"], ["1,2", "red"], ["1,3", "gold"],
   ["1,4", "red"], ["2,3", "red"], ["2,4", "gold"], ["3,4", "red"], ["0,5", "gold"], ["1,5", "gold"],
   ["0,0", "gold"]].forEach(([k, v]) => (P[k] = v));
  board(s, 7.9, 1.25, 4.8, 6, 7, P, ["0,1", "1,2", "2,3", "3,4"], { boardColor: C.accent4, holeColor: C.text2 });
}
s.addNotes("This project builds a Connect-N game - Connect 4 generalised to any board size and any number in a row - and pits seven classic AI algorithms against each other to see which one plays best, and why.");

// ================================================================ 2. The game
s = pres.addSlide({ masterName: "CONTENT", sectionTitle: "Introduction" });
s.addText("The game: drop, stack, connect N", { placeholder: "title" });
{
  const steps = [
    [C.accent2, "Drop a piece", "Players take turns dropping a piece into a column. It falls to the lowest free spot."],
    [C.accent3, "Connect N in a row", "First to line up N pieces horizontally, vertically or diagonally wins. A full board is a draw."],
    [C.accent1, "Any size, any N", "Our engine handles any rows x columns and any N. We tested Connect 4 (6x7) and Connect 5 (8x9)."],
  ];
  steps.forEach(([col, h, b], i) => {
    const y = 1.75 + i * 1.45;
    disc(s, 0.6, y, 0.56, col, "Step disc");
    text(s, String(i + 1), { x: 0.6, y, w: 0.56, h: 0.56, align: "center", valign: "middle", fontSize: 18,
      fontFace: HEAD, color: C.background1 });
    text(s, h, { x: 1.45, y: y - 0.02, w: 5.3, h: 0.45, fontSize: 20, fontFace: HEAD, color: C.text2 });
    text(s, b, { x: 1.45, y: y + 0.45, w: 5.3, h: 0.8, fontSize: 15 });
  });
  board(s, 7.6, 1.6, 5.1, 6, 7, { "0,2": "red", "0,3": "gold", "1,3": "red", "0,4": "gold", "1,4": "gold",
    "2,4": "red", "0,5": "gold", "1,5": "gold", "2,5": "red", "3,5": "red", "0,1": "red", "1,2": "gold", "0,6": "red" },
  ["0,2", "1,3", "2,4", "3,5"]);
  text(s, "Red wins on the diagonal", { x: 7.6, y: 6.25, w: 5.1, h: 0.35, fontSize: 12, color: C.accent5, align: "center" });
}
s.addNotes("Rules recap. The engine stores the board as two bit masks, so checking for a win is a handful of bit shifts - fast enough to play over a thousand full AI-vs-AI games in minutes.");

// ================================================================ 3. Contenders
pres.addSection({ title: "The algorithms" });
s = pres.addSlide({ masterName: "CONTENT", sectionTitle: "The algorithms" });
s.addText("Seven contenders, four ways of thinking", { placeholder: "title" });
{
  const fams = [
    ["Baselines", C.accent5, "Set the floor", [["Random", "Picks any legal column."],
                                    ["Greedy", "Win now, block now, else the best-looking move. No look-ahead."]]],
    ["Search", C.accent1, "Think ahead", [["Minimax", "Tries every move 3 turns deep; assumes perfect replies."],
                                 ["Alpha-Beta", "Same answers, skips hopeless branches - so it reaches 6 deep."]]],
    ["Sampling", C.accent4, "Let random games vote", [["Monte Carlo", "2,000 random games split across the columns."],
                                     ["MCTS", "A search tree that spends its 2,000 games on promising lines."]]],
    ["Learning", C.accent2, "Learn from experience", [["Q-Learning", "A move-value table learned from 50,000 games against itself."]]],
  ];
  const colW = 2.75, gap = 0.37;
  fams.forEach(([fam, color, tag, items], i) => {
    const x = 0.6 + i * (colW + gap);
    text(s, fam, { x, y: 1.6, w: colW, h: 0.5, fontSize: 24, fontFace: HEAD, color });
    text(s, tag, { x, y: 2.1, w: colW, h: 0.4, fontSize: 14, italic: true, color: C.accent5 });
    items.forEach(([nm, desc], j) => {
      const y = 2.85 + j * 1.75;
      disc(s, x, y + 0.04, 0.34, color, `${nm} disc`);
      text(s, nm, { x: x + 0.5, y, w: colW - 0.5, h: 0.42, fontSize: 19, bold: true, color: C.text1 });
      text(s, desc, { x: x + 0.5, y: y + 0.45, w: colW - 0.5, h: 1.15, fontSize: 14 });
    });
  });
  text(s, "Search and sampling get a fixed budget per move - a depth, or a number of simulations - so results don't depend on the machine.",
    { x: 0.6, y: 6.3, w: 12.1, h: 0.4, fontSize: 13, color: C.accent5 });
}
s.addNotes("Why these seven: they cover the four classic approaches to game AI. Random and Greedy are baselines. Minimax and Alpha-Beta search ahead with a hand-written evaluation. Monte Carlo and MCTS replace the evaluation with random simulations. Q-learning tries to learn from experience instead of being told anything.");

// ================================================================ 4. Search
s = pres.addSlide({ masterName: "CONTENT", sectionTitle: "The algorithms" });
s.addText("Search: look ahead, assume the best reply", { placeholder: "title" });
text(s, [
  { text: "Minimax", options: { fontFace: HEAD, fontSize: 20, color: C.text2, breakLine: true } },
  { text: "Builds the tree of every move sequence a few turns deep. At the bottom it scores each position by counting open lines (2, 3, N-1 in a row), then picks the move that is best assuming the opponent always finds their best reply.", options: { breakLine: true } },
  { text: " ", options: { breakLine: true, fontSize: 10 } },
  { text: "Alpha-Beta", options: { fontFace: HEAD, fontSize: 20, color: C.text2, breakLine: true } },
  { text: "Gives exactly the same answer, but abandons a branch the moment it is proven worse than one already found. Trying centre columns first makes those cut-offs come early." },
], { x: 0.6, y: 1.6, w: 5.5, h: 4.6, paraSpaceAfter: 4 });
s.addChart(pres.charts.LINE, [
  { name: "Minimax", labels: exp.pruning.map((p) => `Depth ${p.depth}`), values: exp.pruning.map((p) => p.minimax_nodes) },
  { name: "Alpha-Beta", labels: exp.pruning.map((p) => `Depth ${p.depth}`), values: exp.pruning.map((p) => p.alphabeta_nodes) },
], { x: 6.6, y: 1.45, w: 6.1, h: 4.4, ...chartText, chartColors: [HEX.red, HEX.navy],
  lineSize: 2, lineDataSymbol: "circle", lineDataSymbolSize: 8, valAxisLogScaleBase: 10,
  valGridLine: { color: HEX.grid, size: 0.75 }, catGridLine: { style: "none" },
  showLegend: true, legendPos: "t", legendFontSize: 12, legendColor: HEX.ink,
  showTitle: true, title: "Positions examined per move (log scale)", titleFontSize: 14, titleColor: HEX.ink,
  valAxisLabelFormatCode: "#,##0" });
text(s, [{ text: `${pruneX}x fewer positions`, options: { bold: true, color: C.text2 } },
  { text: " at depth 5, for the identical move" }], { x: 6.6, y: 6.0, w: 6.1, h: 0.45, fontSize: 15 });
s.addNotes(`Measured on 25 mid-game positions. Minimax at depth 5 looks at about ${fmt(prune5.minimax_nodes)} positions per move; Alpha-Beta at the same depth looks at about ${fmt(prune5.alphabeta_nodes)} and returns the identical move. We verified the two pick the same moves on 70 random positions.`);

// ================================================================ 5. MCTS tree
s = pres.addSlide({ masterName: "CONTENT", sectionTitle: "The algorithms" });
s.addText("Sampling: let thousands of random games vote", { placeholder: "title" });
{
  const steps = [["Select", "Walk down the tree, favouring moves that win often - and ones rarely tried."],
    ["Expand", "Add one untried move as a new node."],
    ["Simulate", "Play random moves to the end of the game."],
    ["Backpropagate", "Credit the result to every node on the path."]];
  steps.forEach(([h, b], i) => {
    const y = 1.65 + i * 0.98;
    disc(s, 0.6, y, 0.46, C.accent4, "Phase disc");
    text(s, String(i + 1), { x: 0.6, y, w: 0.46, h: 0.46, align: "center", valign: "middle", fontSize: 16,
      fontFace: HEAD, color: C.background1 });
    text(s, h, { x: 1.3, y: y - 0.04, w: 5.0, h: 0.4, fontSize: 18, fontFace: HEAD, color: C.text2 });
    text(s, b, { x: 1.3, y: y + 0.36, w: 5.0, h: 0.5, fontSize: 14 });
  });
  text(s, [{ text: "Same 2,000 simulations, very different result. ", options: { bold: true, color: C.text2 } },
    { text: `MCTS repeats the four steps 2,000 times and scored ${mc4.score_pct}% in Connect 4. Flat Monte Carlo spreads its 2,000 random games evenly across the columns and scored ${mcf4.score_pct}%.` }],
  { x: 0.6, y: 5.65, w: 5.9, h: 1.1, fontSize: 14 });

  // --- the tree (right panel)
  const d = 0.42, R = d / 2;
  const N0 = [10.0, 1.75];
  const L1 = [[8.1, 2.95], [10.0, 2.95], [11.9, 2.95]];
  const L2 = [[7.5, 4.1], [8.7, 4.1], [9.4, 4.1], [10.6, 4.1]];
  const NEW = [10.6, 5.2];
  const END = [10.6, 6.45];
  const thin = { color: HEX.grid, width: 1.5 };
  const hot = { color: HEX.gold, width: 3 };
  [[N0, L1[0], thin], [N0, L1[2], thin], [L1[0], L2[0], thin], [L1[0], L2[1], thin], [L1[1], L2[2], thin],
   [N0, L1[1], hot], [L1[1], L2[3], hot], [L2[3], NEW, hot]].forEach(([a, b, ln]) =>
    seg(s, a[0] + R, a[1] + R, b[0] + R, b[1] + R, ln, "Tree edge"));
  seg(s, NEW[0] + R, NEW[1] + d, END[0] + R, END[1], { color: HEX.gray, width: 1.5, dashType: "sysDot" }, "Playout");
  [N0, ...L1, ...L2].forEach((p) => disc(s, p[0], p[1], d, C.accent1, "Tree node"));
  [N0, L1[1], L2[3]].forEach((p) => disc(s, p[0], p[1], d, C.accent3, "Selected node"));
  disc(s, NEW[0], NEW[1], d, C.background1, "New node", { color: HEX.gold, width: 2.5, dashType: "dash" });
  disc(s, END[0] + R - 0.14, END[1], 0.28, C.accent2, "Game result");
  // backpropagation arrow alongside the path
  s.addShape(pres.shapes.LINE, { x: 11.55, y: 2.0, w: 0.001, h: 4.3,
    line: { color: HEX.blue, width: 2, endArrowType: "triangle" }, flipV: true, objectName: "Backprop arrow" });
  const lab = (t, x, y, w = 1.9, al = "left") => text(s, t, { x, y, w, h: 0.35, fontSize: 13, bold: true, color: C.text2, align: al });
  lab("1 Select", 8.35, 3.6, 1.0, "right");
  lab("2 Expand", 8.6, 5.25, 1.85, "right");
  lab("3 Simulate", 8.6, 5.95, 1.85, "right");
  lab("4 Backpropagate", 11.7, 4.0, 1.4);
  text(s, "random playout", { x: 10.95, y: 5.95, w: 1.5, h: 0.3, fontSize: 11, italic: true, color: C.accent5 });
}
s.addNotes("Monte Carlo methods need no evaluation function - only the rules. The gold path is one MCTS iteration: select down the tree, add a new node, play a random game from it, then send the result back up. Flat Monte Carlo only looks one move ahead; MCTS builds a tree, so it can see that a move which looks good has a refutation.");

// ================================================================ 6. Learning
s = pres.addSlide({ masterName: "CONTENT", sectionTitle: "The algorithms" });
s.addText("Learning: Q-learning from self-play", { placeholder: "title" });
discList(s, [
  { head: "A table of values.", body: "For every board it has seen, a score for each column.", color: C.accent2 },
  { head: "50,000 games against itself.", body: "Mostly playing its best-known move, sometimes a random one to explore.", color: C.accent2 },
  { head: "Learning rule.", body: "After each move, nudge that score toward the outcome: +1 for a win, otherwise minus the opponent's best score next turn.", color: C.accent2 },
  { head: "In a game,", body: "it plays the highest-scoring column - or a random one if it has never seen the board.", color: C.accent2 },
], 0.6, 1.7, 5.8, { gap: 1.05 });
{
  // a football pitch = all 4.5 trillion positions; the table = a postage stamp
  const fx = 7.0, fy = 1.7, fw = 5.7, fh = 3.7;
  s.addShape(pres.shapes.RECTANGLE, { x: fx, y: fy, w: fw, h: fh, fill: { color: C.accent6 },
    line: { color: C.accent6, width: 0 }, objectName: "Pitch" });
  const wl = { color: HEX.white, width: 1.5 };
  s.addShape(pres.shapes.RECTANGLE, { x: fx + 0.18, y: fy + 0.18, w: fw - 0.36, h: fh - 0.36,
    fill: { color: C.accent6 }, line: wl, objectName: "Pitch lines" });
  seg(s, fx + fw / 2, fy + 0.18, fx + fw / 2, fy + fh - 0.18, wl, "Halfway line");
  s.addShape(pres.shapes.OVAL, { x: fx + fw / 2 - 0.55, y: fy + fh / 2 - 0.55, w: 1.1, h: 1.1,
    fill: { type: "none" }, line: wl, objectName: "Centre circle" });
  s.addShape(pres.shapes.RECTANGLE, { x: fx + 0.18, y: fy + fh / 2 - 0.8, w: 0.7, h: 1.6,
    fill: { type: "none" }, line: wl, objectName: "Box" });
  s.addShape(pres.shapes.RECTANGLE, { x: fx + fw - 0.88, y: fy + fh / 2 - 0.8, w: 0.7, h: 1.6,
    fill: { type: "none" }, line: wl, objectName: "Box" });
  s.addShape(pres.shapes.RECTANGLE, { x: fx + 1.45, y: fy + 0.75, w: 0.09, h: 0.11, fill: { color: C.accent3 },
    line: { color: C.accent3, width: 0 }, objectName: "Stamp" });
  seg(s, fx + 1.55, fy + 0.8, fx + 2.1, fy + 0.8, { color: HEX.gold, width: 1.25 }, "Stamp pointer");
  text(s, "what it learned", { x: fx + 2.18, y: fy + 0.66, w: 1.8, h: 0.3, fontSize: 12, bold: true, color: C.background1 });
  text(s, [{ text: "If every Connect 4 position were a patch of this football pitch, ", options: {} },
    { text: "everything Q-learning learned would cover a postage stamp.", options: { bold: true, color: C.text2 } }],
  { x: 7.0, y: 5.6, w: 5.7, h: 0.75, fontSize: 15 });
  text(s, "About 678 thousand positions learned, out of 4.5 trillion. Stamp shown enlarged - at true scale it is about 10 cm².",
    { x: 7.0, y: 6.35, w: 5.7, h: 0.5, fontSize: 11, color: C.accent5 });
}
s.addNotes("Reinforcement learning is how systems like AlphaZero learned games - but they pair it with a neural network that generalises between similar positions. A plain table cannot: every position is learned separately. The pitch comparison: 677,802 positions out of about 4.53 trillion is a fraction of 1.5 in 10 million; of a 105 x 68 metre pitch, that is about 10 square centimetres.");

// ================================================================ 7. Tournament setup
pres.addSection({ title: "Results" });
s = pres.addSlide({ masterName: "CONTENT", sectionTitle: "Results" });
s.addText("The tournament: everyone plays everyone", { placeholder: "title" });
{
  // round-robin grid: each disc above the diagonal is one pairing
  const keys = ["Random", "Greedy", "Minimax", "AlphaBeta", "MonteCarlo", "MCTS", "QLearning"];
  const short = { Random: "RND", Greedy: "GRD", Minimax: "MMX", AlphaBeta: "A-B", MonteCarlo: "MC", MCTS: "MCTS", QLearning: "QL" };
  const gx = 1.45, gy = 2.05, cell = 0.6, d = 0.42;
  keys.forEach((k, i) => {
    text(s, short[k], { x: gx + i * cell, y: gy - 0.42, w: cell, h: 0.3, fontSize: 11, bold: true, color: C.accent5, align: "center" });
    text(s, short[k], { x: gx - 0.85, y: gy + i * cell + 0.15, w: 0.75, h: 0.3, fontSize: 11, bold: true, color: C.accent5, align: "right" });
    keys.forEach((_, j) => {
      const x = gx + j * cell + (cell - d) / 2, y = gy + i * cell + (cell - d) / 2;
      if (j > i) disc(s, x, y, d, (i + j) % 2 ? C.accent2 : C.accent3, "Pairing");
      else if (j < i) disc(s, x, y, d, C.background2, "Mirror");
    });
  });
  text(s, "21 pairings - every disc is one matchup", { x: 0.6, y: gy + 7 * cell + 0.15, w: 5.6, h: 0.35, fontSize: 12, color: C.accent5, align: "center" });
  discList(s, [
    { head: `${fmt(totalGames)} games`, body: "in total, on two board sizes.", color: C.accent1 },
    { head: `Connect 4 (6x7):`, body: `${c4.games_per_pair} games per pairing, ${fmt(c4.games)} games.`, color: C.accent2 },
    { head: `Connect 5 (8x9):`, body: `${c5.games_per_pair} games per pairing, ${fmt(c5.games)} games.`, color: C.accent3 },
    { head: "Fair starts.", body: "Each pair of games begins from a random opening, played once with each side moving first.", color: C.accent4 },
    { head: "Fair budgets.", body: "Fixed depth or simulations per move, not a time limit.", color: C.accent5 },
  ], 7.0, 1.65, 5.7, { gap: 0.98, fontSize: 16 });
}
s.addNotes(`Lesson learned: in the first run, the deterministic algorithms kept replaying the same game - some pairings had only 2 distinct games out of 20. We fixed this the way chess engine testers do: each game starts from a random 2-move opening, and each opening is played twice with the sides swapped. Every pairing then had 20 distinct games. Ratings are Elo, fitted to all results at once (Bradley-Terry), with the field average fixed at 1500.`);

// ================================================================ 8. Leaderboard C4
s = pres.addSlide({ masterName: "CONTENT", sectionTitle: "Results" });
s.addText("Connect 4 leaderboard: Alpha-Beta on top", { placeholder: "title" });
{
  const st = [...c4.standings].reverse();
  s.addChart(pres.charts.BAR, [{ name: "Elo", labels: st.map((r) => NAME[r.key]), values: st.map((r) => r.elo) }],
    { x: 0.6, y: 1.45, w: 7.6, h: 5.3, barDir: "bar", ...chartText,
      chartColors: st.map((r) => (r.key === "AlphaBeta" ? HEX.gold : HEX.navy)),
      showValue: true, dataLabelPosition: "outEnd", valAxisMinVal: 600, valAxisMaxVal: 2100, valAxisMajorUnit: 300,
      valGridLine: { color: HEX.grid, size: 0.75 }, catGridLine: { style: "none" }, showLegend: false,
      showTitle: true, title: "Elo rating (field average 1500)", titleFontSize: 14, titleColor: HEX.ink, barGapWidthPct: 45 });
  discList(s, [
    { head: `Alpha-Beta leads`, body: `with an ${ab4.score_pct}% score. MCTS is close behind at ${mc4.score_pct}%.`, color: C.accent3 },
    { head: "Minimax is third", body: `(${mm4.score_pct}%): looking only 3 moves ahead costs it.`, color: C.accent1 },
    { head: "Q-Learning finishes last,", body: `below Random (${q4.score_pct}% vs ${r4.score_pct}%).`, color: C.accent2 },
  ], 8.7, 1.8, 4.0, { gap: 1.35, fontSize: 16 });
}
s.addNotes(`Full standings (Elo / score): ${c4.standings.map((r) => `${NAME[r.key]} ${r.elo} / ${r.score_pct}%`).join("; ")}. First player won ${c4.first_player_win_pct}% of games, second ${c4.second_player_win_pct}%, draws ${c4.draw_pct}%.`);

// ================================================================ 9. Head to head
s = pres.addSlide({ masterName: "CONTENT", sectionTitle: "Results" });
s.addText("Head to head: a clean pecking order", { placeholder: "title" });
{
  const order = c4.order;
  const mix = (a, b, t) => {
    const p = (h) => [0, 2, 4].map((i) => parseInt(h.substr(i, 2), 16));
    const A = p(a), B = p(b);
    return A.map((v, i) => Math.round(v + (B[i] - v) * t).toString(16).padStart(2, "0")).join("").toUpperCase();
  };
  const cellColor = (v) => (v >= 50 ? mix("F3F4F6", HEX.navy, (v - 50) / 50) : mix("F3F4F6", HEX.red, (50 - v) / 50));
  const hdr = [{ text: "Row vs column", options: { bold: true, color: C.accent5, fontSize: 11, fill: { color: C.background1 } } }]
    .concat(order.map((k) => ({ text: NAME[k], options: { bold: true, color: C.text1, fontSize: 12, align: "center",
      fill: { color: C.background1 } } })));
  const rows = [hdr];
  order.forEach((a) => {
    const r = [{ text: NAME[a], options: { bold: true, color: C.text1, fontSize: 12, fill: { color: C.background1 } } }];
    order.forEach((b) => {
      if (a === b) { r.push({ text: "-", options: { align: "center", color: C.accent5, fill: { color: C.background1 } } }); return; }
      const v = c4.h2h_score_pct[a][b];
      const strong = v >= 75 || v <= 25;
      r.push({ text: `${Math.round(v)}%`, options: { align: "center", fontSize: 13, bold: strong,
        color: strong ? HEX.white : HEX.ink, fill: { color: cellColor(v) } } });
    });
    rows.push(r);
  });
  s.addTable(rows, { x: 0.6, y: 1.5, w: 12.1, colW: [1.92].concat(order.map(() => 1.454)),
    rowH: 0.56, border: { type: "solid", pt: 1.5, color: HEX.white }, valign: "middle", fontSize: 12 });
  text(s, "Each cell is the row algorithm's score against the column algorithm over 40 Connect 4 games (win = 1, draw = 0.5). Every algorithm beats everything below it.",
    { x: 0.6, y: 6.15, w: 12.1, h: 0.45, fontSize: 12, color: C.accent5 });
}
s.addNotes(`Read across a row to see how that algorithm fared. Alpha-Beta's row is blue everywhere: it beat every opponent, the closest being MCTS at ${c4.h2h_score_pct.AlphaBeta.MCTS}%. Every search and sampling method beat Q-Learning and Random in every single game.`);

// ================================================================ 10. Strength vs time
s = pres.addSlide({ masterName: "CONTENT", sectionTitle: "Results" });
s.addText("The strongest player is not the slowest", { placeholder: "title" });
{
  const st = [...c4.standings].sort((a, b) => a.ms_per_move - b.ms_per_move);
  s.addChart(pres.charts.BAR, [{ name: "ms per move", labels: st.map((r) => NAME[r.key]), values: st.map((r) => Math.max(r.ms_per_move, 0.01)) }],
    { x: 0.6, y: 1.45, w: 7.6, h: 5.3, barDir: "bar", ...chartText,
      chartColors: st.map((r) => (r.key === "AlphaBeta" ? HEX.gold : HEX.blue)),
      showValue: true, dataLabelPosition: "outEnd", dataLabelFormatCode: "#,##0.0#", valAxisLogScaleBase: 10,
      valAxisMinVal: 0.01, valAxisMaxVal: 10000, valAxisCrossesAt: 0.01, valAxisLabelFormatCode: "General",
      valGridLine: { color: HEX.grid, size: 0.75 }, catGridLine: { style: "none" }, showLegend: false,
      showTitle: true, title: "Average thinking time per move, milliseconds (log scale)", titleFontSize: 14, titleColor: HEX.ink,
      barGapWidthPct: 45 });
  discList(s, [
    { head: `Alpha-Beta: ${Math.round(ab4.ms_per_move)} ms.`, body: "The strongest player in the field.", color: C.accent3 },
    { head: `MCTS: ${Math.round(mc4.ms_per_move)} ms.`, body: `${(mc4.ms_per_move / ab4.ms_per_move).toFixed(1)}x the thinking time, and it still rates lower.`, color: C.accent4 },
    { head: `Minimax: ${Math.round(mm4.ms_per_move)} ms.`, body: "The most strength per millisecond.", color: C.accent1 },
  ], 8.7, 1.8, 4.0, { gap: 1.35, fontSize: 16 });
}
s.addNotes(`Times measured on one core of the test machine, Connect 4: ${c4.standings.map((r) => `${NAME[r.key]} ${r.ms_per_move} ms`).join("; ")}.`);

// ================================================================ 11. Depth scaling
pres.addSection({ title: "Experiments" });
function expSlide(title, data, label, color, chartTitle, body, notes) {
  const sl = pres.addSlide({ masterName: "CONTENT", sectionTitle: "Experiments" });
  sl.addText(title, { placeholder: "title" });
  sl.addChart(pres.charts.LINE, [{ name: "Score", labels: data.map(label), values: data.map((d) => d.score_pct) }],
    { x: 0.6, y: 1.45, w: 7.6, h: 5.3, ...chartText, chartColors: [color], lineSize: 2, lineDataSymbol: "circle",
      lineDataSymbolSize: 9, showValue: true, dataLabelPosition: "t", dataLabelFormatCode: "0\"%\"",
      valAxisMinVal: 0, valAxisMaxVal: 100, valAxisMajorUnit: 25, valGridLine: { color: HEX.grid, size: 0.75 },
      catGridLine: { style: "none" }, showLegend: false, showTitle: true, title: chartTitle, titleFontSize: 14, titleColor: HEX.ink });
  const paras = body.split("\n\n");
  discList(sl, paras.map((p) => ({ body: p, color: C.accent3 })), 8.7, 1.8, 4.0, { gap: 1.5, fontSize: 16 });
  sl.addNotes(notes);
}
expSlide(N.EXP_DEPTH_TITLE, exp.depth, (d) => `d=${d.setting}`, HEX.navy,
  "Alpha-Beta score vs Minimax (depth 3), by search depth", N.EXP_DEPTH_TEXT, N.EXP_DEPTH_NOTES);
// ================================================================ 12. MCTS budget
expSlide(N.EXP_MCTS_TITLE, exp.mcts, (d) => fmt(d.setting), HEX.blue,
  "MCTS score vs Minimax (depth 3), by simulations per move", N.EXP_MCTS_TEXT, N.EXP_MCTS_NOTES);

// ================================================================ 13. Connect 5
s = pres.addSlide({ masterName: "CONTENT", sectionTitle: "Experiments" });
s.addText("Bigger board, Connect 5: Alpha-Beta pulls away", { placeholder: "title" });
{
  const keys = c5.order;
  const hdr = ["Rank", "Algorithm", "Connect 5 Elo", "Connect 5 score", "Connect 4 rank"].map((t, i) => ({ text: t,
    options: { bold: true, color: C.background1, fill: { color: C.text2 }, align: i > 1 ? "center" : "left", fontSize: 13 } }));
  const rows = [hdr];
  keys.forEach((k, i) => {
    const r5x = row(c5, k);
    const rank4 = c4.order.indexOf(k) + 1;
    const top = i === 0;
    const o = (al) => ({ align: al, fontSize: 13, bold: top, color: C.text1, fill: { color: top ? "FCEFC7" : (i % 2 ? HEX.white : HEX.tint) } });
    rows.push([{ text: String(i + 1), options: o("left") }, { text: NAME[k], options: o("left") },
      { text: String(r5x.elo), options: o("center") }, { text: `${r5x.score_pct}%`, options: o("center") },
      { text: String(rank4), options: o("center") }]);
  });
  s.addTable(rows, { x: 0.6, y: 1.55, w: 7.6, colW: [0.8, 2.2, 1.6, 1.6, 1.4], rowH: 0.56,
    border: { type: "solid", pt: 1, color: HEX.white }, valign: "middle" });
  discList(s, [
    { head: `${ab5.score_pct}% for Alpha-Beta.`, body: `It lost only ${ab5.losses} of ${ab5.games} games.`, color: C.accent3 },
    { head: "Toughest rival, Minimax,", body: `still lost the matchup ${c5.h2h_score_pct.Minimax.AlphaBeta}% to ${c5.h2h_score_pct.AlphaBeta.Minimax}%.`, color: C.accent1 },
    { head: "Sampling slips.", body: "Random playouts of 40+ moves say less, so MCTS drops to 3rd and Monte Carlo falls below Greedy.", color: C.accent4 },
  ], 8.7, 1.8, 4.0, { gap: 1.45, fontSize: 16 });
}
s.addNotes(`Connect 5 on an 8x9 board, ${fmt(c5.games)} games, 20 per pairing. On a bigger board the sampling methods suffer: random playouts of 40+ moves say less about who is really winning. The search methods, guided by a heuristic, hold up.`);

// ================================================================ 14. Best (dark peak slide)
pres.addSection({ title: "Verdict" });
s = pres.addSlide({ masterName: "CONTENT_DARK", sectionTitle: "Verdict" });
s.addText("Best: Alpha-Beta won all 12 of its matchups", { placeholder: "title" });
{
  const opps = (cfg) => cfg.order.filter((k) => k !== "AlphaBeta");
  const rowsDef = [["Connect 4", c4], ["Connect 5", c5]];
  const d = 1.05, step = 1.6, x0 = 2.75;
  rowsDef.forEach(([lbl, cfg], ri) => {
    const y = 1.75 + ri * 2.05;
    text(s, lbl, { x: 0.6, y: y + 0.25, w: 1.9, h: 0.5, fontSize: 22, fontFace: HEAD, color: C.background1 });
    opps(cfg).forEach((k, i) => {
      const x = x0 + i * step;
      disc(s, x, y, d, C.accent3, "Matchup won");
      text(s, `${Math.round(cfg.h2h_score_pct.AlphaBeta[k])}%`, { x, y, w: d, h: d, align: "center", valign: "middle",
        fontSize: 20, fontFace: HEAD, color: C.text2 });
      text(s, `vs ${NAME[k]}`, { x: x - 0.3, y: y + d + 0.08, w: d + 0.6, h: 0.32, fontSize: 13, align: "center", color: C.background2 });
    });
  });
  text(s, [
    { text: "Why it wins. ", options: { bold: true, color: C.accent3 } },
    { text: "Six moves of look-ahead spot traps that shallower and sampling players miss; pruning makes that depth affordable - the same answer as Minimax for a fraction of the work. Its lead grows on the bigger board, exactly when look-ahead matters most." },
  ], { x: 0.6, y: 5.95, w: 12.1, h: 0.9, fontSize: 16, color: C.background1 });
}
s.addNotes(N.BEST_NOTES);

// ================================================================ 15. Worst
s = pres.addSlide({ masterName: "CONTENT", sectionTitle: "Verdict" });
s.addText("Worst: Q-learning - weaker than random", { placeholder: "title" });
{
  // 10x10 grids: filled = positions it recognised, hollow = it moved at random
  const grid = (x, y, pct, label, score) => {
    const known = Math.round(pct);
    const cell = 0.27, d = 0.2;
    for (let i = 0; i < 100; i++) {
      const cx = x + (i % 10) * cell, cy = y + Math.floor(i / 10) * cell;
      if (i < known) disc(s, cx, cy, d, C.accent2, "Known position");
      else disc(s, cx, cy, d, C.background1, "Unknown position", { color: HEX.gray, width: 0.75 });
    }
    text(s, label, { x, y: y - 0.5, w: 2.8, h: 0.4, fontSize: 18, fontFace: HEAD, color: C.text2 });
    text(s, [{ text: `Recognised ${known} of every 100 positions`, options: { bold: true, breakLine: true } },
      { text: score }], { x, y: y + 2.8, w: 2.9, h: 0.75, fontSize: 13 });
  };
  grid(0.6, 2.2, c4.q_known_state_pct, "Connect 4", `Score ${q4.score_pct}% - Random scored ${r4.score_pct}%`);
  grid(3.75, 2.2, c5.q_known_state_pct, "Connect 5", `Score ${q5.score_pct}% - Random scored ${r5.score_pct}%`);
  discList(s, [
    { head: "Too many positions.", body: "4.5 trillion in Connect 4; it learned about 678 thousand.", color: C.accent2 },
    { head: "Unknown means random.", body: "Every hollow disc is a move it made blind - mostly in the middle and end of the game, where games are decided.", color: C.accent2 },
    { head: "A table can't generalise.", body: "Knowing one position says nothing about a near-identical one.", color: C.accent2 },
    { head: "Self-taught habits.", body: "It learned against itself, so its confident moves are sometimes confidently wrong.", color: C.accent2 },
  ], 7.1, 1.65, 5.6, { gap: 1.18, fontSize: 15 });
}
s.addNotes("Random is the floor by design, so the real 'worst algorithm' is the one that should have done better: Q-learning. The fix is well known - replace the table with a neural network that generalises, and combine it with search (the AlphaZero recipe) - but that needs far more computing power than a fair comparison here allowed.");

// ================================================================ 16. Takeaways
s = pres.addSlide({ masterName: "TITLE_DARK", sectionTitle: "Verdict" });
s.addText("Takeaways", { placeholder: "title" });
discList(s, [
  { body: "Look-ahead wins: Alpha-Beta won every matchup.", color: C.accent3 },
  { body: "Pruning is free strength: same moves, less work.", color: C.accent3 },
  { body: "MCTS knows only the rules, yet came second in Connect 4.", color: C.accent3 },
  { body: "Learning from scratch needs generalisation, not a table.", color: C.accent2 },
], 0.7, 4.4, 6.8, { gap: 0.6, fontSize: 18, color: C.background1 });
board(s, 7.9, 1.25, 4.8, 6, 7, { "0,3": "gold", "1,3": "gold", "2,3": "gold", "3,3": "gold", "0,2": "red",
  "0,4": "red", "1,4": "red", "0,1": "red", "1,2": "gold", "0,5": "gold" }, ["0,3", "1,3", "2,3", "3,3"],
{ boardColor: C.accent4, holeColor: C.text2 });
s.addNotes("Thank you. All the code is included: python play.py lets anyone play against any of the seven algorithms.");

// ---------------------------------------------------------------- write
(async () => {
  await pres.writeFile({ fileName: OUT });
  if (applyTheme) await applyTheme(OUT, THEME);
  else console.warn("apply_theme.js not found - theme colours not written");
  console.log("wrote", OUT);
})();
