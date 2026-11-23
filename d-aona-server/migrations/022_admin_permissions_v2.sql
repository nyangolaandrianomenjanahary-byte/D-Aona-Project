-- =========================================================
-- 022 — Bascule du vocabulaire d'administration vers la v2
-- ---------------------------------------------------------
-- Contexte : la v1 (migration 016) a été écrite pour 9 modules et 6 actions
-- nommées `view / create / update / review / export / delete`. La v2 du
-- back-office en tient 15 et nomme ses actions `read / create / edit / review /
-- export / delete`. Trois modules sont RENOMMÉS, deux sont FUSIONNÉS, sept
-- apparaissent.
--
-- Pourquoi migrer les DONNÉES et pas seulement le code : `admin_grants` est la
-- source de vérité des droits (une ligne par rôle, module, action). Si le code
-- change de vocabulaire sans que la base suive, chaque ligne devient ORPHELINE
-- — `rightsOf()` ignore les modules inconnus — et TOUS les rôles non protégés
-- perdent silencieusement leur accès. Le symptôme serait « le back-office
-- s'ouvre sur un écran vide » chez tout le monde sauf le super administrateur.
-- Une migration de données est donc le seul chemin correct.
--
-- Table de correspondance appliquée ici, dans cet ordre exact :
--
--   dashboard   -> overview            (1:1)
--   ads         -> campaigns           (1:1)
--   accounting  -> finance             (1:1)
--   elo    ┐
--   badges ┘──> ranking                (fusion : les deux n'avaient que `view`)
--   — nouvelle —> disputes, games, matches, withdrawals, audit, settings, modules
--   view        -> read
--   update      -> edit
--   tournament_admin -> tournaments
--   viewer      -> observer
--
-- ÉTAT VÉRIFIÉ AVANT ÉCRITURE (base de développement, 2026-11-02) :
--   7 rôles (admin, finance, marketing, moderation, super_admin, tournament_admin,
--   viewer) ; 9 modules ; 133 lignes = 7 rôles × 19 actions ; aucune action
--   `read`/`edit` préexistante. Les renommages ci-dessous ne peuvent donc pas
--   entrer en collision avec une ligne déjà présente.
--
-- CE QUI N'EST PAS FAIT ICI, VOLONTAIREMENT : aucun droit par défaut n'est
-- écrit pour les sept nouveaux modules. `ensureSeed()` s'en charge au démarrage
-- (INSERT OR IGNORE), ce qui préserve l'invariant central de 016 : un droit
-- retiré à la main ne revient JAMAIS au redémarrage. Écrire ces lignes ici
-- figerait les défauts dans une migration immuable, exactement ce que la v1
-- avait réussi à éviter.
-- =========================================================

-- ---------- 1. Le drapeau « module socle » ----------
-- `core = 1` : module non désactivable (un back-office éteint ne peut plus se
-- rallumer). Les cinq socles sont déterminés au point 7.
ALTER TABLE admin_modules ADD COLUMN core INTEGER NOT NULL DEFAULT 0;

-- ---------- 2. Renommages 1 pour 1 ----------
UPDATE admin_grants  SET module = 'overview'  WHERE module = 'dashboard';
UPDATE admin_modules SET id     = 'overview'  WHERE id     = 'dashboard';

UPDATE admin_grants  SET module = 'campaigns' WHERE module = 'ads';
UPDATE admin_modules SET id     = 'campaigns' WHERE id     = 'ads';

UPDATE admin_grants  SET module = 'finance'   WHERE module = 'accounting';
UPDATE admin_modules SET id     = 'finance'   WHERE id     = 'accounting';

-- ---------- 3. Fusion elo + badges -> ranking ----------
/* Les deux modules n'avaient qu'une action (`view`) et décrivaient la même
   chose : une lecture du classement. On écrit d'abord la ligne `ranking.read`
   (en conservant le `allowed` de chacun, elo prioritaire), puis on supprime
   les deux anciens jeux de lignes. L'ordre compte : sans le INSERT préalable,
   un rôle qui n'aurait eu que `badges` perdrait son accès. */
INSERT OR IGNORE INTO admin_grants (role_id, module, action, allowed)
  SELECT role_id, 'ranking', 'read', allowed FROM admin_grants WHERE module = 'elo' AND action = 'view';
INSERT OR IGNORE INTO admin_grants (role_id, module, action, allowed)
  SELECT role_id, 'ranking', 'read', allowed FROM admin_grants WHERE module = 'badges' AND action = 'view';
DELETE FROM admin_grants WHERE module IN ('elo', 'badges');

UPDATE admin_modules SET id = 'ranking' WHERE id = 'elo';
DELETE FROM admin_modules WHERE id = 'badges';

-- ---------- 4. Vocabulaire des actions ----------
UPDATE admin_grants SET action = 'read' WHERE action = 'view';
UPDATE admin_grants SET action = 'edit' WHERE action = 'update';

-- ---------- 5. Identifiants de rôles ----------
/* `admin_audit` n'est pas touché : c'est un journal en ajout seul (triggers
   anti-UPDATE/anti-DELETE de 016), et réécrire l'histoire d'un journal pour
   l'aligner sur un vocabulaire serait précisément ce qu'il existe pour
   empêcher. Les entrées anciennes citent l'ancien identifiant : c'est un fait
   daté, pas une incohérence. */
UPDATE admin_roles       SET id      = 'tournaments' WHERE id      = 'tournament_admin';
UPDATE admin_assignments SET role_id = 'tournaments' WHERE role_id = 'tournament_admin';
UPDATE admin_grants      SET role_id = 'tournaments' WHERE role_id = 'tournament_admin';

UPDATE admin_roles       SET id      = 'observer'    WHERE id      = 'viewer';
UPDATE admin_assignments SET role_id = 'observer'    WHERE role_id = 'viewer';
UPDATE admin_grants      SET role_id = 'observer'    WHERE role_id = 'viewer';

-- ---------- 6. Catalogue des 15 modules ----------
/* `INSERT OR IGNORE` : les quatre modules renommés existent déjà, on ne
   réécrit donc pas leur interrupteur (`enabled`), qui porte une décision
   d'exploitation. Les onze autres sont créés allumés. */
INSERT OR IGNORE INTO admin_modules (id, enabled, core) VALUES
  ('overview',    1, 1),
  ('users',       1, 0),
  ('kyc',         1, 0),
  ('disputes',    1, 0),
  ('games',       1, 0),
  ('matches',     1, 0),
  ('tournaments', 1, 0),
  ('ranking',     1, 0),
  ('finance',     1, 0),
  ('withdrawals', 1, 0),
  ('campaigns',   1, 0),
  ('roles',       1, 1),
  ('modules',     1, 1),
  ('audit',       1, 1),
  ('settings',    1, 1);

-- ---------- 7. Modules socles ----------
/* Déterminés par une liste d'inclusion et non l'inverse : un module ajouté
   plus tard arrive avec `core = 0` par défaut, ce qui est le comportement sûr
   (on peut toujours l'éteindre). */
UPDATE admin_modules SET core = 0;
UPDATE admin_modules SET core = 1
  WHERE id IN ('overview', 'roles', 'modules', 'audit', 'settings');
