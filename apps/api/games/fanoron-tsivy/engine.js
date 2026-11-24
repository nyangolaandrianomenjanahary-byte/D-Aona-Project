/* Fanoron-Tsivy - REGLES PURES (aucun DOM, aucun etat de session).
   Geometrie 5x9, prises par approche et par retrait, chaines de prises.
   Ce fichier ne connait ni horloge ni joueur : voir ./session.js pour la
   conduite d une partie, et ./manifest.json pour le contrat du jeu. */

/* =========================================================
   D-aôna — Moteur Fanorona serveur (autoritaire)
   Logique pure — aucune dépendance DOM.
   ========================================================= */
"use strict";

const ROWS = 5, COLS = 9;
const DIRS = [];
for (let dr = -1; dr <= 1; dr++)
  for (let dc = -1; dc <= 1; dc++)
    if (dr || dc) DIRS.push([dr, dc]);

const inBoard = (r, c) => r >= 0 && r < ROWS && c >= 0 && c < COLS;
const even = (r, c) => (r + c) % 2 === 0;
const countPieces = (grid, who) => grid.flat().filter((v) => v === who).length;

function initialGrid() {
  const g = Array.from({ length: ROWS }, () => Array(COLS).fill(0));
  for (let c = 0; c < COLS; c++) { g[0][c] = 2; g[1][c] = 2; g[3][c] = 1; g[4][c] = 1; }
  g[2] = [2, 1, 2, 1, 0, 1, 2, 1, 2];
  return g;
}

function movesFrom(grid, r, c, me, chain) {
  const enemy = me === 1 ? 2 : 1;
  const out = [];
  for (const [dr, dc] of DIRS) {
    // Diagonale : permise UNIQUEMENT depuis un point fort ((r+c) pair) — sur le
    // plateau gravé, les croisements obliques (motifs étoile/losange) n'existent
    // qu'à ces intersections. Depuis un point faible, seules les 4 directions
    // orthogonales sont des arêtes. Un pas diagonal conserve la parité de (r+c),
    // donc l'arrivée est aussi un point fort.
    if (dr !== 0 && dc !== 0 && !even(r, c)) continue;
    if (chain && chain.lastDir && chain.lastDir[0] === dr && chain.lastDir[1] === dc) continue;
    const nr = r + dr, nc = c + dc;
    if (!inBoard(nr, nc) || grid[nr][nc] !== 0) continue;
    if (chain && chain.visited && chain.visited.has(nr + "," + nc)) continue;

    const apr = [];
    let ar = nr + dr, ac = nc + dc;
    while (inBoard(ar, ac) && grid[ar][ac] === enemy) { apr.push([ar, ac]); ar += dr; ac += dc; }

    const ret = [];
    let wr = r - dr, wc = c - dc;
    while (inBoard(wr, wc) && grid[wr][wc] === enemy) { ret.push([wr, wc]); wr -= dr; wc -= dc; }

    if (apr.length)  out.push({ from: [r, c], to: [nr, nc], dir: [dr, dc], kind: "apr",  cap: apr });
    if (ret.length)  out.push({ from: [r, c], to: [nr, nc], dir: [dr, dc], kind: "ret",  cap: ret });
    if (!apr.length && !ret.length) out.push({ from: [r, c], to: [nr, nc], dir: [dr, dc], kind: "paika", cap: [] });
  }
  return out;
}

function legalMoves(grid, me, chain) {
  if (chain) {
    return movesFrom(grid, chain.pos[0], chain.pos[1], me, chain).filter((m) => m.cap.length);
  }
  let all = [];
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++)
      if (grid[r][c] === me) all = all.concat(movesFrom(grid, r, c, me, null));
  /* DÉPLACEMENT LIBRE (règle du produit) : la prise n'est JAMAIS obligatoire.
     Tous les pas vers une intersection vide sont permis — les prises restent
     automatiques quand la géométrie les déclenche (approche/retrait), et la
     continuation de chaîne (cas `chain` ci-dessus) exige toujours une prise.
     Une case d'arrivée occupée — pion adverse ou allié — interdit le pas :
     c'est le « chemin bloqué ». */
  return all;
}

function checkWin(grid) {
  const me = countPieces(grid, 1), opp = countPieces(grid, 2);
  if (!opp) return 1;
  if (!me) return 2;
  return 0;
}

function computeEloDelta(playerElo, oppElo, result) {
  const expected = 1 / (1 + Math.pow(10, (oppElo - playerElo) / 400));
  return Math.round(32 * (result - expected));
}

module.exports = {
  ROWS, COLS, DIRS, inBoard, even, countPieces,
  initialGrid, movesFrom, legalMoves, checkWin, computeEloDelta,
};
