-- =========================================================
-- 020 — Badges de classement : d'un tableau du code à une table éditable
-- ---------------------------------------------------------
-- Constat : l'inventaire des badges vit dans `data.js` (`BADGES`), dupliqué
-- dans `index.html`, avec la consigne « cet inventaire et celui de
-- index.html doivent rester alignés ». C'est une dette explicite : deux
-- sources, aucune autorité. Un opérateur ne peut pas renommer « Akofa », ni
-- décaler sa borne, sans éditer du code et redéployer.
--
-- Décision — la table devient l'autorité. `data.js` continue d'exporter
-- `badgeFor()` pour le calcul de rang (le serveur en a besoin à chaque partie
-- terminée), mais la lecture d'affichage passe par ici. Les lignes sont
-- recopiées au démarrage depuis `DATA.BADGES` **si la table est vide**
-- (`ensureBadges()`), donc :
--   · une base existante démarre avec exactement les six badges actuels ;
--   · un renommage fait par un administrateur SURVIT au redémarrage.
--
-- `max_rank` NULLABLE et non `0` : le dernier badge n'a pas de borne haute.
-- `Infinity` n'existe pas en SQL ; `NULL` est la seule façon de dire « et
-- au-delà », et la conversion se fait à la lecture — jamais à l'écriture, où
-- elle produirait un texte « Infinity » comparable à rien.
--
-- Le calcul du rang reste serveur : un badge n'est pas un droit, c'est une
-- projection du classement. Aucune colonne `user_id` ici, donc aucune
-- attribution à maintenir quand l'Elo bouge.
-- =========================================================

CREATE TABLE IF NOT EXISTS badges (
  /* Le nom est la clé : c'est ce que le joueur lit, et rien ne le référence
     par identifiant. Renommer un badge ne casse donc aucun lien. */
  name      TEXT PRIMARY KEY,
  icon      TEXT,
  /* `color` = teinte décorative (fond 8 %, bordure 40 %) et encre du thème
     nuit ; `ink` = encre du thème jour, plus foncée. Deux colonnes parce que
     le contraste AA n'est pas le même sur fond clair et sur fond sombre. */
  color     TEXT,
  ink       TEXT,
  min_rank  INTEGER NOT NULL CHECK (min_rank >= 1),
  /* NULL = pas de borne haute. */
  max_rank  INTEGER
);

/* Contrôle de cohérence minimal : un intervalle vide (max < min) rendrait un
   badge impossible à obtenir tout en restant affiché dans la légende. */
CREATE UNIQUE INDEX IF NOT EXISTS idx_badges_range ON badges(min_rank, max_rank);
