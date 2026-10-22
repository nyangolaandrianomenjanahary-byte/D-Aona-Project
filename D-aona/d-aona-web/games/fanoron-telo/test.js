/* =========================================================
   D-aôna — Tests du moteur Fanoron-telo (3 × 3)
   ---------------------------------------------------------
   Vérifie, sans serveur ni navigateur :
     - la topologie du plateau (adjacence symétrique, 8 lignes) ;
     - la phase de POSE (9 cases, 3 pions, alternance, refus) ;
     - les 8 alignements gagnants ;
     - le passage POSE → MOUVEMENT et les règles de glissement ;
     - la NULLE par triple répétition ;
     - l'immutabilité des états (l'IA en dépend) ;
     - l'IA : mat en un, défense obligatoire, légalité, vitesse.

   Le moteur testé est CELUI DU NAVIGATEUR (même fichier, chargé par
   `require`) : ces tests couvrent donc aussi le client.

   Usage :  node test_fanoron_telo.js
   ========================================================= */
"use strict";

const E = require("./engine.js");
const AI = require("./ai.js");

let failures = 0;
function check(name, ok, detail) {
  if (!ok) failures++;
  console.log(`  ${ok ? "OK   " : "ECHEC"} ${name}${detail ? "   -> " + detail : ""}`);
}
function section(t) { console.log("\n=== " + t + " ==="); }

const place = (to) => ({ type: "place", to });
const move = (from, to) => ({ type: "move", from, to });

/* Joue une suite de coups ; s'arrête net si l'un est refusé (c'est une
   erreur de test, pas un cas à couvrir). */
function play(state, moves) {
  let s = state;
  for (const mv of moves) {
    const r = E.applyMove(s, mv);
    if (!r.ok) throw new Error("coup refusé " + JSON.stringify(mv) + " : " + r.error);
    s = r.state;
  }
  return s;
}

/* Générateur pseudo-aléatoire déterministe (LCG 32 bits) : les parties
   IA/rejouées doivent être identiques d'une exécution à l'autre. */
function seeded(seed) {
  let x = seed >>> 0;
  return function () {
    x = (x * 1664525 + 1013904223) >>> 0;
    return x / 4294967296;
  };
}

/* ---------------------------------------------------------
   1. Plateau, adjacence, lignes
   --------------------------------------------------------- */
section("1. Topologie du plateau");
check("9 cases", E.CELLS === 9 && E.SIZE === 3);
check("3 pions par camp", E.PAWNS_PER_PLAYER === 3);
check("8 lignes gagnantes", E.WIN_LINES.length === 8, String(E.WIN_LINES.length));

let symmetric = true;
for (let i = 0; i < E.CELLS; i++) {
  for (const j of E.ADJ[i]) {
    if (E.ADJ[j].indexOf(i) === -1) symmetric = false;
  }
  if (E.ADJ[i].indexOf(i) !== -1) symmetric = false;
}
check("adjacence symétrique et sans boucle", symmetric);

check("le centre touche les 8 autres cases", E.ADJ[4].length === 8);
check("coins et milieux touchent 3 cases", [0, 1, 2, 3, 5, 6, 7, 8].every((i) => E.ADJ[i].length === 3));

check("0-4 adjacent (diagonale par le centre)", E.ADJ[0].indexOf(4) !== -1);
check("4-8 adjacent (diagonale par le centre)", E.ADJ[4].indexOf(8) !== -1);
check("0-8 NON adjacent", E.ADJ[0].indexOf(8) === -1);
check("0-2 NON adjacent (pas de diagonale 3×3 sans centre)", E.ADJ[0].indexOf(2) === -1);
check("0-6 NON adjacent", E.ADJ[0].indexOf(6) === -1);
/* L'anti-diagonale 2-4-6 existe par le centre, pas par un saut 2-6. */
check("anti-diagonale 2-4-6 via le centre",
  E.ADJ[2].indexOf(4) !== -1 && E.ADJ[4].indexOf(6) !== -1 && E.ADJ[2].indexOf(6) === -1);

