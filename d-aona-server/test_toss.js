"use strict";
/* Test du tirage au sort initial + conformité aux règles officielles du
   document "Fanorona (Dames Malgaches)" :
   - 22 pions par camp au départ ;
   - le joueur qui commence est tiré au sort (pile/face, ~50/50) ;
   - on ne capture que les pions d'un alignement interrompu (contigu) ;
   - prises en chaîne : le pion doit changer de direction et ne pas repasser
     sur une intersection déjà visitée. */
const { GameSession, initialGrid, countPieces, movesFrom, legalMoves, ROWS, COLS } = require("./game");

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; console.log("  ✓ " + msg); } else { fail++; console.log("  ✗ " + msg); } };

// --- 1. Disposition initiale : 22 pions par camp ---
const g0 = initialGrid();
ok(countPieces(g0, 1) === 22, "player1 a 22 pions au départ (got " + countPieces(g0, 1) + ")");
ok(countPieces(g0, 2) === 22, "player2 a 22 pions au départ (got " + countPieces(g0, 2) + ")");
ok(g0.length === ROWS && g0[0].length === COLS, `plateau ${COLS}×${ROWS}`);

// --- 2. Tirage au sort : les joueurs choisissent leur face (PILE/FACE), ~50/50 ---
const mk = () => new GameSession("t", { id: 1, elo: 1000 }, { id: 2, elo: 1000 }, "online", { time: 600 }, 0);
// Une fois une face prise, l'autre joueur reçoit automatiquement l'autre face.
const ex = mk();
let r1 = ex.pickSide(1, "pile");
ok(ex.choices[1] === "pile" && ex.phase === "choose" && r1.resolved === false, "J1 choisit PILE → phase choose, en attente");
const r2 = ex.pickSide(2, "pile");
ok(r2.forced === "face" && ex.choices[2] === null && ex.phase === "choose", "PILE déjà prise → J2 refusé, forcé à FACE");
const r2b = ex.pickSide(2, "face");
ok(ex.choices[1] === "pile" && ex.choices[2] === "face" && ex.phase === "play" && ex.turn === ex.starter && (ex.turn === 1 || ex.turn === 2),
  "J2 reçoit automatiquement FACE → tirage résolu, starter = celui dont la face sort");
ok(ex.getState().toss && ex.getState().toss.starter === ex.turn && ex.getState().toss.side === ex.tossSide, "state.toss expose face + starter");
// Ordre inverse (J2 choisit en premier).
const ex2 = mk();
ex2.pickSide(2, "face");
const r3 = ex2.pickSide(1, "pile");
ok(r3.resolved === true && ex2.choices[1] === "pile" && ex2.choices[2] === "face" && ex2.phase === "play", "ordre inverse : J2 face, J1 pile → résolu");
// Aucun coup possible avant la fin du tirage.
const pre = mk();
ok(pre.applyMove({ from: [2, 2], to: [2, 4], kind: "paika", cap: [] }).ok === false, "aucun coup possible tant que le tirage n'est pas fait");
// Distribution ~50/50 de la pièce (J1 choisit toujours PILE → commence 1 fois sur 2).
let t1 = 0, t2 = 0;
for (let i = 0; i < 500; i++) {
  const s = mk();
  s.pickSide(1, "pile");
  s.pickSide(2, "face");
  if (s.turn === 1) t1++; else t2++;
}
ok(t1 > 0 && t2 > 0, `les 2 joueurs peuvent commencer (turn=1: ${t1}, turn=2: ${t2})`);
ok(t1 >= 100 && t1 <= 400, `distribution ~50/50 (${t1}/500) — pièce aléatoire plausible`);

// --- 3. Alignement interrompu : on ne capture que la séquence contiguë ---
function makeGrid(place) {
  const g = Array.from({ length: ROWS }, () => Array(COLS).fill(0));
  for (const [r, c, v] of place) g[r][c] = v;
  return g;
}
// Me (1) en (1,1) ; ennemis contigus (1,3),(1,4), puis trou en (1,5) et
// ennemis (1,6) au-delà du trou → ne doivent PAS être capturés.
const capGrid = makeGrid([[1, 1, 1], [1, 3, 2], [1, 4, 2], [1, 6, 2]]);
const aprMoves = movesFrom(capGrid, 1, 1, 1, null).filter((m) => m.kind === "apr" && m.to[0] === 1 && m.to[1] === 2);
ok(aprMoves.length === 1 && aprMoves[0].cap.length === 2,
  `approche: capture de la séquence contiguë uniquement (cap=${aprMoves[0] && aprMoves[0].cap.length}, pas le pion après le trou)`);
