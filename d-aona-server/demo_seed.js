/* =========================================================
   D-aôna — DONNÉES DE DÉMONSTRATION (jeu d'essai pour l'interface)
   ---------------------------------------------------------
   Remplit un environnement de test avec des données RÉELLES (mêmes tables,
   mêmes modules que le serveur) pour que chaque écran ait quelque chose à
   montrer — sans jamais inventer de données côté client.

   Ce que le script pose :
     • 8 joueurs de démonstration (pseudo `Demo…`), mots de passe réels
       (Argon2id via auth.js), Elo / victoires / soldes / provinces variés ;
     • le compte RÉEL visé devient ami avec 5 d'entre eux, reçoit 2 demandes
       d'ami et en a envoyé 1 (les trois états de l'écran) ;
     • 2 défis REÇUS en attente (jauge à 45 min) + 1 défi ENVOYÉ en attente
       (bouton « Annuler »), la mise étant réellement débitée chez l'expéditeur ;
     • relançable : un défi expiré n'est plus « en attente », donc un second
       passage le recrée avec une nouvelle échéance (identifiant aléatoire) ;
     • notifications lues et non lues (badge de la cloche) ;
     • historique de wallet cohérent, solde recalculé = somme des mouvements ;
     • conversations de chat avec 3 joueurs (Messagerie + contacts) ;
     • tournois : les 5 officiels (Tournament.seed) garnis d'inscrits, puis
       « Blitz Cup » (3/8) et un tournoi EN COURS au bracket à moitié joué.

   ⚠️ N'écrase jamais les données réelles : il AJOUTE, et ne retire que ce
   qu'il a lui-même posé (mode --clean). À lancer serveur ARRÊTÉ de
   préférence (deux écrivains sur SQLite), ou en lecture seule sinon.

   Usage :
     node demo_seed.js                  → annonce ce qui serait fait (écrit rien)
     node demo_seed.js --yes            → applique
     node demo_seed.js --clean --yes    → retire les données de démonstration
     node demo_seed.js --user <pseudo>  → choisit le compte « réel » visé
   ========================================================= */
"use strict";

const { db, User, Tournament, Wallet, Chat, Challenge, Friend, FriendRequest,
        Notification, TournamentMatch } = require("./db");
const Auth = require("./auth");

const APPLY = process.argv.includes("--yes");
const CLEAN = process.argv.includes("--clean");
const USER_PSEUDO = (() => {
  const i = process.argv.indexOf("--user");
  return i >= 0 ? process.argv[i + 1] : null;
})();

/* Mot de passe commun aux comptes de démonstration — public : ces comptes
   n'existent que sur un environnement de test. 12 caractères minimum, comme
   l'exige la politique de mot de passe du serveur (auth.js → PWD_RULES). */
const DEMO_PWD = "Demo!2026Zz9";
const DEMO_PREFIX = "Demo";
const TAG = "démo";

/* Durée de vie des défis posés. La carte de défi, sa jauge et le bouton
   « Annuler » n'existent à l'écran que si un défi est RÉELLEMENT en attente :
   le serveur les expire au bout de `expires_at` (server.js → balayeur), donc un
   jeu d'essai trop court se vide avant qu'on ait fini de parcourir les écrans.
   45 min laissent le temps de la démonstration ; relancer ce script les
   refraîchit, puisqu'un défi expiré n'est plus « pending ». */
const DEFI_RECU_MIN = 45;
const DEFI_ENVOYE_MIN = 15;

/* Les 8 joueurs : Elo, expérience et solde variés, sinon tous les classements,
   cartes de tournoi et soldes se ressemblent. */
const PLAYERS = [
  { pseudo: "DemoRado",  elo: 1842, wins: 41, losses: 18, balance: 120000, province: "Antananarivo" },
  { pseudo: "DemoNaivo", elo: 1715, wins: 33, losses: 20, balance:  74000, province: "Toamasina" },
  { pseudo: "DemoHery",  elo: 1650, wins: 28, losses: 19, balance:  52000, province: "Mahajanga" },
  { pseudo: "DemoTsiry", elo: 1520, wins: 22, losses: 21, balance:  31500, province: "Fianarantsoa" },
  { pseudo: "DemoLova",  elo: 1435, wins: 18, losses: 24, balance:  18000, province: "Antsiranana" },
  { pseudo: "DemoFara",  elo: 1298, wins: 14, losses: 25, balance:   9500, province: "Toliara" },
  { pseudo: "DemoMiora", elo: 1210, wins:  9, losses: 27, balance:   6400, province: "Antananarivo" },
  { pseudo: "DemoSolo",  elo: 1105, wins:  5, losses: 31, balance:   3800, province: "Toamasina" },
];

