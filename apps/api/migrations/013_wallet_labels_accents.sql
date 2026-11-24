-- 013 — Wallet : accents des libellés, alignés sur la maquette wallet-desktop
-- --------------------------------------------------------------------------
-- Les flux réels écrivaient les libellés SANS accents (« Depot MVola »,
-- « Credit de bienvenue », « Mise entree… », « Mise defi… », « Defi annule /
-- refuse / expire… ») alors que la démo et la maquette affichent la forme
-- accentuée (« Dépôt MVola », « Crédit de bienvenue », « Mise défi vs … »,
-- « Défi annulé - remboursement »…). server.js et demo_seed.js sont corrigés
-- à la source ; cette migration aligne les lignes DÉJÀ en base — sans quoi
-- l'historique du wallet mélangerait les deux orthographes.
--
-- Sans risque pour le classement : data.js classe déjà avec des motifs qui
-- tolèrent les deux formes (/Depot|Dépôt/i, /Mise/i, /remboursement/i…), et
-- la recherche du wallet (db/stores.js, fold()) ignore la casse ET les
-- accents — « depot » retrouve « Dépôt MVola ».
UPDATE transactions SET label = 'Dépôt' || substr(label, 6)
  WHERE label LIKE 'Depot %';
UPDATE transactions SET label = 'Crédit de bienvenue'
  WHERE label = 'Credit de bienvenue';
UPDATE transactions SET label = 'Mise défi vs ' || substr(label, 14)
  WHERE label LIKE 'Mise defi vs %';
UPDATE transactions SET label = 'Gain défi vs ' || substr(label, 14)
  WHERE label LIKE 'Gain defi vs %';
UPDATE transactions SET label = 'Défi annulé - remboursement'
  WHERE label = 'Defi annule - remboursement';
UPDATE transactions SET label = 'Défi refusé - remboursement'
  WHERE label = 'Defi refuse - remboursement';
UPDATE transactions SET label = 'Défi expiré - remboursement'
  WHERE label = 'Defi expire - remboursement';
UPDATE transactions SET label = 'Mise entrée - ' || substr(label, 15)
  WHERE label LIKE 'Mise entree - %';
