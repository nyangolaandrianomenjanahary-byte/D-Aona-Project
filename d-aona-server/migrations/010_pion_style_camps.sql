-- =========================================================
-- 010 — Apparence des pions : DEUX CAMPS ÉTANCHES (CLAIRS / SOMBRES)
-- ---------------------------------------------------------
-- Constat : `pion_style` ne portait QU'UNE apparence, appliquée aux pions du
-- joueur (`.piece.me`). Le camp d'en face restait gouverné par un skin acheté
-- (`equipped_skins.pions_dark`), et rien n'empêchait d'enregistrer une couleur
-- SOMBRE (Noir, Bleu marine…) pour ses propres pions CLAIRS : deux mécanismes
-- concurrents, et un plateau où les deux camps pouvaient se ressembler.
--
-- Modèle retenu — une ligne PAR CAMP, le camp devenant une CLÉ :
--   `pion_style(user_id, camp, color, pattern)`, camp ∈ {light, dark}
--     light → les pions du joueur tels qu'il les voit (`.piece.me`)
--     dark  → les pions de l'adversaire tels qu'il les voit (`.piece.opp`)
--   Une couleur du groupe « clair » ne peut viser que `light`, une couleur du
--   groupe « sombre » que `dark` : le serveur refuse (400) l'inverse. C'est ce
--   contrôle — et non une convention d'affichage — qui rend les deux apparences
--   étanches, y compris par appel direct à l'API.
--
-- Reprise des achats — AUCUN skin perdu :
--   * l'ancienne ligne unique devient le camp `light` (c'est exactement ce
--     qu'elle habillait : les pions du joueur) ;
--   * le camp `dark` est créé pour chaque compte, la couleur étant reprise du
--     skin SOMBRE équipé, la plus proche du dégradé payé :
--       pions-sombre-emeraude   → vert_arme
--       pions-sombre-obsidienne → noir
--       pions-sombre-ombres     → gris_sombre
--       (tout le reste, dont `pions-sombre-classique`) → `noir`, le noir d'encre
--       du pion Vato sombre, qui est aussi la couleur par défaut de ce camp.
--   Les lignes de `user_skins` et `equipped_skins` sont CONSERVÉES : l'historique
--   des achats reste lisible et rien n'est effacé.
-- =========================================================

CREATE TABLE pion_style_camps (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  camp    TEXT    NOT NULL,
  color   TEXT    NOT NULL,
  pattern TEXT    NOT NULL DEFAULT 'aucun',
  PRIMARY KEY (user_id, camp)
);

-- 1) L'apparence existante décrivait MES pions → camp « clairs ».
INSERT OR IGNORE INTO pion_style_camps (user_id, camp, color, pattern)
SELECT user_id, 'light', color, pattern FROM pion_style
WHERE user_id IN (SELECT id FROM users);

-- 2) Une apparence SOMBRE par compte, reprise du skin sombre équipé.
INSERT OR IGNORE INTO pion_style_camps (user_id, camp, color, pattern)
SELECT u.id, 'dark',
       CASE e.pions_dark
         WHEN 'pions-sombre-emeraude'   THEN 'vert_arme'
         WHEN 'pions-sombre-obsidienne' THEN 'noir'
         WHEN 'pions-sombre-ombres'     THEN 'gris_sombre'
         ELSE 'noir'
       END,
       'aucun'
FROM users u
LEFT JOIN equipped_skins e ON e.user_id = u.id;

DROP TABLE pion_style;
ALTER TABLE pion_style_camps RENAME TO pion_style;