const say = (...a) => console.log(...a);
const head = (s) => say("\n== " + s);
let writes = 0;
/* En mode annonce (sans --yes), on n'écrit rien : `write` décrit et renvoie
   `false`, donc les appelants se contentent de lister. */
function write(label) {
  writes++;
  if (APPLY) return true;
  say("   (à écrire) " + label);
  return false;
}

/* ---------- Résolution du compte réel visé ---------- */
function targetUser() {
  if (USER_PSEUDO) {
    const u = User.getByPseudo(USER_PSEUDO);
    if (!u) throw new Error("pseudo introuvable : " + USER_PSEUDO);
    return u;
  }
  /* Par défaut : le premier compte non-démo (l'humain de cet environnement). */
  const row = db.prepare(
    "SELECT * FROM users WHERE pseudo NOT LIKE ? ORDER BY id ASC LIMIT 1"
  ).get(DEMO_PREFIX + "%");
  if (!row) throw new Error("aucun compte réel trouvé — précisez --user <pseudo>");
  return User.getById(row.id);
}

/* ---------- 1. Les huit joueurs de démonstration ---------- */
async function ensurePlayers() {
  const out = [];
  for (let i = 0; i < PLAYERS.length; i++) {
    const p = PLAYERS[i];
    let u = User.getByPseudo(p.pseudo);
    if (!u && write("créer le compte " + p.pseudo)) {
      /* Vrai chemin d'inscription : mot de passe haché (Argon2id), skins par
         défaut posés par auth.js — aucun INSERT « à la main » sur users. */
      const r = await Auth.register({ pseudo: p.pseudo, password: DEMO_PWD, province: p.province });
      if (!r.ok) throw new Error("inscription " + p.pseudo + " : " + r.error);
      u = User.getById(r.user.id);
    }
    /* En mode annonce, un identifiant fictif (négatif) permet de DÉCRIRE les
       étapes suivantes : sans lui, tout s'arrête au premier `if (!a.id)` et
       l'utilisateur ne voit pas ce qui serait posé. */
    out.push({ ...p, id: u ? u.id : (APPLY ? null : -(i + 1)) });
  }
  for (const p of out) {
    if (!p.id) continue;
    const cur = User.getById(p.id);
    if (!write("profil joué de " + p.pseudo)) continue;
    User.update(p.id, {
      elo: p.elo, wins: p.wins, losses: p.losses, province: p.province,
      kyc: 1, last_seen: new Date().toISOString(),
    });
    /* Le solde vient d'une transaction : jamais d'argent posé sans mouvement,
       sinon le wallet affiche un solde sans histoire. */
    const delta = p.balance - cur.balance;
    if (delta > 0) Wallet.addTransaction(p.id, "in", "Crédit " + TAG + " — solde de démonstration", delta, "ok");
    else if (delta < 0) Wallet.addTransaction(p.id, "out", "Ajustement " + TAG, -delta, "ok");
  }
  return out;
}

