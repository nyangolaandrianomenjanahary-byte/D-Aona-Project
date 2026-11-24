/* =========================================================
   D-aôna — Seed de DÉMONSTRATION reproduisant l'ORACLE
   ---------------------------------------------------------
   But unique : produire, dans la base réelle, l'état EXACT de la démo de
   référence, pour que `scripts/compare.js` puisse comparer des chiffres et
   non des impressions. C'est le jalon §11.2 / §11.3 du cahier des charges.

   Valeurs cibles (extraites par `scripts/export-reference.js`, jamais saisies
   à la main) :
       15 comptes · 63 écritures · 3 réserves actives
       491 700 Ar de solde · 28 000 Ar réservés · 463 700 Ar disponibles
       563 900 Ar de crédits · 72 200 Ar de débits
       3 / 10 / 1 dossiers KYC · 2 retraits en attente + 1 payé
       1 litige ouvert + 1 en examen · 6 tournois · 24 inscriptions
       56 parties dont 11 le jour de référence

   La construction suit EXACTEMENT l'algorithme du bundle (fonction `aa` de la
   démo) : inscriptions, écritures fixes, soldes d'ouverture, puis crédit
   d'exploitation pour atteindre le solde cible de chaque compte. L'algorithme
   de bouclage est conservé tel quel — c'est lui qui garantit que la somme des
   écritures égale la somme des soldes. Le recalculer autrement produirait les
   bons totaux avec les mauvaises lignes.

   SÉCURITÉ : refuse de s'exécuter si la base contient des comptes réels, sauf
   `--force`. Ce seed EFFACE les données métier : il n'a rien à faire sur une
   base d'exploitation.

   Usage :
     node seed_oracle.js                     (base d-aona.db, --force requis)
     node seed_oracle.js --db=chemin.db
     node seed_oracle.js --db=chemin.db --force
   ========================================================= */
"use strict";

const path = require("node:path");

/* Jour de référence de la démo (constante `mn` du bundle). */
const REF_DAY = "2026-11-02";
const BASE = new Date(REF_DAY + "T12:00:00+03:00").getTime();
const DAY = 86400000;

/* Horodatage LOCAL (UTC+03) au format SQLite, comme le fait la démo : la date
   vient du décalage en jours, l'heure est celle demandée. On n'écrit pas de
   suffixe de fuseau — `date(created_at)` doit rendre le jour d'Antananarivo. */