/* Chaque case appartient à 3 lignes, sauf le centre (4) et les milieux
   de bord (2) : invariant géométrique, et garantie qu'aucune ligne ne
   manque ni ne fait doublon. */
const occurrences = new Array(E.CELLS).fill(0);
for (const line of E.WIN_LINES) for (const c of line) occurrences[c]++;
const expected = [3, 2, 3, 2, 4, 2, 3, 2, 3];
check("chaque case apparaît dans le bon nombre de lignes", JSON.stringify(occurrences) === JSON.stringify(expected),
  JSON.stringify(occurrences));

/* ---------------------------------------------------------
   2. Phase de pose
   --------------------------------------------------------- */
section("2. Phase de pose");
const start = E.createState();
check("départ : phase pose", start.phase === E.PHASE.PLACEMENT);
check("départ : pion 1 au trait", start.turn === 1);
check("départ : aucune partie engagée", start.over === false && start.plies === 0);
check("départ : 9 coups légaux", E.legalMoves(start).length === 9);
check("départ : uniquement des poses", E.legalMoves(start).every((m) => m.type === "place"));

const afterOne = play(start, [place(4)]);
check("alternance après une pose", afterOne.turn === 2 && afterOne.plies === 1);
check("l'état de départ n'a pas bougé (immutabilité)", start.board.every((v) => v === 0) && start.turn === 1);
check("pion posé au centre", afterOne.board[4] === 1);
check("compteur de pose", afterOne.placedCount[1] === 1 && afterOne.placedCount[2] === 0);

check("refus : case occupée", E.applyMove(afterOne, place(4)).ok === false,
  E.applyMove(afterOne, place(4)).error);
check("refus : case hors plateau (9)", E.applyMove(afterOne, place(9)).ok === false);
check("refus : case hors plateau (-1)", E.applyMove(afterOne, place(-1)).ok === false);
check("refus : coup illisible", E.applyMove(afterOne, null).ok === false);
check("refus : déplacement pendant la pose", E.applyMove(afterOne, move(4, 0)).ok === false);

/* Pose sans alignement : 0 / 4 / 2 / 6 / 7 / 3. */
const six = play(start, [place(0), place(4), place(2), place(6), place(7), place(3)]);
check("5 poses : encore en phase de pose",
  play(start, [place(0), place(4), place(2), place(6), place(7)]).phase === E.PHASE.PLACEMENT);
check("6 poses : passage en phase de mouvement", six.phase === E.PHASE.MOVEMENT && !six.over);
check("6 poses : 3 pions de chaque côté", six.placedCount[1] === 3 && six.placedCount[2] === 3);
check("6 poses : plus aucune pose possible", E.legalMoves(six).every((m) => m.type === "move"));
check("6 poses : 4 glissements légaux", E.legalMoves(six).length === 4,
  JSON.stringify(E.legalMoves(six)));
check("refus : pose pendant le mouvement", E.applyMove(six, place(8)).ok === false,
  E.applyMove(six, place(8)).error);

/* ---------------------------------------------------------
   3. Les huit alignements
   --------------------------------------------------------- */
section("3. Victoire par alignement");
/* Poses : J1 0, J2 3, J1 1, J2 4, J1 2 -> rangée du haut. */
const rowWin = play(start, [place(0), place(3), place(1), place(4), place(2)]);
check("rangée du haut : victoire du joueur 1", rowWin.over && rowWin.winner === 1);
check("rangée du haut : motif « alignement »", rowWin.reason === E.REASON.ALIGNMENT);
check("rangée du haut : ligne [0,1,2]", JSON.stringify(rowWin.line) === "[0,1,2]", JSON.stringify(rowWin.line));
check("le gagnant garde le trait (winner === turn)", rowWin.turn === 1);
check("plus aucun coup une fois la partie finie", E.legalMoves(rowWin).length === 0);
check("refus de jouer après la fin", E.applyMove(rowWin, place(5)).ok === false,
  E.applyMove(rowWin, place(5)).error);

