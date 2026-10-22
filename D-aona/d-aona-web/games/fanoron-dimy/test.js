/* =========================================================
   D-Aona - Fanoron-dimy : HARNAIS DE TEST AUTONOME
   ---------------------------------------------------------
   Aucun navigateur, aucune dependance : `node test.js`.
   Chaque verification imprime OK / ECHEC ; code de sortie 1 des
   qu une seule echoue (utilisable tel quel dans `npm test`).
   ========================================================= */
"use strict";

const E = require("./engine.js");
const B = require("./board.js");
const U = require("./ui.js");
const AI = require("./ai.js");
const MANIFEST = require("./manifest.json");

let checks = 0, fails = 0;
function ok(name, cond, detail) {
  checks++;
  if (!cond) fails++;
  console.log((cond ? "  OK    " : "  ECHEC ") + name + (detail !== undefined ? "   -> " + detail : ""));
}
function eq(name, a, b) {
  const same = JSON.stringify(a) === JSON.stringify(b);
  ok(name, same, same ? undefined : JSON.stringify(a) + " != " + JSON.stringify(b));
}
function section(t) { console.log("\n=== " + t + " ==="); }

/* ---------- 1. Manifeste ---------- */
section("Manifeste");
eq("identifiant", MANIFEST.id, "fanoron-dimy");
eq("famille", MANIFEST.family, "fanoron");
eq("plateau", [MANIFEST.board.rows, MANIFEST.board.cols], [5, 5]);
eq("pions par camp", MANIFEST.players.pawns, E.PAWNS_PER_PLAYER);
eq("prises annoncees", MANIFEST.captures, true);
ok("eloKey aligne sur l identifiant", MANIFEST.eloKey === MANIFEST.id, MANIFEST.eloKey);
ok("formats declares", Array.isArray(MANIFEST.formats) && MANIFEST.formats.length === 3);

/* ---------- 2. Geometrie et position de depart ---------- */
section("Geometrie");
eq("taille", [E.ROWS, E.COLS, E.CELLS], [5, 5, 25]);
eq("index(2,3)", E.index(2, 3), 13);
eq("rowOf(17) / colOf(17)", [E.rowOf(17), E.colOf(17)], [3, 2]);
ok("points forts : (0,0) et (1,1) oui, (0,1) non",
  E.strong(0, 0) && E.strong(1, 1) && !E.strong(0, 1) && E.strong(2, 2));
ok("hors plateau refuse", !E.onBoard(-1) && !E.onBoard(25) && !E.inBoard(5, 0));

section("Position de depart");
const start = E.createState();
eq("12 pions clairs", E.countPieces(start.board, 1), 12);
eq("12 pions sombres", E.countPieces(start.board, 2), 12);
eq("un seul point libre", start.board.filter((v) => v === 0).length, 1);
eq("le centre est libre", start.board[E.index(2, 2)], 0);
eq("les clairs commencent", start.turn, 1);
ok("aucune prise possible a la premiere rangee", start.board[E.index(4, 0)] === 1 && start.board[E.index(0, 0)] === 2);
ok("partie non terminee", start.over === false && start.winner === 0);
ok("symetrie miroir gauche / droite",
  start.board.every((v, i) => v === start.board[E.index(E.rowOf(i), 4 - E.colOf(i))]));
const swap = (v) => (v === 1 ? 2 : v === 2 ? 1 : 0);
ok("haut et bas opposes (couleurs echangees)",
  [0, 1, 3, 4].every((r) => [0, 1, 2, 3, 4].every((c) =>
    start.board[E.index(r, c)] === swap(start.board[E.index(4 - r, c)]))));

/* ---------- 3. Generation des coups ---------- */
section("Coups et prises");
const vide = new Array(25).fill(0);

