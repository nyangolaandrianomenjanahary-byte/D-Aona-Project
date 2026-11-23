-- =========================================================
-- 019 — Catalogue des jeux : la variante devient un objet administrable
-- ---------------------------------------------------------
-- Constat : l'existence d'un jeu est décidée par un dossier de code
-- (`games/<slug>/` + `games/registry.js`). Un opérateur ne peut donc ni
-- préparer une variante « en brouillon », ni retirer un plateau de l'affichage
-- sans redéployer, ni écrire les règles que le joueur lit avant de s'engager.
--
-- Décision — la table porte l'ÉTAT ÉDITORIAL, le dossier de code porte le
-- MOTEUR. Les deux ne se confondent pas :
--   · `manifest.json` décrit la géométrie et les règles EXÉCUTABLES ;
--   · `admin_games` décrit ce que l'administration décide : disponible ou non,
--     brouillon ou publié, quelle durée, quel droit d'entrée au classement,
--     quel texte de règles.
-- Un jeu présent en code et absent de cette table n'est PAS publié ; un jeu
-- présent ici et absent du registre est signalé comme « moteur introuvable »
-- par l'écran plutôt que silencieusement masqué — un catalogue qui mentirait
-- sur la disponibilité réelle serait pire que pas de catalogue.
--
-- Pas de données de départ dans cette migration : les lignes sont recopiées au
-- démarrage depuis `games/registry.js` (`admin/store/competition.js`,
-- `ensureCatalogue()`), exactement pour la raison exposée en 016 — une
-- migration est immuable, elle ne doit pas figer un contenu éditorial qui
-- changera au prochain lot. Effet secondaire utile : ajouter un dossier de jeu
-- suffit, l'entrée apparaît en brouillon.
--
-- Le préfixe `admin_` n'est pas décoratif : la table `games` existe déjà et
-- désigne l'HISTORIQUE des parties jouées. Deux objets différents sous le même
-- nom au même endroit produiraient tôt ou tard un `SELECT` sur la mauvaise.
-- =========================================================

CREATE TABLE IF NOT EXISTS admin_games (
  /* Identifiant du registre (« fanorona », « blitz », « fanoron-telo »…).
     Clé naturelle : c'est aussi le nom du dossier de code. */
  slug        TEXT PRIMARY KEY,
  name        TEXT    NOT NULL,
  /* Précision affichée sous le nom (« Blitz · 10 minutes »). */
  variant     TEXT,
  /* draft = préparé, invisible du joueur ; active = proposé ;
     archived = retiré, mais l'historique des parties reste lisible. */
  status      TEXT    NOT NULL DEFAULT 'draft'
              CHECK (status IN ('draft', 'active', 'archived')),
  /* Durée indicative d'une partie, en minutes. */
  duration    INTEGER NOT NULL DEFAULT 30 CHECK (duration > 0),
  /* 1 = la partie compte pour le classement Elo. */
  ranked      INTEGER NOT NULL DEFAULT 1,
  /* Elo minimum pour s'inscrire ; 0 = ouvert à tous. */
  min_elo     INTEGER NOT NULL DEFAULT 0 CHECK (min_elo >= 0),
  /* Règles affichées au joueur. Texte long assumé : c'est un contenu
     éditorial, borné par le code (4000 caractères). */
  rules       TEXT,
  /* Incrémenté à chaque enregistrement : permet à l'écran de signaler une
     modification non enregistrée et de tracer la version publiée. */
  version     INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT
);

/* Écran « Jeux & règles » : les publiés d'abord, puis l'ordre alphabétique. */
CREATE INDEX IF NOT EXISTS idx_admin_games_status ON admin_games(status, name);
