/* =========================================================
   028 — Grand livre : reprise du SOLDE D'OUVERTURE des comptes hérités
   ---------------------------------------------------------
   Défaut mesuré (2026-11-18) : 18 comptes portaient un `users.balance`
   supérieur de 5 000 Ar à la somme de leurs écritures. La cause n'est pas
   une erreur de solde — les 5 000 Ar d'ouverture sont bien dus — mais une
   ÉCRITURE MANQUANTE : ces comptes ont été créés (ou semés) avant que
   `Wallet.opening()` n'écrive la ligne correspondante au grand livre.

   Cette migration n'ajoute QUE des lignes d'historique. Elle ne touche
   NI `users.balance`, NI `users.bonus_lock`, NI `withdrawals`.

   Elle est AUTO-LIMITÉE, pas pilotée par une liste d'identifiants :
     · aucune ligne « Solde d'ouverture… » pour le joueur ;
     · aucune ligne de reprise déjà posée (`opening:backfill`) ;
     · écart `balance − Σ(in) + Σ(out)` EXACTEMENT égal à 5 000.
   Un compte déjà réconcilié (écart 0, comme l'ID 1 dont les 5 000 Ar
   viennent d'un vrai dépôt de démonstration) ne peut donc pas être touché,
   et une seconde exécution n'ajoute rien.

   Preuve après application : `node scripts/wallet-audit.js` doit annoncer
   0 compte en écart (aucun solde n'a bougé).
   ========================================================= */

INSERT INTO transactions (user_id, dir, label, amount, status, ref_id)
SELECT u.id, 'in', 'Solde d''ouverture · 5000 Ar offerts', 5000, NULL, 'opening:backfill'
FROM users u
WHERE NOT EXISTS (
        SELECT 1 FROM transactions t
        WHERE t.user_id = u.id AND t.label LIKE 'Solde d''ouverture%'
      )
  AND NOT EXISTS (
        SELECT 1 FROM transactions t
        WHERE t.user_id = u.id AND t.ref_id = 'opening:backfill'
      )
  AND u.balance - COALESCE((
        SELECT SUM(CASE WHEN t.dir = 'in' THEN t.amount ELSE -t.amount END)
        FROM transactions t WHERE t.user_id = u.id
      ), 0) = 5000;
