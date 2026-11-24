-- =========================================================
-- 003 — Journal d'authentification (append-only)
-- ---------------------------------------------------------
-- Trace les événements sensibles liés à l'identité : connexion réussie
-- ou refusée, inscription, réclamation, déconnexion, verrouillage.
-- Le mot de passe, le jeton et son empreinte n'y figurent JAMAIS.
-- La table est en AJOUT SEUL : deux déclencheurs refusent toute mise à
-- jour ou suppression, y compris depuis l'application. Un journal
-- d'audit modifiable ne serait pas un journal d'audit.
-- =========================================================

CREATE TABLE IF NOT EXISTS auth_audit_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  at         TEXT    NOT NULL DEFAULT (datetime('now')),
  event      TEXT    NOT NULL,   -- register | login_ok | login_fail | claim
                                 -- | logout | password_change | locked | revoke_all
  user_id    INTEGER,            -- NULL si le pseudo est inconnu
  pseudo     TEXT,               -- tel que saisi (borné) : détecte l'énumération de comptes
  session_id TEXT,
  ip         TEXT,
  user_agent TEXT,
  detail     TEXT                -- motif court — jamais de secret
);

CREATE INDEX IF NOT EXISTS idx_authaudit_at    ON auth_audit_log(at);
CREATE INDEX IF NOT EXISTS idx_authaudit_user  ON auth_audit_log(user_id, at);
CREATE INDEX IF NOT EXISTS idx_authaudit_event ON auth_audit_log(event, at);

CREATE TRIGGER IF NOT EXISTS trg_authaudit_no_update
BEFORE UPDATE ON auth_audit_log
BEGIN
  SELECT RAISE(ABORT, 'auth_audit_log est en ajout seul (append-only)');
END;

CREATE TRIGGER IF NOT EXISTS trg_authaudit_no_delete
BEFORE DELETE ON auth_audit_log
BEGIN
  SELECT RAISE(ABORT, 'auth_audit_log est en ajout seul (append-only)');
END;