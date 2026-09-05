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
  const caps = all.filter((m) => m.cap.length);
  return caps.length ? caps : all;
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

class GameSession {
  constructor(sessionId, player1, player2, mode, format, wager) {
    this.sessionId = sessionId;
    this.player1 = player1;
    this.player2 = player2;
    this.mode = mode;
    this.format = format;
    this.wager = wager || 0;
    this.grid = initialGrid();
    /* Tirage au sort (règle officielle) : chaque joueur choisit une face
       (PILE/FACE). Une fois une face réservée, l'autre joueur reçoit
       automatiquement l'autre face. On lance ensuite la pièce : celui dont
       la face sort commence. Résolu quand les 2 faces ont été posées. */
    this.phase = "choose";
    this.choices = { 1: null, 2: null };
    this.tossSide = null;
    this.starter = null;
    this.turn = null;
    this.chain = null;
    this.over = false;
    this.moves = [];
    this.clock = { 1: format.time, 2: format.time };
  }

  getLegalMoves() {
    return legalMoves(this.grid, this.turn, this.chain);
  }

  /* Choix des faces du tirage au sort. Une face déjà prise par l'autre joueur
     n'est plus disponible : on répond alors avec la face restante (forced). */
  pickSide(playerNum, side) {
    if (this.phase !== "choose") return { ok: false, error: "Choix déjà effectué", state: this.getState() };
    if (side !== "pile" && side !== "face") return { ok: false, error: "Face invalide", state: this.getState() };
    const other = playerNum === 1 ? 2 : 1;
    const taken = this.choices[other];
    if (taken === side) {
      const forced = taken === "pile" ? "face" : "pile";
      return { ok: false, error: "Cette face est déjà prise par l'adversaire", forced, state: this.getState() };
    }
    if (this.choices[playerNum] === side) return { ok: true, resolved: false, state: this.getState() };
    this.choices[playerNum] = side;
    if (this.choices[other] !== null) return this.resolveToss();
    return { ok: true, resolved: false, state: this.getState() };
  }

  /* Lancement de la pièce : celui dont la face choisie sort commence. */
  resolveToss() {
    this.tossSide = Math.random() < 0.5 ? "pile" : "face";
    this.starter = this.choices[1] === this.tossSide ? 1 : 2;
    this.turn = this.starter;
    this.phase = "play";
    return { ok: true, resolved: true, state: this.getState() };
  }

  applyMove(move) {
    if (this.over) return { ok: false, error: "Partie terminée" };
    if (this.phase !== "play") return { ok: false, error: "Tirage au sort en cours" };
    if (this.chain && (this.chain.pos[0] !== move.from[0] || this.chain.pos[1] !== move.from[1]))
      return { ok: false, error: "Prise en chaîne : jouez le pion en chaîne" };

    const legal = this.getLegalMoves();
    const validMove = legal.find((m) =>
      m.from[0] === move.from[0] && m.from[1] === move.from[1] &&
      m.to[0] === move.to[0] && m.to[1] === move.to[1] &&
      m.kind === move.kind &&
      JSON.stringify(m.cap) === JSON.stringify(move.cap || m.cap)
    );
    if (!validMove) return { ok: false, error: "Coup invalide" };

    const [fr, fc] = move.from, [tr, tc] = move.to;
    this.grid[fr][fc] = 0;
    this.grid[tr][tc] = this.turn;
    (move.cap || []).forEach(([cr, cc]) => { this.grid[cr][cc] = 0; });
    this.moves.push(move);

    if ((move.cap || []).length > 0) {
      const visited = this.chain ? new Set(this.chain.visited) : new Set([fr + "," + fc]);
      visited.add(tr + "," + tc);
      this.chain = { pos: [tr, tc], visited, lastDir: move.dir };
      const cont = legalMoves(this.grid, this.turn, this.chain);
      if (cont.length > 0) {
        return { ok: true, chain: true, state: this.getState() };
      }
    }

    this.chain = null;
    this.turn = this.turn === 1 ? 2 : 1;

    const winner = checkWin(this.grid);
    if (winner) {
      this.over = true;
      return { ok: true, gameOver: true, winner, reason: "capture", state: this.getState() };
    }

    const nextMoves = legalMoves(this.grid, this.turn, null);
    if (!nextMoves.length) {
      this.over = true;
      return { ok: true, gameOver: true, winner: this.turn === 1 ? 2 : 1, reason: "blocage", state: this.getState() };
    }

    return { ok: true, chain: false, state: this.getState() };
  }

  endChain() {
    if (!this.chain) return { ok: false, error: "Pas de chaîne active" };
    this.chain = null;
    this.turn = this.turn === 1 ? 2 : 1;
    const winner = checkWin(this.grid);
    if (winner) {
      this.over = true;
      return { ok: true, gameOver: true, winner, reason: "capture", state: this.getState() };
    }
    return { ok: true, chain: false, state: this.getState() };
  }

  resign(playerNum) {
    if (this.over) return { ok: false, error: "Partie terminée" };
    this.over = true;
    const winner = playerNum === 1 ? 2 : 1;
    return { ok: true, gameOver: true, winner, reason: "abandon", state: this.getState() };
  }

  tickClock() {
    if (this.over) return null;
    this.clock[this.turn] = Math.max(0, this.clock[this.turn] - 1);
    if (this.clock[this.turn] === 0) {
      this.over = true;
      return { gameOver: true, winner: this.turn === 1 ? 2 : 1, reason: "temps" };
    }
    return null;
  }

  finish(winner) {
    const meElo = this.player1.elo;
    const oppElo = this.player2.elo;
    const d1 = computeEloDelta(meElo, oppElo, winner === 1 ? 1 : 0);
    const d2 = computeEloDelta(oppElo, meElo, winner === 2 ? 1 : 0);
    return { winnerId: winner === 1 ? this.player1.id : this.player2.id, delta1: d1, delta2: d2 };
  }

  getState() {
    return {
      grid: this.grid,
      turn: this.turn,
      chain: this.chain ? {
        pos: [...this.chain.pos],
        visited: Array.from(this.chain.visited),
        lastDir: [...this.chain.lastDir],
      } : null,
      over: this.over,
      phase: this.phase,
      choices: { 1: this.choices[1], 2: this.choices[2] },
      toss: this.tossSide ? { side: this.tossSide, starter: this.starter, choices: { 1: this.choices[1], 2: this.choices[2] } } : null,
      clock: { ...this.clock },
      moves: this.moves.map((m) => ({
        from: [...m.from], to: [...m.to], dir: [...m.dir], kind: m.kind,
        cap: m.cap.map((c) => [...c]),
      })),
      mode: this.mode,
      format: this.format,
      player1: { id: this.player1.id, pseudo: this.player1.pseudo, elo: this.player1.elo },
      player2: { id: this.player2.id, pseudo: this.player2.pseudo, elo: this.player2.elo },
      opponent: this.phase === "choose" ? this.player2 : (this.turn === 1 ? this.player2 : this.player1),
      wage: this.wager,
    };
  }
}

module.exports = {
  ROWS, COLS,
  initialGrid, movesFrom, legalMoves, countPieces, checkWin, computeEloDelta,
  GameSession,
};
