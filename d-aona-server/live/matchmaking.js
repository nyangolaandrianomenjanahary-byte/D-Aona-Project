"use strict";
/* Appariement : une file par couple JEU + FORMAT.
   La cle est "<jeu>/<format>" : un joueur de Fanorona ne peut pas tomber sur
   un joueur de Katro, meme s ils ont choisi "blitz" tous les deux. */
const { mmQueues } = require("./state");

/* Jeu par defaut : le client historique n envoie que `format`. Tant qu un
   seul jeu est ouvert, ce defaut garde le comportement d avant. */
const DEFAULT_GAME = "fanorona";

const key = (game, format) => String(game) + "/" + String(format);
const formatOf = (k) => String(k).slice(String(k).indexOf("/") + 1);
const gameOf = (k) => String(k).slice(0, String(k).indexOf("/"));

function queueOf(k) {
  if (!mmQueues[k]) mmQueues[k] = [];
  return mmQueues[k];
}

function enqueue(game, format, entry) { queueOf(key(game, format)).push(entry); }

/* Retire l adherent et son adversaire d une file ; renvoie l adversaire ou null.
   On sort TOUJOURS le demandeur de la file : soit il joue, soit il attend. */
function takeOpponent(game, format, userId) {
  const k = key(game, format);
  const q = queueOf(k);
  const opp = q.find((e) => e.userId !== userId && e.mode === "online");
  mmQueues[k] = q.filter((e) => e.userId !== userId && e.userId !== (opp ? opp.userId : null));
  return opp || null;
}

/* Sort un joueur de TOUTES les files (annulation, deconnexion). */
function removeUser(userId) {
  for (const k of Object.keys(mmQueues)) {
    mmQueues[k] = mmQueues[k].filter((e) => e.userId !== userId);
    if (!mmQueues[k].length) delete mmQueues[k];
  }
}

/* Apparie les files qui contiennent au moins deux joueurs, par Elo croissant.
   Renvoie les paires formees : [{ key, pair: [a, b] }]. */
function drainPairs() {
  const out = [];
  for (const k of Object.keys(mmQueues)) {
    const q = mmQueues[k];
    if (q.length < 2) continue;
    q.sort((a, b) => (a.elo || 0) - (b.elo || 0));
    delete mmQueues[k];
    for (let i = 0; i + 1 < q.length; i += 2) out.push({ key: k, pair: [q[i], q[i + 1]] });
    if (q.length % 2) queueOf(k).push(q[q.length - 1]);
  }
  return out;
}

module.exports = { DEFAULT_GAME, key, gameOf, formatOf, enqueue, takeOpponent, removeUser, drainPairs };