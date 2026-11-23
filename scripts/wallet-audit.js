/* =========================================================
   D-aôna — Audit du portefeuille (LECTURE SEULE)
   ---------------------------------------------------------
   Vérifie, pour CHAQUE compte de la base active, que le solde stocké est
   réconciliable avec le grand livre, et que les trois affichages de
   l'interface (header, onglet Wallet, onglet Profil) lisent la même chose.

   Ce que l'audit reproduit EXACTEMENT, sans navigateur :
     · header  = users.balance                       (brut)
     · wallet  = balance − réservé                   (net, « disponible »)
     · profil  = balance − réservé                   (même formule)
     · base    = users.balance
     · recalculé = Σ(in) − Σ(out) sur `transactions`
     · réservé = bonus_lock + Σ(withdrawals pending/approved)

   Après la migration 028 (reprise des soldes d'ouverture), tous les écarts
   doivent être nuls : c'est l'invariant « balance = Σ écritures ».

   Usage :
     node scripts/wallet-audit.js              (base par défaut du serveur)
     node scripts/wallet-audit.js --json       (sortie machine)
   Code de sortie 1 dès qu'un compte est en écart — utilisable dans `npm run
   verify`, qui devient donc rouge si un chemin d'écriture oublie le grand
   livre (c'est exactement ce qui s'était produit).
   ========================================================= */
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const SERVER_DIR = path.join(__dirname, "..", "d-aona-server");
const DB_PATH = process.env.D_AONA_DB_PATH
  ? path.resolve(process.env.D_AONA_DB_PATH)
  : path.join(SERVER_DIR, "d-aona.db");

const AS_JSON = process.argv.includes("--json");

if (!fs.existsSync(DB_PATH)) {
  console.error("Base introuvable : " + DB_PATH);
  process.exit(2);
}

/* Lecture stricte : aucune écriture possible, même par accident. */
const db = new DatabaseSync(DB_PATH, { readOnly: true });
db.exec("PRAGMA busy_timeout = 5000;");

const rows = db.prepare(`
  SELECT u.id, u.pseudo, u.balance, u.bonus_lock,
    COALESCE((
      SELECT SUM(w.amount) FROM withdrawals w
      WHERE w.user_id = u.id AND w.status IN ('pending', 'approved')
    ), 0) AS pending_withdrawals,
    COALESCE((
      SELECT SUM(CASE WHEN t.dir = 'in' THEN t.amount ELSE -t.amount END)
      FROM transactions t WHERE t.user_id = u.id
    ), 0) AS ledger
  FROM users u
  ORDER BY u.id
`).all();

const report = rows.map((r) => {
  const reserved = (r.bonus_lock || 0) + (r.pending_withdrawals || 0);
  const available = Math.max(0, r.balance - reserved);
  return {
    id: r.id,
    pseudo: r.pseudo,
    header: r.balance,
    wallet: available,
    profile: available,
    dbBalance: r.balance,
    ledger: r.ledger,
    reserved,
    balanceGap: r.balance - r.ledger,
    displayGap: r.balance - available,
  };
});

const bad = report.filter((r) => r.balanceGap !== 0 || r.displayGap !== 0);

if (AS_JSON) {
  console.log(JSON.stringify({ db: DB_PATH, checked: report.length, accounts: report, mismatched: bad }, null, 2));
} else {
  console.log("=== Audit du portefeuille — " + DB_PATH);
  console.log("Comptes vérifiés : " + report.length + "\n");
  const head = ["ID", "Pseudo", "Header", "Wallet", "Profil", "Base", "Recalculé", "Écart", "Réservé"];
  const width = (s, n) => String(s).padEnd(n);
  const line = head.map((h, i) => width(h, [5, 16, 10, 10, 10, 10, 11, 8, 9][i])).join(" ");
  console.log(line);
  console.log("-".repeat(line.length));
  for (const r of report) {
    const cells = [
      width(r.id, 5), width(r.pseudo, 16), width(r.header, 10), width(r.wallet, 10),
      width(r.profile, 10), width(r.dbBalance, 10), width(r.ledger, 11),
      width((r.balanceGap > 0 ? "+" : "") + r.balanceGap, 8), width(r.reserved, 9),
    ];
    console.log(cells.join(" ") + (r.balanceGap || r.displayGap ? "   <-- ÉCART" : ""));
  }
  console.log("");
  if (!bad.length) {
    console.log("TOUT EST RÉCONCILIÉ : balance = Σ(in) − Σ(out) sur les " + report.length + " comptes,");
    console.log("et header = Wallet = Profil partout (aucun montant réservé).");
  } else {
    console.log(bad.length + " COMPTE(S) EN ÉCART :");
    for (const r of bad) {
      console.log("  #" + r.id + " " + r.pseudo +
        " : base " + r.dbBalance + " · recalculé " + r.ledger +
        " (écart " + r.balanceGap + ") · affichage header−dispo " + r.displayGap);
    }
  }
}

db.close();
process.exit(bad.length ? 1 : 0);
