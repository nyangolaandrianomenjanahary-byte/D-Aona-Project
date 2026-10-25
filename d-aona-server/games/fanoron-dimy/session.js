/* Fanoron-Dimy - CONDUITE DE PARTIE cote serveur.
   ---------------------------------------------------------
   Meme CONTRAT que la session du Tsivy (games/fanoron-tsivy/session.js), donc
   interchangeable dans le socle : getState / getLegalMoves / applyMove /
   resign / tickClock / finish / piecesLeft.

   Aucune regle ici : tout vient de ./engine.js (le fichier du dossier de jeu de
   l interface, une seule copie). Cette variante demarre directement en jeu et
   ne connait pas la prise en chaine : un coup = un demi-coup.
   ========================================================= */
"use strict";

const E = require("./engine");
/* Un seul bareme Elo pour tous les plateaux : celui du socle (moteur Tsivy). */
const { computeEloDelta } = require("../fanoron-tsivy/engine");

const other = (n) => (n === 1 ? 2 : 1);

class GameSession {
  constructor(sessionId, player1, player2, mode, format, wager) {
    this.game = "fanoron-dimy";
    this.sessionId = sessionId;
    this.player1 = player1;
    this.player2 = player2;
    this.mode = mode;
    this.format = format;
    this.wager = wager || 0;
    /* La session est en jeu des l ouverture (pas de tirage au sort). */
    this.phase = "play";
    this.state = E.createState();
    this.turn = this.state.turn;
    this.over = false;
    this.moves = [];
    this.clock = { 1: format.time, 2: format.time };
  }

  getLegalMoves() {
    return E.legalMoves(this.state);
  }

  applyMove(move) {
    if (this.over) return { ok: false, error: "Partie terminée" };
    const res = E.applyMove(this.state, move);
    if (!res.ok) return { ok: false, error: res.error || "Coup invalide" };
    /* Le moteur rend le coup REELLEMENT joue (sens approche/retrait tranche) :
       c est celui-la qui entre dans l historique, pas la demande du client. */
    const m = res.move;
    this.moves.push({ from: m.from, to: m.to, dir: [m.dir[0], m.dir[1]], kind: m.kind, cap: m.cap.slice() });
    this.state = res.state;
    this.turn = this.state.turn;
    if (this.state.over) {
      this.over = true;
      return {
        ok: true, gameOver: true,
        winner: this.state.winner || 0, reason: this.state.reason,
        state: this.getState(),
      };
    }
    return { ok: true, gameOver: false, state: this.getState() };
  }

  resign(playerNum) {
    if (this.over) return { ok: false, error: "Partie terminée" };
    const winner = other(playerNum);
    this.over = true;
    this.state = Object.assign({}, this.state, { over: true, winner, reason: "abandon" });
    return { ok: true, gameOver: true, winner, reason: "abandon", state: this.getState() };
  }

  tickClock() {
    if (this.over) return null;
    const p = this.turn;
    this.clock[p] = Math.max(0, this.clock[p] - 1);
    if (this.clock[p] !== 0) return null;
    this.over = true;
    this.state = Object.assign({}, this.state, { over: true, winner: other(p), reason: "temps" });
    return { gameOver: true, winner: other(p), reason: "temps" };
  }

  /* Nulle (60 demi-coups sans prise) = demi-point pour chacun. */
  finish(winner) {
    const score = (n) => (winner === 0 || winner === null || winner === undefined ? 0.5 : winner === n ? 1 : 0);
    return {
      winnerId: winner === 1 ? this.player1.id : (winner === 2 ? this.player2.id : null),
      delta1: computeEloDelta(this.player1.elo, this.player2.elo, score(1)),
      delta2: computeEloDelta(this.player2.elo, this.player1.elo, score(2)),
    };
  }

  piecesLeft(side) {
    return E.countPieces(this.state.board, side);
  }

  getState() {
    const s = this.state;
    return {
      game: this.game,
      board: s.board.slice(),
      turn: s.turn,
      over: !!s.over,
      winner: s.winner || 0,
      reason: s.reason || null,
      silent: s.silent || 0,
      last: s.last ? { from: s.last.from, to: s.last.to, cap: s.last.cap.slice() } : null,
      mode: this.mode,
      format: this.format,
      clock: Object.assign({}, this.clock),
      moves: this.moves.map((m) => ({ from: m.from, to: m.to, dir: [m.dir[0], m.dir[1]], kind: m.kind, cap: m.cap.slice() })),
      player1: playerOf(this.player1),
      player2: playerOf(this.player2),
      opponent: this.turn === 1 ? playerOf(this.player2) : playerOf(this.player1),
      wage: this.wager,
    };
  }
}

/* Meme forme que l etat du Tsivy : le client peint le plateau par PROPRIETAIRE
   (apparences des pions comprises). */
function playerOf(p) {
  return {
    id: p.id, pseudo: p.pseudo, elo: p.elo,
    pionStyles: p.pionStyles || null,
  };
}

module.exports = { GameSession };