function stamp(dayOffset, hour = 9, minute = 0) {
  const local = new Date(BASE + dayOffset * DAY + 3 * 3600000);
  const y = local.getUTCFullYear();
  const m = String(local.getUTCMonth() + 1).padStart(2, "0");
  const d = String(local.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d} ${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00`;
}

/* ---------- Données de la démo, recopiées telles quelles ---------- */
const PSEUDOS = ["GuideAdmin", "DemoRado", "DemoNaivo", "DemoHery", "DemoTsiry",
  "DemoLova", "DemoFara", "DemoMiora", "DemoSolo", "AinaRakoto",
  "TojoRabe", "MioraBao", "FaraNirina", "HeryTiana", "NainaSoa"];
const ELOS = [1100, 1842, 1715, 1650, 1520, 1435, 1298, 1210, 1105, 1100, 1100, 1100, 1100, 1100, 1100];
const WL = [[0, 0], [41, 18], [33, 20], [28, 19], [22, 21], [18, 24], [14, 25], [9, 27], [5, 31],
  [0, 0], [0, 0], [0, 0], [0, 0], [0, 0], [0, 0]];
const TARGET = [150000, 119000, 71500, 52000, 31500, 18000, 9500, 6400, 3800, 5000, 5000, 5000, 5000, 5000, 5000];
const CITIES = ["Antananarivo", "Antananarivo", "Toamasina", "Mahajanga", "Fianarantsoa",
  "Antsiranana", "Toliara", "Antananarivo", "Toamasina", "Antananarivo", "Antananarivo",
  "Antananarivo", "Antananarivo", "Antananarivo", "Antananarivo"];
const HUES = [155, 32, 205, 280, 8, 175, 45, 230, 320, 145, 15, 195, 70, 265, 350];

const TOURNAMENTS = [
  { id: 1, name: "D-aôna Masters — Saison 2", game: "fanorona", format: "Classique", capacity: 8,
    entry: 5000, start: stamp(5, 15), close: stamp(5, 14), minElo: 1500, minutes: 120, interval: 10,
    sponsor: "MVola", status: "open" },
  { id: 2, name: "Hebdo Fanorona #24", game: "fanorona", format: "Rapide", capacity: 8,
    entry: 2000, start: stamp(1, 18), close: stamp(1, 17), minElo: 0, minutes: 60, interval: 5,
    sponsor: null, status: "open" },
  { id: 3, name: "Blitz Cup — Analamanga", game: "blitz", format: "Blitz", capacity: 8,
    entry: 1000, start: stamp(0, 19), close: stamp(0, 18, 30), minElo: 0, minutes: 10, interval: 5,
    sponsor: null, status: "open" },
  { id: 4, name: "Coupe des nouveaux talents", game: "fanorona", format: "Rapide", capacity: 4,
    entry: 5000, start: stamp(3, 14), close: stamp(3, 13), minElo: 0, minutes: 60, interval: 5,
    sponsor: null, status: "open" },
  { id: 5, name: "Coupe D-aôna — Démo", game: "fanorona", format: "Rapide", capacity: 4,
    entry: 2000, start: stamp(0, 8), close: stamp(0, 7, 45), minElo: 0, minutes: 60, interval: 5,
    sponsor: null, status: "live" },
  { id: 6, name: "Hebdo Fanorona #23", game: "fanorona", format: "Rapide", capacity: 8,
    entry: 2000, start: stamp(-4, 18), close: stamp(-4, 17), minElo: 0, minutes: 60, interval: 5,
    sponsor: null, status: "finished" },
];
const REGS = {
  1: [], 2: [2, 3, 6, 7], 3: [2, 3, 4, 5, 6, 7], 4: [10, 13],
  5: [2, 3, 4, 5], 6: [2, 3, 4, 5, 6, 7, 8, 9],
};
/* L'application réelle nomme ses statuts autrement : la correspondance est
   faite ici, une fois, plutôt que dispersée dans les écrans. */
const STATUS_MAP = { open: "inscriptions", live: "en_cours", finished: "termine" };

/* ---------- Garde d'exécution ---------- */
const args = process.argv.slice(2);
const dbArg = args.find((a) => a.startsWith("--db="));
const force = args.includes("--force");
const DB_PATH = dbArg
  ? path.resolve(dbArg.slice(5))
  : path.join(__dirname, "d-aona.db");

/* Le schéma doit exister AVANT toute écriture : on laisse `db.js` appliquer le
   schéma et les migrations en important le module, exactement comme le
   serveur. On réutilise SA connexion — deux connexions sur le même fichier
   produiraient des verrous au milieu du seed. */
process.env.D_AONA_DB_PATH = DB_PATH;
const { db } = require("./db");
db.exec("PRAGMA foreign_keys = OFF;");

function table(name) {
  try { return db.prepare(`SELECT COUNT(*) AS c FROM "${name}"`).get().c; } catch (e) { return 0; }
}
const realAccounts = table("users");
if (!force && realAccounts > 0) {
  console.error(`REFUS : la base contient déjà ${realAccounts} compte(s).`);
  console.error("Ce seed EFFACE les données métier. Relancez avec --force si c'est bien une base de démonstration.");
  process.exit(2);
}

/* ---------- Remise à zéro ---------- */
const WIPE = ["tournament_matches", "tournament_registrations", "tournaments", "games",
  "game_sessions", "transactions", "withdrawals", "disputes", "kyc_cases", "ads",
  "user_sanctions", "admin_assignments", "notifications", "challenges", "chat_messages",
  "friends", "friend_requests", "user_skins", "equipped_skins", "pion_style",
  "auth_credentials", "sessions", "auth_audit_log", "users"];
db.exec("BEGIN");
for (const t of WIPE) { try { db.exec(`DELETE FROM "${t}"`); } catch (e) {} }
try { db.exec("DELETE FROM sqlite_sequence"); } catch (e) {}
db.exec("COMMIT");

/* ---------- Joueurs ---------- */
const insUser = db.prepare(
  `INSERT INTO users (id, pseudo, elo, wins, losses, balance, bonus_lock, kyc, province,
     created_at, last_seen, avatar, bonus_used, withdrawn_today)
   VALUES (?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?, NULL, 0, 0)`
);
const userId = (n) => n; // u1..u15 -> 1..15 (identifiants naturels, cf. id-map)
for (let i = 0; i < PSEUDOS.length; i++) {
  insUser.run(userId(i + 1), PSEUDOS[i], ELOS[i], WL[i][0], WL[i][1], 0, CITIES[i],
    stamp(-45 + i), stamp(0, 8, 40 - i));
}
/* Deux comptes suspendus dans la démo : u8 (index 7) et u12 (index 11). */
db.prepare("INSERT INTO user_sanctions (user_id, kind, reason, created_at) VALUES (?, 'block', ?, ?)")
  .run(8, "Vérification fair-play en cours.", stamp(0, 8));
db.prepare("INSERT INTO user_sanctions (user_id, kind, reason, created_at) VALUES (?, 'block', ?, ?)")
  .run(12, "Contrôle préventif du dossier d'identité.", stamp(0, 8));
/* Le premier compte est administrateur de la démo. */
db.prepare("INSERT OR IGNORE INTO admin_assignments (user_id, role_id) VALUES (1, 'super_admin')").run();

/* ---------- Tournois et inscriptions ---------- */
const insTour = db.prepare(
  `INSERT INTO tournaments (id, name, game, format, entry, max_players, status, min_rank,
     sponsor, starts_at, match_duration_min, interval_min, created_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, 'Bronze', ?, ?, ?, ?, ?)`
);
for (const t of TOURNAMENTS) {
  insTour.run(t.id, t.name, t.game, t.format, t.entry, t.capacity, STATUS_MAP[t.status],
    t.sponsor, t.start, t.minutes, t.interval, t.close);
}
db.prepare("UPDATE tournaments SET results_json = ? WHERE id = 6")
  .run(JSON.stringify({ championId: 2 }));

/* Bracket du tournoi EN COURS : deux rencontres au premier tour (t5, quatre
   joueurs). Sans elles, « annuler un tournoi annule ses matchs » ne serait pas
   mesurable — la règle existerait sans preuve. */
const insTM = db.prepare(
  "INSERT INTO tournament_matches (tournament_id, round, slot, p1_id, p2_id, status) VALUES (?, ?, ?, ?, ?, 'a_venir')"
);
insTM.run(5, 1, 1, 2, 5);
insTM.run(5, 1, 2, 3, 4);

/* ---------- Grand livre ---------- */
const ledger = [];
let seq = 0;
const insTx = db.prepare(
  "INSERT INTO transactions (user_id, dir, label, amount, ref_id, created_at) VALUES (?, ?, ?, ?, ?, ?)"
);
function entry(userN, amount, label, dayOffset, refId = null) {
  seq++;
  const txId = seq;
  insTx.run(userN, amount >= 0 ? "in" : "out", label, Math.abs(amount), refId,
    stamp(dayOffset, 8, seq % 60));
  ledger.push({ id: txId, userId: userN, amount, label });
  return { id: `TX-${String(txId).padStart(4, "0")}`, txId };
}

for (const t of TOURNAMENTS) {
  for (const u of REGS[t.id]) {
    /* L'identifiant de transaction attendu par la démo est `TX-000N` ; on le
       conserve comme référence pour que la table de correspondance soit
       lisible. */
    const r = entry(u, -t.entry, `Inscription · ${t.name}`, t.id === 6 ? -5 : -2);
    db.prepare(
      "INSERT INTO tournament_registrations (tournament_id, user_id, registered_at) VALUES (?, ?, ?)"
    ).run(t.id, u, stamp(t.id === 6 ? -5 : -2, 8, 0));
    void r;
  }
}
entry(2, 16000, "Victoire · Hebdo Fanorona #23", -4, "prize:t6");
entry(2, 50000, "Dépôt confirmé · MVola", -8, null);
entry(3, -20000, "Retrait confirmé · MVola · PAIEMENT-DEMO-23", -6, "withdrawal:w3");
entry(4, 12500, "Gain de partie · démo", -3);
entry(1, 5000, "Bonus de bienvenue · non retirable", -10);
entry(1, -3000, "Achat · personnalisation du plateau", -2);
entry(1, -200, "Ajustement de démonstration", -4);
entry(8, -300, "Ajustement de démonstration", -4);
entry(9, -700, "Ajustement de démonstration", -4);

for (let i = 1; i <= PSEUDOS.length; i++) entry(i, 1000, "Solde initial repris · démonstration", -40);

/* Bouclage : crédit d'exploitation pour atteindre le solde cible de chaque
   compte. C'est CE mécanisme qui rend la somme des écritures égale à la somme
   des soldes — le refaire autrement casserait la réconciliation. */
const sumFor = (u) => ledger.filter((e) => e.userId === u).reduce((s, e) => s + e.amount, 0);
let remaining = TARGET.reduce((s, v) => s + v, 0) - ledger.reduce((s, e) => s + e.amount, 0);
for (let i = 0; i < PSEUDOS.length; i++) {
  const need = Math.max(0, TARGET[i] - sumFor(i + 1));
  const give = Math.min(need, remaining);
  if (give > 0) entry(i + 1, give, "Crédit d'exploitation · démonstration", -7);
  remaining -= give;
}
if (remaining !== 0) throw new Error("le jeu de données financier ne se réconcilie pas : " + remaining);

/* Soldes = somme des écritures (aucune valeur posée à la main). */
for (let i = 0; i < PSEUDOS.length; i++) {
  db.prepare("UPDATE users SET balance = ? WHERE id = ?").run(sumFor(i + 1), i + 1);
}
/* Le bonus de bienvenue de u1 n'est PAS retirable : il alimente `bonus_lock`,
   qui est la moitié « engagement » du solde réservé. La démo le porte par un
   `hold` ; ici, c'est la colonne dédiée qui joue ce rôle. */
db.prepare("UPDATE users SET bonus_lock = 5000 WHERE id = 1").run();

/* ---------- Retraits ---------- */
const insW = db.prepare(
  `INSERT INTO withdrawals (id, user_id, amount, method, phone, status, reference, reason,
     created_at, reviewed_by, reviewed_at, paid_by, paid_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL)`
);
insW.run(1, 2, 15000, "MVola", "034 00 000 01", "pending", null, null, stamp(0, 8, 10));
insW.run(2, 5, 8000, "Orange Money", "032 00 000 02", "pending", null, null, stamp(0, 7, 45));
insW.run(3, 3, 20000, "MVola", "034 00 000 03", "paid", "PAIEMENT-DEMO-23",
  "Transfert de démonstration confirmé.", stamp(-6, 10, 0));

/* ---------- Dossiers d'identité ---------- */
const insKyc = db.prepare(
  `INSERT INTO kyc_cases (user_id, status, recto_path, verso_path, recto_sha, verso_sha,
     mime_recto, mime_verso, bytes_recto, bytes_verso, reason, submitted_at, reviewed_at, reviewer_id)
   VALUES (?, ?, ?, ?, ?, ?, 'image/png', 'image/png', 700, 660, ?, ?, ?, NULL)`
);
/* Six dossiers fabriqués pour u10..u15 : 3 en attente, 2 vérifiés, 1 refusé. */
for (let s = 0; s < 6; s++) {
  const u = 10 + s;
  const status = s < 3 ? "pending" : s < 5 ? "verified" : "rejected";
  const reason = s === 5
    ? "Photo recto illisible. Merci de soumettre une nouvelle image nette." : null;
  const fp1 = s < 2 ? "2806e9be" : (3827465 + s * 7919).toString(16);
  const fp2 = s < 2 ? "a5753293" : (9483746 + s * 104729).toString(16);
  insKyc.run(u, status, `seed/kyc-${u}-recto.png`, `seed/kyc-${u}-verso.png`, fp1, fp2,
    reason, stamp(-1, 14, s * 5), status === "pending" ? null : stamp(0, 8, 0));
}
/* Huit joueurs déjà vérifiés (ceux que la démo marque « verified »). */
for (const u of [2, 3, 4, 5, 6, 7, 13, 14]) {
  insKyc.run(u, "verified", `seed/kyc-${u}-recto.png`, `seed/kyc-${u}-verso.png`,
    `f-${u}`, `v-${u}`, null, stamp(-12, 9, 0), stamp(-10, 9, 0));
  db.prepare("UPDATE users SET kyc = 1 WHERE id = ?").run(u);
}

/* ---------- Parties ---------- */
const insGame = db.prepare(
  `INSERT INTO games (id, player1_id, player2_id, winner_id, delta1, delta2, mode, format,
     wager, game, status, reason, created_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)`
);
let gameId = 0;
for (let I = 6; I >= 0; I--) {
  const perDay = [8, 10, 7, 9, 6, 8, 5][I];
  void perDay;
  const count = [8, 10, 7, 9, 6, 8, 5][I];
  for (let ie = 0; ie < count; ie++) {
    gameId++;
    const p1 = 1 + (ie * 2 + I) % 14;
    const p2 = 1 + (ie * 2 + I + 1) % 14;
    const done = I > 0 || ie >= 4;
    /* La démo force `friendly` sur toute partie TERMINÉE (aucune n'a produit
       d'Elo) : on conserve ce détail, il explique pourquoi aucun delta n'est
       inventé. */
    const mode = done ? "friendly" : (ie % 2 === 0 ? "ranked" : "friendly");
    insGame.run(gameId, p1, p2, done ? p1 : null, null, null, mode,
      ie % 3 === 0 ? "blitz" : "rapide", ie % 3 === 0 ? "blitz" : "fanorona",
      done ? "finished" : "live",
      done ? "Résultat historique de démonstration (partie amicale)." : null,
      stamp(-I, 7 + Math.floor(ie / 3), (ie * 5) % 60));
  }
}
/* Trois parties posées à la main par la démo, toutes le jour de référence. */
insGame.run(++gameId, 2, 5, null, null, null, "tournament", "rapide", "fanorona", "live",
  null, stamp(0, 8, 0));
const t5a = gameId;
insGame.run(++gameId, 3, 4, null, null, null, "tournament", "rapide", "fanorona", "live",
  null, stamp(0, 8, 0));
const t5b = gameId;
insGame.run(++gameId, 8, 9, null, null, null, "ranked", "rapide", "fanorona", "disputed",
  null, stamp(0, 8, 15));
const disputedMatch = gameId;

/* ---------- Litiges ---------- */
const insDispute = db.prepare(
  "INSERT INTO disputes (match_id, user_id, category, reason, status, created_at) VALUES (?, ?, ?, ?, ?, ?)"
);
insDispute.run(disputedMatch, 9, "Résultat contesté",
  "Déconnexion pendant la partie. Le joueur demande une vérification du résultat " +
  "avant toute mise à jour du classement.", "open", stamp(0, 8, 30));
/* `m-0-5` = 6ᵉ partie du jour : les 8 parties du jour occupent les identifiants
   46 à 53, donc m-0-5 est la 51ᵉ. */
insDispute.run(51, 6, "Comportement",
  "Signalement de démonstration : propos inadaptés dans le salon. Contrôle de " +
  "modération à effectuer.", "investigating", stamp(0, 7, 50));

/* ---------- Campagnes ---------- */
const insAd = db.prepare(
  `INSERT INTO ads (slug, titre, image, lien, debut, fin, position, actif, ordre, created_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`
);
insAd.run("oracle-1", "Le Fanorona nous rassemble.", "board", "https://daona.mg/",
  stamp(-30, 0).slice(0, 10), stamp(60, 0).slice(0, 10), "accueil", 1, stamp(-30, 9));
insAd.run("oracle-2", "La prochaine coupe, c'est pour vous.", "cup", "https://daona.mg/tournois",
  stamp(1, 0).slice(0, 10), stamp(7, 0).slice(0, 10), "both", 2, stamp(-30, 9));

/* ---------- Amorçages du back-office ---------- */
require("./admin").init();

/* ---------- Contrôle de réconciliation ---------- */
const one = (sql, ...a) => (db.prepare(sql).get(...a) || {}).c || 0;
const sum = (sql, ...a) => (db.prepare(sql).get(...a) || {}).s || 0;
const credits = sum("SELECT COALESCE(SUM(amount),0) AS s FROM transactions WHERE dir = 'in'");
const debits = sum("SELECT COALESCE(SUM(amount),0) AS s FROM transactions WHERE dir = 'out'");
const balance = sum("SELECT COALESCE(SUM(balance),0) AS s FROM users");
const bonus = sum("SELECT COALESCE(SUM(bonus_lock),0) AS s FROM users");
const pendingW = sum("SELECT COALESCE(SUM(amount),0) AS s FROM withdrawals WHERE status IN ('pending','approved')");
const reserved = bonus + pendingW;
const lines = one("SELECT COUNT(*) AS c FROM transactions");
if (credits - debits !== balance) throw new Error(`réconciliation : crédits-débits ${credits - debits} ≠ soldes ${balance}`);
if (lines !== 63) throw new Error(`63 écritures attendues, ${lines} écrites`);
if (balance !== 491700) throw new Error(`solde attendu 491700, obtenu ${balance}`);
if (reserved !== 28000) throw new Error(`réservé attendu 28000, obtenu ${reserved}`);

console.log("Seed ORACLE écrit dans " + DB_PATH);
console.log(`  comptes        ${one("SELECT COUNT(*) AS c FROM users")}`);
console.log(`  écritures      ${lines}   (crédits ${credits} · débits ${debits})`);
console.log(`  solde          ${balance} Ar`);
console.log(`  réservé        ${reserved} Ar   (bonus ${bonus} + demandes ${pendingW})`);
console.log(`  disponible     ${balance - reserved} Ar`);
console.log(`  KYC            ${one("SELECT COUNT(*) AS c FROM kyc_cases WHERE status='pending'")} / ` +
  `${one("SELECT COUNT(*) AS c FROM kyc_cases WHERE status='verified'")} / ` +
  `${one("SELECT COUNT(*) AS c FROM kyc_cases WHERE status='rejected'")}`);
console.log(`  retraits       ${one("SELECT COUNT(*) AS c FROM withdrawals WHERE status='pending'")} en attente · ` +
  `${one("SELECT COUNT(*) AS c FROM withdrawals WHERE status='paid'")} payé(s)`);
console.log(`  litiges        ${one("SELECT COUNT(*) AS c FROM disputes WHERE status='open'")} ouvert(s) · ` +
  `${one("SELECT COUNT(*) AS c FROM disputes WHERE status='investigating'")} en examen`);
console.log(`  tournois       ${one("SELECT COUNT(*) AS c FROM tournaments")} · inscriptions ` +
  `${one("SELECT COUNT(*) AS c FROM tournament_registrations")}`);
console.log(`  parties        ${one("SELECT COUNT(*) AS c FROM games")} · aujourd'hui ` +
  `${one("SELECT COUNT(*) AS c FROM games WHERE date(created_at) = ?", REF_DAY)}`);
void t5a; void t5b;