/* Diagonale : refusee depuis un point faible, permise depuis un point fort. */
let b = vide.slice(); b[11] = 1; b[6] = 1;
eq("aucun coup hors d un pion du joueur", E.movesFrom(b, 12, 1), []);
b = vide.slice(); b[11] = 1;
let mv = E.movesFrom(b, 11, 1);
ok("point faible : jamais de diagonale", mv.every((m) => m.dir[0] === 0 || m.dir[1] === 0),
  JSON.stringify(mv.map((m) => m.dir)));
ok("point faible : 4 sorties orthogonales",
  mv.length === 4 && [6, 10, 12, 16].every((t) => mv.some((m) => m.to === t)), mv.length);
b = vide.slice(); b[12] = 1;
mv = E.movesFrom(b, 12, 1);
ok("point fort : 8 directions", mv.length === 8, mv.length);

/* Approche : adversaire derriere l arrivee. */
b = vide.slice(); b[11] = 1; b[13] = 2; b[14] = 2;
mv = E.movesFrom(b, 11, 1).filter((m) => m.to === 12);
eq("approche capture les deux pions alignes", mv.find((m) => m.kind === "apr").cap, [13, 14]);

/* Retrait : adversaire derriere le depart (12 -> 7, retour vers le bas). */
b = vide.slice(); b[12] = 1; b[17] = 2; b[22] = 2;
mv = E.movesFrom(b, 12, 1).filter((m) => m.to === 7);
eq("retrait capture les deux pions alignes", mv.find((m) => m.kind === "ret").cap, [17, 22]);

/* Les deux sens sur un meme deplacement : deux coups distincts. */
b = vide.slice(); b[12] = 1; b[2] = 2; b[17] = 2;
mv = E.movesFrom(b, 12, 1).filter((m) => m.to === 7);
ok("approche et retrait proposes ensemble", mv.length === 2, JSON.stringify(mv.map((m) => m.kind)));

/* Deplacement libre : aucune prise obligatoire. */
b = vide.slice(); b[12] = 1;
ok("deplacement sans prise accepte", E.movesFrom(b, 12, 1).every((m) => m.kind === "paika"));

/* Chemin bloque : la case d arrivee occupee interdit le pas. */
b = vide.slice(); b[11] = 1; b[12] = 1;
ok("arrivee occupee par un allie : refuse", !E.movesFrom(b, 11, 1).some((m) => m.to === 12));
b = vide.slice(); b[11] = 1; b[12] = 2;
ok("arrivee occupee par un ennemi : refuse", !E.movesFrom(b, 11, 1).some((m) => m.to === 12));

section("Coups legaux");
const legaux = E.legalMoves(start);
ok("des coups existent au depart", legaux.length > 0, legaux.length);
ok("tries par nombre de prises", legaux.every((m, i) => i === 0 || legaux[i - 1].cap.length >= m.cap.length));
ok("tous partent d un pion du trait", legaux.every((m) => start.board[m.from] === 1));
ok("toutes les arrivees sont vides", legaux.every((m) => start.board[m.to] === 0));

/* ---------- 4. Validation et application ---------- */
section("applyMove");
const avant = start.board.slice();
const coup = E.legalMoves(start)[0];
const res = E.applyMove(start, coup);
ok("coup legal accepte", res.ok === true);
ok("etat d entree intact", JSON.stringify(start.board) === JSON.stringify(avant));
ok("pion deplace", res.state.board[coup.to] === 1 && res.state.board[coup.from] === 0);
eq("le trait passe aux sombres", res.state.turn, 2);
eq("dernier coup memorise", [res.state.last.from, res.state.last.to], [coup.from, coup.to]);
ok("applyMove refuse un coup illegal", E.applyMove(start, { from: 0, to: 1 }).ok === false);
ok("applyMove refuse une case vide", E.applyMove(start, { from: 12, to: 7 }).ok === false);
ok("isLegal vrai pour un coup legal", E.isLegal(start, coup));
ok("isLegal faux pour un coup illegal", !E.isLegal(start, { from: 0, to: 1 }));