/* ---------- 2. Amis et demandes d'ami (les trois états de l'écran) ---------- */
function ensureLinks(me, players) {
  const [a, b, c, d, e, f, g, h] = players;
  if (!a.id) return;
  /* Les 5 premiers sont AMIS : ils alimentent les contacts, le fil « En
     direct » (portée contacts) et la liste d'amis. */
  for (const p of [a, b, c, d, e]) {
    if (!write("amitié " + me.pseudo + " ↔ " + p.pseudo)) continue;
    /* `Friend.add` pose UNE ligne (user_id → friend_id) : on pose les deux
       sens, comme le fait le serveur à l'acceptation d'une demande. */
    if (!Friend.areFriends(me.id, p.id)) Friend.add(me.id, p.id);
    if (!Friend.areFriends(p.id, me.id)) Friend.add(p.id, me.id);
  }
  /* 2 demandes REÇUES en attente (Accepter / Refuser) + 1 ENVOYÉE. */
  for (const p of [f, g]) {
    if (!write("demande d'ami reçue de " + p.pseudo)) continue;
    if (!Friend.areFriends(me.id, p.id) && !FriendRequest.pendingBetween(me.id, p.id)) FriendRequest.send(p.id, me.id);
  }
  if (!write("demande d'ami envoyée à " + h.pseudo)) return;
  if (!Friend.areFriends(me.id, h.id) && !FriendRequest.pendingBetween(me.id, h.id)) FriendRequest.send(me.id, h.id);
  /* Les joueurs de démonstration sont aussi amis ENTRE EUX : sans ce maillage,
     un compte `Demo…` ne verrait aucune partie dans le fil « En direct »
     (portée « contacts »), alors que ce sont eux qui jouent les parties. */
  for (let i = 0; i < 5; i++) {
    for (let k = i + 1; k < 5; k++) {
      const [x, y] = [players[i], players[k]];
      if (Friend.areFriends(x.id, y.id)) continue;
      if (!write("amitié " + x.pseudo + " ↔ " + y.pseudo)) continue;
      Friend.add(x.id, y.id);
      Friend.add(y.id, x.id);
    }
  }
}

/* ---------- 3. Défis : 2 reçus (jauge) + 1 envoyé (annulation) ---------- */
function ensureChallenges(me, players) {
  const [a, b, , , , , , h] = players;
  if (!a.id) return;
  const enAttente = (fromId, toId) => !!db.prepare(
    "SELECT 1 FROM challenges WHERE from_id = ? AND to_id = ? AND status = 'pending'"
  ).get(fromId, toId);
  /* Identifiant aléatoire, comme le fait le serveur : un identifiant figé
     entrerait en collision dès qu'un défi précédent a expiré (il n'est alors
     plus « en attente », donc recréé — avec le même id, l'insertion échouait). */
  const nouvelId = () => "DF-" + Math.random().toString(36).slice(2, 7).toUpperCase();

  /* Reçus : la carte de défi, sa jauge et les boutons Accepter / Refuser.
     La mise de l'envoyeur est débitée pour de vrai (règle du serveur). */
  for (const [p, wager, format] of [[a, 1000, "blitz"], [b, 2500, "rapide"]]) {
    if (enAttente(p.id, me.id)) continue;
    if (!write("défi reçu de " + p.pseudo + " (" + wager + " Ar, " + format + ")")) continue;
    Wallet.spend(p.id, wager, "Mise defi vs " + me.pseudo);
    db.prepare(
      `INSERT INTO challenges (id, from_id, to_id, wager, format, status, expires_at)
       VALUES (?,?,?,?,?,'pending', datetime('now', ?))`
    ).run(nouvelId(), p.id, me.id, wager, format, "+" + DEFI_RECU_MIN + " minutes");
  }
  /* Envoyé : le bouton « Annuler le défi » a un défi à annuler. */
  if (!enAttente(me.id, h.id) && write("défi envoyé à " + h.pseudo + " (500 Ar)")) {
    Wallet.spend(me.id, 500, "Mise defi vs " + h.pseudo);
    db.prepare(
      `INSERT INTO challenges (id, from_id, to_id, wager, format, status, expires_at)
       VALUES (?,?,?,?,?,'pending', datetime('now', ?))`
    ).run(nouvelId(), me.id, h.id, 500, "blitz", "+" + DEFI_ENVOYE_MIN + " minutes");
  }
}

