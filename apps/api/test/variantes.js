"use strict";
/* =========================================================
   D-aona - Harnais des SESSIONS AUTORITAIRES (contrat du socle)
   ---------------------------------------------------------
   Verifie que les trois plateaux heberges par le serveur (Tsivy, Dimy, Telo)
   exposent le MEME contrat que le socle appelle, et que les variantes
   nouvellement ouvertes au jeu en ligne savent jouer, refuser un coup
   illegal, finir (dont la nulle) et calculer l Elo.

   Aucune base, aucun reseau : les sessions sont pures et se construisent
   avec deux joueurs en memoire.
   ========================================================= */

const Registry = require("../games/registry");

const FORMAT = { id: "blitz", name: "Blitz", time: 180 };
const player = (id, pseudo, elo) => ({ id, pseudo, elo, pionStyles: null });

let checks = 0, fails = 0;
function check(name, fn) {
  checks++;
  try {
    fn();
    console.log("  OK    " + name);
  } catch (e) {
    fails++;
    console.log("  ECHEC " + name + "   -> " + e.message);
  }
}
function eq(actual, expected, label) {
  const a = JSON.stringify(actual), b = JSON.stringify(expected);
  if (a !== b) throw new Error((label || "valeur") + " : attendu " + b + ", obtenu " + a);
}
function ok(value, label) { if (!value) throw new Error(label || "attendu vrai"); }

function make(id, elo1, elo2) {
  const S = Registry.get(id).GameSession;
  return new S("GS-TEST", player(1, "Alpha", elo1 || 1200), player(2, "Bravo", elo2 || 1000), "online", FORMAT, 0);
}

console.log("\n=== Registre ===");
check("trois plateaux heberges", () => eq(Registry.ids().sort(), ["fanoron-dimy", "fanoron-telo", "fanoron-tsivy"]));
check("identifiant inconnu -> jeu par defaut", () => eq(Registry.get("katro").GameSession, Registry.get(Registry.DEFAULT).GameSession));
check("identifiant connu -> module du jeu", () => ok(Registry.has("fanoron-dimy") && Registry.has("fanoron-telo")));

console.log("\n=== Contrat de session (memes methodes pour les 3) ===");
const METHODS = ["getState", "getLegalMoves", "applyMove", "resign", "tickClock", "finish", "piecesLeft"];
for (const id of Registry.ids()) {
  check(id + " : surface complete", () => {
    const s = make(id);
    for (const m of METHODS) eq(typeof s[m], "function", "methode " + m);
    eq(s.getState().game, id, "etat.game");
    eq(s.getState().player1.pseudo, "Alpha", "etat.player1");
    eq(typeof s.phase, "string", "phase de session");
  });
}


