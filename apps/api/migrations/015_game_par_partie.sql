-- =========================================================
-- 015 — Le plateau joué : une partie, un défi, un historique
-- ---------------------------------------------------------
-- Constat : les trois plateaux du Fanorona (Tsivy 9×5, Dimy 5×5, Telo 3×3)
-- peuvent désormais être joués EN LIGNE — partie classée, défi entre amis,
-- entraînement. Or `games` et `challenges` ne retenaient que le mode et le
-- format : impossible de dire sur QUEL plateau la partie s'est jouée, donc
-- historique et défis reçus auraient tous affiché « Fanorona ».
--
-- Modèle retenu — une colonne, un défaut qui ne ment pas :
--   `game` = identifiant du DOSSIER de jeu (`fanoron-tsivy`, `fanoron-dimy`,
--   `fanoron-telo`), celui du registre serveur et du manifeste.
--   `fanoron-tsivy` est la valeur par défaut : c'est le seul plateau qui
--   existait avant cette migration, donc les lignes antérieures sont justes
--   sans réécriture.
--
-- L'Elo, lui, ne bouge pas : un seul barème et une seule colonne `users.elo`
-- pour les trois plateaux — c'est le classement commun voulu par le projet.
-- =========================================================

ALTER TABLE games ADD COLUMN game TEXT NOT NULL DEFAULT 'fanoron-tsivy';
ALTER TABLE challenges ADD COLUMN game TEXT NOT NULL DEFAULT 'fanoron-tsivy';
