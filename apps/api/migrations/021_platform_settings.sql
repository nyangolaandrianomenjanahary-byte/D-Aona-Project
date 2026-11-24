-- =========================================================
-- 021 — Paramètres de la plateforme (clé/valeur) + compteur de révision
-- ---------------------------------------------------------
-- Constat : aucune configuration n'est réglable sans redéploiement. Le nom
-- affiché, le contact de support, le fuseau, l'ouverture des inscriptions et
-- un éventuel mode maintenance sont écrits en dur dans `index.html` — donc
-- identiques pour tous les environnements, et impossibles à couper en urgence.
--
-- Décision — une table clé/valeur, volontairement pauvre :
--   · pas de colonne par réglage (15 migrations à venir pour 15 réglages) ;
--   · pas de JSON fourre-tout non plus (impossible à interroger, impossible à
--     valider). Une ligne = un réglage, `value` est du TEXTE.
--   · le TYPE vit dans le catalogue du code (`admin/store/platform.js`) : une
--     valeur illisible (« truee ») est refusée à l'écriture, pas interprétée à
--     la lecture. Un réglage absent prend son DÉFAUT du code — une base vide
--     et une base pleine se comportent donc pareil.
--
-- `maintenance` et `registrations_open` sont les deux seuls réglages qui
-- CHANGENT le comportement du serveur : ils sont lus à chaque requête
-- concernée, jamais mis en cache au démarrage (une coupure d'urgence qui
-- exigerait un redémarrage ne servirait à rien).
--
-- `revision` n'est pas un réglage : c'est le compteur d'écriture global du
-- back-office. Chaque commande réussie l'incrémente. Le client le renvoie en
-- `ifRevision` ; un écart signifie « quelqu'un d'autre a écrit entre-temps » et
-- la commande est refusée en 409 plutôt qu'appliquée sur un état périmé. C'est
-- la contrepartie serveur de la concurrence optimiste de la maquette, sans
-- laquelle deux administrateurs se recouvrent silencieusement.
-- =========================================================

CREATE TABLE IF NOT EXISTS platform_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT
);

/* Une seule ligne de révision, créée ici : les UPDATE ultérieurs la trouvent
   toujours, et un compteur absent ne peut pas être confondu avec 0. */
INSERT OR IGNORE INTO platform_settings (key, value) VALUES ('revision', '0');
