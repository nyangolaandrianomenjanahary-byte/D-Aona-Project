/* Fanoron-Telo - REGLES (facade).
   ---------------------------------------------------------
   Les regles vivent dans le dossier de jeu de l interface :
   `D-aona/d-aona-web/games/fanoron-telo/engine.js`. Ce fichier est un pied UMD
   (`module.exports` + `window.FanoronTelo`) : le navigateur le charge comme
   script, le serveur le `require()` — UNE seule copie des regles, donc aucune
   divergence client/serveur possible par construction.

   Ce module n ajoute rien : il expose le contrat "moteur" attendu par
   test/structure.js et par ./session.js. */
"use strict";

module.exports = require("../../../D-aona/d-aona-web/games/fanoron-telo/engine.js");
