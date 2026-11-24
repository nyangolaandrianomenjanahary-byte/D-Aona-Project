/* =========================================================
   D-aôna — PARTIES EN DIRECT DE DÉMONSTRATION
   ---------------------------------------------------------
   Les parties en cours vivent en MÉMOIRE dans le serveur (Map `sessions`) :
   aucune insertion en base ne peut donc les faire apparaître. Ce script
   connecte de VRAIS clients WebSocket (les comptes `Demo…`), les apparie par
   le matchmaking normal et joue des coups LÉGITIMES (moteur game.js) à un
   rythme humain : le fil « En direct » se remplit, et les cartes montrent de
   vrais coups et de vrais pions restants.

   Prérequis : serveur lancé + `node demo_seed.js --yes` appliqué.

   Usage :  node demo_live.js [--matches=3]
   Arrêt :  Ctrl+C — les parties sont abandonnées, comme un vrai départ de
            joueur (le serveur applique alors son délai de grâce).
   ========================================================= */
"use strict";

const WebSocket = require("ws");
const { legalMoves } = require("./game");

const BASE = "http://127.0.0.1:" + (process.env.D_AONA_PORT || process.env.PORT || "8080");
/* Le serveur WebSocket est monté sur le chemin `/ws` (voir server.js), pas sur
   la racine : s'y connecter à la racine répond 400 et le bot resterait muet. */
const WS_URL = BASE.replace(/^http/, "ws") + "/ws";
const PWD = "Demo!2026Zz9";
const FORMAT = "rapide";
const POOL = ["DemoRado", "DemoNaivo", "DemoHery", "DemoTsiry",
              "DemoLova", "DemoFara", "DemoMiora", "DemoSolo"];

/* Les sessions fantômes d'une exécution précédente (partie laissée vivante par
   le délai de grâce de 20 s) restent en mémoire du serveur ET dans le fil
   « En direct ». `--clean` les résilie au démarrage, sans attendre : utile si
   l'on veut une démonstration sans reste des essais précédents. */
const CLEAN = process.argv.includes("--clean");

const arg = (nom, dflt) => {
  const a = process.argv.find((x) => x.startsWith("--" + nom + "="));
  return a ? Number(a.split("=")[1]) : dflt;
};
/* 2 bots par partie ; plafonné à 4 parties (8 connexions) : au-delà, la
   démonstration n'apporte rien et surcharge le serveur. */
const MATCHES = Math.max(1, Math.min(4, arg("matches", 3)));
const log = (...a) => console.log("[" + new Date().toLocaleTimeString("fr-FR") + "]", ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* Connexion par le VRAI point d'entrée : le jeton est émis par le serveur
   (mêmes règles que le navigateur, aucune session bricolée).
   Le serveur limite les tentatives de connexion (12 par 5 min et par réseau,
   anti-force brute) : on respecte le délai annoncé au lieu d'insister. */
async function login(pseudo, essai = 1) {
  const r = await fetch(BASE + "/api/auth/login", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pseudo, password: PWD }),
  });
  const j = await r.json().catch(() => ({}));
  if (r.ok && j.token) return j.token;
  const attente = /Réessayez dans (\d+) s/.exec(j.error || "");
  if (r.status === 429 && attente && essai <= 3) {
    const s = Number(attente[1]) + 2;
    log(pseudo + " : limite de connexions atteinte — nouvelle tentative dans " + s + " s");
    await sleep(s * 1000);
    return login(pseudo, essai + 1);
  }
  throw new Error(pseudo + " : connexion refusée (" + (j.error || r.status) + ")");
}

/* Un bot = un joueur connecté qui répond au protocole WebSocket de l'app. */
class Bot {
  constructor(pseudo, token) {
    this.pseudo = pseudo; this.token = token;
    this.ws = null; this.sessionId = null; this.playerNum = null;
    this.queued = false; this.timer = null; this.fini = false;
    /* Dernier état autoritaire reçu : c'est LUI qui sert à choisir le coup au
       moment de l'envoyer, jamais un état capturé à la planification (un coup
       joué sur un état périmé est refusé par le serveur). */
    this.lastState = null; this.lastStateAt = 0;
    /* Sessions fantômes déjà résiliées et synchronisations sans réponse : servent
       à ne pas insister indéfiniment sur une partie qui n'existe plus. */
    this.abandonnees = new Set(); this.syncs = 0;
  }

