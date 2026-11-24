-- =========================================================
-- 016 — Espace d'administration modulaire + dossiers KYC
-- ---------------------------------------------------------
-- Constat : aucun rôle, aucune permission, aucun journal d'action. Le seul
-- contrôle existant est « est-ce connecté ? ». Or l'administration à venir
-- (publicités, tournois, comptabilité, joueurs, Elo, badges, KYC) doit être
-- découpée par MODULE et par RÔLE, et chaque action sensible doit laisser une
-- trace ineffaçable.
--
-- Modèle retenu (proche d'un back-office PrestaShop) :
--   · admin_modules      — catalogue des modules + interrupteur global ;
--   · admin_roles        — catalogue des rôles (libellé, protégé ou non) ;
--   · admin_grants       — une ligne par (rôle, module, action) => autorisé ?
--                          Le droit vit en BASE, pas dans le code : un
--                          administrateur peut le modifier sans redéploiement ;
--   · admin_assignments  — qui possède quel rôle (un joueur peut en cumuler) ;
--   · admin_audit        — journal en AJOUT SEUL (triggers anti-UPDATE/DELETE).
--
-- KYC : le dossier devient un OBJET (une demande) et non plus un simple
-- drapeau `users.kyc`. La demande porte DEUX pièces obligatoires (recto et
-- verso de la CIN), leur empreinte SHA-256 (recto ≡ verso = même image
-- renvoyée deux fois), l'auteur de la décision et le motif.
-- `users.kyc` est CONSERVÉ tel quel (1 = vérifié) : les routes métier qui
-- testent `!user.kyc` continuent de fonctionner sans modification. Les comptes
-- déjà vérifiés avant cette migration n'ont pas de dossier : ils restent
-- vérifiés (aucune réécriture de données, donc aucune perte d'accès).
--
-- Publicités : le carrousel lisait un fichier statique (assets/ad/pubs.json).
-- La table `ads` en devient la source, avec les mêmes champs + un état actif et
-- un ordre d'affichage. Les bannières existantes y sont recopiées par le
-- serveur au démarrage (voir admin/store.js), pas ici : une migration est
-- immuable, ses données de départ ne doivent pas figer le contenu éditorial.
-- =========================================================

-- ---------- Catalogue des modules administrables ----------
CREATE TABLE IF NOT EXISTS admin_modules (
  id       TEXT PRIMARY KEY,
  enabled  INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT
);

-- ---------- Rôles ----------
CREATE TABLE IF NOT EXISTS admin_roles (
  id          TEXT PRIMARY KEY,
  label       TEXT NOT NULL,
  description TEXT,
  /* 1 = rôle fondateur : intouchable (droits complets, non supprimable) */
  protected   INTEGER NOT NULL DEFAULT 0
);

-- ---------- Droits : (rôle, module, action) ----------
CREATE TABLE IF NOT EXISTS admin_grants (
  role_id  TEXT NOT NULL,
  module   TEXT NOT NULL,
  action   TEXT NOT NULL,
  allowed  INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (role_id, module, action)
);
CREATE INDEX IF NOT EXISTS idx_admin_grants_role ON admin_grants(role_id, module);

-- ---------- Attribution des rôles aux joueurs ----------
CREATE TABLE IF NOT EXISTS admin_assignments (
  user_id    INTEGER NOT NULL,
  role_id    TEXT NOT NULL,
  granted_by INTEGER,
  granted_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, role_id)
);
CREATE INDEX IF NOT EXISTS idx_admin_assignments_role ON admin_assignments(role_id);

-- ---------- Journal d'administration (ajout seul) ----------
CREATE TABLE IF NOT EXISTS admin_audit (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  at           TEXT NOT NULL DEFAULT (datetime('now')),
  actor_id     INTEGER,
  actor_pseudo TEXT,
  action       TEXT NOT NULL,
  target       TEXT,
  detail_json  TEXT,
  ip           TEXT
);
CREATE INDEX IF NOT EXISTS idx_admin_audit_at ON admin_audit(at);
CREATE INDEX IF NOT EXISTS idx_admin_audit_actor ON admin_audit(actor_id);


/* Un journal modifiable n'est pas un journal : on interdit la réécriture et
   l'effacement au niveau du moteur, pas par discipline des appelants. */
CREATE TRIGGER IF NOT EXISTS admin_audit_no_update
BEFORE UPDATE ON admin_audit
BEGIN
  SELECT RAISE(ABORT, 'admin_audit est en écriture seule');
END;

CREATE TRIGGER IF NOT EXISTS admin_audit_no_delete
BEFORE DELETE ON admin_audit
BEGIN
  SELECT RAISE(ABORT, 'admin_audit est en écriture seule');
END;

-- ---------- Publicités du carrousel d'accueil ----------
CREATE TABLE IF NOT EXISTS ads (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  slug       TEXT UNIQUE NOT NULL,
  titre      TEXT NOT NULL,
  image      TEXT NOT NULL,
  repli      TEXT,
  lien       TEXT,
  debut      TEXT,
  fin        TEXT,
  position   TEXT NOT NULL DEFAULT 'accueil',
  actif      INTEGER NOT NULL DEFAULT 1,
  ordre      INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_ads_position ON ads(position, actif, ordre);

-- ---------- Dossiers KYC (recto + verso) ----------
CREATE TABLE IF NOT EXISTS kyc_cases (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER NOT NULL,
  status       TEXT NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending', 'verified', 'rejected')),
  /* Chemins RELATIFS au dossier privé du serveur (private/kyc/…) : un chemin
     absolu rendrait la base dépendante de la machine qui l'a écrite. */
  recto_path   TEXT NOT NULL,
  verso_path   TEXT NOT NULL,
  /* Empreintes : deux faces identiques = même image envoyée deux fois. */
  recto_sha    TEXT NOT NULL,
  verso_sha    TEXT NOT NULL,
  mime_recto   TEXT NOT NULL,
  mime_verso   TEXT NOT NULL,
  bytes_recto  INTEGER NOT NULL,
  bytes_verso  INTEGER NOT NULL,
  reason       TEXT,
  submitted_at TEXT NOT NULL DEFAULT (datetime('now')),
  reviewed_at  TEXT,
  reviewer_id  INTEGER
);
CREATE INDEX IF NOT EXISTS idx_kyc_user ON kyc_cases(user_id, submitted_at);
CREATE INDEX IF NOT EXISTS idx_kyc_status ON kyc_cases(status, submitted_at);
/* Un seul dossier OUVERT par joueur : une nouvelle demande remplace la
   précédente, elle ne s'empile pas (sinon la file de revue devient illisible
   et un joueur peut noyer ses refus). */
CREATE UNIQUE INDEX IF NOT EXISTS idx_kyc_one_pending
  ON kyc_cases(user_id) WHERE status = 'pending';
