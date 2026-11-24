-- =========================================================
-- 012 — PERFORMANCES : index des requêtes chaudes (lot S12)
-- ---------------------------------------------------------
-- Aucune donnée modifiée : uniquement des CREATE INDEX IF NOT EXISTS.
-- La base était déjà indexée pour l'auth, les sessions, les notifications,
-- le chat (sens from→to), les amis et les matchs de tournoi (db.js + 002).
-- Trois familles manquaient, mesurées par `_idxcheck.js` sur copie gonflée :
--
--   · challenges : la requête d'EXPIRATION est scrutée à CHAQUE tick de jeu
--     (1 s) — sans index, un balayage complet de table chaque seconde ;
--     les deux sens de lecture (to_id / from_id) servent le fil et les remboursements ;
--   · games : l'historique d'un joueur (player1 OR player2, ORDER BY created_at
--     DESC) balayait toute la table à chaque affichage ;
--   · chat_messages : le fil se lit dans les DEUX sens (from/to ET to/from) —
--     l'index existant (from,to) ne sert que le premier.
-- =========================================================

CREATE INDEX IF NOT EXISTS idx_challenges_status_expires ON challenges(status, expires_at);
CREATE INDEX IF NOT EXISTS idx_challenges_to   ON challenges(to_id);
CREATE INDEX IF NOT EXISTS idx_challenges_from ON challenges(from_id);

CREATE INDEX IF NOT EXISTS idx_games_p1_created ON games(player1_id, created_at);
CREATE INDEX IF NOT EXISTS idx_games_p2_created ON games(player2_id, created_at);

CREATE INDEX IF NOT EXISTS idx_chat_to_from ON chat_messages(to_user_id, from_user_id, created_at);