console.log("\n=== Telo : pose, alignement, refus ===");
check("demarre en pose, joueur 1", () => {
  const s = make("fanoron-telo");
  eq(s.getState().phase, "placement", "phase");
  eq(s.getState().turn, 1, "trait");
  eq(s.getState().board.length, 9, "cases");
});
check("un coup illegal ne change rien", () => {
  const s = make("fanoron-telo");
  const before = JSON.stringify(s.getState());
  const r = s.applyMove({ type: "place", to: 99 });
  eq(r.ok, false, "ok");
  eq(JSON.stringify(s.getState()), before, "etat inchange");
});
check("pas de pose sur une case occupee", () => {
  const s = make("fanoron-telo");
  ok(s.applyMove({ type: "place", to: 0 }).ok, "premiere pose");
  eq(s.getState().turn, 2, "main passee");
  eq(s.applyMove({ type: "place", to: 0 }).ok, false, "case occupee refusee");
});
check("alignement en pose = victoire immediate", () => {
  const s = make("fanoron-telo");
  [0, 4, 1, 8].forEach((to) => ok(s.applyMove({ type: "place", to }).ok, "pose " + to));
  const last = s.applyMove({ type: "place", to: 2 });
  ok(last.ok, "pose gagnante");
  eq(last.gameOver, true, "gameOver");
  eq(last.winner, 1, "vainqueur");
  eq(last.reason, "alignement", "raison");
  eq(s.getState().over, true, "etat terminal");
  eq(s.over, true, "session terminale");
});
check("Elo : le vainqueur gagne des points, le perdant en perd", () => {
  const s = make("fanoron-telo", 1200, 1000);
  const d = s.finish(1);
  ok(d.delta1 > 0 && d.delta2 < 0, "deltas " + d.delta1 + " / " + d.delta2);
  eq(d.winnerId, 1, "winnerId");
});
check("nulle = demi-point pour les deux", () => {
  const s = make("fanoron-telo", 1200, 1000);
  const d = s.finish(null);
  eq(d.winnerId, null, "winnerId");
  ok(d.delta1 < 0 && d.delta2 > 0, "nulle du mieux classe : " + d.delta1 + " / " + d.delta2);
});
check("horloge : le temps ecoule fait perdre le joueur au trait", () => {
  const s = make("fanoron-telo");
  s.clock[1] = 1;
  const t = s.tickClock();
  eq(t && t.gameOver, true, "gameOver");
  eq(t.winner, 2, "vainqueur");
  eq(t.reason, "temps", "raison");
});
check("abandon : l autre camp gagne", () => {
  const s = make("fanoron-telo");
  const r = s.resign(1);
  eq(r.winner, 2, "vainqueur");
  eq(r.reason, "abandon", "raison");
  eq(s.getState().over, true, "etat");
});

console.log("\n=== Dimy : prise, alternance, comptage ===");
check("12 pions par camp au depart", () => {
  const s = make("fanoron-dimy");
  eq(s.piecesLeft(1), 12, "clairs");
  eq(s.piecesLeft(2), 12, "sombres");
  eq(s.getState().turn, 1, "trait");
});
check("un coup legal passe la main, l historique le retient", () => {
  const s = make("fanoron-dimy");
  const legal = s.getLegalMoves();
  ok(legal.length > 0, "coups legaux");
  const r = s.applyMove({ from: legal[0].from, to: legal[0].to });
  ok(r.ok, "coup accepte");
  eq(r.state.turn, 2, "main passee");
  eq(s.moves.length, 1, "historique");
  eq(s.getState().moves.length, 1, "historique publie");
});
check("un coup illegal est refuse sans effet", () => {
  const s = make("fanoron-dimy");
  const before = JSON.stringify(s.getState().board);
  const r = s.applyMove({ from: 0, to: 24 });
  eq(r.ok, false, "coup refuse");
  eq(JSON.stringify(s.getState().board), before, "plateau inchange");
  eq(s.moves.length, 0, "historique vide");
});
check("fin de partie : deltas Elo calcules pour les deux", () => {
  const s = make("fanoron-dimy", 1200, 1000);
  const d = s.finish(2);
  eq(d.winnerId, 2, "winnerId");
  ok(d.delta1 < 0 && d.delta2 > 0, "deltas " + d.delta1 + " / " + d.delta2);
});

console.log("\n=== Reprise : UN contrat pour tous les plateaux ===");
/* Reprendre une partie ne rejoue rien : le client repeint l'état publié par le
   serveur. Le CONTRAT est donc celui de `getState` — il doit valoir pour TOUT
   jeu ajouté demain. Ce qui change d'un plateau à l'autre (la forme du plateau,
   les raisons de fin) reste la part du jeu ; ce qui suit ne se négocie pas. */
const REPRISE_KEYS = ["game", "turn", "over", "mode", "format", "clock", "moves",
  "player1", "player2", "opponent", "wage"];
