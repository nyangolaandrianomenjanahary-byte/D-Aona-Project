/* Facade de compatibilite.
   Le moteur Fanoron-Tsivy vit desormais dans games/fanoron-tsivy/ :
     - engine.js  : regles pures
     - session.js : conduite de partie (horloges, tirage, camps, chaines)
     - manifest.json : contrat du jeu
   Ce fichier ne contient AUCUN code : il preserve les 9 symboles historiques
   utilises par server.js, demo_live.js et test_scenarios.js. */
"use strict";

const M = require("./games/fanoron-tsivy");

module.exports = {
  ROWS: M.ROWS, COLS: M.COLS,
  initialGrid: M.initialGrid, movesFrom: M.movesFrom, legalMoves: M.legalMoves,
  countPieces: M.countPieces, checkWin: M.checkWin, computeEloDelta: M.computeEloDelta,
  GameSession: M.GameSession,
};