/* Fanoron-Telo - CONDUITE DE PARTIE cote serveur.
   ---------------------------------------------------------
   Meme CONTRAT que la session du Tsivy (games/fanoron-tsivy/session.js) : le
   socle ne connait que ces methodes, jamais les regles d un jeu.

     getState()        etat complet, publiable tel quel au client
     getLegalMoves()   coups du joueur au trait
     applyMove(move)   -> { ok:true, gameOver?, winner?, reason?, state }
     resign(playerNum) abandon
     tickClock()       une seconde de l horloge du joueur au trait
     finish(winner)    deltas Elo du resultat
     piecesLeft(side)  pions restants (fil « En direct », bilan de fin)

   Aucune regle ici : tout vient de ./engine.js, qui est le fichier du dossier
   de jeu de l interface (une seule copie). Pas de tirage au sort dans cette
   variante : la pose commence directement au joueur 1.
   ========================================================= */
"use strict";

const E = require("./engine");
/* L Elo est CELUI DU SOCLE : un seul bareme pour les trois plateaux, donc un
   seul classement. `computeEloDelta` vit dans le moteur du Tsivy. */
const { computeEloDelta } = require("../fanoron-tsivy/engine");

const other = (n) => (n === 1 ? 2 : 1);

class GameSession {
  constructor(sessionId, player1, player2, mode, format, wager) {
    this.game = "fanoron-telo";
    this.sessionId = sessionId;
    this.player1 = player1;
    this.player2 = player2;
    this.mode = mode;
    this.format = format;
    this.wager = wager || 0;
    /* `phase` est celui de la SESSION (le Tsivy y met « choose » pendant le
       tirage). Ici il n y a pas de tirage : la session est en jeu des l
       ouverture. La phase de la variante (pose / mouvement) vit dans l etat. */
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
    if (!res.ok) return { ok: false, error: res.error };
    const played = res.state.lastMove;
    if (played) this.moves.push(played.type === "place" ? { type: "place", to: played.to }
                                                       : { type: "move", from: played.from, to: played.to });
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

  /* Deltas Elo. Le resultat vaut 1 / 0,5 / 0 : la nulle (triple repetition)
     compte comme un demi-point pour les DEUX camps, sans victoire ni defaite. */
  finish(winner) {
    const score = (n) => (winner === 0 || winner === null || winner === undefined ? 0.5 : winner === n ? 1 : 0);
    return {
      winnerId: winner === 1 ? this.player1.id : (winner === 2 ? this.player2.id : null),
      delta1: computeEloDelta(this.player1.elo, this.player2.elo, score(1)),
      delta2: computeEloDelta(this.player2.elo, this.player1.elo, score(2)),
    };
  }

  piecesLeft(side) {
    return this.state.board.filter((v) => v === side).length;
  }

  getState() {
    const s = this.state;
    return {
      game: this.game,
      board: s.board.slice(),
      turn: s.turn,
      phase: s.phase,
      over: !!s.over,
      winner: s.winner || 0,
      reason: s.reason || null,
      line: s.line ? s.line.slice() : null,
      lastMove: s.lastMove || null,
      placedCount: { 1: s.placedCount[1], 2: s.placedCount[2] },
      reps: Object.assign({}, s.reps),
      mode: this.mode,
      format: this.format,
      clock: Object.assign({}, this.clock),
      moves: this.moves.map((m) => Object.assign({}, m)),
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