/* ---------- 4. Notifications du compte réel (cloche + écran) ---------- */
function ensureNotifications(me, players) {
  const [a, b, c] = players;
  if (!a.id) return;
  /* Anti-doublon : une notification déjà posée se reconnaît à son texte. */
  const deja = (text) => !!db.prepare(
    "SELECT 1 FROM notifications WHERE user_id = ? AND payload_json LIKE ?"
  ).get(me.id, "%" + text.slice(0, 28) + "%");
  /* Mélange lu / non lu : le badge de la cloche ET « Tout marquer lu » ont de
     quoi travailler. */
  const items = [
    ["defi", `⚔️ ${a.pseudo} (${a.elo}) vous défie — mise 1 000 Ar.`, false],
    ["defi", `⚔️ ${b.pseudo} (${b.elo}) vous défie — mise 2 500 Ar.`, false],
    ["inscription", `✅ Inscription confirmée au tournoi « Blitz Cup — Analamanga » (${TAG}).`, false],
    ["tournoi_debut", `🏆 Le tournoi « Tournoi Hebdo Fanorona #24 » commence bientôt (${TAG}).`, false],
    ["victoire", `✅ Match remporté contre ${c.pseudo} (+18 Elo) (${TAG}).`, false],
    ["victoire", `🏆 Cashprice « Tournoi Hebdo Fanorona #23 » : 2ᵉ place, +12 500 Ar (${TAG}).`, true],
    ["forfait_adverse", `✅ Victoire par forfait — adversaire absent (${TAG}).`, true],
  ];
  for (const [type, text, lu] of items) {
    if (deja(text)) continue;
    if (!write("notification " + type + " (" + (lu ? "lue" : "non lue") + ")")) continue;
    const id = Notification.create(me.id, type, {
      text, demo: true,
      tournamentId: /tournoi|Blitz Cup/i.test(text) ? 2 : null,
    });
    if (lu) Notification.markRead(id, me.id);
  }
}

/* ---------- 5. Wallet : historique + solde de test ---------- */
function ensureWallet(me) {
  const hist = db.prepare("SELECT 1 FROM transactions WHERE user_id = ? AND ref_id LIKE 'demo-hist%'").get(me.id);
  if (!hist && write("historique de wallet (dépôt, bonus, mise, cashprice, skin, retrait)")) {
    /* Mouvements DÉJÀ passés : insérés sans repasser par Wallet (qui, lui,
       modifierait le solde). Le solde est recalculé juste après pour rester
       égal à la somme des mouvements — un historique ne doit pas mentir sur
       le solde qu'il produit. */
    const rows = [
      ["in",  "Dépôt MVola", 50000, "demo-hist-1", "-6 days"],
      ["in",  "Bonus de bienvenue", 5000, "demo-hist-2", "-6 days"],
      ["out", "Mise défi vs DemoRado", 1000, "demo-hist-3", "-5 days"],
      ["out", "Achat skin — Pions dorés", 3000, "demo-hist-4", "-4 days"],
      ["in",  "Cashprice Tournoi Hebdo #23 (2ᵉ)", 12500, "demo-hist-5", "-3 days"],
      ["out", "Retrait MVola", 20000, "demo-hist-6", "-2 days"],
    ];
    for (const [dir, label, amount, ref, offset] of rows) {
      db.prepare(
        `INSERT INTO transactions (user_id, dir, label, amount, status, ref_id, created_at)
         VALUES (?,?,?,?,'ok',?, datetime('now', ?))`
      ).run(me.id, dir, label, amount, ref, offset);
    }
    const sum = db.prepare(
      "SELECT COALESCE(SUM(CASE WHEN dir = 'in' THEN amount ELSE -amount END), 0) AS s FROM transactions WHERE user_id = ?"
    ).get(me.id).s;
    /* Bonus verrouillé = le bonus de bienvenue : le « disponible »
       (solde − bonus) reste positif et crédible sur l'écran Wallet. */
    db.prepare("UPDATE users SET balance = ?, bonus_lock = ? WHERE id = ?").run(Math.max(sum, 0), 5000, me.id);
  }
  /* De quoi tester défis et tournois sans se ruiner (plancher de test). */
  const CIBLE = 150000;
  const cur = User.getById(me.id);
  if (cur.balance < CIBLE) {
    const delta = CIBLE - cur.balance;
    if (write("crédit de test de " + delta + " Ar (plancher " + CIBLE + " Ar)")) {
      Wallet.addTransaction(me.id, "in", "Crédit " + TAG + " — environnement de test", delta, "ok");
    }
  }
}

