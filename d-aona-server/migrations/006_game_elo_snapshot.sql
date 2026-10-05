-- =========================================================
-- 006 — Instantané d'Elo par partie (avant / après)
-- ---------------------------------------------------------
-- `games` ne conservait que les ÉCARTS (`delta1` / `delta2`) : impossible
-- d'afficher « 1120 → 1132 · +12 Elo », ni à un joueur ni, surtout, à un TIERS
-- qui consulte le profil public (il n'y avait alors aucune valeur à montrer, et
-- l'interface finissait sur « undefined Elo »). On enregistre donc l'Elo AVANT
-- et APRÈS pour chacun des deux camps, au moment exact où la partie se termine.
--
-- Colonnes NULLABLES : les parties déjà enregistrées n'ont pas de valeur, et
-- c'est assumé — l'interface affiche « Données indisponibles » plutôt qu'un
-- chiffre reconstitué à l'aveugle (une reconstitution par marche arrière serait
-- fausse pour tout l'historique antérieur à une décroissance d'inactivité).
-- =========================================================

ALTER TABLE games ADD COLUMN elo1_before INTEGER;
ALTER TABLE games ADD COLUMN elo1_after  INTEGER;
ALTER TABLE games ADD COLUMN elo2_before INTEGER;
ALTER TABLE games ADD COLUMN elo2_after  INTEGER;