  open() {
    this.ws = new WebSocket(WS_URL);
    this.ws.on("open", () => this.send({ type: "auth", token: this.token }));
    this.ws.on("message", (raw) => {
      let m; try { m = JSON.parse(raw); } catch (e) { return; }
      this.onMessage(m);
    });
    /* Coupure réseau ou arrêt du serveur : on retente, et on REPREND la partie
       en cours (le serveur garde 20 s de délai de grâce) au lieu de l'abandonner. */
    this.ws.on("close", () => {
      if (this.fini) return;
      this.queued = false;
      if (this.sessionId) setTimeout(() => { if (!this.fini) this.sync(); }, 1500);
      setTimeout(() => this.open(), 3000);
    });
    this.ws.on("error", () => {});
  }

  send(o) {
    try { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(o)); } catch (e) {}
  }

  /* File d'attente du matchmaking : le serveur apparie deux joueurs du même
     format, sans mise ni KYC (mode « online » gratuit). */
  queue() {
    if (this.queued || this.sessionId) return;
    this.queued = true;
    this.send({ type: "find_match", format: FORMAT, mode: "online" });
  }

  onMessage(m) {
    /* Une seule partie compte : CELLE de ce bot. Le serveur peut pousser l'état
       d'une autre partie du même compte — à la (re)connexion il renvoie la
       première session vivante trouvée, et un redémarrage de ce script en moins
       de 20 s laisse la partie précédente vivante. Jouer un état étranger fait
       refuser tous les coups (« Coup invalide ») et la partie reste figée : on
       écarte donc tout message dont la session n'est pas la nôtre. */
    if (m.sessionId && m.sessionId !== this.sessionId && m.type !== "game_start") {
      if (m.type === "game_state" && !this.sessionId) this.abandon(m.sessionId);
      return;
    }
    switch (m.type) {
      case "match_found":
        this.queued = false;
        this.send({ type: "accept_match", matchKey: m.matchKey });
        break;
      case "match_cancelled":
        this.queued = false;
        this.queue();
        break;
      case "game_start":
        this.sessionId = m.sessionId; this.playerNum = m.playerNum; this.queued = false;
        this.syncs = 0;
        log(this.pseudo + " ▶ partie " + m.sessionId + " contre " + m.opponent.pseudo +
            " (joueur " + m.playerNum + ")");
        /* Tirage au sort : chacun réserve une face, le serveur lance la pièce. */
        setTimeout(() => this.send({
          type: "pick_side", sessionId: m.sessionId,
          side: this.playerNum === 1 ? "pile" : "face",
        }), 500 + Math.random() * 900);
        break;
      case "game_state":
        this.lastState = m.state; this.lastStateAt = Date.now(); this.syncs = 0;
        this.think(m.state);
        break;
      /* Les erreurs du serveur (session expirée, mise insuffisante, coup refusé)
         ne doivent pas rester invisibles : sans ce journal, un bot bloqué ne se
         diagnostique pas. */
      case "error":
        log(this.pseudo + " ⚠ " + m.message);
        /* Coup refusé = état local divergent : on jette le coup en attente et on
           redemande l'état autoritaire. Sans cela personne ne rejoue — l'autre
           attend son tour — et la partie reste figée dans le fil « En direct ». */
        if (this.timer) { clearTimeout(this.timer); this.timer = null; }
        this.sync();
        break;
      case "game_end":
        if (m.sessionId !== this.sessionId) return;
        log(this.pseudo + " ■ fin de partie (" + ((m.result && m.result.reason) || "?") + ")");
        this.sessionId = null; this.playerNum = null; this.queued = false;
        this.lastState = null; this.lastStateAt = 0; this.syncs = 0;
        if (this.timer) { clearTimeout(this.timer); this.timer = null; }
        /* Nouvelle partie après une courte pause : le fil reste garni. */
        setTimeout(() => this.queue(), 5000 + Math.random() * 5000);
        break;
      default:
        break;
    }
  }

  /* Joue un coup LÉGITIME après un délai « humain » : la partie reste assez
     longtemps en cours pour être suivie en spectateur. Le coup n'est PAS figé à
     la planification : il est choisi quand le délai expire, sur le dernier état
     reçu — un état arrivé entre-temps rendait sinon le coup refusé (l'état local
     et l'état serveur ne disaient plus la même chose). */
  think(state) {
    if (!state || state.over || this.timer || !this.sessionId) return;
    if (state.phase !== "play" || state.turn !== this.playerNum) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      const move = this.pickMove(this.lastState);
      /* Plus aucun coup jouable sur l'état connu : on ne devine pas, on
         redemande l'état autoritaire. */
      if (!move) { this.sync(); return; }
      this.send({ type: "move", sessionId: this.sessionId, move });
    }, 1500 + Math.random() * 2500);
  }

  /* Choix du coup sur l'état donné : capture le plus souvent possible (70 %),
     sinon un déplacement — sans quoi les parties s'éternisent en mouvements
     neutres au lieu de montrer de vraies prises. */
  pickMove(state) {
    if (!state || state.over || state.phase !== "play" || state.turn !== this.playerNum) return null;
    /* `chain.visited` est un Set côté moteur, un tableau après passage par le
       JSON : on le reconstruit, sinon les prises en chaîne sont illisibles. */
    const chain = state.chain
      ? { pos: state.chain.pos, visited: new Set(state.chain.visited), lastDir: state.chain.lastDir }
      : null;
    const moves = legalMoves(state.grid, state.turn, chain);
    if (!moves.length) return null;
    const caps = moves.filter((mv) => mv.cap.length);
    const pool = caps.length && Math.random() < 0.7 ? caps : moves;
    const pick = pool[Math.floor(Math.random() * pool.length)];
    return { from: pick.from, to: pick.to, dir: pick.dir, kind: pick.kind, cap: pick.cap };
  }

  /* Redemande l'état autoritaire : le serveur répond par `game_state`, la partie
     repart même après un coup refusé. */
  sync() {
    if (!this.sessionId) return;
    this.syncs++;
    this.send({ type: "sync_game", sessionId: this.sessionId });
  }

  /* Résilie une partie fantôme : le serveur termine la session proprement au
     lieu de la laisser figée dans le fil « En direct » (une partie sans joueur
     ne bouge plus jamais). */
  abandon(sessionId) {
    if (this.abandonnees.has(sessionId)) return;
    this.abandonnees.add(sessionId);
    log(this.pseudo + " ✕ partie fantôme résiliée (" + sessionId + ")");
    this.send({ type: "resign", sessionId });
  }

  /* Chien de garde : une partie dont on n'entend plus parler (coup refusé,
     diffusion manquée, réseau) resterait figée dans le fil « En direct ». Après
     trois relances muettes, la session n'existe plus : on repart en file. */
  watch() {
    setInterval(() => {
      if (this.fini || !this.sessionId || !this.lastStateAt) return;
      if (Date.now() - this.lastStateAt < 25000) return;
      if (this.syncs >= 3) {
        log(this.pseudo + " ↻ session " + this.sessionId + " muette — abandon et nouvelle file");
        this.sessionId = null; this.playerNum = null; this.lastState = null;
        this.lastStateAt = 0; this.syncs = 0;
        this.queue();
        return;
      }
      log(this.pseudo + " ↻ resynchronisation (aucun état depuis 25 s)");
      this.sync();
      this.lastStateAt = Date.now();
    }, 5000);
  }

  /* Arrêt propre : on résilie la partie en cours AVANT de fermer la connexion.
     Une simple fermeture laisse la session vivante pendant le délai de grâce de
     20 s et un redémarrage immédiat la transformerait en partie fantôme. */
  stop() {
    this.fini = true;
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    if (this.sessionId) this.send({ type: "resign", sessionId: this.sessionId });
  }
}

