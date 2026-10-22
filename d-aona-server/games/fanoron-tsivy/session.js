/* Fanoron-Tsivy - CONDUITE DE PARTIE (horloges, tirage, camps, enchainement).
   Aucune regle de deplacement ici : tout vient de ./engine.js. */
"use strict";

const {
  ROWS, COLS, DIRS, inBoard, even, countPieces,
  initialGrid, movesFrom, legalMoves, checkWin, computeEloDelta,
} = require("./engine");

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
      /* `pionStyles` = l'apparence des pions DU compte, une par camp. Elle voyage avec
         l'état parce que le plateau se peint par PROPRIÉTAIRE : sans elle, le client
         n'aurait que la sienne et l'appliquerait aussi aux pions de l'adversaire
         (c'était le cas). `game.js` ne lit pas la base — les apparences sont posées
         sur les objets joueurs par `createGameSession` (server.js), avec le reste du
         profil. `null` (IA sans compte, état d'avant la mise à jour) ⇒ le client
         retombe sur le pion Vato du camp, jamais sur l'apparence de l'autre joueur. */
      player1: { id: this.player1.id, pseudo: this.player1.pseudo, elo: this.player1.elo,
                 pionStyles: this.player1.pionStyles || null },
      player2: { id: this.player2.id, pseudo: this.player2.pseudo, elo: this.player2.elo,
                 pionStyles: this.player2.pionStyles || null },
      opponent: this.phase === "choose" ? this.player2 : (this.turn === 1 ? this.player2 : this.player1),
      wage: this.wager,
    };
  }
}

module.exports = { GameSession };
