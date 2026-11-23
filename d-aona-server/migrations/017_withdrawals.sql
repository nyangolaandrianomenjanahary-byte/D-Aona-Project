-- =========================================================
-- 017 — Demandes de retrait : le retrait devient INSTRUISIBLE
-- ---------------------------------------------------------
-- Constat : `POST /api/withdraw` débitait le portefeuille IMMÉDIATEMENT
-- (`Wallet.spend`). Conséquences mesurables :
--   · aucune trace de la demande — impossible de savoir qui a demandé quoi ;
--   · aucun moyen de REFUSER : l'argent était déjà parti avant tout contrôle ;
--   · aucune référence de transfert : rien ne prouve que l'argent est arrivé ;
--   · le plafond de 500 000 Ar/jour se calculait sur un débit DÉJÀ effectué,
--     donc un opérateur ne pouvait plus le corriger.
--
-- Décision — le joueur DÉPOSE une demande ; un opérateur la révise, puis la
-- paie en saisissant la référence du transfert. Trois états utiles, un seul
-- chemin :
--
--     pending ──révision ok──> approved ──paiement──> paid
--        └────révision ko────> rejected
--
-- Invariants portés par ce fichier (pas par la discipline des appelants) :
--   1. `amount > 0`. Le sens (sortie) est porté par la TABLE, pas par le signe :
--      un montant négatif ici serait un dépôt déguisé.
--   2. `reference` n'a de sens que pour `paid` — une référence annoncée avant
--      le paiement est un mensonge en base. La contrainte n'est pas exprimée en
--      SQL (SQLite ne sait pas la conditionner à `status` sans trigger), elle
--      l'est dans `admin/store/finance.js` et couverte par un test.
--   3. `reason` est obligatoire pour `rejected` : un refus sans motif est
--      indistinguable d'un bug.
--   4. Aucune ligne n'est supprimée. Un refus reste visible : il explique au
--      joueur pourquoi son argent n'est pas parti.
--
-- Le solde RÉSERVÉ n'est PAS stocké ici-bas en double : il se calcule
-- (`SUM(amount) WHERE status IN ('pending','approved')`). Une colonne
-- « reserved » entretenue à la main dériverait au premier chemin d'écriture
-- oublié — c'est exactement le défaut de `users.withdrawn_today`, qui n'était
-- entretenue par personne et restait à 0.
-- =========================================================

CREATE TABLE IF NOT EXISTS withdrawals (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL,
  amount      INTEGER NOT NULL CHECK (amount > 0),
  /* Opérateur de paiement mobile (MVola, Orange Money, Airtel Money…) borné
     par le code : la liste des opérateurs est éditoriale, pas structurelle. */
  method      TEXT    NOT NULL,
  /* Numéro de destination, tel que saisi par le joueur. Conservé parce que le
     paiement est manuel : l'opérateur doit pouvoir relire le numéro. */
  phone       TEXT,
  status      TEXT    NOT NULL DEFAULT 'pending'
              CHECK (status IN ('pending', 'approved', 'rejected', 'paid')),
  /* Référence du transfert, saisie au moment du paiement. */
  reference   TEXT,
  reason      TEXT,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  reviewed_by INTEGER,
  reviewed_at TEXT,
  paid_by     INTEGER,
  paid_at     TEXT
);

/* File d'attente du module « Demandes de retrait » : les demandes ouvertes,
   les plus anciennes d'abord (une demande de trois jours passe avant celle
   d'il y a une minute). */
CREATE INDEX IF NOT EXISTS idx_withdrawals_status ON withdrawals(status, created_at);

/* Portefeuille du joueur : son historique de demandes, et le calcul du solde
   réservé (pending + approved). */
CREATE INDEX IF NOT EXISTS idx_withdrawals_user ON withdrawals(user_id, status);