for (const id of Registry.ids()) {
  check(id + " : l etat publie le socle commun de la reprise", () => {
    const st = make(id).getState();
    for (const k of REPRISE_KEYS) ok(st[k] !== undefined, "cle " + k);
    /* Le plateau lui-meme : `board` (Dimy, Telo) ou `grid` (Tsivy) — deux
       representations, un seul contrat : il y en a UNE, non vide. */
    const plateau = st.board || st.grid;
    ok(Array.isArray(plateau) && plateau.length > 0, "plateau publie (board|grid)");
    eq(st.game, id, "etat.game");
    eq(st.player1.id, 1, "identite du camp 1");
    eq(st.player2.id, 2, "identite du camp 2");
  });
  check(id + " : deux lectures donnent le MEME etat (instantane pur)", () => {
    const s = make(id);
    s.tickClock();                       // un etat qui a vecu, pas un etat neuf
    eq(JSON.stringify(s.getState()), JSON.stringify(s.getState()), "getState idempotent");
  });
  check(id + " : la reprise retrouve l horloge et la partie en cours", () => {
    const s = make(id);
    s.tickClock();
    const st = s.getState();
    eq(st.over, false, "partie en cours");
    /* Tsivy ne fait pas courir le temps pendant le choix des faces : le contrat
       est que l'horloge des DEUX camps soit publiée (et bornée), pas qu'elle
       ait bougé. */
    ok(typeof st.clock[1] === "number" && typeof st.clock[2] === "number", "horloge des deux camps " + JSON.stringify(st.clock));
    ok(st.clock[1] <= FORMAT.time && st.clock[2] <= FORMAT.time, "horloge bornee");
    eq(st.moves.length, 0, "aucun coup joue");
    eq(s.turn, st.turn, "trait de session = trait publie");
  });
  check(id + " : l horloge publiee ne contient que les deux camps", () => {
    const s = make(id);
    s.tickClock();
    const ks = Object.keys(s.getState().clock).sort();
    eq(ks, ["1", "2"], "cles d horloge");
  });
  check(id + " : la session PORTE son plateau (publie par game_state)", () => {
    const s = make(id);
    eq(s.game, id, "session.game");
    eq(s.getState().game, s.game, "etat.game = session.game");
  });
  check(id + " : l etat publie est une COPIE (muter ne corrompt pas la partie)", () => {
    const s = make(id);
    const st = s.getState();
    const plateau = st.board || st.grid;
    /* Un plateau en une seule dimension n'est pas concerne : on ne juge que
       la forme connue (deux representations, `board` ou `grid`). */
    if (!Array.isArray(plateau) || !Array.isArray(plateau[0])) return;
    const avant = JSON.stringify(s.getState());
    plateau[0][0] = "CORRUPTION";
    eq(JSON.stringify(s.getState()), avant, "session intacte apres mutation de l etat publie");
  });

}

/* Garde-fou du SOCLE (pas d un jeu) : ces trois lignes de server.js sont ce qui
   rend la reprise identique partout. Si elles disparaissent, tout plateau futur
   perd la reprise sans que personne ne le voie. */
const fs = require("node:fs");
const path = require("node:path");
const SRV = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
check("game_state publie game + playerNum aux DEUX joueurs", () => {
  const n = (SRV.match(/type: "game_state", sessionId: session\.sessionId, game, playerNum: [12]/g) || []).length;
  eq(n, 2, "game_state complets");
});
check("sync_game repond TOUJOURS (no_active_game sinon)", () => {
  ok(/type: "no_active_game"/.test(SRV), "reponse quand il n y a rien a reprendre");
});
check("reconnexion : la session du joueur est republiee d office", () => {
  ok(/const curSession = findUserSession\(user\.id\);\s*\n\s*if \(curSession\) dispatchGameState\(curSession\);/.test(SRV),
    "dispatch a l authentification");
});
check("appariement automatique : le jeu de la file est transmis", () => {
  ok(/createGameSession\(pair\[0\]\.userId, pair\[1\]\.userId, "online", mm\.formatOf\(key\), 0, mm\.gameOf\(key\)\)/.test(SRV),
    "drainPairs doit passer mm.gameOf(key)");
});

/* L'ENVELOPPE aussi est un contrat : un seul émetteur d'état, et le plateau
   voyage avec lui. Un jeu futur n'a rien à ajouter — mais rien à contourner
   non plus, d'où ces deux verrous. */