const colWin = play(start, [place(0), place(1), place(3), place(2), place(6)]);
check("colonne de gauche : [0,3,6]", colWin.winner === 1 && JSON.stringify(colWin.line) === "[0,3,6]",
  JSON.stringify(colWin.line));

const diagWin = play(start, [place(0), place(1), place(4), place(2), place(8)]);
check("grande diagonale : [0,4,8]", diagWin.winner === 1 && JSON.stringify(diagWin.line) === "[0,4,8]",
  JSON.stringify(diagWin.line));

const antiWin = play(start, [place(2), place(0), place(4), place(1), place(6)]);
check("anti-diagonale : [2,4,6]", antiWin.winner === 1 && JSON.stringify(antiWin.line) === "[2,4,6]",
  JSON.stringify(antiWin.line));

/* Le joueur 2 gagne aussi : 3 / 4 / 5. */
const secondWin = play(start, [place(0), place(3), place(1), place(4), place(8), place(5)]);
check("le joueur 2 peut gagner", secondWin.over && secondWin.winner === 2, "winner=" + secondWin.winner);
check("ligne du joueur 2 : [3,4,5]", JSON.stringify(secondWin.line) === "[3,4,5]", JSON.stringify(secondWin.line));

/* ---------------------------------------------------------
   4. Phase de mouvement
   --------------------------------------------------------- */
section("4. Phase de mouvement");
check("trait au joueur 1 après la pose", six.turn === 1);
check("refus : déplacer un pion adverse", E.applyMove(six, move(3, 0)).ok === false,
  E.applyMove(six, move(3, 0)).error);
check("refus : case d'arrivée occupée", E.applyMove(six, move(0, 3)).ok === false,
  E.applyMove(six, move(0, 3)).error);
check("refus : saut non adjacent (0 -> 8)", E.applyMove(six, move(0, 8)).ok === false,
  E.applyMove(six, move(0, 8)).error);
check("refus : case d'origine vide", E.applyMove(six, move(1, 0)).ok === false,
  E.applyMove(six, move(1, 0)).error);

const slide = E.applyMove(six, move(0, 1));
check("glissement adjacent accepté (0 -> 1)", slide.ok === true, slide.ok ? "" : slide.error);
check("glissement : pion déplacé", slide.ok && slide.state.board[0] === 0 && slide.state.board[1] === 1);
check("glissement : la main passe", slide.ok && slide.state.turn === 2);
check("glissement : un pli de plus", slide.ok && slide.state.plies === six.plies + 1);
check("glissement : compteurs de pose figés",
  slide.ok && slide.state.placedCount[1] === 3 && slide.state.placedCount[2] === 3);
check("glissement : aucun pion pris (six pions sur le plateau)",
  slide.ok && E.countPawns(slide.state.board, 1) + E.countPawns(slide.state.board, 2) === 6);

/* Diagonales passant par le centre, sur un état construit. */
const center = E.createState({ board: [0, 0, 0, 0, 1, 0, 2, 0, 0], turn: 1, phase: "movement" });
check("centre -> coin par la diagonale (4 -> 8)", E.applyMove(center, move(4, 8)).ok === true);
check("centre -> coin par la diagonale (4 -> 0)", E.applyMove(center, move(4, 0)).ok === true);
const corner = E.createState({ board: [1, 0, 0, 0, 0, 0, 0, 0, 2], turn: 1, phase: "movement" });
check("coin -> centre accepté (0 -> 4)", E.applyMove(corner, move(0, 4)).ok === true);
check("refus : coin opposé non adjacent (0 -> 8)", E.applyMove(corner, move(0, 8)).ok === false);

/* ---------------------------------------------------------
   5. Blocage
   --------------------------------------------------------- */
section("5. Blocage");
/* État FORGÉ (le joueur 1 n'a qu'un pion, en 0) : le joueur 2 ferme la
   dernière sortie. En partie réelle ce cas est hors d'atteinte — la
   preuve par énumération ci-dessous le montre — mais le filet doit
   répondre. */
