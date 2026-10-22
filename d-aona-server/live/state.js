"use strict";
/* Etat serveur en memoire : LES MEMES objets pour tous les modules.
   Un module qui en fabriquerait une copie casserait la diffusion temps reel
   (chaque copie aurait ses propres sockets). */

const connections = new Map();     // ws -> { userId, pseudo }
const userSockets = new Map();     // userId -> ws
const sessions = new Map();        // sessionId -> GameSession (engine)
const spectators = new Map();      // sessionId -> Set<userId>
const disconnectTimers = new Map();// userId -> { timer, sessionId }
const pendingMatches = new Map();  // cle -> { p1, p2, p1Ready, p2Ready, format, game }
const aiTimers = new Map();        // sessionId -> timer
/* Files d attente : cle "<jeu>/<format>". Aucune cle n est pre-creee : une file
   n existe que si un joueur y attend. Deux jeux differentes ne peuvent donc
   pas se rencontrer, meme a format egal. */
const mmQueues = Object.create(null);

module.exports = {
  connections, userSockets, sessions, spectators,
  disconnectTimers, pendingMatches, aiTimers, mmQueues,
};