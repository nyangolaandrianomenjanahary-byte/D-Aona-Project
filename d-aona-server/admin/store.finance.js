/* =========================================================
   D-aôna — Administration : finances (retraits, soldes, grand livre)
   ---------------------------------------------------------
   Ce que ce fichier existe pour empêcher : qu'un retrait soit un DÉBIT
   immédiat. L'ancien `POST /api/withdraw` appelait `Wallet.spend()` : l'argent
   quittait le portefeuille avant tout contrôle, aucun refus n'était possible,
   et rien ne prouvait que le transfert avait eu lieu.

   Le retrait est désormais une DEMANDE, instruite par un opérateur :

       pending ──approbation──> approved ──paiement──> paid
          └───refus motivé────> rejected

   L'argent n'est débité qu'à `paid`, et par `Wallet.spendWithdrawable()` — qui
   ne touche JAMAIS au bonus verrouillé. `Wallet.spend()`, lui, consomme le
   bonus en premier : l'utiliser pour un retrait permettait de retirer de
   l'argent non retirable. C'est la raison d'être de la seconde primitive.

   SOLDE RÉSERVÉ — pas de table `holds`. Le réservé se CALCULE :
       réservé    = bonus_lock + Σ(demandes pending + approved)
       disponible = balance − réservé
   Une table de réservations entretenue à la main dériverait au premier chemin
   d'écriture oublié ; c'est exactement le défaut de `users.withdrawn_today`,
   qui n'était entretenue par personne et restait à 0.
   ========================================================= */
"use strict";

const { db, Wallet, Notification } = require("../db");

/* Opérateurs de paiement mobile acceptés. Liste ÉDITORIALE (elle change sans
   migration) ; `method` reste du texte en base. */
const METHODS = ["MVola", "Orange Money", "Airtel Money", "Bankily"];

/* Plafond quotidien, en ariary. La règle vit ICI et nulle part ailleurs : le
   formulaire l'affiche, le serveur l'applique. */
const DAILY_CAP = 500000;
const MIN_AMOUNT = 1000;

function normMethod(v) {
  const s = String(v == null ? "" : v).trim();
  if (!s) return METHODS[0];
  const found = METHODS.find((m) => m.toLowerCase() === s.toLowerCase());
  return found || METHODS[0];
}

function clip(v, max) {
  if (v == null) return null;
  const s = String(v).trim();
  return s ? s.slice(0, max) : null;
}

function fail(status, code, error) {
  return { ok: false, status, code, error };
}

/* Montant lisible : « 17 000 Ar ». Les payloads de notification sont affichés
   tels quels, donc le format se décide ici et pas dans l'interface. */
function money(n) {
  return Number(n || 0).toLocaleString("fr-FR") + " Ar";
}

/* ---------- Soldes ---------- */

/* Ce qui est déjà promis : le bonus (non retirable par nature) et les demandes
   en cours. Le total est ce que le joueur ne peut PAS engager une seconde fois. */
function reserved(userId) {
  const bal = Wallet.getBalance(userId) || { balance: 0, bonus_lock: 0 };
  const row = db.prepare(
    "SELECT COALESCE(SUM(amount), 0) AS s FROM withdrawals WHERE user_id = ? AND status IN ('pending', 'approved')"
  ).get(userId);
  const pending = row ? row.s : 0;
  return { bonus: bal.bonus_lock || 0, pending, total: (bal.bonus_lock || 0) + pending };
}

function balanceOf(userId) {
  const bal = Wallet.getBalance(userId) || { balance: 0, bonus_lock: 0 };
  const r = reserved(userId);
  return { balance: bal.balance || 0, bonusLock: bal.bonus_lock || 0, reserved: r.total, withdrawable: Math.max(0, (bal.balance || 0) - r.total) };
}

/* ---------- Demandes ---------- */

const SELECT = `SELECT w.*, u.pseudo FROM withdrawals w LEFT JOIN users u ON u.id = w.user_id`;

function shape(r) {
  if (!r) return null;
  return {
    id: r.id, userId: r.user_id, pseudo: r.pseudo || null,
    amount: r.amount, method: r.method, phone: r.phone, status: r.status,
    reference: r.reference, reason: r.reason,
    createdAt: r.created_at, reviewedAt: r.reviewed_at, reviewedBy: r.reviewed_by,
    paidAt: r.paid_at, paidBy: r.paid_by,
  };
}

function get(id) {
  return shape(db.prepare(`${SELECT} WHERE w.id = ?`).get(id));
}