/* ---------- 6. Chat : conversations réelles (Messagerie + contacts) ---------- */
function ensureChat(me, players) {
  const [a, b, c] = players;
  if (!a.id) return;
  const fils = [
    { other: a, msgs: [
      [a.id, "Salut ! Tu joues le blitz de 20 h ?"],
      [me.id, "Oui, je m'inscris — 1 000 Ar la mise ?"],
      [a.id, "C'est ça. Je t'envoie un défi, accepte-le 😉"],
    ] },
    { other: b, msgs: [
      [b.id, "Bien joué hier, tu m'as mis 3-0 😅"],
      [me.id, "Merci ! On remet ça quand tu veux."],
      [b.id, "Ce soir. Je viens de te défier."],
    ] },
    { other: c, msgs: [
      [me.id, "Tu as vu le nouveau tournoi ?"],
      [c.id, "Oui, inscriptions ouvertes. J'y suis déjà."],
    ] },
  ];
  for (const fil of fils) {
    let n = 0;
    for (const [fromId, text] of fil.msgs) {
      /* Le destinataire est l'autre interlocuteur DU FIL : `fromId` vaut soit
         moi, soit lui — jamais un voisin de tableau. */
      const toId = fromId === me.id ? fil.other.id : me.id;
      n++;
      const deja = db.prepare(
        "SELECT 1 FROM chat_messages WHERE from_user_id = ? AND to_user_id = ? AND text = ?"
      ).get(fromId, toId, text);
      if (deja) continue;
      if (!write("message « " + text.slice(0, 34) + "… »")) continue;
      /* Horodatage croissant : l'horloge du fil reste crédible. */
      db.prepare(
        `INSERT INTO chat_messages (from_user_id, to_user_id, text, created_at)
         VALUES (?,?,?, datetime('now', ?))`
      ).run(fromId, toId, text, "-" + (48 - n * 5) + " minutes");
    }
  }
}

