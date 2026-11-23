-- =========================================================
-- 023 — Sanctions de compte (suspension motivée, révocable)
-- ---------------------------------------------------------
-- Constat : l'administration peut « révoquer un KYC » ou « déverrouiller »
-- (routes existantes), mais il n'existe AUCUN moyen de suspendre un compte.
-- Un joueur qui triche reste connecté, et la seule réponse possible est une
-- conversation hors application.
--
-- Décision — la sanction est un ÉVÉNEMENT daté, pas une colonne booléenne :
--   · qui a sanctionné, quand, pourquoi, et quand la mesure a été levée ;
--   · l'état courant se LIT (dernier événement), il ne se stocke pas. Une
--     colonne `users.blocked` entretenue à la main dériverait dès qu'un chemin
--     d'écriture serait oublié — c'est le défaut de `users.withdrawn_today`.
--
-- `kind` couvre les quatre gestes réels de la modération :
--   · block     — suspension : la connexion est refusée (403 COMPTE_SUSPENDU)
--                 et les sessions ouvertes sont révoquées immédiatement ;
--   · unblock   — levée de la suspension ;
--   · warning   — avertissement consigné, sans effet technique ;
--   · kyc_revoke — retrait de la vérification d'identité (le drapeau `users.kyc`
--                 reste la source pour les routes métier : il est baissé par le
--                 code, la trace de la décision vit ici).
--
-- Pas de suppression : une sanction levée reste dans l'historique. C'est ce
-- qui permet de répondre à « pourquoi mon compte a-t-il été bloqué en mars ? ».
-- =========================================================

CREATE TABLE IF NOT EXISTS user_sanctions (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL,
  kind       TEXT    NOT NULL
             CHECK (kind IN ('block', 'unblock', 'warning', 'kyc_revoke')),
  /* Motif obligatoire à l'écriture (contrôlé par le code) : une sanction sans
     motif n'est pas défendable devant le joueur concerné. */
  reason     TEXT,
  actor_id   INTEGER,
  created_at TEXT    NOT NULL DEFAULT (datetime('now')),
  /* Renseigné quand la mesure est levée : une ligne `block` avec `lifted_at`
     n'est plus active, mais reste lisible. */
  lifted_at  TEXT
);

/* État courant d'un joueur = sa dernière ligne. Cet index sert exactement ça. */
CREATE INDEX IF NOT EXISTS idx_sanctions_user ON user_sanctions(user_id, id);

/* Historique par type : « combien de suspensions ce mois-ci ? ». */
CREATE INDEX IF NOT EXISTS idx_sanctions_kind ON user_sanctions(kind, created_at);