/* La demande OUVERTE d'un joueur (pending ou approved), s'il y en a une.
   Exposée au profil : sans elle, le joueur voit son solde disponible baisser
   sans aucune explication à l'écran. */
function openRequest(userId) {
  const row = db.prepare(
    `${SELECT} WHERE w.user_id = ? AND w.status IN ('pending', 'approved') ORDER BY w.id DESC LIMIT 1`
  ).get(userId);
  return shape(row);
}

function list({ status = "all", limit = 100 } = {}) {
  const n = Math.min(Math.max(parseInt(limit, 10) || 100, 1), 500);
  const allowed = ["pending", "approved", "rejected", "paid"];
  const rows = allowed.includes(status)
    ? db.prepare(`${SELECT} WHERE w.status = ? ORDER BY w.created_at ASC, w.id ASC LIMIT ?`).all(status, n)
    : db.prepare(`${SELECT} ORDER BY CASE w.status WHEN 'pending' THEN 0 WHEN 'approved' THEN 1 ELSE 2 END,
        w.created_at DESC, w.id DESC LIMIT ?`).all(n);
  return rows.map(shape);
}

/* Création d'une demande. AUCUN débit : on vérifie, on enregistre, on attend. */
function create(userId, input = {}) {
  const amount = parseInt(input.amount, 10) || 0;
  if (amount < MIN_AMOUNT) return fail(400, "MONTANT_INVALIDE", `Minimum ${MIN_AMOUNT} Ar`);

  /* Le plafond est vérifié AVANT le solde : c'est une règle de politique, et
     son message doit sortir même si le solde est de toute façon insuffisant —
     sinon un joueur à 600 000 Ar croit à un bug de solde. */
  const today = Wallet.withdrawnToday(userId);
  if (amount > DAILY_CAP - today)
    return fail(400, "PLAFOND_QUOTIDIEN", `Plafond quotidien de retrait atteint (max. ${DAILY_CAP} Ar/jour)`);

  /* Une seule demande ouverte à la fois — vérifié AVANT le solde : deux
     demandes simultanées pour le même argent donneraient deux virements si
     les deux étaient approuvées, et le joueur doit lire « vous en avez déjà
     une » plutôt que « solde insuffisant », qui est faux. */
  const open = db.prepare(
    "SELECT id FROM withdrawals WHERE user_id = ? AND status IN ('pending', 'approved')"
  ).get(userId);
  if (open) return fail(409, "DEMANDE_EN_COURS", "Une demande de retrait est déjà en cours d'instruction");

  const bal = balanceOf(userId);
  if (amount > bal.withdrawable) return fail(400, "SOLDE_INSUFFISANT", "Solde insuffisant");

  /* `method` ET `operator` sont acceptés : le client historique envoyait
     `operator` (le serveur le lisait comme `method` → toute demande partait en
     MVola), le client corrigé envoie `method`. Le numéro, lui, est ce que
     l'opérateur relit pour payer : il ne doit jamais être perdu. */
  const info = db.prepare(
    "INSERT INTO withdrawals (user_id, amount, method, phone) VALUES (?, ?, ?, ?)"
  ).run(userId, amount, normMethod(input.method || input.operator), clip(input.phone, 24));
  return { ok: true, request: get(info.lastInsertRowid) };
}

/* Instruction : approuver ou refuser. Un refus DOIT être motivé — un refus sans
   motif est indistinguable d'un bug, et c'est le seul texte que le joueur lira. */
function review(id, input = {}, actor = {}) {
  const w = get(id);
  if (!w) return fail(404, "DEMANDE_INCONNUE", "Demande introuvable");
  if (w.status !== "pending") return fail(409, "ETAT_INVALIDE", "Cette demande a déjà été instruite");

  const decision = String(input.decision || "").toLowerCase();
  if (decision !== "approve" && decision !== "reject")
    return fail(400, "DECISION_INCONNUE", "Décision inconnue : approve ou reject");

  const reason = clip(input.reason, 500);
  if (decision === "reject" && (!reason || reason.length < 3))
    return fail(400, "MOTIF_MANQUANT", "Un refus doit être motivé");

  const status = decision === "approve" ? "approved" : "rejected";
  db.prepare(
    "UPDATE withdrawals SET status = ?, reason = ?, reviewed_by = ?, reviewed_at = datetime('now') WHERE id = ?"
  ).run(status, reason, actor.id || null, id);

  /* Le joueur doit l'apprendre dans l'application, pas par un solde qui change
     sans explication. `text` est la phrase que l'écran Notifications affiche
     telle quelle : un payload sans texte lisible y apparaît vide. */
  Notification.create(w.userId, "withdrawal", {
    id: w.id, status, amount: w.amount, reason,
    text: status === "approved"
      ? `Demande de retrait de ${money(w.amount)} approuvée — le virement est en préparation.`
      : `Demande de retrait de ${money(w.amount)} refusée : ${reason}`,
  });
  return { ok: true, request: get(id) };
}

