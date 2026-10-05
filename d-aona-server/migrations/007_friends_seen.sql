-- =========================================================
-- 007 — Filigrane de consultation de l'écran Amis
-- ---------------------------------------------------------
-- Le badge de l'icône Amis doit signaler les demandes NOUVELLES et se vider dès
-- que l'écran Amis a été ouvert — y compris après un rechargement de page. Le
-- navigateur ne peut donc pas en être le seul dépositaire : on mémorise côté
-- serveur le dernier identifiant de demande VU.
--
-- Filigrane ENTIER, et non un horodatage : SQLite écrit ses dates avec
-- `datetime('now')` là où le reste du code manipule de l'ISO-UTC — comparer deux
-- formats est une source de bugs silencieux (fuseau, séparateur, suffixe Z). Les
-- identifiants, eux, sont monotones. Une demande relancée après un refus est
-- supprimée puis réinsérée (db.js, `FriendRequest.send`) : elle reçoit un NOUVEL
-- id, donc elle est bien comptée comme nouvelle.
-- =========================================================

ALTER TABLE users ADD COLUMN friends_seen_request_id INTEGER;