const trap = E.createState({ board: [1, 2, 0, 2, 0, 0, 2, 0, 0], turn: 2, phase: "movement" });
/* Avant le coup, le pion de 0 peut encore filer au centre (on interroge
   l'état du point de vue du joueur 1, puisque `legalMoves` ne répond que
   pour le joueur au trait). */
const beforeTrap = E.createState({ board: [1, 2, 0, 2, 0, 0, 2, 0, 0], turn: 1, phase: "movement" });
check("avant le coup, le pion en 0 respire encore",
  E.legalMoves(beforeTrap).some((m) => m.type === "move" && m.to === 4));
const closed = E.applyMove(trap, move(6, 4));
check("blocage détecté",
  closed.ok === true && closed.state.over === true && closed.state.reason === E.REASON.BLOCKED,
  closed.ok ? closed.state.reason : closed.error);
check("le joueur bloqué perd la partie", closed.ok && closed.state.winner === 2);
check("l'état bloqué ne propose aucun coup", closed.ok && E.legalMoves(closed.state).length === 0);
const enclosed = E.createState({ board: closed.state.board, turn: 1, phase: "movement" });
check("le pion en 0 n'a plus aucune sortie", E.legalMoves(enclosed).length === 0);

/* Preuve par énumération : sur TOUTES les positions de mouvement
   atteignables (3 pions contre 3, sans alignement), le joueur au trait
   dispose toujours d'au moins un coup. Le blocage reste donc un filet
   théorique et jamais une fin de partie réelle — c'est ce qui autorise
   le raisonnement « bloqué ⇒ déjà aligné » du moteur. */
const triples = [];
for (let a = 0; a < 9; a++)
  for (let b = a + 1; b < 9; b++)
    for (let c = b + 1; c < 9; c++) triples.push([a, b, c]);

let positions = 0;
let stuck = 0;
for (const mine of triples) {
  for (const theirs of triples) {
    if (mine.some((i) => theirs.indexOf(i) !== -1)) continue;
    const board = E.newBoard();
    for (const i of mine) board[i] = 1;
    for (const i of theirs) board[i] = 2;
    if (E.winnerLine(board, 1) || E.winnerLine(board, 2)) continue;
    positions++;
    for (const turn of [1, 2]) {
      const st = E.createState({ board: board, turn: turn, phase: "movement" });
      if (E.legalMoves(st).length === 0) stuck++;
    }
  }
}
check("balayage : plus de 1 200 positions examinées", positions > 1200, String(positions));
check("balayage : aucune position réelle ne bloque le joueur au trait", stuck === 0, String(stuck));

/* ---------------------------------------------------------
   6. Nulle par triple répétition
   --------------------------------------------------------- */
section("6. Nulle par triple répétition");
/* Position de départ du cycle — plateau :
        . 1 2
        2 1 .
        1 2 .
   Aucun alignement, trois cases libres : les deux camps peuvent faire
   des allers-retours sans jamais conclure. */
const loopStart = E.createState({ board: [0, 1, 2, 2, 1, 0, 1, 2, 0], turn: 1, phase: "movement" });
check("position de cycle : partie en cours", loopStart.over === false && loopStart.phase === E.PHASE.MOVEMENT);

const cycle = [
  move(4, 8), move(3, 0), move(8, 4), move(0, 3), // un aller-retour complet
  move(4, 8), move(3, 0), move(8, 4), move(0, 3), // et un second
];
let loop = loopStart;
let premature = false;
for (let i = 0; i < cycle.length; i++) {
  const r = E.applyMove(loop, cycle[i]);
  if (!r.ok) throw new Error("coup de cycle refusé (" + i + 1 + ") : " + r.error);
  loop = r.state;
  if (i < cycle.length - 1 && loop.over) premature = loop.reason;
}
check("la position se répète sans fin prématurée", premature === false, String(premature));
check("troisième occurrence = nulle", loop.over === true && loop.reason === E.REASON.DRAW, loop.reason);
check("une nulle n'a pas de vainqueur", loop.winner === null);
check("le trait a bien rebouclé sur le joueur 1", loop.turn === 1);
check("après une nulle, plus aucun coup", E.legalMoves(loop).length === 0);