b = vide.slice(); b[11] = 1; b[13] = 2; b[14] = 2; b[24] = 2;
const prise = E.applyMove(E.createState({ board: b, turn: 1 }), { from: 11, to: 12 });
ok("prise appliquee", prise.ok && E.countPieces(prise.state.board, 2) === 1, E.countPieces(prise.state.board, 2));

const copie = E.clone(start);
copie.board[0] = 0;
ok("clone independant", start.board[0] === 2 && copie.board[0] === 0);
eq("cle stable", E.key(start), E.key(E.createState()));

/* ---------- 5. Fins de partie ---------- */
section("Fins de partie");
b = vide.slice(); b[12] = 1;
let st = E.createState({ board: b, turn: 2 });
ok("adversaire sans pion : victoire", st.over && st.winner === 1 && st.reason === E.REASON.CAPTURE,
  st.winner + "/" + st.reason);

/* Blocage : plus aucune case libre, le joueur au trait perd. */
b = new Array(25).fill(1); b[0] = 2; b[24] = 2;
st = E.createState({ board: b, turn: 1 });
ok("aucun coup possible : blocage", st.over && st.winner === 2 && st.reason === E.REASON.BLOCKED,
  st.winner + "/" + st.reason);

/* Nulle de pietinement. */
st = E.createState({ silent: E.SILENT_LIMIT });
ok("60 demi-coups sans prise : nulle", st.over && st.winner === 0 && st.reason === E.REASON.DRAW,
  st.winner + "/" + st.reason);
ok("sous la limite : la partie continue", !E.createState({ silent: 3 }).over);

b = vide.slice(); b[12] = 1; b[24] = 2;
const sansPrise = E.applyMove(E.createState({ board: b, turn: 1 }), { from: 12, to: 7 });
ok("compteur de pietinement incremente", sansPrise.ok && sansPrise.state.silent === 1, sansPrise.state.silent);
ok("le compteur retombe a zero apres une prise", prise.state.silent === 0);

/* ---------- 6. Plateau (geometrie) ---------- */
section("Plateau");
ok("25 cases", B.CELLS === 25 && B.SIZE === 5);
ok("segments non vides", B.LINES.length >= 40, B.LINES.length);
ok("aucun segment en double",
  new Set(B.LINES.map((l) => l.slice().sort((x, y) => x - y).join("-"))).size === B.LINES.length);
ok("segments sans boucle", B.LINES.every((l) => l[0] !== l[1]));
ok("segments orthogonaux ou diagonaux d un point fort", B.LINES.every((l) => {
  const dr = Math.abs(B.rowOf(l[0]) - B.rowOf(l[1])), dc = Math.abs(B.colOf(l[0]) - B.colOf(l[1]));
  if (dr + dc === 1) return true;
  return dr === 1 && dc === 1 && E.strong(B.rowOf(l[0]), B.colOf(l[0])) && E.strong(B.rowOf(l[1]), B.colOf(l[1]));
}));

let roundtrip = true;
for (let i = 0; i < 25; i++) {
  const r = B.cellRect(i, 500, 500, 10);
  const hit = B.hitTest(r.x + r.w / 2, r.y + r.h / 2, 500, 500, 10);
  if (hit !== i) { roundtrip = false; break; }
}
ok("cellRect / hitTest : aller-retour sur les 25 cases", roundtrip);
ok("hitTest hors plateau rend null", B.hitTest(-50, -50, 500, 500, 10) === null);
eq("point(12) au centre", B.point(12), { x: 50, y: 50 });
/* Diagonales : 1 dans un coin, 2 sur un bord, 4 au centre. */
const diagOf = (i) => B.LINES.filter((l) => (l[0] === i || l[1] === i) &&
  Math.abs(B.rowOf(l[0]) - B.rowOf(l[1])) === 1 &&
  Math.abs(B.colOf(l[0]) - B.colOf(l[1])) === 1).length;
eq("coin : 1 diagonale", diagOf(0), 1);
eq("bord : 2 diagonales", diagOf(2), 2);
eq("centre : 4 diagonales", diagOf(12), 4);
ok("aucune diagonale sur un point faible",
  [1, 3, 5, 9, 15, 19, 21, 23].every((i) => diagOf(i) === 0));

