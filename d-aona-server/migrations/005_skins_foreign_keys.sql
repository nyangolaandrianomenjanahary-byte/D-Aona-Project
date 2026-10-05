-- =========================================================
-- 005 — Clés étrangères manquantes sur les tables de SKINS
-- ---------------------------------------------------------
-- Constat : `user_skins` et `equipped_skins` n'avaient AUCUNE clé étrangère
-- (contrairement à `sessions` et `auth_credentials`). Supprimer un compte
-- laissait donc derrière lui ses lignes de skins, définitivement orphelines :
-- elles gonflent les compteurs, faussent la possession d'un skin et ne
-- disparaîtront jamais. Un `ON DELETE CASCADE` règle le problème à la source
-- (règle : la contrainte est dans la base, pas dans le code appelant).
--
-- SQLite ne sait pas ajouter une contrainte à une table existante : il faut
-- recréer la table, recopier, supprimer l'ancienne, renommer.
-- Les lignes sans propriétaire sont volontairement ÉCARTÉES au passage : elles
-- ne correspondent à aucun compte et ne peuvent plus rien désigner.
-- =========================================================

CREATE TABLE user_skins_new (
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  skin_id     TEXT NOT NULL,
  acquired_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, skin_id)
);
INSERT INTO user_skins_new (user_id, skin_id, acquired_at)
  SELECT user_id, skin_id, acquired_at FROM user_skins
  WHERE user_id IN (SELECT id FROM users);
DROP TABLE user_skins;
ALTER TABLE user_skins_new RENAME TO user_skins;

CREATE TABLE equipped_skins_new (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  pions   TEXT,
  plateau TEXT,
  effet   TEXT
);
INSERT INTO equipped_skins_new (user_id, pions, plateau, effet)
  SELECT user_id, pions, plateau, effet FROM equipped_skins
  WHERE user_id IN (SELECT id FROM users);
DROP TABLE equipped_skins;
ALTER TABLE equipped_skins_new RENAME TO equipped_skins;
