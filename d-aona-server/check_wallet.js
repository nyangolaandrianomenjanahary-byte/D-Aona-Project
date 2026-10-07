/* =========================================================
   D-aôna — Contrôle du portefeuille (LECTURE SEULE)
   ---------------------------------------------------------
   Repère les comptes au solde incohérent : solde négatif, ou solde
   incohérent avec les mouvements enregistrés dans `transactions`
   (un écart signale un débit non tracé — l'ancien défaut de double
   débit de Wallet.spend(), corrigé le 2026-09-14, peut avoir laissé
   des traces).

   Aucune écriture : le script ouvre la base en lecture seule.

   Usage :  node check_wallet.js
   ========================================================= */
"use strict";

const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const DB_PATH = path.join(__dirname, "d-aona.db");
const db = new DatabaseSync(DB_PATH, { readOnly: true });

const total = db.prepare("SELECT COUNT(*) AS c FROM users").get().c;
const negative = db.prepare("SELECT id, pseudo, balance, bonus_lock FROM users WHERE balance < 0 ORDER BY balance ASC").all();
const outs = db.prepare("SELECT COUNT(*) AS c FROM transactions WHERE dir = 'out'").get().c;

console.log("=== CONTRÔLE DU PORTEFEUILLE (lecture seule) ===");
console.log(`Base          : ${DB_PATH}`);
console.log(`Comptes       : ${total}`);
console.log(`Mouvements 'out' enregistrés : ${outs}`);
console.log(`Comptes à solde NÉGATIF : ${negative.length}`);
for (const u of negative.slice(0, 20)) {
  console.log(`  #${u.id} ${u.pseudo} : solde ${u.balance} Ar (bonus verrouillé ${u.bonus_lock} Ar)`);
}
if (negative.length > 20) console.log(`  … et ${negative.length - 20} autre(s).`);

/* Solde attendu = somme des entrées − somme des sorties, à partir du crédit
   d'inscription de 5 000 Ar. Un écart signale un débit non tracé (double débit). */
const rows = db.prepare(`
  SELECT u.id, u.pseudo, u.balance,
         COALESCE(SUM(CASE WHEN t.dir = 'in' THEN t.amount ELSE 0 END), 0) AS entrees,
         COALESCE(SUM(CASE WHEN t.dir = 'out' THEN t.amount ELSE 0 END), 0) AS sorties
  FROM users u LEFT JOIN transactions t ON t.user_id = u.id
  GROUP BY u.id
`).all();
const gaps = rows
  .map((r) => ({ ...r, attendu: 5000 + r.entrees - r.sorties, ecart: r.balance - (5000 + r.entrees - r.sorties) }))
  .filter((r) => r.ecart !== 0);
console.log(`\nComptes dont le solde s'écarte des mouvements enregistrés : ${gaps.length}`);
for (const g of gaps.slice(0, 20)) {
  console.log(`  #${g.id} ${g.pseudo} : solde ${g.balance} / attendu ${g.attendu} (écart ${g.ecart})`);
}
if (gaps.length > 20) console.log(`  … et ${gaps.length - 20} autre(s).`);

db.close();
