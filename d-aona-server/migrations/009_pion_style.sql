-- =========================================================
-- 009 — Personnalisation du pion : COULEUR × MOTIF
-- ---------------------------------------------------------
-- Constat : habiller les pions demandait d'acheter un « skin de pions » entier
-- (`pions-clair-dragon`, `pions-sombre-ombres`…) — soit une combinaison figée par
-- thème, deux achats séparés pour les deux camps, et un catalogue qui devait
-- grandir à chaque idée. Le joueur veut choisir SÉPARÉMENT la couleur de son pion
-- et, éventuellement, un motif à poser dessus (16 couleurs × 9 motifs).
--
-- Modèle retenu — deux colonnes INDÉPENDANTES, jamais d'identifiant combiné :
--   `pion_style(user_id, color, pattern)`. Aucune des 144 combinaisons n'existe
--   en base : ajouter une couleur ou un motif au catalogue (data.js) suffit à le
--   rendre combinable avec toute l'autre liste, sans nouvelle migration.
--
-- Reprise des achats — AUCUN achat perdu : les anciens skins de pions équipés
-- désignaient une apparence précise ; chacun devient la couleur la plus proche :
--   pions-clair-emeraude    → vert_clair      pions-sombre-emeraude    → vert_sombre
--   pions-clair-obsidienne  → jaune           pions-sombre-obsidienne  → noir
--   pions-clair-dragon      → orange_clair    pions-sombre-ombres      → gris_sombre
--   (tout ce qui n'est pas listé, dont `pions-clair-classique`) → `blanc`,
--   l'ivoire du pion Vato, qui est aussi la couleur par défaut.
-- Les lignes de `user_skins` et `equipped_skins` sont CONSERVÉES : l'historique
-- des achats reste lisible, et les skins sombres continuent d'habiller les pions
-- de l'adversaire tels que le joueur les voit.
-- =========================================================

CREATE TABLE IF NOT EXISTS pion_style (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  color   TEXT NOT NULL DEFAULT 'blanc',
  pattern TEXT NOT NULL DEFAULT 'aucun'
);

-- Une ligne par compte existant, avec la couleur reprise du skin de pions équipé.
INSERT OR IGNORE INTO pion_style (user_id, color, pattern)
SELECT u.id,
       CASE e.pions_light
         WHEN 'pions-clair-emeraude'   THEN 'vert_clair'
         WHEN 'pions-clair-obsidienne' THEN 'jaune'
         WHEN 'pions-clair-dragon'     THEN 'orange_clair'
         ELSE 'blanc'
       END,
       'aucun'
FROM users u
LEFT JOIN equipped_skins e ON e.user_id = u.id;