/* ---------- 7. IA ---------- */
section("IA");
const aiStart = AI.chooseMove(start, { level: "facile", budgetMs: 100 });
ok("l IA rend un coup legal", !!aiStart && E.isLegal(start, aiStart));
const aiDeux = AI.chooseMove(start, { level: "facile", budgetMs: 100, rng: AI.rngFrom(42) });
const aiDeuxBis = AI.chooseMove(start, { level: "facile", budgetMs: 100, rng: AI.rngFrom(42) });
eq("graine identique : meme coup", [aiDeux.from, aiDeux.to], [aiDeuxBis.from, aiDeuxBis.to]);

b = vide.slice(); b[11] = 1; b[0] = 1; b[13] = 2; b[14] = 2; b[20] = 2;
const affame = E.createState({ board: b, turn: 1 });
const choix = AI.chooseMove(affame, { level: "normal", budgetMs: 300, rng: AI.rngFrom(7) });
ok("l IA prend quand elle peut", choix && choix.cap.length === 2, choix && JSON.stringify(choix.cap));

const fini = E.createState({ board: (() => { const x = new Array(25).fill(0); x[12] = 1; return x; })(), turn: 2 });
ok("aucun coup a rendre sur partie finie", AI.chooseMove(fini, {}) === null);

/* ---------- 8. Interaction ---------- */
section("Interaction");
const journal = [];
const ctl = U.createController({ mySide: 1, onMove: (m) => journal.push(m) });
eq("selection d un pion clair", ctl.click(11).reason, "selection");
eq("le pion reste selectionne", ctl.getSelected(), 11);
eq("re-clic : deselection", ctl.click(11).reason, "deselection");
eq("pion sombre refuse", ctl.click(7).reason, "pas-votre-pion");
ctl.click(11);
const joue = ctl.click(12);
ok("deplacement joue", joue.moved === true, joue.reason);
eq("onMove appele une fois", journal.length, 1);
eq("le trait a change", ctl.getState().turn, 2);
eq("hors tour : refuse", ctl.click(20).reason, "not-your-turn");
ok("canPlay faux hors tour", ctl.canPlay() === false);

const hot = U.createController({ mySide: 0 });
hot.click(11);
ok("deux joueurs : le camp du trait joue", hot.click(12).moved === true);
ok("deux joueurs : les sombres jouent aussi", hot.canPlay() === true);

const bloque = U.createController({ mySide: 1, state: fini });
ok("partie finie : aucun clic jouable", bloque.click(12).reason === "over" && bloque.canPlay() === false);
ok("coordonnee hors plateau refusee", U.createController({ mySide: 1 }).click(99).reason === "hors-plateau");

/* ---------- 9. Partie complete aleatoire ---------- */
section("Partie complete (aleatoire, graine fixe)");
let auto = E.createState();
const rnd = AI.rngFrom(20261022);
let plies = 0;
while (!auto.over && plies < 400) {
  const coups = E.legalMoves(auto);
  if (!coups.length) break;
  const m = coups[Math.floor(rnd() * coups.length)];
  const r = E.applyMove(auto, m);
  if (!r.ok) { ok("coup aleatoire toujours legal", false, JSON.stringify(m)); break; }
  auto = r.state;
  plies++;
}
ok("la partie se termine", auto.over === true, plies + " demi-coups, raison " + auto.reason);
ok("un vainqueur ou une nulle", auto.winner === 0 || auto.winner === 1 || auto.winner === 2, auto.winner);
ok("aucune valeur inconnue sur le plateau", auto.board.every((v) => v === 0 || v === 1 || v === 2));

console.log("\n" + (fails === 0 ? "RESULTAT : TOUS LES TESTS PASSENT" : "RESULTAT : " + fails + " ECHEC(S)") +
  " (" + (checks - fails) + "/" + checks + ")");
process.exit(fails === 0 ? 0 : 1);