async function main() {
  log("D-aôna — parties en direct de démonstration (" + MATCHES + " partie(s) en parallèle)");
  const joueurs = POOL.slice(0, MATCHES * 2);
  const bots = [];
  for (const p of joueurs) {
    const token = await login(p);
    const b = new Bot(p, token);
    b.open();
    b.watch();
    bots.push(b);
    /* Une pause entre deux connexions : la limite anti-force brute compte les
       tentatives par réseau, inutile de la frôler pour six comptes. */
    await sleep(900);
  }
  /* Battement de cœur : détecte une connexion morte et garde le canal ouvert. */
  setInterval(() => bots.forEach((b) => b.send({ type: "ping" })), 25000);
  /* Nettoyage facultatif : un `sync_game` sans identifiant fait renvoyer par le
     serveur la première partie vivante du compte — souvent un reste d'essai
     précédent — et le bot la résilie aussitôt. Quelques tours suffisent. */
  if (CLEAN) {
    log("Nettoyage : résiliation des parties laissées vivantes par un essai précédent…");
    for (let tour = 0; tour < 4; tour++) {
      bots.forEach((b) => { if (!b.sessionId) b.send({ type: "sync_game" }); });
      await sleep(700);
    }
  }
  await sleep(800);
  bots.forEach((b) => b.queue());
  log("Appariement en cours… le fil « En direct » de l'écran Match va se remplir.");
  log("Ctrl+C pour arrêter.");
  const stop = () => {
    log("Arrêt demandé : résiliation des parties en cours, puis fermeture.");
    bots.forEach((b) => b.stop());
    /* On laisse le temps aux `resign` de partir avant de quitter : sinon la
       partie reste vivante 20 s et devient fantôme si on relance aussitôt. */
    setTimeout(() => {
      bots.forEach((b) => { try { b.ws.close(); } catch (e) {} });
      process.exit(0);
    }, 600);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

main().catch((e) => {
  console.error("ÉCHEC : " + (e && e.message ? e.message : e));
  process.exit(1);
});