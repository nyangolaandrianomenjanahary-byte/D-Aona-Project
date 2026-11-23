-- =========================================================
-- 026 — La variante et l'historique, sur la SESSION
-- =========================================================
-- Deux lacunes de schéma, corrigées ensemble parce qu'elles ont la même racine :
-- `game_sessions` ne savait ni QUELLE variante était jouée (l'écran Parties
-- affichait « variante inconnue », et la ventilation des mises par jeu était
-- impossible), ni à quelle ligne d'historique elle correspondait.
--
-- Colonnes NULLABLES, sans défaut : une session antérieure ne connaît ni l'une
-- ni l'autre, et on ne l'invente pas. L'API renvoie `null`, l'écran affiche
-- « — ». Toute NOUVELLE session les écrit (server.js).
ALTER TABLE game_sessions ADD COLUMN game TEXT;
ALTER TABLE game_sessions ADD COLUMN game_record_id INTEGER;

-- ---------- Réparation d'un état hérité ----------
-- `GameRecord.create()` n'écrivait pas `status` : la colonne prenait son défaut
-- de la migration 018 (`'finished'`), y compris pour une partie EN COURS — d'où
-- des « terminées sans vainqueur » dans l'écran Parties, et un doublon avec la
-- ligne de session.
--
-- On ne touche QUE les lignes qui portent la signature exacte du défaut :
-- statut « fini », aucun vainqueur, et `reason = 'en_cours'` (la valeur posée à
-- la création). Une partie réellement terminée a un vainqueur ou un motif de
-- fin ; elle n'est donc jamais concernée.
--
-- Sont exclues les lignes dont la session est encore jouable : celles-là seront
-- reprises en `live` par `rehydrateSessions()` au démarrage du serveur.
UPDATE games
   SET status = 'cancelled', reason = 'Session disparue — partie close'
 WHERE status = 'finished'
   AND winner_id IS NULL
   AND reason = 'en_cours'
   AND id NOT IN (
     SELECT game_record_id FROM game_sessions
      WHERE status = 'playing' AND game_record_id IS NOT NULL
   );
