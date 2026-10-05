-- =========================================================
-- 008 — Skins de pions : séparation CLAIRS / SOMBRES
-- ---------------------------------------------------------
-- Constat : un skin de pions n'était qu'un `id` opaque (`kind:'pions'`) et
-- les deux camps partageaient UNE seule colonne d'équipement
-- (`equipped_skins.pions`). Impossible d'équiper en même temps un skin clair
-- et un skin sombre, et rien ne reliait un skin au camp qu'il habille :
-- `POST /api/skins/equip` faisait confiance au `kind` envoyé par le client.
-- Le jeu a besoin de deux catégories distinctes (LIGHT / DARK), avec leurs
-- achats et leur équipement propres.
--
-- Choix de migration — AUCUN achat perdu :
--   - `pions-classique` (gratuit, habillait les DEUX camps) est remplacé par
--     deux skins gratuits, `pions-clair-classique` et `pions-sombre-classique`,
--     attribués à TOUS les comptes (ils restent à 0 Ar et équipés d'office :
--     aucune perte pour personne) ;
--   - `pions-emeraude` habillait `.piece.me`, c'est-à-dire les pions du joueur
--     tels qu'il les voit (convention POV : « mes pions » = pions clairs) :
--     il devient le skin LIGHT `pions-clair-emeraude`, et l'achat suit ;
--   - `pions-obsidienne` habillait `.piece.opp` (les pions adverses = pions
--     sombres) : il devient le skin DARK `pions-sombre-obsidienne`.
--   Les identifiants sont réécrits dans `user_skins` (UPDATE) : celui qui
--   possédait un skin le possède toujours, à l'identique.
--
-- SQLite ne sait pas ajouter une colonne en conservant la clé étrangère
-- existante : la table est recréée (même procédé que la migration 005).
-- =========================================================

CREATE TABLE equipped_skins_new (
  user_id     INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  pions_light TEXT,
  pions_dark  TEXT,
  plateau     TEXT,
  effet       TEXT
);
INSERT INTO equipped_skins_new (user_id, pions_light, pions_dark, plateau, effet)
  SELECT user_id,
         CASE WHEN pions = 'pions-emeraude' THEN 'pions-clair-emeraude'
              ELSE 'pions-clair-classique' END,
         CASE WHEN pions = 'pions-obsidienne' THEN 'pions-sombre-obsidienne'
              ELSE 'pions-sombre-classique' END,
         plateau, effet
  FROM equipped_skins
  WHERE user_id IN (SELECT id FROM users);
DROP TABLE equipped_skins;
ALTER TABLE equipped_skins_new RENAME TO equipped_skins;

-- Identifiants normalisés : le type est porté par le suffixe clair/sombre.
UPDATE user_skins SET skin_id = 'pions-clair-emeraude'    WHERE skin_id = 'pions-emeraude';
UPDATE user_skins SET skin_id = 'pions-sombre-obsidienne' WHERE skin_id = 'pions-obsidienne';

-- L'ancien skin gratuit « les deux camps » n'a plus de sens : chaque compte
-- reçoit les DEUX nouveaux skins gratuits (un par catégorie).
DELETE FROM user_skins WHERE skin_id = 'pions-classique';
INSERT OR IGNORE INTO user_skins (user_id, skin_id) SELECT id, 'pions-clair-classique'  FROM users;
INSERT OR IGNORE INTO user_skins (user_id, skin_id) SELECT id, 'pions-sombre-classique' FROM users;
