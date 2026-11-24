/* Registre des jeux heberges par le SERVEUR.
   ---------------------------------------------------------
   Le socle ne nomme aucun jeu : il demande `<id>` au registre et recoit un
   module qui expose le contrat « moteur + session ». Ajouter un plateau
   classable = creer son dossier (manifest.json, engine.js, session.js,
   index.js) et ajouter UNE ligne ici.

   `DEFAULT` garde le comportement historique : un client qui n envoie pas
   `game` (ancienne version) tombe sur le Fanoron-Tsivy, seul jeu ouvert
   jusqu ici. */
"use strict";

const GAMES = {
  "fanoron-tsivy": require("./fanoron-tsivy"),
  "fanoron-dimy": require("./fanoron-dimy"),
  "fanoron-telo": require("./fanoron-telo"),
};

const DEFAULT = "fanoron-tsivy";

const has = (id) => Object.prototype.hasOwnProperty.call(GAMES, id);
const get = (id) => GAMES[has(id) ? id : DEFAULT];
const ids = () => Object.keys(GAMES);

module.exports = { DEFAULT, has, get, ids };
