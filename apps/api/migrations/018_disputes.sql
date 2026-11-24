-- =========================================================
-- 018 — Litiges / fair-play : le résultat d'une partie devient contestable
-- ---------------------------------------------------------
-- Constat : une partie terminée est un fait définitif. `games` porte le
-- vainqueur et les deltas Elo, et rien ne permet de dire « ce résultat est
-- contesté ». Un signalement de joueur n'a donc aucun objet à désigner, et
-- l'opérateur n'a aucun endroit où consigner sa décision.
--
-- Décision — le litige est un OBJET à part entière, rattaché à UNE partie.
-- Il ne modifie jamais `games` de lui-même : la correction du résultat est une
-- action distincte et journalisée (`POST /api/admin/matches/:id/result`), parce
-- que corriger un résultat touche l'Elo de deux joueurs et doit rester une
-- décision explicite, jamais un effet de bord d'un changement d'état de litige.
--
--   open ──> investigating ──> resolved
--     └──────────────────────> rejected
--
-- `outcome` dit ce qui a été FAIT au résultat — trois valeurs, aucune autre :
--   · none      — le résultat est confirmé, rien ne bouge ;
--   · corrected — le résultat a été corrigé (cf. l'entrée de journal liée) ;
--   · void      — la partie est annulée, l'Elo est rendu.
-- Un litige `resolved` sans `outcome` serait une décision sans effet : la
-- valeur est donc renseignée par le code au moment de la résolution.
--
-- `games.status` : la partie porte désormais son état. Les 602 parties
-- existantes sont des parties TERMINÉES — c'est le seul état qu'elles ont
-- jamais eu, et la valeur par défaut le dit explicitement plutôt que de les
-- laisser dans un état indéterminé. Contrainte volontairement absente du
-- `ALTER` : SQLite refuse d'ajouter une colonne avec une contrainte de table,
-- et une contrainte de colonne posée ici serait de toute façon invisible des
-- 602 lignes déjà écrites. Les valeurs admises sont donc vérifiées dans
-- `admin/store/competition.js`.
-- =========================================================

CREATE TABLE IF NOT EXISTS disputes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  /* Partie contestée. Pas de clé étrangère déclarative : `games` est purgé
     par les outils de maintenance (wipe_db.js) et un litige doit survivre à la
     disparition de la partie pour rester auditable. */
  match_id    INTEGER NOT NULL,
  /* Plaignant. Nul si le litige a été ouvert par la modération elle-même
     (contrôle proactif, signalement externe). */
  user_id     INTEGER,
  /* Catégorie éditoriale : « Résultat contesté », « Comportement »,
     « Triche », « Autre ». Texte libre borné par le code — une table de
     catégories pour quatre valeurs serait de la cérémonie. */
  category    TEXT    NOT NULL,
  reason      TEXT    NOT NULL,
  status      TEXT    NOT NULL DEFAULT 'open'
              CHECK (status IN ('open', 'investigating', 'resolved', 'rejected')),
  /* Effet RÉEL sur le résultat : none | corrected | void. */
  outcome     TEXT    CHECK (outcome IS NULL OR outcome IN ('none', 'corrected', 'void')),
  resolution  TEXT,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  resolved_by INTEGER,
  resolved_at TEXT
);

/* File de modération : les litiges ouverts, les plus anciens d'abord. */
CREATE INDEX IF NOT EXISTS idx_disputes_status ON disputes(status, created_at);

/* Une partie peut être contestée plusieurs fois (deux joueurs, deux avis) et
   l'écran « Parties » remonte les litiges d'une partie : on indexe la colonne
   dans les deux sens. */
CREATE INDEX IF NOT EXISTS idx_disputes_match ON disputes(match_id);

-- État de la partie. `finished` par défaut = les parties déjà en base.
ALTER TABLE games ADD COLUMN status TEXT NOT NULL DEFAULT 'finished';