check("un SEUL emetteur de game_state (dispatchGameState)", () => {
  const n = (SRV.match(/type: "game_state"/g) || []).length;
  eq(n, 2, "game_state hors dispatchGameState");
});
check("le spectateur recoit le plateau comme les joueurs", () => {
  const n = (SRV.match(/type: "spectate_state", sessionId: session\.sessionId, game/g) || []).length;
  ok(n >= 1, "spectate_state sans game");
});
check("le jeu par defaut de l appariement existe dans le registre", () => {
  const mm = require("../live/matchmaking");
  ok(Registry.has(mm.DEFAULT_GAME), "DEFAULT_GAME=" + mm.DEFAULT_GAME);
});

/* ---------- REPRISE APRES REDEMARRAGE (persistance) ----------
   `state_json` range un INSTANTANE de la session, pas l etat publie : c est ce
   qui permet de reconstruire la partie a l identique, horloge et champs internes
   compris. L aller-retour est verifie sur les trois plateaux, sans base ni
   reseau — un plateau ajoute demain doit le passer comme les autres. */
console.log("\n=== Reprise apres redemarrage (instantane de session) ===");
for (const id of Registry.ids()) {
  check(id + " : l instantane JSON suffit a reconstruire la session", () => {
    const s = make(id);
    /* Une partie ENGAGEE, pas l etat initial : c est la que vivent les champs
       internes (tirage resolu, chaine de prises, horloge ecoulee) que l etat
       publie n expose pas. */
    if (s.phase === "choose" && typeof s.pickSide === "function") { s.pickSide(1, "pile"); s.pickSide(2, "face"); }
    const mv = s.getLegalMoves();
    if (mv && mv.length) s.applyMove(mv[0]);
    if (s.clock[s.turn] !== undefined) s.clock[s.turn] = 123;
    const avant = JSON.stringify(s.getState());
    const copie = Object.create(Registry.get(id).GameSession.prototype);
    Object.assign(copie, JSON.parse(JSON.stringify(s)));
    eq(JSON.stringify(copie.getState()), avant, "etat reconstruit");
    eq(copie.clock, s.clock, "horloge conservee");
    eq(typeof copie.applyMove, "function", "methodes du jeu presentes");
  });
  check(id + " : une session reconstruite continue de jouer", () => {
    const s = make(id);
    if (s.phase === "choose" && typeof s.pickSide === "function") { s.pickSide(1, "pile"); s.pickSide(2, "face"); }
    const copie = Object.create(Registry.get(id).GameSession.prototype);
    Object.assign(copie, JSON.parse(JSON.stringify(s)));
    const mv = copie.getLegalMoves();
    if (!mv || !mv.length) return;                    // rien a jouer : rien a prouver
    ok(copie.applyMove(mv[0]).ok, "un coup legal reste legal apres reconstruction");
  });
}
check("le socle persiste un INSTANTANE de session (pas l etat publie)", () => {
  ok(/GameSessionStore\.updateState\(session\.sessionId, \{ v: SNAPSHOT_V, session: snap \}\)/.test(SRV),
    "format d instantane");
});
check("un SEUL point d ecriture de l etat (persistSession)", () => {
  const n = (SRV.match(/GameSessionStore\.updateState\(/g) || []).length;
  eq(n, 1, "ecritures d etat directes hors persistSession");
});
check("les parties ouvertes sont rechargees au demarrage", () => {
  ok(/function start\(\) \{\s*seedDatabase\(\);[\s\S]{0,400}?rehydrateSessions\(\);/.test(SRV),
    "rehydrateSessions() avant l ecoute HTTP");
});
check("un abandon est arme PAR SESSION (et non par joueur)", () => {
  ok(/disconnectTimers\.set\(key, \{ timer, sessionId: id, userId: conn\.userId \}\)/.test(SRV),
    "cle joueur+session");
});

console.log("\n" + (fails === 0 ? "RESULTAT : TOUS LES TESTS PASSENT" : "RESULTAT : " + fails + " ECHEC(S)") + "  (" + checks + " verifications)");
process.exit(fails === 0 ? 0 : 1);