/* ---------- 7. Tournois : inscriptions garnies + un tournoi en cours ---------- */
function ensureTournaments(players) {
  const [a, b, c, d, e, f] = players;
  if (!a.id) return;
  /* Les 5 tournois officiels (Tournament.seed) : 4 inscriptions + 1 terminé,
     ce qui peuple les trois filtres (Ouvert / En cours / Terminé). */
  if (write("les tournois officiels (Tournament.seed)")) Tournament.seed();
  const list = Tournament.list();
  const idDe = (re) => (list.find((t) => re.test(t.name)) || {}).id;

  /* Inscrits : les cartes affichent « 3 / 8 » au lieu de « 0 / 8 », et la
     barre de progression a une vraie valeur. */
  const garnir = [
    [idDe(/Blitz Cup/i), [a, b, c]],
    [idDe(/#24/), [b, d, e, f]],
  ];
  for (const [tid, joueurs] of garnir) {
    if (!tid) continue;
    for (const p of joueurs) {
      if (Tournament.isRegistered(p.id, tid)) continue;
      if (write("inscription de " + p.pseudo + " au tournoi #" + tid)) Tournament.register(p.id, tid);
    }
  }

  /* Tournoi EN COURS : 4 joueurs et un bracket dont un match est déjà joué —
     « Détail & bracket » et le filtre « En cours » ont un vrai contenu.
     Statut `en_cours` : c'est celui que le serveur pose lui-même quand
     l'heure de départ est atteinte (voir processTournamentMatches). */
  const NOM = "Coupe D-aôna — Démo (en cours)";
  if (list.some((t) => t.name === NOM)) return;
  if (!write("tournoi en cours + bracket à 4 joueurs")) return;
  const info = db.prepare(
    `INSERT INTO tournaments (name, game, format, entry, max_players, status, min_rank, sponsor, starts_at, match_duration_min, interval_min)
     VALUES (?, 'Fanorona', 'rapide', 2000, 4, 'en_cours', 'Bronze', NULL, ?, 5, 0)`
  ).run(NOM, new Date(Date.now() - 20 * 60000).toISOString());
  const tid = Number(info.lastInsertRowid);
  const quatre = [a, b, c, d];
  for (const p of quatre) Tournament.register(p.id, tid);
  const ilYA = (min) => new Date(Date.now() - min * 60000).toISOString();
  const dans = (min) => new Date(Date.now() + min * 60000).toISOString();
  const demi1 = TournamentMatch.create(tid, 1, 0, {
    p1_id: quatre[0].id, p2_id: quatre[3].id, status: "termine",
    score1: 3, score2: 1, winner_id: quatre[0].id, starts_at: ilYA(18), confirm_deadline: ilYA(25),
  });
  const demi2 = TournamentMatch.create(tid, 1, 1, {
    p1_id: quatre[1].id, p2_id: quatre[2].id, status: "en_cours", starts_at: ilYA(5), confirm_deadline: dans(5),
  });
  const finale = TournamentMatch.create(tid, 2, 0, { status: "a_venir", starts_at: dans(25) });
  /* Le vainqueur de la 1re demi est déjà placé en finale : le bracket se lit
     d'un coup d'œil, sans avoir à jouer. */
  db.prepare("UPDATE tournament_matches SET next_match_id = ? WHERE id IN (?, ?)").run(finale, demi1, demi2);
  db.prepare("UPDATE tournament_matches SET p1_id = ? WHERE id = ?").run(quatre[0].id, finale);
}

/* ---------- 8. Retrait : on ne supprime QUE ce que la démo a posé ---------- */
function cleanDemo(me) {
  const ids = db.prepare("SELECT id, pseudo FROM users WHERE pseudo LIKE ?").all(DEMO_PREFIX + "%").map((r) => r.id);
  if (!ids.length) { say("Aucun compte de démonstration à retirer."); return; }
  head("Retrait des données de démonstration (" + ids.length + " compte(s) " + DEMO_PREFIX + "…)");
  if (!write("supprimer les comptes de démonstration et tout ce qui les référence")) return;
  const ph = ids.map(() => "?").join(",");
  db.exec("BEGIN");
  try {
    /* Tables SANS clé étrangère : il faut les vider explicitement, sinon des
       lignes orphelines survivent à la suppression des comptes. */
    db.prepare(`DELETE FROM tournament_registrations WHERE user_id IN (${ph})`).run(...ids);
    db.prepare(`DELETE FROM tournament_matches WHERE p1_id IN (${ph}) OR p2_id IN (${ph}) OR winner_id IN (${ph})`).run(...ids, ...ids, ...ids);
    db.prepare(`DELETE FROM challenges WHERE from_id IN (${ph}) OR to_id IN (${ph})`).run(...ids, ...ids);
    db.prepare(`DELETE FROM chat_messages WHERE from_user_id IN (${ph}) OR to_user_id IN (${ph})`).run(...ids, ...ids);
    db.prepare(`DELETE FROM friends WHERE user_id IN (${ph}) OR friend_id IN (${ph})`).run(...ids, ...ids);
    db.prepare(`DELETE FROM friend_requests WHERE from_id IN (${ph}) OR to_id IN (${ph})`).run(...ids, ...ids);
    db.prepare(`DELETE FROM notifications WHERE user_id IN (${ph})`).run(...ids);
    db.prepare(`DELETE FROM transactions WHERE user_id IN (${ph})`).run(...ids);
    db.prepare(`DELETE FROM games WHERE player1_id IN (${ph}) OR player2_id IN (${ph})`).run(...ids, ...ids);
    db.prepare(`DELETE FROM game_sessions WHERE player1_id IN (${ph}) OR player2_id IN (${ph})`).run(...ids, ...ids);
    db.prepare(`DELETE FROM user_skins WHERE user_id IN (${ph})`).run(...ids);
    db.prepare(`DELETE FROM equipped_skins WHERE user_id IN (${ph})`).run(...ids);
    /* Le tournoi de démonstration et son bracket (il n'appartient à personne,
       donc retirer les comptes ne suffit pas). */
    const t = db.prepare("SELECT id FROM tournaments WHERE name = ?").get("Coupe D-aôna — Démo (en cours)");
    if (t) {
      db.prepare("DELETE FROM tournament_matches WHERE tournament_id = ?").run(t.id);
      db.prepare("DELETE FROM tournament_registrations WHERE tournament_id = ?").run(t.id);
      db.prepare("DELETE FROM tournaments WHERE id = ?").run(t.id);
    }
    /* Ce que la démo a posé sur le compte RÉEL : historique et notifications
       balisés `démo` uniquement — le reste de son activité est intact. */
    db.prepare("DELETE FROM notifications WHERE user_id = ? AND payload_json LIKE ?").run(me.id, "%" + TAG + "%");
    db.prepare("DELETE FROM transactions WHERE user_id = ? AND (ref_id LIKE 'demo-hist%' OR label LIKE ?)").run(me.id, "%" + TAG + "%");
    /* Le solde redevient la somme de ce qui reste : historique et solde ne se
       contredisent jamais, même après un retrait. */
    const sum = db.prepare(
      "SELECT COALESCE(SUM(CASE WHEN dir = 'in' THEN amount ELSE -amount END), 0) AS s FROM transactions WHERE user_id = ?"
    ).get(me.id).s;
    db.prepare("UPDATE users SET balance = ?, bonus_lock = 0 WHERE id = ?").run(Math.max(sum, 0), me.id);
    db.prepare(`DELETE FROM users WHERE id IN (${ph})`).run(...ids);
    db.exec("COMMIT");
    say("   " + ids.length + " compte(s) retiré(s) ; compte réel laissé en place (solde recalculé).");
  } catch (e) {
    try { db.exec("ROLLBACK"); } catch (_) {}
    throw e;
  }
}

/* ---------- Programme principal ---------- */
async function main() {
  const me = targetUser();
  say("D-aôna — données de démonstration");
  say("  compte réel visé : " + me.pseudo + " (#" + me.id + ", " + me.balance + " Ar)");
  say("  mode             : " + (APPLY ? "ÉCRITURE" : "annonce (ne touche à rien)") + (CLEAN ? " + retrait" : ""));

  if (CLEAN) {
    cleanDemo(me);
    if (APPLY) db.exec("VACUUM");
    return;
  }

  head("1. Joueurs de démonstration");
  const players = await ensurePlayers();
  say("   " + players.filter((p) => p.id).length + " compte(s) prêt(s) — mot de passe : " + DEMO_PWD);

  head("2. Amis et demandes d'ami");
  ensureLinks(me, players);

  head("3. Défis (2 reçus, 1 envoyé)");
  ensureChallenges(me, players);

  head("4. Notifications");
  ensureNotifications(me, players);

  head("5. Wallet");
  ensureWallet(me);

  head("6. Messagerie");
  ensureChat(me, players);

  head("7. Tournois");
  ensureTournaments(players);

  if (!APPLY) {
    say("\n" + writes + " opération(s) décrite(s) — RIEN n'a été écrit.");
    say("Relancez avec --yes pour appliquer : node demo_seed.js --yes");
    return;
  }

  head("Résultat en base");
  const n = (sql, ...a) => db.prepare(sql).get(...a).c;
  say("  comptes                : " + n("SELECT COUNT(*) c FROM users") +
      " (dont " + n("SELECT COUNT(*) c FROM users WHERE pseudo LIKE 'Demo%'") + " de démo)");
  say("  amis du compte réel    : " + n("SELECT COUNT(*) c FROM friends WHERE user_id = ?", me.id));
  say("  demandes reçues        : " + n("SELECT COUNT(*) c FROM friend_requests WHERE to_id = ? AND status='pending'", me.id));
  say("  défis en attente       : " + n("SELECT COUNT(*) c FROM challenges WHERE status='pending'"));
  say("  notifications non lues : " + n("SELECT COUNT(*) c FROM notifications WHERE read=0"));
  say("  mouvements de wallet   : " + n("SELECT COUNT(*) c FROM transactions WHERE user_id = ?", me.id));
  say("  messages de chat       : " + n("SELECT COUNT(*) c FROM chat_messages"));
  say("  tournois               : " + n("SELECT COUNT(*) c FROM tournaments") +
      " (dont " + n("SELECT COUNT(*) c FROM tournaments WHERE status='en_cours'") + " en cours)");
  say("  matchs de bracket      : " + n("SELECT COUNT(*) c FROM tournament_matches"));
  const fin = User.getById(me.id);
  say("\nSolde du compte réel : " + fin.balance + " Ar (disponible " + (fin.balance - fin.bonus_lock) + " Ar).");
  say("Comptes de test : DemoRado … DemoSolo — mot de passe " + DEMO_PWD);
  say("Parties EN DIRECT : node demo_live.js (les parties vivent en mémoire, pas en base).");
  say("\nTerminé. Rechargez l'application (Ctrl+F5).");
}

main().catch((e) => {
  console.error("\nÉCHEC : " + (e && e.message ? e.message : e));
  process.exit(1);
});