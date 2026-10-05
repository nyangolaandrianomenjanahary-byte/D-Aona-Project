-- =========================================================
-- 004 — Unicité des contacts (téléphone / email)
-- ---------------------------------------------------------
-- L'interface annonce « compte unique par numéro / email ». Le contrôle
-- applicatif de POST /api/auth/register est insuffisant : deux inscriptions
-- lancées en parallèle peuvent passer toutes les deux avant que l'une n'ait
-- écrit. La garantie doit donc être dans la base, pas dans le code appelant.
--
-- Index PARTIELS volontairement : SQLite autorise plusieurs NULL, on n'indexe
-- que les valeurs réellement renseignées — un compte sans téléphone (ou sans
-- email) reste donc possible, et les anciens enregistrements vides ne gênent
-- pas.
-- =========================================================

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_phone_unique
  ON users(phone) WHERE phone IS NOT NULL AND phone <> '';

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_unique
  ON users(email) WHERE email IS NOT NULL AND email <> '';
