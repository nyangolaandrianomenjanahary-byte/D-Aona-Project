-- =========================================================
-- 011 — Apparence des pions : cohérence des groupes dans les données existantes
-- ---------------------------------------------------------
-- La 010 a créé les deux camps, mais elle a repris TEL QUEL le style du camp
-- clair : or l'ancien système acceptait les 16 couleurs pour les pions du joueur,
-- si bien qu'un compte pouvait avoir enregistré une couleur SOMBRE pour ses pions
-- CLAIRS — exactement l'incohérence que le nouveau modèle interdit, et un état que
-- l'API refuse désormais d'écrire (400).
--
-- Cette migration remet chaque camp DANS SON GROUPE : une couleur hors groupe
-- devient la couleur PAR DÉFAUT du camp (l'apparence Vato — blanc clair / noir
-- sombre), et le motif est CONSERVÉ (il n'a jamais été lié à un groupe).
-- Contrôle sur la base réelle : 1 compte sur 14 (camp clair) — les 13 autres, et
-- les 14 camps sombres, n'étaient pas concernés.
--
-- Les deux listes ci-dessous recopient les identifiants de `PION_COLORS`
-- (data.js) : une migration ne peut pas lire un module JS, et leur duplication est
-- donc assumée. Si une couleur est ajoutée au catalogue, elle reste compatible
-- avec ce contrôle — seules les couleurs PRÉSENTES ici sont vérifiées.
-- =========================================================

UPDATE pion_style SET color = 'blanc' WHERE camp = 'light'
  AND color NOT IN ('rouge_clair', 'vert_clair', 'bleu_clair', 'jaune',
                    'blanc', 'gris_clair', 'orange_clair', 'violet_clair');

UPDATE pion_style SET color = 'noir' WHERE camp = 'dark'
  AND color NOT IN ('grenat', 'vert_arme', 'bleu_marine', 'marron',
                    'noir', 'gris_sombre', 'orange_sombre', 'violet_sombre');

-- Garde-fou d'invariant : les DEUX camps existent pour chaque compte, quel que
-- soit l'état de départ (base antérieure restaurée depuis une sauvegarde, ligne
-- supprimée à la main…). Un camp manquant empêcherait la boutique de l'afficher.
INSERT OR IGNORE INTO pion_style (user_id, camp, color, pattern)
SELECT id, 'light', 'blanc', 'aucun' FROM users;
INSERT OR IGNORE INTO pion_style (user_id, camp, color, pattern)
SELECT id, 'dark', 'noir', 'aucun' FROM users;