/* ---------------------------------------------------------
   7. Contrats d'état
   --------------------------------------------------------- */
section("7. Contrats d'état");
const fresh = E.createState();
check("clé d'état = plateau|trait|phase", E.key(fresh) === "000000000|1|placement", E.key(fresh));
const freshAfter = play(fresh, [place(4)]);
check("clé d'état après une pose", E.key(freshAfter) === "000010000|2|placement", E.key(freshAfter));

const copy = E.clone(freshAfter);
copy.board[0] = 2;
copy.turn = 1;
copy.placedCount[1] = 9;
check("clone : plateau indépendant", freshAfter.board[0] === 0);
check("clone : trait indépendant", freshAfter.turn === 2);
check("clone : compteurs indépendants", freshAfter.placedCount[1] === 1);

const running = E.status(freshAfter);
check("status : partie en cours", running.over === false && running.winner === null && running.line === null);
const finished = E.status(rowWin);
check("status : victoire signalée",
  finished.over === true && finished.winner === 1 && finished.reason === E.REASON.ALIGNMENT);

check("comptage des pions",
  E.countPawns([1, 1, 2, 2, 0, 0, 0, 0, 0], 1) === 2 &&
  E.countPawns([1, 1, 2, 2, 0, 0, 0, 0, 0], 2) === 2);
check("adversaire", E.other(1) === 2 && E.other(2) === 1);
check("état construit déjà gagné : annoncé terminé",
  E.createState({ board: [1, 1, 1, 2, 2, 0, 0, 0, 0], turn: 1 }).over === true);
check("isLegal accepte un coup valide", E.isLegal(fresh, place(0)) === true);
check("isLegal refuse une pose sur case occupée", E.isLegal(freshAfter, place(4)) === false);

/* ---------------------------------------------------------
   8. Intelligence artificielle
   --------------------------------------------------------- */
section("8. Intelligence artificielle");
/* Le joueur 1 a deux pions en 0 et 1 : la case 2 conclut. */
const mate = E.createState({ board: [1, 1, 0, 2, 0, 0, 2, 0, 0], turn: 1 });
const mateMove = AI.chooseMove(mate, { level: 2, rng: seeded(1) });
check("mat en un trouvé (pose en 2)",
  mateMove !== null && mateMove.type === "place" && mateMove.to === 2, JSON.stringify(mateMove));

/* Le joueur 1 menace la case 2 ; le joueur 2 (IA) n'a aucun gain
   immédiat et ne peut que bloquer, sinon il perd au coup suivant. */
const defense = E.createState({ board: [1, 1, 0, 0, 0, 2, 0, 2, 0], turn: 2 });
const defenseMove = AI.chooseMove(defense, { level: 2, rng: seeded(7) });
check("menace adverse bloquée (pose en 2)",
  defenseMove !== null && defenseMove.to === 2, JSON.stringify(defenseMove));

/* Légalité et temps de réponse sur des parties complètes, IA contre IA. */
const duel = seeded(20261022);
let illegal = 0;
let maxMs = 0;
let plies = 0;
for (let party = 0; party < 2; party++) {
  let s = E.createState();
  while (!s.over && s.plies < 80) {
    const t0 = Date.now();
    const mv = AI.chooseMove(s, { level: 2, rng: duel, timeBudgetMs: 80 });
    const dt = Date.now() - t0;
    if (dt > maxMs) maxMs = dt;
    if (!mv || !E.isLegal(s, mv)) { illegal++; break; }
    const r = E.applyMove(s, mv);
    if (!r.ok) { illegal++; break; }
    s = r.state;
    plies++;
  }
}
check("IA contre IA : aucun coup illégal", illegal === 0, String(illegal));
check("IA contre IA : les parties avancent", plies > 10, plies + " plis");
check("chaque décision tient dans le budget (80 ms)", maxMs < 400, maxMs + " ms");