const aprCaps = (aprMoves[0] && aprMoves[0].cap) || [];
ok(!aprCaps.some(([r, c]) => r === 1 && c === 6), "le pion au-delà du trou n'est pas pris");

// --- 4. Chaîne : changement de direction obligatoire + pas de repassage ---
// Pion en (2,2) (case paire). Ennemis en (4,2) (bas, capturable) et (2,4) (droite).
// Sans restriction, il existe une prise vers le bas ((1,0)) et une vers la droite.
const chainGrid = makeGrid([[2, 2, 1], [4, 2, 2], [2, 4, 2]]);
const base = legalMoves(chainGrid, 1, null);
ok(base.some((m) => m.dir[0] === 1 && m.dir[1] === 0), "sans chaîne: la prise vers le bas (1,0) existe");
const ch1 = legalMoves(chainGrid, 1, { pos: [2, 2], lastDir: [1, 0], visited: new Set() });
ok(ch1.length > 0, "chaîne: au moins une prise est encore disponible");
ok(!ch1.some((m) => m.from[0] === 2 && m.from[1] === 2 && m.dir[0] === 1 && m.dir[1] === 0),
  "chaîne: la même direction que le coup précédent est interdite");
ok(ch1.some((m) => m.dir[0] === 0 && m.dir[1] === 1), "chaîne: changer de direction reste permis (droite)");
// Une intersection déjà visitée ne peut pas être rejouée (celle vers le bas (3,2) est visitée).
const ch2 = legalMoves(chainGrid, 1, { pos: [2, 2], lastDir: [0, -1], visited: new Set(["3,2"]) });
ok(ch2.length > 0, "chaîne visitée: une prise reste disponible");
ok(!ch2.some((m) => m.from[0] === 2 && m.from[1] === 2 && m.to[0] === 3 && m.to[1] === 2),
  "chaîne: on ne repasse pas sur une intersection déjà visitée");

// --- 5. Si capture possible, elle est obligatoire (seuls les coups qui prennent sont légaux) ---
const mandatoryGrid = makeGrid([[1, 1, 1], [1, 3, 2]]);
const mandatory = legalMoves(mandatoryGrid, 1, null);
ok(mandatory.length > 0 && mandatory.every((m) => m.cap.length > 0), "capture obligatoire: uniquement des coups qui prennent");

// --- 6. Diagonales gravées : permises seulement depuis les points forts ((r+c) pair) ---
// (2,2) est un point fort → 8 directions ; (2,3) est un point faible → 4 orthogonales.
const strongMoves = movesFrom(makeGrid([[2, 2, 1]]), 2, 2, 1, null);
ok(strongMoves.some((m) => m.dir[0] !== 0 && m.dir[1] !== 0), "point fort (2,2): la diagonale est permise");
const weakMoves = movesFrom(makeGrid([[2, 3, 1]]), 2, 3, 1, null);
ok(weakMoves.length === 4 && weakMoves.every((m) => !(m.dir[0] !== 0 && m.dir[1] !== 0)),
  `point faible (2,3): uniquement les 4 orthogonales (got ${weakMoves.length})`);
// Un pas diagonal conserve la parité → arrive toujours sur un point fort.
ok(strongMoves.filter((m) => m.dir[0] !== 0 && m.dir[1] !== 0).every((m) => (m.to[0] + m.to[1]) % 2 === 0),
  "toute destination diagonale est un point fort");

console.log(fail === 0 ? `\n=== TEST TIRAGE AU SORT / RÈGLES RÉUSSI (${pass}✓ / ${fail}✗) ===` : `\n=== TEST TIRAGE AU SORT / RÈGLES ÉCHEC (${pass}✓ / ${fail}✗) ===`);
process.exit(fail === 0 ? 0 : 1);