/* Paiement : le seul endroit où l'argent sort réellement. La référence de
   transfert est OBLIGATOIRE — c'est la preuve que le virement a été fait. */
function pay(id, input = {}, actor = {}) {
  const w = get(id);
  if (!w) return fail(404, "DEMANDE_INCONNUE", "Demande introuvable");
  if (w.status !== "approved")
    return fail(409, "ETAT_INVALIDE", "Seule une demande approuvée peut être payée");

  const reference = clip(input.reference, 80);
  if (!reference || reference.length < 3)
    return fail(400, "REFERENCE_MANQUANTE", "Référence de transfert obligatoire");

  /* À ce stade la demande est encore comptée dans le réservé : le contrôle
     porte donc sur `balance − bonus_lock`, et non sur le disponible. */
  const bal = Wallet.getBalance(w.userId) || { balance: 0, bonus_lock: 0 };
  if (w.amount > bal.balance - bal.bonus_lock)
    return fail(409, "SOLDE_INSUFFISANT", "Le solde disponible ne couvre plus cette demande");

  /* DÉBIT ET CHANGEMENT DE STATUT DANS LA MÊME TRANSACTION. Deux écritures
     séparées laisseraient, si le processus s'arrête entre les deux, un compte
     débité avec une demande toujours « approuvée » — donc payable une seconde
     fois. C'est l'invariant que la référence exige explicitement. */
  db.exec("BEGIN");
  try {
    const paid = Wallet.spendWithdrawable(w.userId, w.amount, `Retrait ${w.method} · ${reference}`, `withdrawal:${w.id}`);
    if (!paid) {
      db.exec("ROLLBACK");
      return fail(409, "SOLDE_INSUFFISANT", "Le solde disponible ne couvre plus cette demande");
    }
    db.prepare(
      "UPDATE withdrawals SET status = 'paid', reference = ?, paid_by = ?, paid_at = datetime('now') WHERE id = ?"
    ).run(reference, actor.id || null, id);
    db.exec("COMMIT");
  } catch (e) {
    try { db.exec("ROLLBACK"); } catch (_) {}
    return fail(409, "ECRITURE_IMPOSSIBLE", "Paiement impossible : rien n'a été débité");
  }

  Notification.create(w.userId, "withdrawal", {
    id: w.id, status: "paid", amount: w.amount, reference,
    text: `Retrait de ${money(w.amount)} payé par ${w.method} (référence ${reference}).`,
  });
  return { ok: true, request: get(id) };
}

/* ---------- Synthèse pour l'écran « Portefeuilles & flux » ---------- */

function overview() {
  const totals = db.prepare(
    `SELECT
       COALESCE(SUM(CASE WHEN status IN ('pending','approved') THEN amount ELSE 0 END), 0) AS engaged,
       COALESCE(SUM(CASE WHEN status = 'paid' THEN amount ELSE 0 END), 0) AS paid,
       COALESCE(SUM(CASE WHEN status = 'rejected' THEN amount ELSE 0 END), 0) AS refused
     FROM withdrawals`
  ).get();
  const balances = db.prepare(
    "SELECT COALESCE(SUM(balance), 0) AS total, COALESCE(SUM(bonus_lock), 0) AS bonus, COUNT(*) AS players FROM users"
  ).get();
  const flows = db.prepare(
    `SELECT dir, COALESCE(SUM(amount), 0) AS total, COUNT(*) AS count
     FROM transactions GROUP BY dir`
  ).all();
  const byDir = Object.fromEntries(flows.map((f) => [f.dir, { total: f.total, count: f.count }]));
  return {
    players: balances.players,
    balance: balances.total,
    bonus: balances.bonus,
    engaged: totals.engaged,
    paid: totals.paid,
    refused: totals.refused,
    inflow: byDir.in || { total: 0, count: 0 },
    outflow: byDir.out || { total: 0, count: 0 },
  };
}

module.exports = {
  METHODS, DAILY_CAP, MIN_AMOUNT,
  balanceOf, reserved, get, openRequest, list, create, review, pay, overview,
};