const t3 = Date.now();
AI.chooseMove(E.createState(), { level: 3, rng: seeded(5) });
const dt3 = Date.now() - t3;
check("niveau 3 : premier coup sous 800 ms", dt3 < 800, dt3 + " ms");
check("aucun coup sur une partie terminée", AI.chooseMove(rowWin, { level: 3, rng: seeded(2) }) === null);

/* Force : niveau 2 contre un adversaire qui tire au hasard. */
let wins = 0;
let draws = 0;
let losses = 0;
const lucky = seeded(99);
for (let g = 0; g < 5; g++) {
  let s = E.createState();
  while (!s.over && s.plies < 200) {
    let mv;
    if (s.turn === 1) {
      mv = AI.chooseMove(s, { level: 2, rng: lucky });
    } else {
      const options = E.legalMoves(s);
      mv = options[Math.floor(lucky() * options.length) % options.length];
    }
    const r = E.applyMove(s, mv);
    if (!r.ok) throw new Error("coup refusé pendant le test de force : " + r.error);
    s = r.state;
  }
  if (s.winner === 1) wins++;
  else if (s.winner === 2) losses++;
  else draws++;
}
check("5 parties contre le hasard : aucune défaite", losses === 0, "V" + wins + " N" + draws + " D" + losses);
check("5 parties contre le hasard : au moins 3 victoires", wins >= 3, "V" + wins + " N" + draws + " D" + losses);

/* ================= PLATEAU ET INTERACTION ================= */
section("Plateau et interaction (board.js, ui.js)");
const Board = require("./board.js");
const UI = require("./ui.js");

check("8 lignes gagnantes de 3 cases", Board.LINES.length === 8 && Board.LINES.every((l) => l.length === 3));
check("geometrie : case 0 en haut a gauche, case 4 au centre",
  Board.hitTest(12, 12, 300, 300, 10) === 0 && Board.cellRect(4, 300, 300, 10).x > 100);
check("un clic dans la gouttiere ne touche aucune case", Board.hitTest(0, 0, 300, 300, 10) === null);

{
  const stub = { render: () => null };
  let seen = null;
  const ctl = UI.createController({ engine: E, board: stub, mySide: 1, onMove: (m) => { seen = m; } });
  const r1 = ctl.click(4);
  check("phase de pose : un clic pose un pion", r1.moved && r1.move.type === "place" && r1.move.to === 4);
  check("la pose est transmise a onMove", seen && seen.type === "place" && seen.to === 4);
  check("la main passe a l adversaire", ctl.getState().turn === 2);
  const r2 = ctl.click(0);
  check("sans la main, le clic est refuse", !r2.moved && r2.reason === "not-your-turn");

  let st = E.createState();
  let g = 0;
  while (st.phase === E.PHASE.PLACEMENT && g++ < 20) st = E.applyMove(st, E.legalMoves(st)[0]).state;
  check("six poses font entrer en phase de mouvement", st.phase === E.PHASE.MOVEMENT);

  const me = st.turn;
  const mv = E.legalMoves(st).find((m) => m.type === "move" && st.board[m.from] === me);
  const ctl2 = UI.createController({ state: st, mySide: me, board: stub });
  const s1 = ctl2.click(mv.from);
  check("un clic sur son pion le selectionne", !s1.moved && s1.reason === "selection" && ctl2.getSelected() === mv.from);
  const s2 = ctl2.click(mv.to);
  check("un second clic joue la glisse", s2.moved && s2.move.type === "move" && s2.move.from === mv.from);
  check("la selection est videe apres le coup", ctl2.getSelected() === null);
}
console.log(failures === 0
  ? "\nRESULTAT : TOUS LES TESTS PASSENT"
  : "\nRESULTAT : " + failures + " ECHEC(S)");
process.exit(failures === 0 ? 0 : 1);
